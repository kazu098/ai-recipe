import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { randomUUID } from "crypto";
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

const ALWAYS_AVAILABLE_SEASONINGS = `
醤油・塩・胡椒・砂糖・みりん・料理酒・酢・サラダ油・ごま油・バター・マヨネーズ・ケチャップ
味噌・だし（和風・コンソメ・鶏がら）・小麦粉・片栗粉・オリーブオイル・めんつゆ・ポン酢
ウスターソース・ソース・豆板醤・オイスターソース・生姜（チューブ）・にんにく（チューブ）
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

function buildHistorySection(history: MealHistory[]): string {
  if (!history.length) return "";
  const lines = history
    .slice(0, 14)
    .map((h) => `- ${h.meal_name}（${h.genre ?? ""}・${h.main_ingredient ?? ""}・${h.cooking_method ?? ""}）`);
  return `
【マンネリ回避】過去14日間に提案済みの料理（これらと異なるジャンル・主食材・調理法を選ぶこと）:
${lines.join("\n")}
`;
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

function buildHouseholdSection(profile: HouseholdProfile): string {
  const lines: string[] = [];
  if (profile.has_children) {
    lines.push(`- 子どもあり${profile.children_age_note ? `（${profile.children_age_note}）` : ""}。子ども向けに辛さ控えめ・食べやすい食材サイズで。`);
  }
  if (profile.taste_preference === "light") lines.push("- 味付け: 薄味を好む家庭。醤油・塩を少なめに。");
  if (profile.taste_preference === "rich") lines.push("- 味付け: 濃いめを好む家庭。しっかり味をつけること。");
  if (profile.cooking_policy) lines.push(`- 料理方針: ${profile.cooking_policy}`);
  if (profile.ng_foods) lines.push(`- NG食材・アレルギー: ${profile.ng_foods}`);
  return lines.length ? `\n【家庭プロファイル】\n${lines.join("\n")}\n` : "";
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
  household_profile: HouseholdProfile = {}
): string {
  const mainComp = meal_components.find((c) => c.role === "main");
  const sideComp = meal_components.find((c) => c.role === "side");
  const soupComp = meal_components.find((c) => c.role === "soup");
  const mainLabel = mainComp?.label ?? "メイン";

  const componentNote = [
    sideComp ? `${sideComp.label}（小鉢1品・汁物以外）` : "",
    soupComp ? `${soupComp.label}（味噌汁・スープ・汁物など液体の料理のみ）` : "",
  ].filter(Boolean).join("と");

  const hotcookNote = has_hotcook
    ? `
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

  const langInstruction = locale === "en"
    ? "IMPORTANT: Write all text values in English (dish names, reasons, ingredient names, genre, etc.).\n\n"
    : "";

  const ingredientList = ingredients.join("、");

  const missingIngredientsRule = hasUserRequest
    ? `- リクエスト食材が冷蔵庫にない場合は必ず missing_ingredients に追加すること
- matched_ingredients には上記の冷蔵庫食材のうち料理に使うもののみ入れること`
    : `- 今ある食材と常備調味料だけで作れる料理を最優先で選ぶこと
- 【絶対厳守】料理名・料理に使う食材（野菜・肉・魚・豆腐など）が matched_ingredients にも常備調味料リストにもない場合、その食材を必ず missing_ingredients に追加すること。絶対に隠蔽してはならない
- 【絶対厳守】missing_ingredients を [] にするときは、料理名・料理内容に冷蔵庫にない食材が一切含まれていないことを確認してから出力すること`;

  if (hasUserRequest) {
    return `${langInstruction}あなたは家庭料理の専門家です。

==========================================
【最優先指示・絶対に守ること】
ユーザーのリクエスト: 「${user_request.trim()}」
==========================================

【冷蔵庫にある食材】（画像認識済み）:
${ingredientList}

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
- 余力: ${tired_mode ? "疲れている。15分以内・材料少なめで作れる簡単な料理を優先" : "通常"}
- 献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${buildHouseholdSection(household_profile)}${hotcookNote}

【常備調味料・基本食材（常に自宅にあるものとして扱う）】
${ALWAYS_AVAILABLE_SEASONINGS}
${buildHistorySection(history)}
【出力ルール】
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
    "reason": "なぜこの料理か（1文・30字以内）",
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

  return `${langInstruction}あなたは家庭料理の専門家です。共働き家庭向けに献立を提案してください。

【冷蔵庫にある食材】（画像認識済み）:
${ingredientList}

状況:
- 食事: ${meal_time}
- 余力: ${tired_mode ? "疲れている。15分以内・材料少なめで作れる簡単な料理を優先" : "通常"}
- 献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${buildHouseholdSection(household_profile)}${hotcookNote}

【常備調味料・基本食材（常に自宅にあるものとして扱う）】
${ALWAYS_AVAILABLE_SEASONINGS}
${buildHistorySection(history)}
上記の食材を使って献立を提案してください。

【必須ルール】
${missingIngredientsRule}
${sideComp || soupComp ? `- メインとサブ料理は食材が重複しすぎないよう、バランスよく選ぶこと` : ""}
${soupComp ? `- soupには必ず味噌汁・スープ・汁物など液体を含む料理を設定すること。サラダ・炒め物・副菜は絶対不可` : ""}

出力はJSONのみ（コードブロック・説明文不要）:
{
  "ingredients": [${ingredients.map((i) => `"${i}"`).join(", ")}],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "${mainLabel}名",
    "reason": "なぜこのメインか（1文・30字以内）",
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
    tired_mode = false,
    meal_time = "夕食",
    meal_components = [{ role: "main", label: "メイン" }],
    locale = "ja",
    appliances = [],
    user_request = "",
    household_profile = {},
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
          locale, has_hotcook, user_request, ingredients, household_profile as HouseholdProfile
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

        send("meal", { meal: parsed.meal, ingredients: parsed.ingredients });
        if (sessionId) send("session", { session_id: sessionId });
        send("done", {});
      } catch (err) {
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
