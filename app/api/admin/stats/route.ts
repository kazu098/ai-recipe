import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";

function isAdmin(email: string | undefined): boolean {
  return !!email && email === process.env.ADMIN_EMAIL;
}

export async function GET(req: NextRequest) {
  // 認証チェック
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const days = Number(req.nextUrl.searchParams.get("days") ?? "30");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // service_role で集計（RLS をバイパス）
  const admin = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [eventsRes, dailyRes, genreRes, patternRes, usersRes] = await Promise.all([
    // ① イベント別合計
    admin.rpc("admin_event_counts", { p_since: since }),

    // ② 日別イベント数（チャート用）
    admin.rpc("admin_daily_events", { p_since: since }),

    // ③ ジャンル別選択数
    admin
      .from("analytics_events")
      .select("properties")
      .eq("event_name", "meal_selected")
      .gte("created_at", since),

    // ④ ミールパターン別利用数
    admin
      .from("analytics_events")
      .select("properties")
      .eq("event_name", "analysis_started")
      .gte("created_at", since),

    // ⑤ ユーザー数（profiles）
    admin.from("profiles").select("plan", { count: "exact" }),
  ]);

  // ジャンル集計
  const genreMap: Record<string, number> = {};
  for (const row of genreRes.data ?? []) {
    const g = (row.properties as Record<string, string>)?.genre ?? "不明";
    genreMap[g] = (genreMap[g] ?? 0) + 1;
  }

  // パターン集計
  const patternMap: Record<string, number> = {};
  for (const row of patternRes.data ?? []) {
    const p = (row.properties as Record<string, string>)?.pattern ?? "不明";
    patternMap[p] = (patternMap[p] ?? 0) + 1;
  }

  // プラン別ユーザー数
  const planMap: Record<string, number> = {};
  for (const row of usersRes.data ?? []) {
    const p = (row as { plan: string }).plan ?? "free";
    planMap[p] = (planMap[p] ?? 0) + 1;
  }

  return NextResponse.json({
    days,
    event_counts: eventsRes.data ?? [],
    daily_events: dailyRes.data ?? [],
    genre_breakdown: Object.entries(genreMap)
      .map(([genre, count]) => ({ genre, count }))
      .sort((a, b) => b.count - a.count),
    pattern_breakdown: Object.entries(patternMap)
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count),
    user_stats: {
      total: usersRes.count ?? 0,
      by_plan: planMap,
    },
  });
}
