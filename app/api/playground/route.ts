import { NextRequest } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `あなたは家庭料理の専門家です。
冷蔵庫の写真（複数枚）から食材を認識し、共働き家庭向けに献立を1案提案してください。
複数の写真がある場合は、全ての写真を合わせて食材を網羅的にリストアップしてください。

出力は必ず以下のJSONのみ（マークダウン不要）:
{
  "ingredients": ["食材1", "食材2", ...],
  "meal": {
    "name": "料理名",
    "reason": "なぜこの料理か（1文・30字以内）",
    "time_minutes": 数値,
    "difficulty": "easy|medium|hard",
    "matched_ingredients": ["使う食材1", ...],
    "missing_ingredients": ["買い足す食材1", ...]
  }
}`;

function extractJSON(text: string): string {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : text;
}

type SendFn = (event: string, data: unknown) => void;

async function streamGPT4o(imageDataUrls: string[], send: SendFn) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const imageContents: OpenAI.Chat.ChatCompletionContentPart[] = imageDataUrls.map((dataUrl) => ({
    type: "image_url",
    image_url: { url: dataUrl, detail: "auto" },
  }));

  const stream = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: [{ type: "text", text: SYSTEM_PROMPT }, ...imageContents] }],
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
  send("done", { ingredients: parsed.ingredients ?? [], meal: parsed.meal ?? null, rawResponse: fullText });
}

type GeminiModelId = "gemini-2.5-pro" | "gemini-2.5-flash" | "gemini-2.5-flash-no-think" | "gemini-2.5-flash-lite";

async function streamGemini(
  model: GeminiModelId,
  imageDataUrls: string[],
  send: SendFn
) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");

  const noThink = model === "gemini-2.5-flash-no-think";
  const modelId = noThink ? "gemini-2.5-flash" : model;

  const geminiModel = genAI.getGenerativeModel({
    model: modelId,
    ...(noThink && { generationConfig: { thinkingConfig: { thinkingBudget: 0 } } as never }),
  });

  const imageParts = imageDataUrls.map((dataUrl) => ({
    inlineData: {
      data: dataUrl.replace(/^data:image\/\w+;base64,/, ""),
      mimeType: (dataUrl.match(/^data:(image\/\w+);/)?.[1] ?? "image/jpeg") as
        | "image/jpeg"
        | "image/png"
        | "image/webp",
    },
  }));

  const result = await geminiModel.generateContentStream([SYSTEM_PROMPT, ...imageParts]);

  let fullText = "";
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      fullText += text;
      send("chunk", { text });
    }
  }

  const parsed = JSON.parse(extractJSON(fullText)) as { ingredients: string[]; meal: unknown };
  send("done", { ingredients: parsed.ingredients ?? [], meal: parsed.meal ?? null, rawResponse: fullText });
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
