import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { randomUUID } from "crypto";

function buildPrompt(tired_mode: boolean, meal_time: string): string {
  return `あなたは家庭料理の専門家です。共働き家庭向けに献立を提案してください。

状況:
- 食事: ${meal_time}
- 余力: ${tired_mode ? "疲れている。15分以内・材料少なめで作れる簡単な料理を優先" : "通常"}

冷蔵庫の写真から食材を全て認識し、最適な献立を1案提案してください。

出力はJSONのみ（コードブロック・説明文不要）:
{
  "ingredients": ["食材1", "食材2", ...],
  "meal": {
    "type": "${tired_mode ? "quick" : "best"}",
    "name": "料理名",
    "reason": "なぜこの料理か（1文・30字以内）",
    "time_minutes": 数値,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["今ある食材1", ...],
    "missing_ingredients": ["足りない食材（なければ空配列）"],
    "genre": "和食|洋食|中華|エスニック",
    "main_ingredient": "肉|魚|卵|野菜|麺|米",
    "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"
  }
}`;
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

// 食材を1つずつストリームから抽出
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
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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
  const { imageDataUrls, tired_mode = false, meal_time = "夕食" } = await req.json();

  if (!imageDataUrls?.length) {
    return new Response("imageDataUrls required", { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send: SendFn = (event, data) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      const prompt = buildPrompt(tired_mode, meal_time);
      let fullText = "";

      try {
        // Gemini 2.5 Flash をPrimaryとして使用。失敗時はGPT-4oにフォールバック
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
          meal: Record<string, unknown>;
        };
        parsed.meal.id = randomUUID();

        send("meal", { meal: parsed.meal, ingredients: parsed.ingredients });
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
