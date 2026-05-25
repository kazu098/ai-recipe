import { NextRequest } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

// Phase 1: 1枚の画像から食材のみを抽出
const INGREDIENT_ONLY_PROMPT = `冷蔵庫の写真を1枚見て、見えている食材をリストアップしてください。
ルール:
- 調味料・ドレッシング・ソース類は含めない
- 食材名は日本語で簡潔に（例: 鶏もも肉、卵、ニンジン）
- 商品パッケージが見える場合は中の食材名に変換する（例: 「冷凍チャーハン」→「冷凍ご飯」）
- 確認できない・不明なものは含めない
JSON配列のみ出力（説明文不要）: ["食材1", "食材2", ...]`;

// Phase 2: 認識済み食材から献立を提案
function buildMealPrompt(ingredients: string[]): string {
  return `あなたは家庭料理の専門家です。
冷蔵庫に以下の食材があります（画像認識済み）:
${ingredients.join("、")}

この食材は「候補」です。すべて使う必要はありません。
料理として自然に合う食材だけを1〜4個程度選び、共働き家庭向けに献立を1案提案してください。
認識外の肉・魚・野菜・豆腐などを勝手に前提にした料理名にしないでください。
料理名と料理内容は、選んだ認識食材 + 一般的な常備調味料だけで説明できるものにしてください。

出力は必ず以下のJSONのみ（マークダウン不要）:
{
  "ingredients": [${ingredients.map((i) => `"${i}"`).join(", ")}],
  "meal": {
    "name": "料理名",
    "reason": "なぜこの料理か（1文・30字以内）",
    "time_minutes": 数値,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["使う食材1", ...],
    "missing_ingredients": ["買い足す食材1", ...]
  }
}`;
}

function extractJSON(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}

function parseIngredientArray(text: string): string[] {
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try {
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

type SendFn = (event: string, data: unknown) => void;
type GeminiModelId = "gemini-2.5-pro" | "gemini-2.5-flash" | "gemini-2.5-flash-no-think" | "gemini-2.5-flash-lite";

async function streamGPT4o(imageDataUrls: string[], send: SendFn) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Phase 1: per-image 並列認識
  const lists = await Promise.all(
    imageDataUrls.map(async (url) => {
      const res = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: INGREDIENT_ONLY_PROMPT },
            { type: "image_url", image_url: { url, detail: "auto" } },
          ],
        }],
        max_tokens: 300,
      });
      return parseIngredientArray(res.choices[0]?.message?.content ?? "");
    })
  );
  const ingredients = mergeIngredients(lists);

  // Phase 2: テキストのみで献立生成
  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: buildMealPrompt(ingredients) }],
    max_tokens: 800,
    stream: true,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) {
      fullText += text;
      send("chunk", { text });
    }
  }

  const parsed = JSON.parse(extractJSON(fullText)) as { ingredients: string[]; meal: unknown };
  send("done", { ingredients: parsed.ingredients ?? ingredients, meal: parsed.meal ?? null, rawResponse: fullText });
}

async function streamGemini(model: GeminiModelId, imageDataUrls: string[], send: SendFn) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

  const noThink = model === "gemini-2.5-flash-no-think";
  const modelId = noThink ? "gemini-2.5-flash" : model;
  const geminiModel = genAI.getGenerativeModel({
    model: modelId,
    ...(noThink && { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as never }),
  });

  // Phase 1: per-image 並列認識
  const lists = await Promise.all(
    imageDataUrls.map(async (url) => {
      try {
        const result = await geminiModel.generateContent([INGREDIENT_ONLY_PROMPT, toImagePart(url)]);
        return parseIngredientArray(result.response.text());
      } catch {
        return [] as string[];
      }
    })
  );
  const ingredients = mergeIngredients(lists);

  // Phase 2: テキストのみで献立生成（ストリーミング）
  const result = await geminiModel.generateContentStream(buildMealPrompt(ingredients));

  let fullText = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      fullText += text;
      send("chunk", { text });
    }
  }

  const parsed = JSON.parse(extractJSON(fullText)) as { ingredients: string[]; meal: unknown };
  send("done", { ingredients: parsed.ingredients ?? ingredients, meal: parsed.meal ?? null, rawResponse: fullText });
}

export async function POST(req: NextRequest) {
  const { model, imageDataUrls } = await req.json();

  if (!imageDataUrls || !Array.isArray(imageDataUrls) || imageDataUrls.length === 0) {
    return new Response("imageDataUrls (配列) が必要です", { status: 400 });
  }
  if (imageDataUrls.length > 5) {
    return new Response("画像は最大5枚までです", { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send: SendFn = (event, data) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      try {
        if (model === "gpt-4o") {
          if (!process.env.OPENAI_API_KEY) {
            send("error", { message: "OPENAI_API_KEY が .env.local に設定されていません" });
            return;
          }
          await streamGPT4o(imageDataUrls, send);
        } else if (["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-no-think", "gemini-2.5-flash-lite"].includes(model)) {
          if (!process.env.GEMINI_API_KEY) {
            send("error", { message: "GEMINI_API_KEY が .env.local に設定されていません" });
            return;
          }
          await streamGemini(model as GeminiModelId, imageDataUrls, send);
        } else {
          send("error", { message: `未対応モデル: ${model}` });
        }
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
