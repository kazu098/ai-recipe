import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

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

function parseArray(text: string): string[] {
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

async function recognizeOneGemini(dataUrl: string): Promise<string[]> {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-lite",
    generationConfig: { temperature: 0.1 },
  });
  try {
    const result = await model.generateContent([INGREDIENT_ONLY_PROMPT, toImagePart(dataUrl)]);
    return parseArray(result.response.text());
  } catch {
    return [];
  }
}

async function recognizeOneGPT4o(dataUrl: string): Promise<string[]> {
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
  return parseArray(res.choices[0]?.message?.content ?? "");
}

export async function POST(req: NextRequest) {
  const { imageDataUrls } = await req.json();

  if (!imageDataUrls?.length) {
    return Response.json({ error: "imageDataUrls required" }, { status: 400 });
  }

  try {
    let lists: string[][];

    if (process.env.GEMINI_API_KEY) {
      lists = await Promise.all((imageDataUrls as string[]).map(recognizeOneGemini));
    } else if (process.env.OPENAI_API_KEY) {
      lists = await Promise.all((imageDataUrls as string[]).map(recognizeOneGPT4o));
    } else {
      return Response.json({ error: "GEMINI_API_KEY または OPENAI_API_KEY が未設定です" }, { status: 500 });
    }

    const ingredients = mergeIngredients(lists);
    return Response.json({ ingredients });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "認識に失敗しました" },
      { status: 500 }
    );
  }
}
