import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { randomUUID } from "crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import {
  getAuthUserId,
  getRecentMealHistory,
  createSession,
  saveMealHistory,
  checkAndIncrementUsage,
} from "@/lib/supabase/db";
import type { MealHistory } from "@/lib/supabase/types";
import { checkHotcookCapability } from "@/lib/hotcook/engine";

type ActiveComp = { role: string; label: string };
type MealAudience = "family" | "kids" | "adults";

const ALWAYS_AVAILABLE_SEASONINGS_JA = `
醤油・塩・胡椒・砂糖・みりん・料理酒・酢・サラダ油・ごま油・バター・マヨネーズ・ケチャップ
味噌・だし（和風・コンソメ・鶏がら）・小麦粉・片栗粉・オリーブオイル・めんつゆ・ポン酢
ウスターソース・ソース・豆板醤・オイスターソース・生姜（チューブ）・にんにく（チューブ）
`.trim();

const ALWAYS_AVAILABLE_SEASONINGS_EN = `
salt, black pepper, sugar, white vinegar, apple cider vinegar, vegetable oil, olive oil, butter, mayonnaise, ketchup
chicken/beef/vegetable broth, all-purpose flour, cornstarch, soy sauce, Worcestershire sauce, hot sauce
garlic powder, onion powder, cumin, paprika, Italian seasoning, dried oregano, red pepper flakes
Dijon mustard, balsamic vinegar, honey, heavy cream, tomato paste
`.trim();

// 1枚の画像から食材のみを認識する軽量プロンプト
const INGREDIENT_ONLY_PROMPT = `冷蔵庫の写真を1枚見て、見えている食材をリストアップしてください。
ルール:
- 調味料・ドレッシング・ソース類は含めない
- 食材名は日本語で簡潔に（例: 鶏もも肉、卵、ニンジン）
- 商品パッケージが見える場合は中の食材名に変換する（例: 「冷凍チャーハン」→「冷凍ご飯」）
- 確認できない・不明なものは含めない
JSON配列のみ出力（説明文不要）: ["食材1", "食材2", ...]`;

function toImagePart(dataUrl: string) {
  return {
    inlineData: {
      data: dataUrl.replace(/^data:image\/\w+;base64,/, ""),
      mimeType: (dataUrl.match(/^data:(image\/\w+);/)?.[1] ?? "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/webp",
    },
  };
}

async function recognizeIngredientsOneImage(dataUrl: string): Promise<string[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: { temperature: 0.1 },
  });
  try {
    const result = await model.generateContent([INGREDIENT_ONLY_PROMPT, toImagePart(dataUrl)]);
    const text = result.response.text();
    const match = text.match(/\[[\s\S]*?\]/);
    if (!match) return [];
    return (JSON.parse(match[0]) as string[]).filter((s) => typeof s === "string" && s.trim());
  } catch {
    return [];
  }
}

function mergeIngredients(lists: string[][]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      const key = item.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        merged.push(key);
      }
    }
  }
  return merged;
}

function buildHistorySection(history: MealHistory[], locale: string): string {
  if (!history.length) return "";

  const recent = history.slice(0, 14);
  const liked = history.filter((h) => h.family_reaction === "liked");
  const disliked = history.filter((h) => h.family_reaction === "disliked");
  const memos = history.filter((h) => h.next_time_memo);
  const parts: string[] = [];

  if (locale === "en") {
    const lines = recent.map((h) => `- ${h.meal_name} (${h.genre ?? ""} · ${h.main_ingredient ?? ""} · ${h.cooking_method ?? ""})`);
    parts.push(`[Variety] Meals suggested in the last 14 days (choose a different genre, main ingredient, and cooking method):\n${lines.join("\n")}`);
    if (liked.length) {
      const likedLines = liked.slice(0, 5).map((h) => `- ${h.meal_name} (${h.genre ?? ""} · ${h.main_ingredient ?? ""})`);
      parts.push(`[Well-received] Meals the family enjoyed (actively choose similar genre/main ingredient):\n${likedLines.join("\n")}`);
    }
    if (disliked.length) {
      const dislikedLines = disliked.slice(0, 5).map((h) => `- ${h.meal_name}`);
      parts.push(`[Disliked] Meals the family didn't enjoy (avoid the same dish and same main ingredient):\n${dislikedLines.join("\n")}`);
    }
    if (memos.length) {
      const memoLines = memos.slice(0, 3).map((h) => `- "${h.meal_name}": ${h.next_time_memo}`);
      parts.push(`[Notes for next time] (use as reference when cooking):\n${memoLines.join("\n")}`);
    }
  } else {
    const lines = recent.map((h) => `- ${h.meal_name}（${h.genre ?? ""}・${h.main_ingredient ?? ""}・${h.cooking_method ?? ""}）`);
    parts.push(`【マンネリ回避】過去14日間に提案済みの料理（これらと異なるジャンル・主食材・調理法を選ぶこと）:\n${lines.join("\n")}`);
    if (liked.length) {
      const likedLines = liked.slice(0, 5).map((h) => `- ${h.meal_name}（${h.genre ?? ""}・${h.main_ingredient ?? ""}）`);
      parts.push(`【好評だった料理】家族がよく食べた料理（同じジャンル・主食材の料理を積極的に選ぶこと）:\n${likedLines.join("\n")}`);
    }
    if (disliked.length) {
      const dislikedLines = disliked.slice(0, 5).map((h) => `- ${h.meal_name}`);
      parts.push(`【不評だった料理】家族があまり食べなかった料理（これらと同じ料理・同じ主食材は避けること）:\n${dislikedLines.join("\n")}`);
    }
    if (memos.length) {
      const memoLines = memos.slice(0, 3).map((h) => `「${h.meal_name}」: ${h.next_time_memo}`);
      parts.push(`【次回へのメモ】過去の記録（調理時の参考にすること）:\n${memoLines.map((m) => `- ${m}`).join("\n")}`);
    }
  }

  return parts.map((p) => `\n${p}\n`).join("");
}

function buildSubDishSection(components: ActiveComp[]): string {
  const parts: string[] = [];
  const side = components.find((c) => c.role === "side");
  const soup = components.find((c) => c.role === "soup");
  if (side) {
    parts.push(`    "side": { "name": "${side.label}名（小鉢・副菜。汁物・スープは不可）", "matched_ingredients": ["使う食材1", ...] }`);
  }
  if (soup) {
    parts.push(`    "soup": { "name": "${soup.label}名（必ず味噌汁・スープ・汁物など液体を含む料理。サラダ・炒め物・副菜は絶対不可）", "matched_ingredients": ["使う食材1", ...] }`);
  }
  return parts.length ? ",\n" + parts.join(",\n") : "";
}

type HouseholdProfile = {
  has_children?: boolean;
  children_age_note?: string;
  taste_preference?: "light" | "normal" | "rich";
  cooking_policy?: string;
  ng_foods?: string;
};

function buildHouseholdSection(profile: HouseholdProfile, locale: string): string {
  const lines: string[] = [];
  if (locale === "en") {
    if (profile.has_children) {
      lines.push(`- Has children${profile.children_age_note ? ` (${profile.children_age_note})` : ""}. Use mild seasoning and bite-sized ingredients.`);
    }
    if (profile.taste_preference === "light") lines.push("- Taste: prefers light seasoning. Use less soy sauce and salt.");
    if (profile.taste_preference === "rich") lines.push("- Taste: prefers bold flavors. Season well.");
    if (profile.cooking_policy) lines.push(`- Cooking policy: ${profile.cooking_policy}`);
    if (profile.ng_foods) lines.push(`- Allergies / foods to avoid: ${profile.ng_foods}`);
    return lines.length ? `\n[Household Profile]\n${lines.join("\n")}\n` : "";
  } else {
    if (profile.has_children) {
      lines.push(`- 子どもあり${profile.children_age_note ? `（${profile.children_age_note}）` : ""}。子ども向けに辛さ控えめ・食べやすい食材サイズで。`);
    }
    if (profile.taste_preference === "light") lines.push("- 味付け: 薄味を好む家庭。醤油・塩を少なめに。");
    if (profile.taste_preference === "rich") lines.push("- 味付け: 濃いめを好む家庭。しっかり味をつけること。");
    if (profile.cooking_policy) lines.push(`- 料理方針: ${profile.cooking_policy}`);
    if (profile.ng_foods) lines.push(`- NG食材・アレルギー: ${profile.ng_foods}`);
    return lines.length ? `\n【家庭プロファイル】\n${lines.join("\n")}\n` : "";
  }
}

function buildAudienceSection(audience: MealAudience, locale: string, tiredMode: boolean): string {
  const selected: MealAudience = ["family", "kids", "adults"].includes(audience) ? audience : "family";
  if (locale === "en") {
    const base = tiredMode
      ? "- Low-energy mode: keep it fast and low-effort, but still avoid repetitive single-dish defaults unless requested."
      : "- Normal mode: prioritize variety, balance, and a dinner that feels acceptable for the whole household.";
    const details: Record<MealAudience, string[]> = {
      family: [
        "- Target: a household dinner for parents and children, not solo cooking.",
        "- Prefer a child-friendly base seasoning; adults can add spice or condiments after serving.",
        "- Avoid spicy, bitter, or very strong flavors unless requested.",
        base,
      ],
      kids: [
        "- Target: children first, while still acceptable for adults.",
        "- Use mild seasoning, soft textures, bite-sized cuts, and familiar flavors.",
        "- Avoid spicy or strongly aromatic dishes unless requested.",
        base,
      ],
      adults: [
        "- Target: adults in the household. Child constraints can be relaxed.",
        "- More varied cuisines and stronger flavors are acceptable if they match the ingredients.",
        "- Still suggest a practical home dinner, not a solo convenience meal unless requested.",
        base,
      ],
    };
    return `\n[Meal Audience]\n${details[selected].join("\n")}\n`;
  }

  const base = tiredMode
    ? "- 疲れたモードでは、時短・低負荷を優先しつつ、リクエストがない限り一人向けの定番パスタや丼だけに寄せすぎないこと。"
    : "- 通常モードでは、家族の夕食としてのバランス・満足感・レパートリーの広がりを優先すること。";
  const details: Record<MealAudience, string[]> = {
    family: [
      "- 対象: 子どもを含む家庭の夕食。一人暮らし向けの自分用簡単飯ではない。",
      "- 子どもも食べやすいベースの味付けにし、大人は後から辛味・薬味・調味料で調整できる料理を優先。",
      "- リクエストがない限り、辛すぎる・苦味が強い・香りが強すぎる料理は避ける。",
      base,
    ],
    kids: [
      "- 対象: 子ども優先。大人も食べられるが、子どもの食べやすさを最優先。",
      "- 辛さ控えめ、やわらかめ、一口サイズ、なじみのある味を優先。",
      "- リクエストがない限り、辛味やクセの強い香味野菜を主役にしない。",
      base,
    ],
    adults: [
      "- 対象: 大人向け。子ども向け制約はゆるめてよい。",
      "- 食材に合うなら、少し大人っぽい味付けや異国料理も選んでよい。",
      "- ただし家庭の夕食として現実的な料理にし、一人向けの手抜き飯には寄せすぎない。",
      base,
    ],
  };
  return `\n【食べる人】\n${details[selected].join("\n")}\n`;
}

function buildFavoritesSection(favorites: string[], disliked: string[], locale: string): string {
  if (!favorites.length && !disliked.length) return "";
  const parts: string[] = [];
  if (locale === "en") {
    if (favorites.length) {
      parts.push(`[Favorites] Meals this user has saved (prefer similar genre/main ingredient):\n${favorites.slice(0, 10).map((n) => `- ${n}`).join("\n")}`);
    }
    if (disliked.length) {
      parts.push(`[Not interested] Meals the user marked as uninteresting (avoid the same dish):\n${disliked.slice(0, 10).map((n) => `- ${n}`).join("\n")}`);
    }
  } else {
    if (favorites.length) {
      parts.push(`【お気に入り】ユーザーが保存した料理（同じジャンル・主食材を積極的に選ぶこと）:\n${favorites.slice(0, 10).map((n) => `- ${n}`).join("\n")}`);
    }
    if (disliked.length) {
      parts.push(`【不要な提案】ユーザーが「興味なし」にした料理（同じ料理は絶対に提案しないこと）:\n${disliked.slice(0, 10).map((n) => `- ${n}`).join("\n")}`);
    }
  }
  return parts.map((p) => `\n${p}\n`).join("");
}

function buildCuisineBlock(cuisine_pattern: string, locale: string): string {
  const isEn = locale === "en";

  // 英語ユーザーがデフォルト（japanese）のままの場合は洋食バイアスを適用
  if (isEn && cuisine_pattern === "japanese") {
    return `
[Cuisine Style: Any — prefer globally familiar dishes]
Suggest dishes that are common in Western, Mediterranean, or global home cooking.
Examples: pasta, roast chicken, stir-fried vegetables with garlic, grain bowls, soups, stews, tacos, salmon with herbs, frittata, curry, fried rice.
Japanese-style dishes are acceptable if the available ingredients strongly call for them.
Do NOT default to purely Japanese dishes (nikujaga, teriyaki, chawanmushi, etc.) unless the ingredients or a user request clearly suggest them.
`;
  }

  const blocks: Record<string, { en: string; ja: string }> = {
    japanese: {
      en: `[Cuisine Style: Japanese]
Suggest authentic Japanese home-cooking dishes.
Examples: miso soup, tamagoyaki, yakitori, karaage, gyoza, nikujaga, oyakodon, onigiri, soba, udon, teriyaki chicken, chawanmushi, tsukune, agedashi tofu.
Keep authentic Japanese flavors (dashi, miso, soy, mirin).`,
      ja: `【ジャンル：和食】
本格的な日本の家庭料理を提案してください。
例：味噌汁、卵焼き、焼き鳥、唐揚げ、餃子、肉じゃが、親子丼、おにぎり、そば、うどん、照り焼きチキン、茶碗蒸し。
だし・味噌・醤油・みりんを活かした和の味付けを基本とすること。`,
    },
    western: {
      en: `[Cuisine Style: Western (American / European)]
Suggest dishes that are genuinely common in American or European households.
Examples: pasta (carbonara, bolognese, aglio e olio), grilled chicken, tacos, burgers, Caesar salad, French onion soup, roast vegetables, frittata, risotto, quiche, steak, salmon with lemon butter, minestrone.
Do NOT suggest Japanese-style "western" food (no Hamburg steak / ハンバーグ, no Japanese cream stew, no korokke).`,
      ja: `【ジャンル：洋食（欧米スタイル）】
アメリカ・ヨーロッパの家庭で実際によく作られる料理を提案してください。
例：パスタ（カルボナーラ・ボロネーゼ・アーリオオーリオ）、グリルチキン、タコス、バーガー、シーザーサラダ、フレンチオニオンスープ、ローストベジタブル、フリッタータ、リゾット、キッシュ、ステーキ、レモンバターソーモン、ミネストローネ。
日本化した洋食（ハンバーグ、コロッケ、クリームシチューなど）は避け、欧米本来のスタイルで提案すること。`,
    },
    korean: {
      en: `[Cuisine Style: Korean]
Suggest authentic Korean home-cooking dishes.
Examples: bibimbap, bulgogi, kimchi jjigae, doenjang jjigae, japchae, tteokbokki, dakgalbi, samgyeopsal, sundubu jjigae, kongnamul, pajeon, galbi, bossam, naengmyeon.
Use authentic Korean flavors (gochujang, doenjang, sesame oil, gochugaru, garlic).`,
      ja: `【ジャンル：韓国料理】
本格的な韓国の家庭料理を提案してください。
例：ビビンバ、プルコギ、キムチチゲ、テンジャンチゲ、チャプチェ、トッポッキ、タッカルビ、サムギョプサル、スンドゥブチゲ、コンナムル、チヂミ、カルビ、ポッサム、冷麺。
コチュジャン・テンジャン・ごま油・コチュカル・にんにくを活かした韓国らしい味付けにすること。`,
    },
    chinese: {
      en: `[Cuisine Style: Chinese]
Suggest authentic Chinese home-cooking dishes.
Examples: mapo tofu, kung pao chicken, sweet and sour pork, fried rice, lo mein, dumplings (jiaozi), hot and sour soup, stir-fried green beans, steamed fish, braised pork belly (hong shao rou), dan dan noodles, eggplant with garlic sauce, egg drop soup.
Use authentic Chinese flavors (soy sauce, oyster sauce, Shaoxing wine, five spice, bean paste).`,
      ja: `【ジャンル：中華料理】
本格的な中国の家庭料理を提案してください。
例：麻婆豆腐、宮保鶏丁（カンパオチキン）、酢豚、チャーハン、焼きそば、餃子、酸辣湯、ドライストリングビーンズ、蒸し魚、豚の角煮、担々麺、茄子の味噌炒め、卵スープ。
醤油・オイスターソース・紹興酒・五香粉・豆板醤を活かした中華らしい味付けにすること。`,
    },
    ethnic: {
      en: `[Cuisine Style: Ethnic / Global]
Suggest dishes from global cuisines: Thai, Indian, Mexican, Vietnamese, Middle Eastern, etc.
Examples: Thai green curry, pad thai, chicken tikka masala, dal, tacos al pastor, pho, spring rolls, shakshuka, hummus with pita, falafel, nasi goreng, tom yum soup.
Embrace bold spices and authentic flavor profiles from the chosen regional cuisine.`,
      ja: `【ジャンル：エスニック料理】
タイ・インド・メキシコ・ベトナム・中東などのグローバルな料理を提案してください。
例：グリーンカレー、パッタイ、チキンティッカマサラ、ダル、タコスアルパストール、フォー、春巻き、シャクシュカ、フムス、ファラフェル、ナシゴレン、トムヤムスープ。
各地域の本格的なスパイスとフレーバーを活かした料理にすること。`,
    },
    oneplate: {
      en: `[Cuisine Style: One Plate]
Suggest a satisfying single-plate meal. Can be any cuisine — focus on balance and completeness.
Examples: grain bowls, Buddha bowls, pasta dishes, rice bowls, noodle dishes, wraps, salad plates with protein.`,
      ja: `【ジャンル：ワンプレート】
バランスの取れた一皿料理を提案してください。ジャンルは問いません。
例：グレインボウル、仏陀ボウル、パスタ、丼もの、麺料理、ラップ、タンパク質入りサラダプレート。`,
    },
  };

  const block = blocks[cuisine_pattern];
  if (!block) return "";
  return "\n" + (isEn ? block.en : block.ja) + "\n";
}

function buildPrompt(
  tired_mode: boolean,
  meal_time: string,
  history: MealHistory[],
  meal_components: ActiveComp[],
  locale: string,
  has_hotcook: boolean,
  user_request: string,
  ingredients: string[],
  household_profile: HouseholdProfile = {},
  meal_audience: MealAudience = "family",
  favorite_meals: string[] = [],
  disliked_meals: string[] = [],
  cuisine_pattern = "japanese",
  priority_ingredients: string[] = []
): string {
  const isEn = locale === "en";
  const mainComp = meal_components.find((c) => c.role === "main");
  const sideComp = meal_components.find((c) => c.role === "side");
  const soupComp = meal_components.find((c) => c.role === "soup");
  const mainLabel = mainComp?.label ?? (isEn ? "Main dish" : "メイン");

  const componentNote = isEn
    ? [
        sideComp ? `${sideComp.label} (side dish, not soup)` : "",
        soupComp ? `${soupComp.label} (must be miso soup, broth, or liquid-based dish)` : "",
      ].filter(Boolean).join(" and ")
    : [
        sideComp ? `${sideComp.label}（小鉢1品・汁物以外）` : "",
        soupComp ? `${soupComp.label}（味噌汁・スープ・汁物など液体の料理のみ）` : "",
      ].filter(Boolean).join("と");

  const hotcookNote = has_hotcook
    ? isEn
      ? `
==========================================
🔴 [SMART COOKER RULES — STRICT]
==========================================
The user has a Hitachi Hotcook (automatic cooking pot).
**NEVER suggest dishes that cannot be made in a Hotcook.** This is the highest-priority rule.

[Dishes SUITABLE for Hotcook (prefer these)]
- Braised meat: nikujaga, chikuzen-ni, pork belly daikon, kakuni, chicken & root veg stew
- Braised fish: saba miso, buri daikon, sardine ginger stew
- Braised veg/dried: kabocha nimono, ratatouille, hijiki, kiriboshi daikon
- Curry/stew: chicken curry, beef curry, keema curry, waterless curry, cream stew
- Soup: tonjiru, miso soup, pot-au-feu, minestrone, corn potage, clam chowder
- Steamed: chawanmushi, steamed chicken, shumai
- Boiled: broccoli, potatoes, corn
- Low-temp/ferment: salad chicken, yogurt
- Rice: plain rice, takikomi gohan, risotto
- Stir-simmered: mapo nasu, meatballs, meat sauce, gapao-style

[Dishes FORBIDDEN in Hotcook (never suggest)]
- Fried: karaage, tempura, croquette, tonkatsu, ebi fry
- Grilled with browning: steak, hamburger steak, grilled fish, teriyaki, gyoza, okonomiyaki
- Egg fry: tamagoyaki, fried egg, omelette, omurice, scrambled eggs
- Crispy stir-fry: fried rice, yakisoba, yakiudon, stir-fried vegetables, carbonara
- Baked/grilled: toast, pizza, gratin
- Raw dishes: sashimi, sushi

[Rules]
1. Never output dishes with cooking_method "fry" or "grill"
2. If user requests a forbidden dish, replace with the closest Hotcook-compatible dish
3. Set cooking_method to one of: simmer, steam, boil, salad (or stir-simmer only for moist stir dishes)
==========================================
`
      : `
==========================================
🔴 【ホットクック対応条件・絶対厳守】
==========================================
ユーザーはホットクック（自動調理鍋）を所有しています。
**ホットクックで作れない料理は絶対に提案禁止です。** これは何より優先される最重要ルールです。

【ホットクックで作れる料理（これらの中から積極的に選ぶ）】
- 煮物（肉）: 肉じゃが、筑前煮、豚バラ大根、豚の角煮、豚肉のトマト煮こみ、鶏と根菜の煮物
- 煮物（魚）: さばの味噌煮、ぶり大根、いわしの生姜煮、金目鯛の煮つけ
- 煮物（野菜・乾物）: かぼちゃの煮物、ラタトゥイユ、ひじきの煮物、切り干し大根、きんぴらごぼう
- カレー・シチュー: チキンカレー、ビーフカレー、キーマカレー、無水カレー、クリームシチュー
- スープ: 豚汁、具だくさん味噌汁、ポトフ、ミネストローネ、コーンポタージュ、クラムチャウダー
- 蒸し物: 茶碗蒸し、蒸し鶏、シュウマイ
- 無水ゆで: ブロッコリーゆで、じゃがいもゆで、とうもろこし
- 発酵・低温調理: サラダチキン、ローストビーフ風、ヨーグルト、甘酒
- ごはん: 白ごはん、炊き込みごはん、リゾット
- 炒め煮（しっとり系）: 麻婆なす、回鍋肉、ミートソース、ガパオ風

【ホットクックで作れない料理（絶対に提案してはならない）】
- 揚げ物: 唐揚げ、天ぷら、フライ、コロッケ、とんかつ、メンチカツ、エビフライ
- 焦げ目が必要な焼き物: ステーキ、ハンバーグ、焼き魚、塩焼き、照り焼き、ムニエル、餃子、お好み焼き
- 卵料理（焼き系）: 卵焼き、だし巻き、目玉焼き、オムレツ、オムライス、スクランブルエッグ
- シャキッと炒め: チャーハン、焼きそば、焼きうどん、野菜炒め、ペペロンチーノ、炒飯
- パン・グリル: トースト、サンドイッチ、ピザ、グラタン、ドリア
- 生もの: 刺身、寿司

【判定ルール】
1. cooking_method が「揚げ」または「焼き」の料理は絶対に出力しないこと
2. 上記の禁止キーワードを含む料理名は絶対に出力しないこと
3. ユーザーリクエストが上記の禁止料理を指定している場合は、最も近い「ホットクックで作れる」料理に置き換えること
   例:「唐揚げが食べたい」→「サラダチキン」または「鶏肉のトマト煮こみ」
   例:「ハンバーグ」→「ロールキャベツ」または「ミートソース」
   例:「ステーキ」→「ローストビーフ風（低温調理）」
   例:「焼き魚」→「魚の煮つけ」または「魚の味噌煮」
   例:「野菜炒め」→「野菜のラタトゥイユ」または「具だくさんスープ」
4. cooking_method には「煮込み」「蒸し」「ゆで」「サラダ」のいずれかを設定すること（「炒め」は炒め煮の場合のみ）
==========================================
`
    : "";

  const hasUserRequest = user_request.trim().length > 0;
  const seasonings = isEn ? ALWAYS_AVAILABLE_SEASONINGS_EN : ALWAYS_AVAILABLE_SEASONINGS_JA;
  const ingredientList = ingredients.join(isEn ? ", " : "、");
  const priorityNote = priority_ingredients.length > 0
    ? isEn
      ? `\n[Priority ingredients — MUST USE these in the dish]: ${priority_ingredients.join(", ")}\n`
      : `\n【優先使用食材 — 必ずこれらを料理に使うこと】: ${priority_ingredients.join("、")}\n`
    : "";
  const ingredientSelectionRule = isEn
    ? `- Fridge contents are candidate ingredients, not a checklist. Do NOT try to use all recognized ingredients.
- Select only the ingredients that naturally fit the dish. It is OK to leave recognized ingredients unused.
- For the main dish, usually use 1-4 core fridge ingredients unless the dish naturally needs more.
- Do NOT invent non-pantry ingredients. Without a user request, the dish name and dish content must be explainable using only matched_ingredients + pantry staples.
- matched_ingredients must be a subset of the recognized fridge list and must include only ingredients actually used in the dish.`
    : `- 認識した食材は「候補」であり、全部使う必要はありません。全食材を無理に使い切ろうとしないこと。
- 料理に自然に合う食材だけを選んで使うこと。認識食材が余っても問題ありません。
- メイン料理では、基本的に冷蔵庫食材を1〜4個程度に絞ること（料理として自然な場合だけ増やしてよい）。
- 認識外の肉・魚・野菜・豆腐などを勝手に前提にした料理名にしないこと。リクエストがない場合、料理名と料理内容は matched_ingredients + 常備調味料だけで説明できること。
- matched_ingredients は認識済み冷蔵庫食材の部分集合にし、実際に料理に使う食材だけを入れること。`;

  if (isEn) {
    const energyNote = tired_mode
      ? "Low energy. Prioritize dishes ready in under 15 min with few ingredients and minimal knife work (3 steps or less). Prefer microwave, slow cooker, heat-and-serve, mix-only, or bag-cooking methods."
      : "Normal energy";
    const missingRule = hasUserRequest
      ? `- If a requested ingredient is not in the fridge, add it to missing_ingredients\n- matched_ingredients must only include items from the fridge list above`
      : `- Prioritize dishes that can be made only with current fridge items and pantry staples\n- [STRICT] If any ingredient needed for the dish (vegetables, meat, fish, tofu, etc.) is not in matched_ingredients or pantry staples, add it to missing_ingredients. Never hide it.\n- [STRICT] Only set missing_ingredients to [] after confirming no ingredient in the dish is absent from the fridge`;
    const balanceRule = (sideComp || soupComp) ? "- Choose main and side dishes with varied ingredients to create a balanced meal" : "";
    const soupRule = soupComp ? "- soup must be a liquid dish (miso soup, broth, stew). Never a salad or stir-fry." : "";
    const subDishSchema = buildSubDishSection(meal_components);

    if (hasUserRequest) {
      return `You are a home cooking expert.

==========================================
[TOP PRIORITY — MUST FOLLOW]
User request: "${user_request.trim()}"
==========================================

[Fridge contents (already recognized from photo)]:
${ingredientList}
${priorityNote}
Execute the following steps:

Step 1: Read the request. Identify the ingredient(s) or dish the user wants.
  - e.g. "I want to use cabbage and pork" → target ingredients: [cabbage, pork]
  - e.g. "I want curry" → target dish: curry

Step 2: Suggest ONE dish centered on the identified ingredient(s) or dish.
  ⚠️ Always use the specified ingredient/dish, whether or not it's in the fridge.
  ⚠️ Do NOT make a different ingredient the star.

Step 3: meal.matched_ingredients — include ONLY fridge items used in the dish.
Step 4: meal.missing_ingredients — include ALL of:
  - requested ingredients not in the fridge
  - any ingredient required for the dish that is neither in the fridge nor in pantry staples

[Situation]
- Meal: ${meal_time}
- Energy: ${energyNote}
- Meal structure: ${mainLabel}${componentNote ? ` + ${componentNote}` : " only"}
${buildAudienceSection(meal_audience, locale, tired_mode)}${buildHouseholdSection(household_profile, locale)}${hotcookNote}${buildCuisineBlock(cuisine_pattern, locale)}
[Pantry staples (always available at home)]
${seasonings}
${buildHistorySection(history, locale)}${buildFavoritesSection(favorite_meals, disliked_meals, locale)}
[Output rules]
${ingredientSelectionRule}
${missingRule}
${balanceRule}
${soupRule}

==========================================
🔴 Reminder:
You MUST follow the user request "${user_request.trim()}".
ONLY suggest a dish that features the requested ingredient/dish as the star.
==========================================

Output JSON only (no code block, no explanation):
{
  "ingredients": [${ingredients.map((i) => `"${i}"`).join(", ")}],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "Dish name featuring the requested ingredient/dish",
    "reason": "${history.length > 0 ? "Why this dish — mention how it differs from recent meals or fits family preferences (1 sentence, under 30 words)" : "Why this dish (1 sentence, under 30 words)"}",
    "time_minutes": number,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["fridge items used in the dish"],
    "missing_ingredients": ["requested items not in fridge + other needed items"],
    "genre": "Japanese|Western|Chinese|Asian",
    "main_ingredient": "meat|fish|egg|vegetable|noodle|rice",
    "cooking_method": "stir-fry|simmer|grill|fry|steam|salad"${subDishSchema}
  }
}`;
    }

    return `You are a home cooking expert. Suggest a dinner for a busy household.

[Fridge contents (already recognized from photo)]:
${ingredientList}
${priorityNote}
Situation:
- Meal: ${meal_time}
- Energy: ${energyNote}
- Meal structure: ${mainLabel}${componentNote ? ` + ${componentNote}` : " only"}
${buildAudienceSection(meal_audience, locale, tired_mode)}${buildHouseholdSection(household_profile, locale)}${hotcookNote}${buildCuisineBlock(cuisine_pattern, locale)}
[Pantry staples (always available at home)]
${seasonings}
${buildHistorySection(history, locale)}${buildFavoritesSection(favorite_meals, disliked_meals, locale)}
Suggest a meal using a sensible subset of the above ingredients.

[Required rules]
${ingredientSelectionRule}
${missingRule}
${balanceRule}
${soupRule}

Output JSON only (no code block, no explanation):
{
  "ingredients": [${ingredients.map((i) => `"${i}"`).join(", ")}],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "${mainLabel} dish name",
    "reason": "${history.length > 0 ? "Why this dish — mention how it differs from recent meals or fits family preferences (1 sentence, under 30 words)" : "Why this dish (1 sentence, under 30 words)"}",
    "time_minutes": number,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["fridge items used in the dish"],
    "missing_ingredients": [],
    "genre": "Japanese|Western|Chinese|Asian",
    "main_ingredient": "meat|fish|egg|vegetable|noodle|rice",
    "cooking_method": "stir-fry|simmer|grill|fry|steam|salad"${subDishSchema}
  }
}`;
  }

  // Japanese prompt
  const missingIngredientsRule = hasUserRequest
    ? `- リクエスト食材が冷蔵庫にない場合は必ず missing_ingredients に追加すること
- matched_ingredients には上記の冷蔵庫食材のうち料理に使うもののみ入れること`
    : `- 今ある食材と常備調味料だけで作れる料理を最優先で選ぶこと
- 【絶対厳守】料理名・料理に使う食材（野菜・肉・魚・豆腐など）が matched_ingredients にも常備調味料リストにもない場合、その食材を必ず missing_ingredients に追加すること。絶対に隠蔽してはならない
- 【絶対厳守】missing_ingredients を [] にするときは、料理名・料理内容に冷蔵庫にない食材が一切含まれていないことを確認してから出力すること`;

  if (hasUserRequest) {
    return `あなたは家庭料理の専門家です。

==========================================
【最優先指示・絶対に守ること】
ユーザーのリクエスト: 「${user_request.trim()}」
==========================================

【冷蔵庫にある食材】（画像認識済み）:
${ingredientList}
${priorityNote}
以下の手順を1つずつ実行せよ:

ステップ1: 上記リクエストを読み、ユーザーが「使いたい食材」または「作りたい料理」を特定せよ。
  - 例:「白菜と肉を使いたい」→ 使いたい食材は [白菜, 肉]
  - 例:「カレーを作りたい」→ 作りたい料理は カレー

ステップ2: ステップ1で特定した「使いたい食材」「作りたい料理」を中心とした料理を1品提案せよ。
  ⚠️ 指定食材が冷蔵庫にあろうとなかろうと、必ずその食材を使う料理を選ぶこと。
  ⚠️ 別の食材を主役にすることは禁止。

ステップ3: meal.matched_ingredients には「冷蔵庫食材のうち、その料理に使うもの」のみを入れよ。
ステップ4: meal.missing_ingredients には次のものをすべて入れよ:
  - ユーザーが指定したが冷蔵庫にない食材
  - その料理に必要だが冷蔵庫にも常備調味料にもない食材

【状況】
- 食事: ${meal_time}
- 余力: ${tired_mode ? "疲れている。調理時間15分以内・食材少なめ・包丁をほぼ使わない・工程が3ステップ以内の料理を優先。電子レンジ・ホットクック・温めるだけ・混ぜるだけ・袋のまま調理など、手間が最小の調理法を選ぶこと" : "通常"}
- 献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${buildAudienceSection(meal_audience, locale, tired_mode)}${buildHouseholdSection(household_profile, locale)}${hotcookNote}${buildCuisineBlock(cuisine_pattern, locale)}
【常備調味料・基本食材（常に自宅にあるものとして扱う）】
${seasonings}
${buildHistorySection(history, locale)}${buildFavoritesSection(favorite_meals, disliked_meals, locale)}
【出力ルール】
${ingredientSelectionRule}
${missingIngredientsRule}
${sideComp || soupComp ? `- メインとサブ料理は食材が重複しすぎないよう、バランスよく選ぶこと` : ""}
${soupComp ? `- soupには必ず味噌汁・スープ・汁物など液体を含む料理を設定すること。サラダ・炒め物・副菜は絶対不可` : ""}

==========================================
🔴 再度の念押し:
ユーザーのリクエスト「${user_request.trim()}」を必ず守ること。
リクエストで指定された食材/料理を主役にした料理以外は絶対に提案してはならない。
==========================================

出力はJSONのみ（コードブロック・説明文不要）:
{
  "ingredients": [${ingredients.map((i) => `"${i}"`).join(", ")}],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "リクエストの指定食材/料理を使った料理名",
    "reason": "${history.length > 0 ? "なぜこの料理か。最近の献立との違い・家族の好みを反映した点を含めること（1文・30字以内）" : "なぜこの料理か（1文・30字以内）"}",
    "time_minutes": 数値,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["冷蔵庫食材のうち料理に使うもの"],
    "missing_ingredients": ["リクエスト食材で冷蔵庫にないもの、+必要な追加食材"],
    "genre": "和食|洋食|中華|エスニック",
    "main_ingredient": "肉|魚|卵|野菜|麺|米",
    "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"${buildSubDishSection(meal_components)}
  }
}`;
  }

  return `あなたは家庭料理の専門家です。共働き家庭向けに献立を提案してください。

【冷蔵庫にある食材】（画像認識済み）:
${ingredientList}
${priorityNote}
状況:
- 食事: ${meal_time}
- 余力: ${tired_mode ? "疲れている。調理時間15分以内・食材少なめ・包丁をほぼ使わない・工程が3ステップ以内の料理を優先。電子レンジ・ホットクック・温めるだけ・混ぜるだけ・袋のまま調理など、手間が最小の調理法を選ぶこと" : "通常"}
- 献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${buildAudienceSection(meal_audience, locale, tired_mode)}${buildHouseholdSection(household_profile, locale)}${hotcookNote}${buildCuisineBlock(cuisine_pattern, locale)}
【常備調味料・基本食材（常に自宅にあるものとして扱う）】
${seasonings}
${buildHistorySection(history, locale)}${buildFavoritesSection(favorite_meals, disliked_meals, locale)}
上記の食材から、料理として自然な一部の食材を選んで献立を提案してください。

【必須ルール】
${ingredientSelectionRule}
${missingIngredientsRule}
${sideComp || soupComp ? `- メインとサブ料理は食材が重複しすぎないよう、バランスよく選ぶこと` : ""}
${soupComp ? `- soupには必ず味噌汁・スープ・汁物など液体を含む料理を設定すること。サラダ・炒め物・副菜は絶対不可` : ""}

出力はJSONのみ（コードブロック・説明文不要）:
{
  "ingredients": [${ingredients.map((i) => `"${i}"`).join(", ")}],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "${mainLabel}名",
    "reason": "${history.length > 0 ? "なぜこのメインか。最近の献立との違い・家族の好みを反映した点を含めること（1文・30字以内）" : "なぜこのメインか（1文・30字以内）"}",
    "time_minutes": 数値,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["今ある食材1", ...],
    "missing_ingredients": [],
    "genre": "和食|洋食|中華|エスニック",
    "main_ingredient": "肉|魚|卵|野菜|麺|米",
    "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"${buildSubDishSection(meal_components)}
  }
}`;
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

type SendFn = (event: string, data: unknown) => void;

// 献立生成: テキストのみ（食材認識済み前提）
async function streamMealWithGemini(prompt: string, _send: SendFn): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: { temperature: 0.2 },
  });

  const result = await model.generateContentStream(prompt);
  let fullText = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) fullText += text;
  }
  return fullText;
}

async function streamMealWithGPT4o(prompt: string, _send: SendFn): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 1000,
    stream: true,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) fullText += text;
  }
  return fullText;
}

// GPT-4o による1枚の画像からの食材認識（Gemini fallback 用）
async function recognizeIngredientsOneImageGPT4o(dataUrl: string): Promise<string[]> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const res = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: INGREDIENT_ONLY_PROMPT },
        { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
      ],
    }],
    max_tokens: 300,
  });
  const text = res.choices[0]?.message?.content ?? "";
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
    return (JSON.parse(match[0]) as string[]).filter((s) => typeof s === "string" && s.trim());
  } catch {
    return [];
  }
}

export async function POST(req: NextRequest) {
  const {
    imageDataUrls,
    ingredients_override,
    priority_ingredients = [],
    tired_mode = false,
    meal_time = "夕食",
    meal_components = [{ role: "main", label: "メイン" }],
    cuisine_pattern = "japanese",
    locale = "ja",
    appliances = [],
    meal_audience = "family",
    user_request = "",
    household_profile = {},
    favorite_meals = [],
    disliked_meals = [],
  } = await req.json();

  // ingredients_override がある場合は画像不要（食材確認画面からの呼び出し）
  if (!ingredients_override?.length && !imageDataUrls?.length) {
    return new Response("imageDataUrls または ingredients_override が必要です", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: SendFn = (event, data) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const userId = await getAuthUserId();
      if (userId) {
        const usage = await checkAndIncrementUsage(userId);
        if (!usage) {
          send("error", {
            message: "今月の利用上限に達しました",
            code: "usage_limit_exceeded",
          });
          return;
        }
      }

      const history = userId ? await getRecentMealHistory(userId) : [];
      const has_hotcook = (appliances as string[]).includes("hotcook");
      console.log("[analyze] user_request:", JSON.stringify(user_request));

      let fullText = "";

      try {
        // Phase 1: 食材認識
        // ingredients_override がある場合は認識済みリストをそのまま使用（食材確認画面からの呼び出し）
        let ingredients: string[] = [];
        if (ingredients_override?.length) {
          ingredients = ingredients_override as string[];
          for (const item of ingredients) {
            send("ingredient", { item });
          }
          console.log("[analyze] using ingredients_override:", ingredients);
        } else if (process.env.GEMINI_API_KEY) {
          const lists = await Promise.all(
            (imageDataUrls as string[]).map(recognizeIngredientsOneImage)
          );
          ingredients = mergeIngredients(lists);
          for (const item of ingredients) {
            send("ingredient", { item });
          }
          console.log("[analyze] merged ingredients:", ingredients);
        } else if (process.env.OPENAI_API_KEY) {
          const lists = await Promise.all(
            (imageDataUrls as string[]).map(recognizeIngredientsOneImageGPT4o)
          );
          ingredients = mergeIngredients(lists);
          for (const item of ingredients) {
            send("ingredient", { item });
          }
          console.log("[analyze] merged ingredients:", ingredients);
        } else {
          send("error", { message: "GEMINI_API_KEY または OPENAI_API_KEY を .env.local に設定してください" });
          return;
        }

        // Phase 2: 食材リストのみで献立生成（画像再送なし）
        const prompt = buildPrompt(
          tired_mode, meal_time, history, meal_components as ActiveComp[],
          locale, has_hotcook, user_request, ingredients, household_profile as HouseholdProfile,
          meal_audience as MealAudience, favorite_meals as string[], disliked_meals as string[], cuisine_pattern as string,
          priority_ingredients as string[]
        );
        if (process.env.GEMINI_API_KEY) {
          try {
            fullText = await streamMealWithGemini(prompt, send);
          } catch {
            send("status", { message: "GPT-4oに切り替えています..." });
            if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY が未設定です");
            fullText = await streamMealWithGPT4o(prompt, send);
          }
        } else if (process.env.OPENAI_API_KEY) {
          fullText = await streamMealWithGPT4o(prompt, send);
        }

        const parsed = JSON.parse(extractJSON(fullText)) as {
          ingredients: string[];
          meal: {
            name: string;
            genre: string;
            main_ingredient: string;
            cooking_method: string;
            [key: string]: unknown;
          };
        };
        parsed.meal.id = randomUUID();
        console.log("[analyze] meal.name:", parsed.meal.name, "matched:", parsed.meal.matched_ingredients, "missing:", parsed.meal.missing_ingredients);

        // HotCook 対応判定: 非対応の料理が生成された場合は警告ログを出す
        if (has_hotcook) {
          const capability = checkHotcookCapability({
            name: parsed.meal.name,
            cooking_method: parsed.meal.cooking_method,
          });
          parsed.meal.hotcook_capability = capability;
          if (capability === "unsupported") {
            console.warn(
              "[analyze] ⚠️ ホットクック非対応の料理が生成されました:",
              parsed.meal.name,
              "/ cooking_method:",
              parsed.meal.cooking_method
            );
          }
        }

        let sessionId: string | null = null;
        if (userId) {
          sessionId = await createSession({
            userId,
            tiredMode: tired_mode,
            detectedIngredients: parsed.ingredients,
          });
          if (sessionId) {
            await saveMealHistory({
              userId,
              sessionId,
              meals: [{
                meal_name: parsed.meal.name,
                genre: parsed.meal.genre,
                main_ingredient: parsed.meal.main_ingredient,
                cooking_method: parsed.meal.cooking_method,
              }],
            });
          }
        }

        send("meal", { meal: parsed.meal, ingredients: parsed.ingredients, history_used: history.length > 0 });
        if (sessionId) send("session", { session_id: sessionId });
        send("done", {});
      } catch (err) {
        try {
          const adminDb = createServiceClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
          );
          // 管理者自身のエラーは記録しない
          const isAdmin = userId && await adminDb
            .from("profiles")
            .select("email")
            .eq("id", userId)
            .single()
            .then(({ data }) => data?.email === process.env.ADMIN_EMAIL);
          if (!isAdmin) {
            await adminDb.from("analytics_events").insert({
              user_id: userId ?? null,
              event_name: "analysis_error",
              properties: { error: err instanceof Error ? err.message : String(err) },
            });
          }
        } catch {
          // analytics failure は無視
        }
        send("error", { message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
