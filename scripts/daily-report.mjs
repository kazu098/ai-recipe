#!/usr/bin/env node
/**
 * Snapmeal Daily Analytics Report
 * - Fetches GA4 + Supabase data for yesterday (JST)
 * - Applies rule-based analysis against 14-day history
 * - Posts to Slack (with alerts if rules fire)
 * - Creates GitHub Issue for HIGH-priority alerts
 * - Writes today's metrics to HISTORY_FILE for weekly analysis
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   GA4_PROPERTY_ID, GA4_REFRESH_TOKEN, GA4_CLIENT_ID, GA4_CLIENT_SECRET
 *   SLACK_WEBHOOK_URL
 *   GITHUB_TOKEN  (auto-provided in GitHub Actions)
 *   HISTORY_FILE  (path to analytics-history.json, default: data/analytics-history.json)
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GA4_PROPERTY_ID,
  GA4_REFRESH_TOKEN,
  GA4_CLIENT_ID,
  GA4_CLIENT_SECRET,
  SLACK_WEBHOOK_URL,
  GITHUB_TOKEN,
  HISTORY_FILE = 'data/analytics-history.json',
} = process.env;

// ── JST yesterday ─────────────────────────────────────────────────

function getYesterdayJst() {
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(jstNow);
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return {
    dateStr: `${y}-${m}-${day}`,
    label: `${y}/${m}/${day}`,
    startISO: `${y}-${m}-${day}T00:00:00+09:00`,
    endISO: `${y}-${m}-${day}T23:59:59+09:00`,
  };
}

// ── Google OAuth ──────────────────────────────────────────────────

async function getGoogleAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: GA4_REFRESH_TOKEN,
      client_id: GA4_CLIENT_ID,
      client_secret: GA4_CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── GA4 Data API ──────────────────────────────────────────────────

async function fetchGA4(dateStr) {
  const token = await getGoogleAccessToken();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [generalRes, ctaRes] = await Promise.all([
    fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStr, endDate: dateStr }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      }),
    }),
    fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStr, endDate: dateStr }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: { fieldName: 'eventName', stringFilter: { value: 'cta_click', matchType: 'EXACT' } },
        },
      }),
    }),
  ]);

  const [general, cta] = await Promise.all([generalRes.json(), ctaRes.json()]);
  return {
    sessions: parseInt(general.rows?.[0]?.metricValues?.[0]?.value ?? '0'),
    users:    parseInt(general.rows?.[0]?.metricValues?.[1]?.value ?? '0'),
    ctaClicks: parseInt(cta.rows?.[0]?.metricValues?.[0]?.value ?? '0'),
  };
}

// ── Supabase ──────────────────────────────────────────────────────

async function fetchSupabase(startISO, endISO) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Prefer: 'count=exact',
  };
  const qs = (start, end, extra = '') =>
    `?select=id${extra}&created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}`;
  const parseCount = res => parseInt((res.headers.get('content-range') ?? '*/0').split('/')[1] ?? '0');

  const [profilesRes, eventsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles${qs(startISO, endISO)}`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/analytics_events${qs(startISO, endISO, '&event_name=eq.meal_suggested')}`, { headers }),
  ]);

  return {
    newUsers: parseCount(profilesRes),
    mealSuggested: parseCount(eventsRes),
  };
}

// ── History (14-day Supabase data for rule analysis) ─────────────

async function fetchSupabaseHistory() {
  const since = new Date(Date.now() - 15 * 24 * 3600 * 1000);
  const sinceISO = since.toISOString();
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };

  const [eventsRes, profilesRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_daily_events`, {
      method: 'POST', headers,
      body: JSON.stringify({ p_since: sinceISO }),
    }),
    fetch(
      `${SUPABASE_URL}/rest/v1/profiles?select=created_at&created_at=gte.${encodeURIComponent(sinceISO)}`,
      { headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` } }
    ),
  ]);

  const events = await eventsRes.json();
  const profiles = await profilesRes.json();

  const byDay = {};
  for (const e of Array.isArray(events) ? events : []) {
    const day = String(e.day).slice(0, 10);
    if (!byDay[day]) byDay[day] = {};
    byDay[day][e.event_name] = Number(e.cnt);
  }
  for (const p of Array.isArray(profiles) ? profiles : []) {
    const day = String(p.created_at).slice(0, 10);
    if (!byDay[day]) byDay[day] = {};
    byDay[day].newUsers = (byDay[day].newUsers || 0) + 1;
  }

  return Object.entries(byDay)
    .map(([date, d]) => ({
      date,
      mealSuggested: d.meal_suggested || 0,
      newUsers: d.newUsers || 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Rule-based analysis ───────────────────────────────────────────

function avg(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function analyzeRules(today, history) {
  const alerts = [];
  const last7 = history.slice(-7);
  if (last7.length < 3) return alerts;

  const avgMeal    = avg(last7.map(d => d.mealSuggested));
  const avgNewUsers = avg(last7.map(d => d.newUsers));

  // Rule 1: 献立生成が7日平均比 -40% 以上
  if (avgMeal > 5 && today.mealSuggested < avgMeal * 0.6) {
    const pct = Math.round((1 - today.mealSuggested / avgMeal) * 100);
    alerts.push({
      level: 'HIGH', emoji: '🚨',
      message: `献立生成数が7日平均比 *-${pct}%* (${today.mealSuggested}件 vs 平均${Math.round(avgMeal)}件)`,
      action: 'アプリに障害が発生していないか確認してください',
    });
  }

  // Rule 2: 新規ユーザー3日連続ゼロ
  const recentNewUsers = [...last7, today].slice(-3).map(d => d.newUsers);
  if (recentNewUsers.every(n => n === 0) && avgNewUsers > 0) {
    alerts.push({
      level: 'HIGH', emoji: '🚨',
      message: '新規ユーザーが3日以上連続でゼロです',
      action: 'LP・SEO・SNS流入を確認してください',
    });
  }

  // Rule 3: 献立生成が7日平均比 -25%（MEDIUM）
  if (avgMeal > 5 && today.mealSuggested < avgMeal * 0.75 && today.mealSuggested >= avgMeal * 0.6) {
    const pct = Math.round((1 - today.mealSuggested / avgMeal) * 100);
    alerts.push({
      level: 'MEDIUM', emoji: '⚠️',
      message: `献立生成数がやや減少 (-${pct}% vs 7日平均)`,
      action: 'しばらく様子を見てください',
    });
  }

  // Rule 4: 新規ユーザー当たりの献立生成が少ない（アクティベーション低下）
  if (today.newUsers >= 3 && today.mealSuggested / today.newUsers < 1.5) {
    alerts.push({
      level: 'MEDIUM', emoji: '⚠️',
      message: `新規ユーザー活性化率が低下 (新規${today.newUsers}人 → 献立${today.mealSuggested}件)`,
      action: 'オンボーディングフローに問題がないか確認してください',
    });
  }

  // Rule 5: 週間トレンドで連続減少（3日以上）
  const recentMeals = [...last7, today].slice(-4).map(d => d.mealSuggested);
  if (recentMeals.length === 4 && recentMeals.every((v, i) => i === 0 || v <= recentMeals[i - 1]) && recentMeals[0] > 0) {
    alerts.push({
      level: 'MEDIUM', emoji: '📉',
      message: '献立生成数が4日連続で減少しています',
      action: '直近のリリース内容やユーザーフィードバックを確認してください',
    });
  }

  return alerts;
}

// ── Slack ─────────────────────────────────────────────────────────

function fmt(v) {
  return v != null ? `\`${Number(v).toLocaleString('ja-JP')}\`` : '`-`';
}

async function postToSlack(label, ga4, sb, alerts) {
  const hasHigh = alerts.some(a => a.level === 'HIGH');
  const titleEmoji = hasHigh ? '🔴' : alerts.length > 0 ? '🟡' : '🟢';

  const lines = [
    `${titleEmoji} *Snapmeal 日次レポート — ${label}*`,
    '',
    '*🌐 LP パフォーマンス (Google Analytics)*',
    `• セッション数: ${fmt(ga4?.sessions)}`,
    `• ユーザー数: ${fmt(ga4?.users)}`,
    `• CTA クリック: ${fmt(ga4?.ctaClicks)}`,
    '',
    '*📱 アプリ使用状況 (Supabase)*',
    `• 新規ユーザー: ${fmt(sb?.newUsers)}`,
    `• 献立生成数: ${fmt(sb?.mealSuggested)}`,
  ];

  if (alerts.length > 0) {
    lines.push('');
    lines.push('*📋 アラート*');
    for (const a of alerts) {
      lines.push(`${a.emoji} [${a.level}] ${a.message}`);
      lines.push(`  → ${a.action}`);
    }
  } else {
    lines.push('');
    lines.push('_異常なし。引き続き様子を見てください。_');
  }

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  if (!res.ok) throw new Error(`Slack post failed: ${res.status}`);
}

// ── GitHub Issue ──────────────────────────────────────────────────

async function createGitHubIssue(date, alerts) {
  if (!GITHUB_TOKEN) return;
  const highAlerts = alerts.filter(a => a.level === 'HIGH');
  if (highAlerts.length === 0) return;

  const title = `🚨 Analytics Alert: ${date} — ${highAlerts.map(a => a.message.replace(/\*/g, '').slice(0, 40)).join(' / ')}`;
  const body = [
    `## 日次レポートアラート (${date})`,
    '',
    ...highAlerts.map(a => [
      `### ${a.emoji} ${a.message.replace(/\*/g, '')}`,
      '',
      `**推奨アクション**: ${a.action}`,
    ].join('\n')),
    '',
    `---`,
    `_GitHub Actions の daily-report ワークフローにより自動作成_`,
  ].join('\n');

  const res = await fetch('https://api.github.com/repos/kazu098/ai-recipe/issues', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, labels: ['analytics', 'alert'] }),
  });
  const issue = await res.json();
  if (issue.html_url) console.log('GitHub Issue created:', issue.html_url);
}

// ── History file ──────────────────────────────────────────────────

function readHistory() {
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeHistory(history, todayEntry) {
  const updated = [...history.filter(e => e.date !== todayEntry.date), todayEntry]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30); // keep last 30 days
  mkdirSync(dirname(HISTORY_FILE), { recursive: true });
  writeFileSync(HISTORY_FILE, JSON.stringify(updated, null, 2));
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const date = getYesterdayJst();
  console.log(`Fetching data for ${date.label}...`);

  const [ga4Result, sbResult, historyResult] = await Promise.allSettled([
    fetchGA4(date.dateStr),
    fetchSupabase(date.startISO, date.endISO),
    fetchSupabaseHistory(),
  ]);

  if (ga4Result.status === 'rejected') console.error('GA4 error:', ga4Result.reason);
  if (sbResult.status === 'rejected') console.error('Supabase error:', sbResult.reason);
  if (historyResult.status === 'rejected') console.error('History error:', historyResult.reason);

  const ga4 = ga4Result.status === 'fulfilled' ? ga4Result.value : null;
  const sb  = sbResult.status  === 'fulfilled' ? sbResult.value  : null;
  const supabaseHistory = historyResult.status === 'fulfilled' ? historyResult.value : [];

  // Load stored history (for weekly analysis continuity)
  const storedHistory = readHistory();

  // Rule-based analysis using Supabase history
  const todayForRules = { ...sb, date: date.dateStr };
  const alerts = sb ? analyzeRules(todayForRules, supabaseHistory) : [];

  if (alerts.length > 0) {
    console.log('Alerts:', alerts.map(a => `[${a.level}] ${a.message.replace(/\*/g, '')}`));
  }

  // Post to Slack
  await postToSlack(date.label, ga4, sb, alerts);

  // Create GitHub Issue for HIGH alerts
  await createGitHubIssue(date.label, alerts);

  // Save to history file (for weekly Gemini analysis)
  const todayEntry = {
    date: date.dateStr,
    sessions:      ga4?.sessions      ?? null,
    users:         ga4?.users         ?? null,
    ctaClicks:     ga4?.ctaClicks     ?? null,
    newUsers:      sb?.newUsers       ?? null,
    mealSuggested: sb?.mealSuggested  ?? null,
  };
  writeHistory(storedHistory, todayEntry);
  console.log('History updated.');
  console.log('Done.');
}

main().catch(err => {
  console.error('Report failed:', err);
  process.exit(1);
});
