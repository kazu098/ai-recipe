import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

function buildPrompt(
  mealName: string,
  matchedIngredients: string[],
  genre: string,
  cookingMethod: string,
  servings: number,
  appliances: string[],
  ngFoods: string
): string {
  const hasHotcook = appliances.includes("hotcook");

  return `あなたは家庭料理の専門家です。以下の料理の詳細レシピを${servings}人分で作成してください。

料理名: ${mealName}
使用する主な食材: ${matchedIngredients.join("、") || "適量"}
ジャンル: ${genre}
調理法: ${cookingMethod}
調理器具: ${appliances.join("、") || "フライパン・鍋"}
${ngFoods ? `使用禁止食材（アレルギー等）: ${ngFoods}` : ""}

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
  ]${hasHotcook ? `,
  "hotcook_menu": ["メニューを選ぶ", "カテゴリーで探す", "...", "スタート"]` : ""},
  "tips": "コツやポイント（1〜2文、なければ空文字）"
}

ingredientsには調味料以外の食材のみ記載し、seasoningsに調味料・たれ・油類を記載してください。
${hasHotcook ? `ホットクックを持っているユーザーです。この料理がホットクックで作れる場合はhotcook_menuにメニュー操作手順を配列で記載してください（例：["メニューを選ぶ", "カテゴリーで探す", "煮物", "肉じゃが", "スタート"]）。ホットクックに不向きな料理（サラダ等）は空配列にしてください。` : ""}
手順は${hasHotcook ? "ホットクックの使用を優先して" : ""}具体的かつ簡潔に記載してください。`;
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
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = buildPrompt(
      mealName,
      matchedIngredients,
      genre,
      cookingMethod,
      servings,
      appliances,
      ngFoods
    );

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
