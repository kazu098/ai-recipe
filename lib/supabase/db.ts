import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { MealHistory } from "./types";

function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch { /* Route Handler内では無視 */ }
        },
      },
    }
  );
}

/** 認証済みユーザーのIDを取得。未認証ならnull */
export async function getAuthUserId(): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/** 過去14日間の meal_history を取得（プロンプト注入用） */
export async function getRecentMealHistory(userId: string): Promise<MealHistory[]> {
  const supabase = createClient();
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("meal_history")
    .select("*")
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);
  return (data ?? []) as MealHistory[];
}

/** セッションを作成して session_id を返す */
export async function createSession(params: {
  userId: string;
  tiredMode: boolean;
  detectedIngredients: string[];
}): Promise<string | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: params.userId,
      tired_mode: params.tiredMode,
      detected_ingredients: params.detectedIngredients,
    })
    .select("id")
    .single();
  if (error) return null;
  return data.id as string;
}

type MealInput = {
  meal_name: string;
  genre: string;
  main_ingredient: string;
  cooking_method: string;
};

/** meal_history に複数の献立を保存 */
export async function saveMealHistory(params: {
  userId: string;
  sessionId: string;
  meals: MealInput[];
}): Promise<void> {
  const supabase = createClient();
  await supabase.from("meal_history").insert(
    params.meals.map((m) => ({
      user_id: params.userId,
      session_id: params.sessionId,
      meal_name: m.meal_name,
      genre: m.genre,
      main_ingredient: m.main_ingredient,
      cooking_method: m.cooking_method,
    }))
  );
}

/** meal_history の was_selected を true に更新 */
export async function markMealSelected(params: {
  userId: string;
  sessionId: string;
  mealName: string;
}): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("meal_history")
    .update({ was_selected: true })
    .eq("user_id", params.userId)
    .eq("session_id", params.sessionId)
    .eq("meal_name", params.mealName);
}

const PLAN_LIMITS: Record<string, number> = {
  free: 10,
  pro: 90,
  pro_annual: 90,
};

/**
 * 利用回数をチェックし、上限未満なら +1 してカウントを返す。
 * 上限に達している場合は null を返す。
 * NEXT_PUBLIC_BETA_MODE=true の間は常に成功（制限なし）。
 */
export async function checkAndIncrementUsage(
  userId: string
): Promise<{ count: number; limit: number } | null> {
  if (process.env.NEXT_PUBLIC_BETA_MODE === "true") {
    return { count: 1, limit: 9999 };
  }

  const supabase = createClient();
  const yearMonth = new Date().toISOString().slice(0, 7);

  // プランと現在のカウントを並列取得
  const [profileRes, counterRes] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", userId).single(),
    supabase
      .from("usage_counters")
      .select("count")
      .eq("user_id", userId)
      .eq("year_month", yearMonth)
      .maybeSingle(),
  ]);

  const plan = (profileRes.data?.plan as string) ?? "free";
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const currentCount = (counterRes.data?.count as number) ?? 0;

  if (currentCount >= limit) return null;

  const { data } = await supabase.rpc("increment_usage_counter", {
    p_user_id: userId,
    p_year_month: yearMonth,
  });

  return { count: (data as number) ?? currentCount + 1, limit };
}

/** セッション履歴を取得（直近20件） */
export async function getSessionHistory(userId: string): Promise<{
  sessions: Array<{
    id: string;
    created_at: string;
    tired_mode: boolean;
    detected_ingredients: string[] | null;
    meals: Array<{
      id: string;
      meal_name: string;
      genre: string | null;
      was_selected: boolean;
      was_cooked: boolean;
    }>;
  }>;
}> {
  const supabase = createClient();
  const { data: sessions } = await supabase
    .from("sessions")
    .select("id, created_at, tired_mode, detected_ingredients")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (!sessions?.length) return { sessions: [] };

  const sessionIds = sessions.map((s) => s.id);
  const { data: meals } = await supabase
    .from("meal_history")
    .select("id, session_id, meal_name, genre, was_selected, was_cooked")
    .in("session_id", sessionIds)
    .eq("user_id", userId);

  const mealsBySession: Record<string, typeof meals> = {};
  for (const meal of meals ?? []) {
    if (!mealsBySession[meal.session_id]) mealsBySession[meal.session_id] = [];
    mealsBySession[meal.session_id]!.push(meal);
  }

  return {
    sessions: sessions.map((s) => ({
      ...s,
      detected_ingredients: s.detected_ingredients as string[] | null,
      meals: (mealsBySession[s.id] ?? []) as Array<{
        id: string;
        meal_name: string;
        genre: string | null;
        was_selected: boolean;
        was_cooked: boolean;
      }>,
    })),
  };
}

/** 今月の利用回数とプラン上限を取得 */
export async function getUsageStatus(
  userId: string
): Promise<{ count: number; limit: number; plan: string }> {
  const supabase = createClient();
  const yearMonth = new Date().toISOString().slice(0, 7);

  const [profileRes, counterRes] = await Promise.all([
    supabase.from("profiles").select("plan").eq("id", userId).single(),
    supabase
      .from("usage_counters")
      .select("count")
      .eq("user_id", userId)
      .eq("year_month", yearMonth)
      .maybeSingle(),
  ]);

  const plan = (profileRes.data?.plan as string) ?? "free";
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const count = (counterRes.data?.count as number) ?? 0;

  return { count, limit, plan };
}

export type FavoriteItem = {
  meal_name: string;
  genre: string | null;
  reason: string | null;
  time_minutes: number | null;
  difficulty: string | null;
  created_at: string;
};

/** お気に入り献立の一覧を取得（名前のみ） */
export async function getFavoriteNames(userId: string): Promise<string[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("favorites")
    .select("meal_name")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r: { meal_name: string }) => r.meal_name);
}

/** お気に入り献立の一覧をフルデータで取得 */
export async function getFavorites(userId: string): Promise<FavoriteItem[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("favorites")
    .select("meal_name, genre, reason, time_minutes, difficulty, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as FavoriteItem[];
}

/** お気に入りに追加（既存なら無視） */
export async function addFavorite(params: {
  userId: string;
  mealName: string;
  genre?: string;
  reason?: string;
  timeMinutes?: number;
  difficulty?: string;
}): Promise<void> {
  const supabase = createClient();
  await supabase.from("favorites").upsert(
    {
      user_id: params.userId,
      meal_name: params.mealName,
      genre: params.genre ?? null,
      reason: params.reason ?? null,
      time_minutes: params.timeMinutes ?? null,
      difficulty: params.difficulty ?? null,
    },
    { onConflict: "user_id,meal_name", ignoreDuplicates: true }
  );
}

/** お気に入りから削除 */
export async function removeFavorite(params: {
  userId: string;
  mealName: string;
}): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("favorites")
    .delete()
    .eq("user_id", params.userId)
    .eq("meal_name", params.mealName);
}

/** meal_history にフィードバックを保存 */
export async function saveFeedback(params: {
  userId: string;
  sessionId: string;
  mealName: string;
  wasCooked?: boolean;
  familyReaction?: "liked" | "disliked" | null;
  reactionMemo?: string;
  nextTimeMemo?: string;
}): Promise<void> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (params.wasCooked !== undefined) update.was_cooked = params.wasCooked;
  if (params.familyReaction !== undefined) update.family_reaction = params.familyReaction;
  if (params.reactionMemo !== undefined) update.reaction_memo = params.reactionMemo;
  if (params.nextTimeMemo !== undefined) update.next_time_memo = params.nextTimeMemo;
  if (!Object.keys(update).length) return;

  await supabase
    .from("meal_history")
    .update(update)
    .eq("user_id", params.userId)
    .eq("session_id", params.sessionId)
    .eq("meal_name", params.mealName);
}

/** household_settings を profiles に保存 */
export async function saveHouseholdSettings(
  userId: string,
  settings: Record<string, unknown>
): Promise<void> {
  const supabase = createClient();
  await supabase
    .from("profiles")
    .update({ household_settings: settings })
    .eq("id", userId);
}

/** household_settings を profiles から読み込む */
export async function loadHouseholdSettings(
  userId: string
): Promise<Record<string, unknown> | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("household_settings")
    .eq("id", userId)
    .single();
  return (data?.household_settings as Record<string, unknown>) ?? null;
}
