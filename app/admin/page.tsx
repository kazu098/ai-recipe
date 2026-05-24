"use client";

import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventCount = { event_name: string; cnt: number };
type DailyEvent = { day: string; event_name: string; cnt: number };
type BreakdownItem = { genre?: string; pattern?: string; count: number };
type Stats = {
  days: number;
  event_counts: EventCount[];
  daily_events: DailyEvent[];
  genre_breakdown: BreakdownItem[];
  pattern_breakdown: BreakdownItem[];
  user_stats: { total: number; by_plan: Record<string, number> };
  repeat_stats: { total_users: number; repeat_users: number; repeat_rate: number };
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  photo_uploaded:      "📷 写真アップロード",
  analysis_started:    "🔍 解析開始",
  analysis_error:      "❌ 解析エラー",
  meal_suggested:      "🍽 献立提案",
  alternative_viewed:  "👆 代替案閲覧",
  meal_selected:       "✅ 献立選択",
  recipe_cooked:       "🍳 作った",
  guest_limit_hit:     "⚠ ゲスト上限到達",
  upgrade_modal_shown: "💰 アップグレード表示",
  login_prompted:      "🔑 ログイン誘導",
  login_completed:     "🎉 ログイン完了",
};

const PATTERN_LABELS: Record<string, string> = {
  japanese: "🍱 和食",
  western:  "🍽️ 洋食",
  chinese:  "🥢 中華",
  korean:   "🫕 韓国",
  ethnic:   "🌮 エスニック",
  oneplate: "🥗 ワンプレート",
};

function pct(a: number, b: number): string {
  if (!b) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

function Bar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${w}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{value}</span>
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);

  const loadStats = (d: number) => {
    setLoading(true);
    fetch(`/api/admin/stats?days=${d}&_=${Date.now()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("forbidden");
        return r.json();
      })
      .then((data: Stats) => {
        setStats(data);
        setFetchedAt(new Date());
        setLoading(false);
      })
      .catch((e: Error) => { setError(e.message); setLoading(false); });
  };

  useEffect(() => { loadStats(days); }, [days]);

  const ec = (name: string) =>
    stats?.event_counts.find((e) => e.event_name === name)?.cnt ?? 0;

  // ファネル
  const funnel = [
    { label: "解析開始",   count: ec("analysis_started") },
    { label: "献立提案",   count: ec("meal_suggested") },
    { label: "献立選択",   count: ec("meal_selected") },
    { label: "作った",     count: ec("recipe_cooked") },
  ];

  // 直近 N 日のユニーク日付
  const chartDays = (() => {
    if (!stats) return [];
    const daySet = new Set(stats.daily_events.map((d) => d.day));
    return Array.from(daySet).sort();
  })();

  // 選択イベントのみの日別数（棒グラフ用）
  const chartData = chartDays.map((day) => ({
    day,
    selected: stats?.daily_events.find(
      (d) => d.day === day && d.event_name === "meal_selected"
    )?.cnt ?? 0,
    started: stats?.daily_events.find(
      (d) => d.day === day && d.event_name === "analysis_started"
    )?.cnt ?? 0,
  }));

  const maxChartVal = Math.max(...chartData.map((d) => d.started), 1);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        アクセス拒否されました
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 max-w-4xl mx-auto px-4 py-8">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Snapmeal Admin</h1>
          <p className="text-sm text-gray-400 mt-0.5">Analytics Dashboard</p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              onClick={() => { setDays(d); if (d === days) loadStats(d); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition ${
                days === d ? "bg-primary text-white" : "bg-white text-gray-600 border border-gray-200 hover:border-gray-300"
              }`}
            >
              {d}日
            </button>
          ))}
          <button
            onClick={() => loadStats(days)}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-white text-gray-600 border border-gray-200 hover:border-gray-300 transition"
            title="最新データを取得"
          >
            ↻
          </button>
        </div>
      </div>
      {fetchedAt && (
        <p className="text-xs text-gray-400 mb-6">
          取得: {fetchedAt.toLocaleTimeString("ja-JP")} ・ 管理者自身のイベントは除外済み
        </p>
      )}

      {loading ? (
        <div className="flex justify-center mt-24">
          <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : stats ? (
        <div className="space-y-8">

          {/* ユーザー指標 */}
          <section>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">ユーザー</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricCard label="総ユーザー数" value={stats.user_stats.total} />
              <MetricCard
                label="Proユーザー"
                value={stats.user_stats.by_plan["pro"] ?? 0}
                sub={pct(stats.user_stats.by_plan["pro"] ?? 0, stats.user_stats.total) + " CVR"}
              />
              <MetricCard label="解析開始" value={ec("analysis_started")} sub={`${days}日間`} />
              <MetricCard
                label="ゲスト上限到達"
                value={ec("guest_limit_hit")}
                sub={`${pct(ec("guest_limit_hit"), ec("analysis_started"))} of 解析`}
              />
            </div>
          </section>

          {/* エンゲージメント指標 */}
          <section>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">エンゲージメント</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MetricCard
                label="7日リピート率"
                value={`${stats.repeat_stats.repeat_rate}%`}
                sub={`${stats.repeat_stats.repeat_users} / ${stats.repeat_stats.total_users} ユーザー`}
              />
              <MetricCard
                label="解析エラー率"
                value={`${pct(ec("analysis_error"), ec("analysis_started"))}`}
                sub={`${ec("analysis_error")} エラー / ${ec("analysis_started")} 解析`}
              />
              <MetricCard
                label="代替案閲覧率"
                value={pct(ec("alternative_viewed"), ec("meal_suggested"))}
                sub={`${ec("alternative_viewed")} / ${ec("meal_suggested")} 献立提案`}
              />
            </div>
          </section>

          {/* ファネル */}
          <section>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">コンバージョンファネル</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {funnel.map((step, i) => {
                const prevCount = i === 0 ? step.count : funnel[i - 1].count;
                const cvr = pct(step.count, prevCount);
                const barW = funnel[0].count > 0 ? Math.round((step.count / funnel[0].count) * 100) : 0;
                return (
                  <div key={step.label} className="flex items-center gap-4 px-5 py-4 border-b border-gray-50 last:border-0">
                    <div className="w-4 h-4 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold flex-shrink-0">
                      {i + 1}
                    </div>
                    <div className="w-20 flex-shrink-0">
                      <p className="text-sm font-semibold text-gray-700">{step.label}</p>
                      {i > 0 && <p className="text-xs text-gray-400">{cvr} of 前ステップ</p>}
                    </div>
                    <div className="flex-1">
                      <div className="bg-gray-100 rounded-full h-3">
                        <div
                          className="bg-primary h-3 rounded-full transition-all"
                          style={{ width: `${barW}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-lg font-bold text-gray-800 w-12 text-right">
                      {step.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 日別トレンド */}
          {chartData.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">
                日別トレンド（解析開始 / 献立選択）
              </h2>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-end gap-1 h-24">
                  {chartData.slice(-30).map((d) => (
                    <div
                      key={d.day}
                      className="flex-1 flex flex-col-reverse items-center gap-0.5 group relative"
                    >
                      <div
                        className="w-full bg-primary/20 rounded-sm"
                        style={{ height: `${Math.round((d.started / maxChartVal) * 88)}px` }}
                      />
                      <div
                        className="w-full bg-primary rounded-sm"
                        style={{ height: `${Math.round((d.selected / maxChartVal) * 88)}px` }}
                      />
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap z-10">
                        {d.day.slice(5)}: {d.started}開始/{d.selected}選択
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 mt-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary/20 inline-block" />解析開始</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary inline-block" />献立選択</span>
                </div>
              </div>
            </section>
          )}

          {/* ジャンル内訳 / パターン内訳 */}
          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">選ばれたジャンル</h2>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                {stats.genre_breakdown.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">データなし</p>
                ) : stats.genre_breakdown.map((g) => (
                  <div key={g.genre}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">{g.genre ?? "不明"}</span>
                      <span className="text-gray-400 text-xs">{pct(g.count, ec("meal_selected"))}</span>
                    </div>
                    <Bar value={g.count} max={stats.genre_breakdown[0]?.count ?? 1} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">献立スタイル</h2>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
                {stats.pattern_breakdown.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-4">データなし</p>
                ) : stats.pattern_breakdown.map((p) => (
                  <div key={p.pattern}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">
                        {PATTERN_LABELS[p.pattern ?? ""] ?? p.pattern ?? "不明"}
                      </span>
                      <span className="text-gray-400 text-xs">
                        {pct(p.count, ec("analysis_started"))}
                      </span>
                    </div>
                    <Bar value={p.count} max={stats.pattern_breakdown[0]?.count ?? 1} color="bg-accent" />
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* 全イベント一覧 */}
          <section>
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-3">全イベント（{days}日間）</h2>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              {stats.event_counts.map((e) => (
                <div key={e.event_name} className="flex items-center justify-between px-5 py-3 border-b border-gray-50 last:border-0">
                  <span className="text-sm text-gray-700">
                    {EVENT_LABELS[e.event_name] ?? e.event_name}
                  </span>
                  <span className="text-sm font-bold text-gray-900">{e.cnt}</span>
                </div>
              ))}
              {stats.event_counts.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-8">イベントデータなし</p>
              )}
            </div>
          </section>

        </div>
      ) : null}
    </main>
  );
}
