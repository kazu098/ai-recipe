import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

type SubDish = { name: string; matched_ingredients: string[] };

function buildPrompt(
  mealName: string,
  matchedIngredients: string[],
  genre: string,
  cookingMethod: string,
  servings: number,
  appliances: string[],
  ngFoods: string,
  fukusai: SubDish | null,
  shirumono: SubDish | null
): string {
  const hasHotcook = appliances.includes("hotcook");
  const ngLine = ngFoods ? `使用禁止食材（アレルギー等）: ${ngFoods}` : "";

  const subDishSchema = [
    fukusai ? `  "fukusai_recipe": {
    "title": "${fukusai.name}",
    "ingredients": [{"name": "食材名", "amount": "分量"}],
    "seasonings": [{"name": "調味料名", "amount": "分量"}],
    "steps": ["手順1", "手順2"]
  }` : null,
    shirumono ? `  "shirumono_recipe": {
    "title": "${shirumono.name}",
    "ingredients": [{"name": "食材名", "amount": "分量"}],
    "seasonings": [{"name": "調味料名", "amount": "分量"}],
    "steps": ["手順1", "手順2"]
  }` : null,
  ].filter(Boolean).join(",\n");

  const subDishRequest = [
    fukusai ? `【副菜】${fukusai.name}（使用食材: ${fukusai.matched_ingredients.join("、") || "適量"}）の簡単なレシピも生成してください。` : "",
    shirumono ? `【汁物】${shirumono.name}（使用食材: ${shirumono.matched_ingredients.join("、") || "適量"}）の簡単なレシピも生成してください。` : "",
  ].filter(Boolean).join("\n");

  return `あなたは家庭料理の専門家です。以下の献立の詳細レシピを${servings}人分で作成してください。

【主菜】
料理名: ${mealName}
使用する主な食材: ${matchedIngredients.join("、") || "適量"}
ジャンル: ${genre}
調理法: ${cookingMethod}
調理器具: ${appliances.join("、") || "フライパン・鍋"}
${ngLine}

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
  ]${hasHotcook ? `,
  "hotcook_menu": ["メニューを選ぶ", "カテゴリーで探す", "...", "スタート"]` : ""},
  "tips": "コツやポイント（1〜2文、なければ空文字）"${subDishSchema ? `,\n${subDishSchema}` : ""}
}

ingredientsには調味料以外の食材のみ記載し、seasoningsに調味料・たれ・油類を記載してください。
副菜・汁物のレシピは steps を3〜4ステップ程度の簡潔な内容にしてください。
${hasHotcook ? `ホットクックを持っているユーザーです。主菜がホットクックで作れる場合はhotcook_menuにメニュー操作手順を記載してください。` : ""}`;
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
    fukusai = null,
    shirumono = null,
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
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const prompt = buildPrompt(
      mealName,
      matchedIngredients,
      genre,
      cookingMethod,
      servings,
      appliances,
      ngFoods,
      fukusai,
      shirumono
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
