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

/** 月次利用回数を +1 してカウントを返す */
export async function incrementUsageCounter(userId: string): Promise<number> {
  const supabase = createClient();
  const yearMonth = new Date().toISOString().slice(0, 7); // '2026-05'
  const { data } = await supabase.rpc("increment_usage_counter", {
    p_user_id: userId,
    p_year_month: yearMonth,
  });
  return (data as number) ?? 0;
}

/** 今月の利用回数を取得 */
export async function getUsageCount(userId: string): Promise<number> {
  const supabase = createClient();
  const yearMonth = new Date().toISOString().slice(0, 7);
  const { data } = await supabase
    .from("usage_counters")
    .select("count")
    .eq("user_id", userId)
    .eq("year_month", yearMonth)
    .maybeSingle();
  return (data?.count as number) ?? 0;
}
