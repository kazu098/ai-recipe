// ─────────────────────────────────────────────────────────────────────────────
// HotCook 対応判定 + アドバイス生成エンジン
//
// 役割:
// 1. checkHotcookCapability(): 料理が HotCook で作れるかを判定
//    - "unsupported": 提案禁止（揚げ物・焼き物・シャキッと炒め）
//    - "auto":        自動メニューカテゴリで対応可能
//    - "manual":      手動モードで対応可能
// 2. getHotcookAdvice(): 料理ごとの HotCook 操作アドバイスを生成
//    - メニュー選び方・水分・まぜ技・時間・安全注意・容量警告
// ─────────────────────────────────────────────────────────────────────────────

import {
  HOTCOOK_CATEGORIES,
  UNSUPPORTED_PATTERNS,
  type HotcookCategory,
  type ManualTimeRule,
} from "./categories";

export type HotcookCapability = "auto" | "manual" | "unsupported";

export type HotcookAdvice = {
  category: HotcookCategory;
  /** ユーザーに見せる「メニューの選び方」 */
  menu_selection: {
    primary_path: string;
    auto_menu_examples: string[];
    manual_fallback: {
      mode: string;
      stir: boolean;
      time_min_min: number;
      time_max_min: number;
      time_condition: string;
    };
  };
  /** 各種アドバイス */
  water_note: string;
  stir_note: string;
  time_note: string;
  safety_notes: string[];
  capacity_warning: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// 対応可能性判定
// ─────────────────────────────────────────────────────────────────────────────

export function checkHotcookCapability(meal: {
  name: string;
  cooking_method: string;
}): HotcookCapability {
  // 対応不可パターンの先行判定
  if (UNSUPPORTED_PATTERNS.cooking_methods.some((m) => meal.cooking_method.includes(m))) {
    return "unsupported";
  }
  if (UNSUPPORTED_PATTERNS.name_keywords.some((k) => meal.name.includes(k))) {
    return "unsupported";
  }
  // カテゴリにマッチすれば auto、それ以外は manual
  const cat = matchCategory(meal);
  return cat ? "auto" : "manual";
}

// ─────────────────────────────────────────────────────────────────────────────
// カテゴリマッチング
// ─────────────────────────────────────────────────────────────────────────────

function matchCategory(meal: {
  name: string;
  cooking_method: string;
  ingredients?: string[];
}): HotcookCategory | null {
  let best: { cat: HotcookCategory; score: number } | null = null;

  for (const cat of HOTCOOK_CATEGORIES) {
    let score = 0;
    const t = cat.triggers;

    if (t.cooking_method?.some((m) => meal.cooking_method.includes(m))) score += 20;
    if (t.name_keywords?.some((k) => meal.name.includes(k))) score += 30;
    if (meal.ingredients && t.ingredients?.length) {
      const hits = meal.ingredients.filter((i) =>
        t.ingredients!.some((ti) => i.includes(ti) || ti.includes(i))
      );
      score += hits.length * 8;
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { cat, score };
    }
  }
  return best?.cat ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// アドバイス生成
// ─────────────────────────────────────────────────────────────────────────────

export function getHotcookAdvice(meal: {
  meal_name: string;
  ingredients: string[];
  cooking_method: string;
}): HotcookAdvice | null {
  const cat = matchCategory({
    name: meal.meal_name,
    cooking_method: meal.cooking_method,
    ingredients: meal.ingredients,
  });
  if (!cat) return null;

  const timeRule = pickTimeRule(cat.manual_time_rules, meal.ingredients, meal.meal_name);
  const waterless = cat.liquid_profile === "none";
  const fragile = isFragile(meal.ingredients, cat);

  return {
    category: cat,
    menu_selection: {
      primary_path: cat.auto_menu_path,
      auto_menu_examples: cat.auto_menu_examples,
      manual_fallback: {
        mode: cat.manual_mode,
        stir: cat.manual_stir,
        time_min_min: timeRule.min_min,
        time_max_min: timeRule.max_min,
        time_condition: timeRule.condition,
      },
    },
    water_note: buildWaterNote(meal.ingredients, cat.liquid_profile, waterless),
    stir_note: buildStirNote(meal.ingredients, cat.manual_stir, fragile),
    time_note: buildTimeNote(timeRule, cat),
    safety_notes: buildSafetyNotes(meal.ingredients, cat),
    capacity_warning:
      "内鍋の水位MAX線を超えないこと。葉物はかさが大きいので無理に押し込まない。",
  };
}

function pickTimeRule(
  rules: ManualTimeRule[],
  ingredients: string[],
  mealName: string
): ManualTimeRule {
  let best = rules[0];
  let bestScore = 0;
  for (const rule of rules) {
    let score = 0;
    const tokens = rule.condition.split(/[・＋,、（）()]/).filter(Boolean);
    for (const token of tokens) {
      if (ingredients.some((i) => i.includes(token) || token.includes(i))) score += 5;
      if (mealName.includes(token)) score += 3;
    }
    if (score > bestScore) {
      best = rule;
      bestScore = score;
    }
  }
  return best;
}

function isFragile(ingredients: string[], cat: HotcookCategory): boolean {
  const list = cat.fragile_ingredients ?? [];
  if (list.length === 0) return false;
  return list.some((f) => ingredients.some((i) => i.includes(f)));
}

function buildWaterNote(
  ingredients: string[],
  liquidProfile: "none" | "low" | "medium" | "high",
  waterless: boolean
): string {
  if (waterless) {
    return "無水カテゴリです。野菜の水分のみで調理するため追加水は不要。";
  }

  const highWater = ["白菜", "トマト", "玉ねぎ", "きのこ", "もやし", "なす", "ズッキーニ", "キャベツ"];
  const absorbing = ["春雨", "乾燥豆", "切り干し大根", "ひじき", "高野豆腐", "大豆", "ひよこ豆"];

  if (ingredients.some((i) => highWater.some((h) => i.includes(h)))) {
    return "白菜・トマト・玉ねぎ・きのこから水分が多く出るため、通常レシピより水分を1/3減らすこと。";
  }
  if (ingredients.some((i) => absorbing.some((a) => i.includes(a)))) {
    return "乾物・春雨・豆類は吸水するため、水分は通常より多めに確保すること。";
  }
  if (liquidProfile === "high") {
    return "水位MAX線を超えないこと。具材が多いと吹きこぼれの原因になる。";
  }
  return "通常レシピの水分量から1/3減らすこと（ホットクックは蒸気が逃げにくく水分が残りやすい）。";
}

function buildStirNote(ingredients: string[], stir: boolean, fragile: boolean): string {
  if (stir && !fragile) {
    return "まぜ技ユニットを使用（均一な仕上がり・カレー・炒め煮向け）。";
  }
  if (fragile) {
    const fragileKeywords = ["魚", "豆腐", "かぼちゃ", "白菜", "卵"];
    const matched = ingredients.filter((i) => fragileKeywords.some((f) => i.includes(f)));
    if (matched.length) {
      return `「${matched.join("・")}」が崩れやすいため、まぜ技ユニットは外して調理する。`;
    }
  }
  return "まぜ技ユニットなし。形を保ちたい食材向けの設定。";
}

function buildTimeNote(rule: ManualTimeRule, cat: HotcookCategory): string {
  const autoLine = cat.auto_menu_examples.length
    ? `「${cat.auto_menu_examples[0]}」など自動メニューを使う場合は時間は自動制御。`
    : "";
  return `手動の場合、沸とう後の加熱時間 ${rule.min_min}〜${rule.max_min}分を目安に設定（${rule.condition}）。${autoLine}`;
}

function buildSafetyNotes(ingredients: string[], cat: HotcookCategory): string[] {
  const notes: string[] = [];

  if (cat.required_prep) {
    for (const prep of cat.required_prep) {
      if (prep.ingredients.some((p) => ingredients.some((i) => i.includes(p)))) {
        notes.push(`下処理: ${prep.prep}`);
      }
    }
  }

  if (ingredients.some((i) => ["牛乳", "豆乳", "生クリーム"].some((d) => i.includes(d)))) {
    notes.push("牛乳・豆乳・生クリームは加熱終了後に加える（分離・吹きこぼれ防止）。");
  }
  if (ingredients.some((i) => i.includes("片栗粉"))) {
    notes.push("片栗粉は水溶きして加熱終了後に加える（固まり防止）。");
  }
  if (cat.notes) notes.push(...cat.notes);

  return notes;
}
