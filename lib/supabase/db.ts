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
 */
export async function checkAndIncrementUsage(
  userId: string
): Promise<{ count: number; limit: number } | null> {
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
