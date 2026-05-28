import { createClient } from "@/lib/supabase/client";

const ANON_ID_KEY = "snapmeal_anon_id";

function getAnonId(): string {
  let id = localStorage.getItem(ANON_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
  }
  return id;
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

export async function trackEvent(
  eventName: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  // GA4 へ送信
  try {
    window.gtag?.("event", eventName, properties);
  } catch {
    // silent
  }

  // Supabase analytics_events テーブルへも保存
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // 管理者自身のイベントは記録しない
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;
    if (adminEmail && user?.email === adminEmail) return;

    await supabase.from("analytics_events").insert({
      user_id: user?.id ?? null,
      anonymous_id: getAnonId(),
      event_name: eventName,
      properties,
    });
  } catch {
    // Analytics failures should never affect UX
  }
}

// ─── イベント名定数 ────────────────────────────────────────────────────────────

export const EVENTS = {
  PHOTO_UPLOADED:        "photo_uploaded",
  ANALYSIS_STARTED:      "analysis_started",
  INGREDIENT_CONFIRMED:  "ingredient_confirmed",
  MEAL_SUGGESTED:        "meal_suggested",
  ALTERNATIVE_VIEWED:    "alternative_viewed",
  MEAL_SELECTED:         "meal_selected",
  RECIPE_COOKED:         "recipe_cooked",
  RECIPE_NOT_COOKED:     "recipe_not_cooked",
  GUEST_LIMIT_HIT:       "guest_limit_hit",
  UPGRADE_MODAL_SHOWN:   "upgrade_modal_shown",
  LOGIN_PROMPTED:        "login_prompted",
  LOGIN_COMPLETED:       "login_completed",
  TIRED_MODE_TOGGLED:    "tired_mode_toggled",
  PATTERN_SELECTED:      "pattern_selected",
  SHARE_RECIPE:          "share_recipe",
} as const;
