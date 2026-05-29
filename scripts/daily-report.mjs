#!/usr/bin/env node
/**
 * Snapmeal Daily Analytics Report
 * Fetches GA4 + Supabase data for yesterday (JST) and posts to Slack.
 *
 * Required env vars:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   GA4_PROPERTY_ID, GA4_SERVICE_ACCOUNT_KEY (JSON string)
 *   SLACK_WEBHOOK_URL
 */

import { createSign } from 'node:crypto';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GA4_PROPERTY_ID,
  GA4_SERVICE_ACCOUNT_KEY,
  SLACK_WEBHOOK_URL,
} = process.env;

// ── JST yesterday ──────────────────────────────────────────────────

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

// ── Google Service Account Auth ────────────────────────────────────

async function getGoogleAccessToken() {
  const key = JSON.parse(GA4_SERVICE_ACCOUNT_KEY);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/analytics.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })).toString('base64url');
  const signer = createSign('RSA-SHA256');
  signer.write(`${header}.${payload}`);
  signer.end();
  const sig = signer.sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${payload}.${sig}`,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── GA4 Data API ───────────────────────────────────────────────────

async function fetchGA4(dateStr) {
  const token = await getGoogleAccessToken();
  const url = `https://analyticsdata.googleapis.com/v1beta/properties/${GA4_PROPERTY_ID}:runReport`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const [generalRes, ctaRes] = await Promise.all([
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStr, endDate: dateStr }],
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      }),
    }),
    fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        dateRanges: [{ startDate: dateStr, endDate: dateStr }],
        metrics: [{ name: 'eventCount' }],
        dimensionFilter: {
          filter: {
            fieldName: 'eventName',
            stringFilter: { value: 'cta_click', matchType: 'EXACT' },
          },
        },
      }),
    }),
  ]);

  const [general, cta] = await Promise.all([generalRes.json(), ctaRes.json()]);
  return {
    sessions: parseInt(general.rows?.[0]?.metricValues?.[0]?.value ?? '0'),
    users: parseInt(general.rows?.[0]?.metricValues?.[1]?.value ?? '0'),
    ctaClicks: parseInt(cta.rows?.[0]?.metricValues?.[0]?.value ?? '0'),
  };
}

// ── Supabase REST API ──────────────────────────────────────────────

async function fetchSupabase(startISO, endISO) {
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Prefer: 'count=exact',
  };

  const qs = (start, end, extra = '') =>
    `?select=id${extra}&created_at=gte.${encodeURIComponent(start)}&created_at=lte.${encodeURIComponent(end)}`;

  const [profilesRes, eventsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/profiles${qs(startISO, endISO)}`, { headers }),
    fetch(`${SUPABASE_URL}/rest/v1/analytics_events${qs(startISO, endISO, '&event_name=eq.meal_suggested')}`, { headers }),
  ]);

  const parseCount = res => {
    const range = res.headers.get('content-range') ?? '*/0';
    return parseInt(range.split('/')[1] ?? '0');
  };

  return {
    newUsers: parseCount(profilesRes),
    mealSuggested: parseCount(eventsRes),
  };
}

// ── Slack ──────────────────────────────────────────────────────────

function fmt(v) {
  return v != null ? `\`${Number(v).toLocaleString('ja-JP')}\`` : '`-`';
}

async function postToSlack(label, ga4, sb) {
  const lines = [
    `📊 *Snapmeal 日次レポート — ${label}*`,
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

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  if (!res.ok) throw new Error(`Slack post failed: ${res.status}`);
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const date = getYesterdayJst();
  console.log(`Fetching data for ${date.label}...`);

  const [ga4Result, sbResult] = await Promise.allSettled([
    fetchGA4(date.dateStr),
    fetchSupabase(date.startISO, date.endISO),
  ]);

  if (ga4Result.status === 'rejected') console.error('GA4 error:', ga4Result.reason);
  if (sbResult.status === 'rejected') console.error('Supabase error:', sbResult.reason);

  const ga4 = ga4Result.status === 'fulfilled' ? ga4Result.value : null;
  const sb = sbResult.status === 'fulfilled' ? sbResult.value : null;

  await postToSlack(date.label, ga4, sb);
  console.log('Done.');
}

main().catch(err => {
  console.error('Report failed:', err);
  process.exit(1);
});
