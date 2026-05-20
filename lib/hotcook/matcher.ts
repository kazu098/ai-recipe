import { AUTO_MENUS, MANUAL_MENUS, type HotcookMenu } from "./menus";

export type MatchResult = {
  menu: HotcookMenu;
  score: number;
  reason: string;
};

export type HotcookAdvice = {
  primary: MatchResult;
  fallback: MatchResult | null;
  water_note: string;
  stir_note: string;
  time_note: string;
  safety_notes: string[];
  operation_path: string;
};

// ── スコアリング ─────────────────────────────────────────────────────────────

function calcScore(menu: HotcookMenu, input: MatchInput): number {
  let score = 0;

  // 主食材マッチ
  for (const ing of input.main_ingredients) {
    if (menu.main_ingredients.some((m) => m.includes(ing) || ing.includes(m))) score += 30;
  }

  // カテゴリマッチ
  for (const cat of input.categories) {
    if (menu.category.some((c) => c.includes(cat) || cat.includes(c))) score += 20;
  }

  // テクスチャマッチ
  for (const tex of input.textures) {
    if (menu.texture.some((t) => t.includes(tex) || tex.includes(t))) score += 10;
  }

  // 水分プロファイルマッチ
  if (menu.liquid_profile === input.liquid_profile) score += 15;

  // まぜ必要性マッチ
  if (input.needs_stir !== undefined && menu.stir_unit === input.needs_stir) score += 10;

  // 予約希望
  if (input.needs_reservation && menu.reservation) score += 5;

  return score;
}

export type MatchInput = {
  main_ingredients: string[];
  categories: string[];
  textures: string[];
  liquid_profile: "none" | "low" | "medium" | "high";
  needs_stir?: boolean;
  needs_reservation?: boolean;
  fragile?: boolean; // 崩れやすい食材があるか
};

export function matchAutoMenu(input: MatchInput): MatchResult | null {
  const scored = AUTO_MENUS.map((m) => ({ menu: m, score: calcScore(m, input) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  const top = scored[0];
  return {
    menu: top.menu,
    score: top.score,
    reason: buildMatchReason(top.menu, input),
  };
}

export function matchManualMenu(input: MatchInput): MatchResult {
  // 手動メニュー選定ルール
  const isLiquidHeavy = input.liquid_profile === "high";
  const needsStir = input.needs_stir ?? !input.fragile;
  const isSteam = input.categories.includes("蒸し物");
  const isLowTemp = input.categories.includes("低温調理");
  const isStirFry = input.categories.includes("炒め物");

  let menuId = 201; // デフォルト: 煮物まぜない
  if (isSteam) menuId = 206;
  else if (isLowTemp) menuId = 207;
  else if (isStirFry) menuId = 204;
  else if (isLiquidHeavy && needsStir) menuId = 202;
  else if (isLiquidHeavy && !needsStir) menuId = 203;
  else if (needsStir) menuId = 200;
  else menuId = 201;

  const menu = MANUAL_MENUS.find((m) => m.id === menuId) ?? MANUAL_MENUS[1];
  return { menu, score: 50, reason: "自動メニューに近いものがないため手動モードを使用" };
}

function buildMatchReason(menu: HotcookMenu, input: MatchInput): string {
  const matched = input.main_ingredients.filter((ing) =>
    menu.main_ingredients.some((m) => m.includes(ing) || ing.includes(m))
  );
  if (matched.length) return `主食材「${matched.join("・")}」が近いメニュー`;
  return `調理スタイルが近い既存メニュー`;
}

// ── 水分調整アドバイス ──────────────────────────────────────────────────────

function buildWaterNote(
  mealName: string,
  ingredients: string[],
  menuLiquidProfile: "none" | "low" | "medium" | "high"
): string {
  const highWaterIngs = ["白菜", "トマト", "玉ねぎ", "きのこ", "もやし", "トマト缶", "ズッキーニ"];
  const absorptionIngs = ["春雨", "乾燥豆", "乾物", "切り干し大根", "ひじき", "高野豆腐"];

  const hasHighWater = ingredients.some((i) => highWaterIngs.some((h) => i.includes(h)));
  const hasAbsorption = ingredients.some((i) => absorptionIngs.some((a) => i.includes(a)));

  if (menuLiquidProfile === "none") {
    if (hasHighWater) return "追加水は不要です。白菜・トマト・玉ねぎなどから十分な水分が出ます。";
    return "無水調理です。食材の水分のみで調理します。";
  }
  if (hasHighWater) {
    return "通常レシピの水分量から30〜40%減らしてください。白菜・トマト・玉ねぎ・きのこから水が多く出ます。";
  }
  if (hasAbsorption) {
    return "乾物・春雨・豆類は吸水するため、水分を通常より多めに。吸水後の量を確認してください。";
  }
  return "水分は通常のレシピより約2/3にしてください。ホットクックは水分が蒸発しにくい構造です。";
}

// ── まぜ判定 ────────────────────────────────────────────────────────────────

function buildStirNote(ingredients: string[], fragile: boolean, stir: boolean): string {
  if (!stir) {
    const fragileIngs = ["魚", "豆腐", "かぼちゃ", "ロールキャベツ", "白菜"];
    const matched = ingredients.filter((i) => fragileIngs.some((f) => i.includes(f)));
    if (matched.length) return `「${matched.join("・")}」が崩れやすいため「まぜない」で調理します。`;
    return "形を保ちたいため「まぜない」で調理します。";
  }
  return "カレー・炒め煮・とろみ系はまぜ技ユニットが均一な仕上がりにします。";
}

// ── 時間アドバイス ──────────────────────────────────────────────────────────

function buildTimeNote(ingredients: string[], timeAfterBoil: number): string {
  const longIngs = ["牛すじ", "豚かたまり", "骨付き", "大豆", "乾燥豆"];
  const hasLong = ingredients.some((i) => longIngs.some((l) => i.includes(l)));
  if (hasLong) return `設定時間は沸とう後の加熱時間です。かたまり肉・豆類は長めの${timeAfterBoil}分以上を推奨。`;
  return `設定時間は「沸とう後の加熱時間」です（目安: ${timeAfterBoil}分）。`;
}

// ── 安全注意 ────────────────────────────────────────────────────────────────

function buildSafetyNotes(ingredients: string[], reservation: boolean): string[] {
  const notes: string[] = [];
  const dairyIngs = ["牛乳", "豆乳", "生クリーム", "チーズ"];
  const reservationDanger = ["肉", "魚", "乳製品", "卵"];

  if (ingredients.some((i) => dairyIngs.some((d) => i.includes(d)))) {
    notes.push("牛乳・豆乳・生クリームは加熱終了後に加えてください（分離・吹きこぼれ防止）。");
  }
  if (reservation && ingredients.some((i) => reservationDanger.some((r) => i.includes(r)))) {
    notes.push("予約調理では肉・魚・乳製品の使用は食中毒リスクがあります。予約機能を使う場合は冷蔵食材の扱いに注意してください。");
  }
  if (ingredients.some((i) => i.includes("片栗粉") || i.includes("とろみ"))) {
    notes.push("片栗粉は加熱後に水溶きして加えるか、最初から入れる場合は少量にしてください。");
  }

  return notes;
}

// ── メイン関数 ──────────────────────────────────────────────────────────────

export function getHotcookAdvice(params: {
  meal_name: string;
  ingredients: string[];
  genre: string;
  cooking_method: string;
}): HotcookAdvice {
  const { meal_name, ingredients, genre, cooking_method } = params;

  // 特徴量を推定
  const fragile = ingredients.some((i) =>
    ["魚", "豆腐", "かぼちゃ", "絹ごし", "白身魚"].some((f) => i.includes(f))
  );
  const isHeavyWater = ["スープ", "汁物", "味噌汁", "ポタージュ", "シチュー"].some((k) =>
    meal_name.includes(k) || cooking_method.includes(k)
  );
  const isCurry = meal_name.includes("カレー") || meal_name.includes("curry");
  const isStirFry = cooking_method.includes("炒め") || meal_name.includes("炒め");

  const liquidProfile: "none" | "low" | "medium" | "high" = isHeavyWater
    ? "high"
    : isCurry
    ? "medium"
    : "low";

  const needsStir = isCurry || (isStirFry && !fragile);

  const input: MatchInput = {
    main_ingredients: ingredients.slice(0, 5),
    categories: [
      isHeavyWater ? "スープ" : "煮物",
      isCurry ? "カレー・シチュー" : "",
      genre === "洋食" ? "洋食" : genre === "中華" ? "中華" : "",
    ].filter(Boolean),
    textures: [isCurry ? "カレー" : isHeavyWater ? "汁物" : "煮込み"],
    liquid_profile: liquidProfile,
    needs_stir: needsStir,
    fragile,
  };

  const autoMatch = matchAutoMenu(input);
  const manualMatch = matchManualMenu({ ...input, fragile });

  const primary = autoMatch ?? manualMatch;
  const fallback = autoMatch ? manualMatch : null;

  const waterNote = buildWaterNote(meal_name, ingredients, primary.menu.liquid_profile);
  const stirNote = buildStirNote(ingredients, fragile, needsStir);
  const timeNote = buildTimeNote(ingredients, primary.menu.time_after_boil_min ?? 20);
  const safetyNotes = buildSafetyNotes(ingredients, primary.menu.reservation);

  // 操作パス生成
  let operationPath = "";
  if (primary.menu.type === "auto") {
    operationPath = `メニューを選ぶ → カテゴリーで探す → ${primary.menu.category[0]} → No.${primary.menu.id} ${primary.menu.name} → スタート`;
  } else {
    operationPath = `手動で作る → ${primary.menu.manual_mode ?? primary.menu.name} → ${primary.menu.time_after_boil_min ?? 20}分 → スタート`;
  }

  return {
    primary,
    fallback,
    water_note: waterNote,
    stir_note: stirNote,
    time_note: timeNote,
    safety_notes: safetyNotes,
    operation_path: operationPath,
  };
}
