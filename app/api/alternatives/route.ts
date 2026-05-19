import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID } from "crypto";
import { getAuthUserId, saveMealHistory } from "@/lib/supabase/db";

type ActiveComp = { role: string; label: string };

const ALWAYS_AVAILABLE_SEASONINGS = `
醤油・塩・胡椒・砂糖・みりん・料理酒・酢・サラダ油・ごま油・バター・マヨネーズ・ケチャップ
味噌・だし（和風・コンソメ・鶏がら）・小麦粉・片栗粉・オリーブオイル・めんつゆ・ポン酢
ウスターソース・ソース・豆板醤・オイスターソース・生姜（チューブ）・にんにく（チューブ）
`.trim();

function buildSubDishFields(components: ActiveComp[]): string {
  const parts: string[] = [];
  const side = components.find((c) => c.role === "side");
  const soup = components.find((c) => c.role === "soup");
  if (side) {
    parts.push(`      "side": { "name": "${side.label}名", "matched_ingredients": ["使う食材1", ...] }`);
  }
  if (soup) {
    parts.push(`      "soup": { "name": "${soup.label}名", "matched_ingredients": ["使う食材1", ...] }`);
  }
  return parts.length ? ",\n" + parts.join(",\n") : "";
}

function buildPrompt(
  ingredients: string[],
  tired_mode: boolean,
  meal_1_name: string,
  meal_1_type: string,
  meal_components: ActiveComp[],
  locale: string,
  has_hotcook: boolean,
  user_request: string
): string {
  const [type2, type3] = tired_mode
    ? ["no_shopping", "best"]
    : ["quick", "no_shopping"];

  const mainComp = meal_components.find((c) => c.role === "main");
  const sideComp = meal_components.find((c) => c.role === "side");
  const soupComp = meal_components.find((c) => c.role === "soup");
  const mainLabel = mainComp?.label ?? "メイン";

  const componentNote = [
    sideComp ? sideComp.label : "",
    soupComp ? soupComp.label : "",
  ].filter(Boolean).join("・");

  const hotcookNote = has_hotcook
    ? `- 調理器具: ホットクックあり。無水調理・煮物・スープ・蒸し物を優先`
    : "";

  const hasUserRequest = user_request.trim().length > 0;

  const langInstruction = locale === "en"
    ? "IMPORTANT: Write all text values in English (dish names, reasons, ingredient names, genre, etc.).\n\n"
    : "";

  const missingIngredientsRule = hasUserRequest
    ? `- リクエスト食材が冷蔵庫にない場合は必ず missing_ingredients に追加すること
- matched_ingredients には冷蔵庫の食材リストにあるもののみ入れること`
    : `- missing_ingredients は必ず空配列 [] にすること
- 買い物が必要な料理は絶対に提案しないこと
- 今ある食材と常備調味料だけで完結する料理を選ぶこと`;

  const userRequestBlock = hasUserRequest
    ? `\n==========================================
【最優先指示・絶対に守ること】
ユーザーのリクエスト: 「${user_request.trim()}」
==========================================

- リクエストで食材が指定されている場合（例:「白菜と肉を使いたい」）→ 提案する2案すべてその食材を主役にすること。別食材を主役にすることは禁止。
- リクエストで料理名が指定されている場合（例:「カレーを作りたい」）→ その料理のバリエーション（例: 和風カレー・ドライカレー等）を2案提案すること。
- リクエスト食材が冷蔵庫にない場合は missing_ingredients に追加してよい。
`
    : "";

  const reminderBlock = hasUserRequest
    ? `\n==========================================
🔴 再度の念押し:
ユーザーのリクエスト「${user_request.trim()}」を必ず守ること。
2案両方とも、リクエストで指定された食材/料理を主役にすること。
==========================================
`
    : "";

  return `${langInstruction}あなたは家庭料理の専門家です。
${userRequestBlock}
【絶対条件】
以下の調味料・基本食材は常に自宅にあるものとして扱ってください:
${ALWAYS_AVAILABLE_SEASONINGS}

冷蔵庫にある食材:
${ingredients.join("、")}

献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${hotcookNote}

「${meal_1_name}」（${meal_1_type}）は既に提案済みです。
上記の食材${hasUserRequest ? "とユーザーリクエスト" : "と常備調味料だけ"}で作れる${mainLabel}をあと2案提案してください。

条件:
- meal_2 の type: "${type2}"
- meal_3 の type: "${type3}"
- 「${meal_1_name}」と異なるジャンル・主食材・調理法にすること

【必須ルール】
${missingIngredientsRule}
${reminderBlock}
出力はJSONのみ（コードブロック・説明文不要）:
{
  "meals": [
    {
      "type": "${type2}",
      "name": "${hasUserRequest ? "リクエストの指定食材/料理を使った料理名" : mainLabel + "名"}",
      "reason": "なぜこの料理か（1文・30字以内）",
      "time_minutes": 数値,
      "difficulty": "easy|medium|hard",
      "matched_ingredients": ["冷蔵庫にあって料理に使う食材"],
      "missing_ingredients": ${hasUserRequest ? `["リクエスト食材で冷蔵庫にないもの、+必要な追加食材"]` : "[]"},
      "genre": "和食|洋食|中華|エスニック",
      "main_ingredient": "肉|魚|卵|野菜|麺|米",
      "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"${buildSubDishFields(meal_components)}
    },
    {
      "type": "${type3}",
      "name": "${hasUserRequest ? "リクエストの指定食材/料理を使った料理名" : mainLabel + "名"}",
      "reason": "なぜこの料理か（1文・30字以内）",
      "time_minutes": 数値,
      "difficulty": "easy|medium|hard",
      "matched_ingredients": [...],
      "missing_ingredients": ${hasUserRequest ? `[...]` : "[]"},
      "genre": "和食|洋食|中華|エスニック",
      "main_ingredient": "肉|魚|卵|野菜|麺|米",
      "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"${buildSubDishFields(meal_components)}
    }
  ]
}`;
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function POST(req: NextRequest) {
  const {
    ingredients,
    tired_mode = false,
    meal_1_name,
    meal_1_type,
    session_id,
    meal_components = [{ role: "main", label: "メイン" }],
    locale = "ja",
    appliances = [],
    user_request = "",
  } = await req.json();

  if (!ingredients?.length) {
    return new Response("ingredients required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      try {
        if (!process.env.GEMINI_API_KEY) {
          send("error", { message: "GEMINI_API_KEY が .env.local に設定されていません" });
          return;
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.5-flash-lite",
          generationConfig: { temperature: 0.2 },
        });
        const has_hotcook = (appliances as string[]).includes("hotcook");
        console.log("[alternatives] user_request:", JSON.stringify(user_request));
        const prompt = buildPrompt(
          ingredients,
          tired_mode,
          meal_1_name ?? "",
          meal_1_type ?? "best",
          meal_components as ActiveComp[],
          locale,
          has_hotcook,
          user_request
        );

        const result = await model.generateContent(prompt);
        const fullText = result.response.text();

        const parsed = JSON.parse(extractJSON(fullText)) as {
          meals: {
            name: string;
            genre: string;
            main_ingredient: string;
            cooking_method: string;
            [key: string]: unknown;
          }[];
        };

        for (const meal of parsed.meals ?? []) {
          meal.id = randomUUID();
          console.log("[alternatives] meal:", meal.name, "matched:", meal.matched_ingredients, "missing:", meal.missing_ingredients);
          send("meal", { meal });
        }

        const userId = await getAuthUserId();
        if (userId && session_id && parsed.meals?.length) {
          await saveMealHistory({
            userId,
            sessionId: session_id,
            meals: parsed.meals.map((m) => ({
              meal_name: m.name,
              genre: m.genre,
              main_ingredient: m.main_ingredient,
              cooking_method: m.cooking_method,
            })),
          });
        }

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
