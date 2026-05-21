import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getHotcookAdvice, type HotcookAdvice } from "@/lib/hotcook/engine";

type SubDish = { name: string; matched_ingredients: string[]; label?: string };

function buildHotcookGuidance(advice: HotcookAdvice): string {
  const a = advice.menu_selection;
  const lines = [
    `==========================================`,
    `🍲 【ホットクック調理ガイド】（このまま手順に反映すること）`,
    `==========================================`,
    `推奨カテゴリ: ${advice.category.name}`,
    `実機での自動メニューの選び方: ${a.primary_path}`,
    `参考になる自動メニュー例: ${a.auto_menu_examples.slice(0, 4).join("、")}`,
    `自動メニューが選べない場合の手動設定: ${a.manual_fallback.mode} → 沸とう後${a.manual_fallback.time_min_min}〜${a.manual_fallback.time_max_min}分 → スタート`,
    `水分: ${advice.water_note}`,
    `まぜ技ユニット: ${advice.stir_note}`,
    `時間: ${advice.time_note}`,
    `容量: ${advice.capacity_warning}`,
  ];
  if (advice.safety_notes.length) {
    lines.push(`下処理・安全: ${advice.safety_notes.join(" / ")}`);
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

  const hotcookGuidance = hasHotcook && hotcookAdvice ? buildHotcookGuidance(hotcookAdvice) : "";

  const hotcookStepInstruction = hasHotcook && hotcookAdvice
    ? `
【メイン料理の手順について（重要）】
このレシピはホットクックで調理します。手順は必ず以下の流れで書いてください:
1. 食材の下処理（カット・霜降り・油抜きなど。必要なものだけ）
2. 内鍋に食材と調味料をセット（投入順序があれば明記）
3. ホットクックの設定（カテゴリ「${hotcookAdvice.category.name}」を選択 → 自動メニュー or 手動モード）
4. スタートボタンを押す
5. 完成後の仕上げ（牛乳・生クリーム・とろみ等を追加する場合）

❌ 禁止: 「フライパンで炒める」「鍋で煮る」「オーブンで焼く」など、ホットクック以外の器具を使う手順
❌ 禁止: 焦げ目をつける、揚げる、シャキッと炒めるなどの不可能な調理
✅ 必須: 上記ガイドの「水分」「まぜ技」「時間」を手順に反映すること
`
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
${hotcookGuidance ? `\n${hotcookGuidance}\n` : ""}
${hotcookStepInstruction}
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
  ],
  "tips": "コツやポイント（1〜2文、なければ空文字）"${subDishSchema ? `,\n${subDishSchema}` : ""}
}

ingredientsには調味料以外の食材のみ記載し、seasoningsに調味料・たれ・油類を記載してください。
サブ料理のレシピは steps を3〜4ステップ程度の簡潔な内容にしてください。`;
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
      ? getHotcookAdvice({
          meal_name: mealName,
          ingredients: matchedIngredients,
          cooking_method: cookingMethod,
        })
      : null;

    if (hotcookAdvice) {
      console.log(
        "[recipe] hotcook category:",
        hotcookAdvice.category.id,
        "/ menu_path:",
        hotcookAdvice.menu_selection.primary_path
      );
    }

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
