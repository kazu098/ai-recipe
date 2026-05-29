#!/usr/bin/env node
/**
 * Snapmeal Weekly Analysis (Gemini Flash)
 * - Reads last 7 days from data/analytics-history.json
 * - Sends to Gemini 1.5 Flash for strategic analysis
 * - Posts recommendations to Slack
 * - Creates GitHub Issues for HIGH-priority next actions
 *
 * Required env vars:
 *   GEMINI_API_KEY
 *   SLACK_WEBHOOK_URL
 *   GITHUB_TOKEN  (auto-provided in GitHub Actions)
 *   HISTORY_FILE  (default: data/analytics-history.json)
 */

import { readFileSync } from 'node:fs';

const {
  GEMINI_API_KEY,
  SLACK_WEBHOOK_URL,
  GITHUB_TOKEN,
  HISTORY_FILE = 'data/analytics-history.json',
} = process.env;

// ── Read history ──────────────────────────────────────────────────

function readHistory() {
  try {
    const all = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'));
    return all.slice(-7); // last 7 days
  } catch {
    return [];
  }
}

// ── Gemini analysis ───────────────────────────────────────────────

async function analyzeWithGemini(history) {
  const rows = history.map(d =>
    `${d.date}: セッション=${d.sessions ?? '-'} ユーザー=${d.users ?? '-'} CTA=${d.ctaClicks ?? '-'} 新規ユーザー=${d.newUsers ?? '-'} 献立生成=${d.mealSuggested ?? '-'}`
  ).join('\n');

  const prompt = `
あなたは食事提案アプリ「Snapmeal」のグロースアナリストです。
以下は直近7日間の日次メトリクスです。

【指標の定義】
- セッション/ユーザー: LP（snap-meal.com）の訪問数
- CTA: LPの「ベータ版を試す」ボタンのクリック数
- 新規ユーザー: アプリに新規登録したユーザー数
- 献立生成: アプリ内でAI献立提案が実行された回数

【直近7日間のデータ】
${rows}

上記データを分析し、以下のJSON形式のみで回答してください（説明文は不要）:
{
  "summary": "今週の全体的な所感（2文以内）",
  "positives": ["良かった点1", "良かった点2"],
  "concerns": ["懸念点1", "懸念点2"],
  "next_actions": [
    {
      "priority": "HIGH or MEDIUM",
      "title": "アクション名（20文字以内）",
      "description": "具体的な内容（50文字以内）",
      "metric": "改善を確認する指標"
    }
  ]
}
`.trim();

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 },
      }),
    }
  );

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Gemini returned unexpected format: ${text.slice(0, 200)}`);
  return JSON.parse(jsonMatch[0]);
}

// ── Slack ─────────────────────────────────────────────────────────

async function postToSlack(history, analysis) {
  const startDate = history[0]?.date ?? '-';
  const endDate   = history[history.length - 1]?.date ?? '-';

  const lines = [
    `📊 *Snapmeal 週次AIレポート — ${startDate} 〜 ${endDate}*`,
    '',
    `*📝 今週のサマリー*`,
    analysis.summary,
    '',
  ];

  if (analysis.positives?.length) {
    lines.push('*✅ 良かった点*');
    for (const p of analysis.positives) lines.push(`• ${p}`);
    lines.push('');
  }

  if (analysis.concerns?.length) {
    lines.push('*⚠️ 懸念点*');
    for (const c of analysis.concerns) lines.push(`• ${c}`);
    lines.push('');
  }

  if (analysis.next_actions?.length) {
    lines.push('*🎯 推奨アクション*');
    for (const a of analysis.next_actions) {
      const badge = a.priority === 'HIGH' ? '🔴' : '🟡';
      lines.push(`${badge} *${a.title}*`);
      lines.push(`  ${a.description}`);
      lines.push(`  確認指標: ${a.metric}`);
    }
  }

  lines.push('');
  lines.push('_Gemini 1.5 Flash による自動分析_');

  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') }),
  });
  if (!res.ok) throw new Error(`Slack post failed: ${res.status}`);
}

// ── GitHub Issues ─────────────────────────────────────────────────

async function createGitHubIssues(analysis, weekLabel) {
  if (!GITHUB_TOKEN) return;
  const highActions = (analysis.next_actions ?? []).filter(a => a.priority === 'HIGH');

  for (const action of highActions) {
    const title = `🎯 [週次] ${action.title} (${weekLabel})`;
    const body = [
      `## ${action.title}`,
      '',
      `**背景**: ${analysis.summary}`,
      '',
      `**具体的な内容**`,
      action.description,
      '',
      `**改善を確認する指標**: ${action.metric}`,
      '',
      `---`,
      `_Snapmeal 週次 AI レポートにより自動作成 (Gemini 1.5 Flash)_`,
    ].join('\n');

    const res = await fetch('https://api.github.com/repos/kazu098/ai-recipe/issues', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, labels: ['analytics', 'weekly-review'] }),
    });
    const issue = await res.json();
    if (issue.html_url) console.log('Issue created:', issue.html_url);
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const history = readHistory();
  if (history.length < 3) {
    console.log('Not enough history for analysis (need >= 3 days). Skipping.');
    return;
  }

  const weekLabel = `${history[0].date}〜${history[history.length - 1].date}`;
  console.log(`Analyzing week: ${weekLabel}`);

  const analysis = await analyzeWithGemini(history);
  console.log('Summary:', analysis.summary);
  console.log('Next actions:', analysis.next_actions?.map(a => `[${a.priority}] ${a.title}`).join(', '));

  await postToSlack(history, analysis);
  await createGitHubIssues(analysis, weekLabel);

  console.log('Done.');
}

main().catch(err => {
  console.error('Weekly analysis failed:', err);
  process.exit(1);
});
