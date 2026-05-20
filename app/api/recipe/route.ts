import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getHotcookAdvice, type HotcookAdvice } from "@/lib/hotcook/matcher";

type SubDish = { name: string; matched_ingredients: string[]; label?: string };

function buildHotcookSection(advice: HotcookAdvice): string {
  const { fallback, water_note, stir_note, time_note, safety_notes, operation_path } = advice;
  const lines: string[] = [
    `【ホットクック推奨設定】`,
    `操作手順: ${operation_path}`,
    `水分: ${water_note}`,
    `まぜ技ユニット: ${stir_note}`,
    `時間設定: ${time_note}`,
  ];
  if (fallback) {
    lines.push(`代替（手動）: ${fallback.menu.manual_mode ?? fallback.menu.name}`);
  }
  if (safety_notes.length) {
    lines.push(`注意: ${safety_notes.join(" / ")}`);
  }
  return lines.join("\n");
}

function buildPrompt(
  mealName: string,
  matchedIngredients: string[],
  genre: string,
  cookingMethod: string,
  servings: number,
  appliances: string[],
  ngFoods: string,
  side: SubDish | null,
  soup: SubDish | null,
  locale: string,
  hotcookAdvice: HotcookAdvice | null
): string {
  const hasHotcook = appliances.includes("hotcook");
  const ngLine = ngFoods ? `使用禁止食材（アレルギー等）: ${ngFoods}` : "";
  const sideLabel = side?.label ?? "サイドディッシュ";
  const soupLabel = soup?.label ?? "スープ";

  const subDishSchema = [
    side ? `  "side_recipe": {
    "title": "${side.name}",
    "ingredients": [{"name": "食材名", "amount": "分量"}],
    "seasonings": [{"name": "調味料名", "amount": "分量"}],
    "steps": ["手順1", "手順2"]
  }` : null,
    soup ? `  "soup_recipe": {
    "title": "${soup.name}",
    "ingredients": [{"name": "食材名", "amount": "分量"}],
    "seasonings": [{"name": "調味料名", "amount": "分量"}],
    "steps": ["手順1", "手順2"]
  }` : null,
  ].filter(Boolean).join(",\n");

  const subDishRequest = [
    side ? `【${sideLabel}】${side.name}（使用食材: ${side.matched_ingredients.join("、") || "適量"}）の簡単なレシピも生成してください。` : "",
    soup ? `【${soupLabel}】${soup.name}（使用食材: ${soup.matched_ingredients.join("、") || "適量"}）の簡単なレシピも生成してください。` : "",
  ].filter(Boolean).join("\n");

  const hotcookSection = hasHotcook && hotcookAdvice ? buildHotcookSection(hotcookAdvice) : "";
  const hotcookMenuSchema = hasHotcook
    ? `,
  "hotcook": {
    "menu_id": ${hotcookAdvice?.primary.menu.id ?? null},
    "menu_name": "${hotcookAdvice?.primary.menu.name ?? ""}",
    "menu_type": "${hotcookAdvice?.primary.menu.type ?? "manual"}",
    "operation_path": "${hotcookAdvice?.operation_path ?? ""}",
    "water_note": "水分調整のポイント",
    "stir_note": "まぜ技ユニットに関する補足",
    "time_note": "時間設定の補足",
    "safety_notes": ["注意点1"]
  }`
    : "";

  const langInstruction = locale === "en"
    ? "IMPORTANT: Write all text values in English (ingredient names, amounts, steps, tips, etc.).\n\n"
    : "";

  return `${langInstruction}あなたは家庭料理の専門家です。以下の献立の詳細レシピを${servings}人分で作成してください。

【メイン】
料理名: ${mealName}
使用する主な食材: ${matchedIngredients.join("、") || "適量"}
ジャンル: ${genre}
調理法: ${cookingMethod}
調理器具: ${appliances.join("、") || "フライパン・鍋"}
${ngLine}
${hotcookSection ? `\n${hotcookSection}\n` : ""}
${subDishRequest}

出力はJSONのみ（コードブロック・説明文不要）:
{
  "title": "${mealName}",
  "servings": ${servings},
  "ingredients": [
    {"name": "食材名", "amount": "${servings}人分の分量（例: 300g、2個）"}
  ],
  "seasonings": [
    {"name": "調味料名", "amount": "分量（例: 大さじ2、小さじ1）"}
  ],
  "steps": [
    "手順1（具体的に）",
    "手順2"
  ]${hotcookMenuSchema},
  "tips": "コツやポイント（1〜2文、なければ空文字）"${subDishSchema ? `,\n${subDishSchema}` : ""}
}

ingredientsには調味料以外の食材のみ記載し、seasoningsに調味料・たれ・油類を記載してください。
サブ料理のレシピは steps を3〜4ステップ程度の簡潔な内容にしてください。
${hasHotcook && hotcookAdvice ? `ホットクックの操作手順・水分調整・まぜ技・時間はすでに上記に指定済みです。hotcookフィールドにはその値をそのまま使用してください。stepsにはホットクック特有の下処理（霜降り・油抜き等）があれば先頭に追加してください。` : ""}`;
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function POST(req: NextRequest) {
  const {
    mealName,
    matchedIngredients = [],
    genre = "",
    cookingMethod = "",
    servings = 2,
    appliances = [],
    ngFoods = "",
    side = null,
    soup = null,
    locale = "ja",
  } = await req.json();

  if (!mealName) {
    return new Response(JSON.stringify({ error: "mealName required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!process.env.GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const hasHotcook = (appliances as string[]).includes("hotcook");
    const hotcookAdvice = hasHotcook
      ? getHotcookAdvice({ meal_name: mealName, ingredients: matchedIngredients, genre, cooking_method: cookingMethod })
      : null;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const prompt = buildPrompt(
      mealName,
      matchedIngredients,
      genre,
      cookingMethod,
      servings,
      appliances,
      ngFoods,
      side,
      soup,
      locale,
      hotcookAdvice
    );

    if (hotcookAdvice) {
      console.log("[recipe] hotcook primary:", hotcookAdvice.primary.menu.name, "score:", hotcookAdvice.primary.score);
    }

    const result = await model.generateContent(prompt);
    const fullText = result.response.text();
    const parsed = JSON.parse(extractJSON(fullText));

    return new Response(JSON.stringify(parsed), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
