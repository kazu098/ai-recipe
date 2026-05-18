export type Plan = "free" | "pro" | "pro_annual";

export type Profile = {
  id: string;
  email: string;
  created_at: string;
  household_settings: Record<string, unknown> | null;
  plan: Plan;
  stripe_customer_id: string | null;
  locale: string;
  photo_optin: boolean;
};

export type Session = {
  id: string;
  user_id: string;
  created_at: string;
  tired_mode: boolean;
  detected_ingredients: string[] | null;
  meals: unknown[] | null;
  selected_meal_id: string | null;
  cooked: boolean;
  storage_paths: string[] | null;
};

export type MealHistory = {
  id: string;
  user_id: string;
  session_id: string;
  meal_name: string;
  genre: string | null;
  main_ingredient: string | null;
  cooking_method: string | null;
  was_selected: boolean;
  was_cooked: boolean;
  created_at: string;
};

export type UsageCounter = {
  user_id: string;
  year_month: string;
  count: number;
};
