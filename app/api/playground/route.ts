import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `あなたは家庭料理の専門家です。
冷蔵庫の写真から食材を認識し、共働き家庭向けに献立を1案提案してください。

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

async function callGPT4o(imageDataUrl: string) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const mimeType = imageDataUrl.match(/^data:(image\/\w+);/)?.[1] ?? "image/jpeg";

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: SYSTEM_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "low" } },
        ],
      },
    ],
    max_tokens: 800,
  });

  const raw = response.choices[0].message.content ?? "";
  return { raw, parsed: JSON.parse(extractJSON(raw)) };
}

async function callGemini(model: "gemini-2.5-pro-preview-05-06" | "gemini-2.5-flash-preview-04-17", imageDataUrl: string) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY ?? "");
  const geminiModel = genAI.getGenerativeModel({ model });

  const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, "");
  const mimeType = (imageDataUrl.match(/^data:(image\/\w+);/)?.[1] ?? "image/jpeg") as "image/jpeg" | "image/png" | "image/webp";

  const result = await geminiModel.generateContent([
    SYSTEM_PROMPT,
    { inlineData: { data: base64, mimeType } },
  ]);

  const raw = result.response.text();
  return { raw, parsed: JSON.parse(extractJSON(raw)) };
}

export async function POST(req: NextRequest) {
  const { model, imageDataUrl } = await req.json();

  if (!imageDataUrl) {
    return NextResponse.json({ error: "imageDataUrl is required" }, { status: 400 });
  }

  try {
    let raw: string;
    let parsed: unknown;

    if (model === "gpt-4o") {
      if (!process.env.OPENAI_API_KEY) {
        return NextResponse.json({ error: "OPENAI_API_KEY が .env.local に設定されていません" }, { status: 500 });
      }
      ({ raw, parsed } = await callGPT4o(imageDataUrl));
    } else if (model === "gemini-2.5-pro") {
      if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY が .env.local に設定されていません" }, { status: 500 });
      }
      ({ raw, parsed } = await callGemini("gemini-2.5-pro-preview-05-06", imageDataUrl));
    } else if (model === "gemini-2.5-flash") {
      if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json({ error: "GEMINI_API_KEY が .env.local に設定されていません" }, { status: 500 });
      }
      ({ raw, parsed } = await callGemini("gemini-2.5-flash-preview-04-17", imageDataUrl));
    } else {
      return NextResponse.json({ error: `未対応モデル: ${model}` }, { status: 400 });
    }

    const result = parsed as { ingredients: string[]; meal: unknown };
    return NextResponse.json({
      ingredients: result.ingredients ?? [],
      meal: result.meal ?? null,
      rawResponse: raw,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
