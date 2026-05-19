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

type ActiveComp = { role: string; label: string };

const ALWAYS_AVAILABLE_SEASONINGS = `
醤油・塩・胡椒・砂糖・みりん・料理酒・酢・サラダ油・ごま油・バター・マヨネーズ・ケチャップ
味噌・だし（和風・コンソメ・鶏がら）・小麦粉・片栗粉・オリーブオイル・めんつゆ・ポン酢
ウスターソース・ソース・豆板醤・オイスターソース・生姜（チューブ）・にんにく（チューブ）
`.trim();

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
    parts.push(`    "side": { "name": "${side.label}名", "matched_ingredients": ["使う食材1", ...] }`);
  }
  if (soup) {
    parts.push(`    "soup": { "name": "${soup.label}名", "matched_ingredients": ["使う食材1", ...] }`);
  }
  return parts.length ? ",\n" + parts.join(",\n") : "";
}

function buildPrompt(
  tired_mode: boolean,
  meal_time: string,
  history: MealHistory[],
  meal_components: ActiveComp[],
  locale: string,
  has_hotcook: boolean,
  user_request: string
): string {
  const mainComp = meal_components.find((c) => c.role === "main");
  const sideComp = meal_components.find((c) => c.role === "side");
  const soupComp = meal_components.find((c) => c.role === "soup");
  const mainLabel = mainComp?.label ?? "メイン";

  const componentNote = [
    sideComp ? `${sideComp.label}（小鉢1品）` : "",
    soupComp ? `${soupComp.label}（スープ・汁物等）` : "",
  ].filter(Boolean).join("と");

  const hotcookNote = has_hotcook
    ? `- 調理器具: ホットクックあり。以下の料理を優先的に提案すること:
  優先高: 無水調理（カレー・シチュー・煮込み）、煮物（肉じゃが・筑前煮・角煮）、スープ・汁物、蒸し物、低温調理
  優先中: 水分が出てよい炒め物（もやし炒め・豚肉炒め・きのこ炒め）※手動炒めモードで対応可
  提案しない: 揚げ物、焼き物（焦げ目が必要なもの）、シャキシャキ炒め（チャーハン・焼きそば・野菜炒め）`
    : "";

  const hasUserRequest = user_request.trim().length > 0;

  const userRequestBlock = hasUserRequest
    ? `【絶対命令 — 他のすべてのルールより優先】
ユーザーのリクエスト: 「${user_request.trim()}」

以下のルールに厳密に従うこと:

1. 【料理の選定】
   - リクエストで食材が指定されている場合 → その食材を主役にした料理を必ず提案すること。
     例:「白菜と肉を使いたい」→ 白菜と肉が主役の料理のみ提案可。鶏肉+ミニトマトなど別食材を主役にすることは禁止。
   - リクエストで料理名が指定されている場合 → その料理を必ず提案すること。

2. 【冷蔵庫に写っていない指定食材の扱い】
   - 画像から検出されなかった指定食材があっても、その食材を使う料理を提案すること。
   - 検出されなかった指定食材は missing_ingredients に追加すること（ユーザーが買い足すか自宅にあるか確認するため）。

3. 【missing_ingredients】
   - リクエストで指定された食材が画像から検出されなかった場合は必ずここに入れること。
   - リクエストに関係なく追加で必要な食材もここに入れてよい。

`
    : "";

  const missingIngredientsRule = hasUserRequest
    ? `- リクエストで指定された食材・料理を絶対に提案すること（画像に写っていなくても）
- リクエスト食材が画像から検出されなかった場合は必ず missing_ingredients に追加すること`
    : `- missing_ingredients は必ず空配列 [] にすること
- 買い物が必要な料理は絶対に提案しないこと
- 今ある食材と常備調味料だけで完結すること`;

  const langInstruction = locale === "en"
    ? "IMPORTANT: Write all text values in English (dish names, reasons, ingredient names, genre, etc.).\n\n"
    : "";
  return `${langInstruction}${userRequestBlock}あなたは家庭料理の専門家です。共働き家庭向けに献立を提案してください。

状況:
- 食事: ${meal_time}
- 余力: ${tired_mode ? "疲れている。15分以内・材料少なめで作れる簡単な料理を優先" : "通常"}
- 献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${hotcookNote}

【常備調味料・基本食材（常に自宅にあるものとして扱う）】
${ALWAYS_AVAILABLE_SEASONINGS}
${buildHistorySection(history)}
冷蔵庫の写真から食材を認識し（調味料は ingredients に含めない）、献立を提案してください。

【必須ルール】
${missingIngredientsRule}
${sideComp || soupComp ? `- メインとサブ料理は食材が重複しすぎないよう、バランスよく選ぶこと` : ""}

出力はJSONのみ（コードブロック・説明文不要）:
{
  "ingredients": ["食材1", "食材2", ...],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "${mainLabel}名",
    "reason": "なぜこのメインか（1文・30字以内）",
    "time_minutes": 数値,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["今ある食材1", ...],
    "missing_ingredients": ["足りない食材1", ...],
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

function extractNewIngredients(buffer: string, known: Set<string>): string[] {
  const found: string[] = [];
  const section = buffer.match(/"ingredients"\s*:\s*\[([^\]]*)/);
  if (!section) return found;
  for (const m of Array.from(section[1].matchAll(/"([^"\\]+)"/g))) {
    if (!known.has(m[1])) {
      known.add(m[1]);
      found.push(m[1]);
    }
  }
  return found;
}

type SendFn = (event: string, data: unknown) => void;

async function streamWithGemini(
  imageDataUrls: string[],
  prompt: string,
  send: SendFn
): Promise<string> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

  const imageParts = imageDataUrls.map((url) => ({
    inlineData: {
      data: url.replace(/^data:image\/\w+;base64,/, ""),
      mimeType: (url.match(/^data:(image\/\w+);/)?.[1] ?? "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/webp",
    },
  }));

  const result = await model.generateContentStream([prompt, ...imageParts]);
  const known = new Set<string>();
  let fullText = "";

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (!text) continue;
    fullText += text;
    for (const ingredient of extractNewIngredients(fullText, known)) {
      send("ingredient", { item: ingredient });
    }
  }
  return fullText;
}

async function streamWithGPT4o(
  imageDataUrls: string[],
  prompt: string,
  send: SendFn
): Promise<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
  const imageContents: OpenAI.Chat.ChatCompletionContentPart[] = imageDataUrls.map((url) => ({
    type: "image_url",
    image_url: { url, detail: "auto" },
  }));

  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...imageContents] }],
    max_tokens: 1000,
    stream: true,
  });

  const known = new Set<string>();
  let fullText = "";

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (!text) continue;
    fullText += text;
    for (const ingredient of extractNewIngredients(fullText, known)) {
      send("ingredient", { item: ingredient });
    }
  }
  return fullText;
}

export async function POST(req: NextRequest) {
  const {
    imageDataUrls,
    tired_mode = false,
    meal_time = "夕食",
    meal_components = [{ role: "main", label: "メイン" }],
    locale = "ja",
    appliances = [],
    user_request = "",
  } = await req.json();

  if (!imageDataUrls?.length) {
    return new Response("imageDataUrls required", { status: 400 });
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
      const prompt = buildPrompt(tired_mode, meal_time, history, meal_components as ActiveComp[], locale, has_hotcook, user_request);
      let fullText = "";

      try {
        if (process.env.GEMINI_API_KEY) {
          try {
            fullText = await streamWithGemini(imageDataUrls, prompt, send);
          } catch {
            send("status", { message: "GPT-4oに切り替えています..." });
            if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY が未設定です");
            fullText = await streamWithGPT4o(imageDataUrls, prompt, send);
          }
        } else if (process.env.OPENAI_API_KEY) {
          fullText = await streamWithGPT4o(imageDataUrls, prompt, send);
        } else {
          send("error", { message: "GEMINI_API_KEY または OPENAI_API_KEY を .env.local に設定してください" });
          return;
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
