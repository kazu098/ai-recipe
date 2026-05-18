import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID } from "crypto";

function buildPrompt(
  ingredients: string[],
  tired_mode: boolean,
  meal_1_name: string,
  meal_1_type: string
): string {
  const [type2, type3] = tired_mode
    ? ["no_shopping", "best"]
    : ["quick", "no_shopping"];

  return `あなたは家庭料理の専門家です。

冷蔵庫にある食材:
${ingredients.join("、")}

「${meal_1_name}」（${meal_1_type}）は既に提案済みです。
上記の食材を使って、異なる料理をあと2案提案してください。

条件:
- meal_2 の type: "${type2}"
- meal_3 の type: "${type3}"
- 「${meal_1_name}」と異なるジャンル・主食材・調理法にすること

出力はJSONのみ（コードブロック・説明文不要）:
{
  "meals": [
    {
      "type": "${type2}",
      "name": "料理名",
      "reason": "なぜこの料理か（1文・30字以内）",
      "time_minutes": 数値,
      "difficulty": "easy|medium|hard",
      "matched_ingredients": ["今ある食材1", ...],
      "missing_ingredients": ["足りない食材（なければ空配列）"],
      "genre": "和食|洋食|中華|エスニック",
      "main_ingredient": "肉|魚|卵|野菜|麺|米",
      "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"
    },
    {
      "type": "${type3}",
      "name": "料理名",
      "reason": "なぜこの料理か（1文・30字以内）",
      "time_minutes": 数値,
      "difficulty": "easy|medium|hard",
      "matched_ingredients": [...],
      "missing_ingredients": [...],
      "genre": "和食|洋食|中華|エスニック",
      "main_ingredient": "肉|魚|卵|野菜|麺|米",
      "cooking_method": "炒め|煮込み|焼き|揚げ|蒸し|サラダ"
    }
  ]
}`;
}

function extractJSON(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
}

export async function POST(req: NextRequest) {
  const { ingredients, tired_mode = false, meal_1_name, meal_1_type } = await req.json();

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
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = buildPrompt(ingredients, tired_mode, meal_1_name ?? "", meal_1_type ?? "best");

        // Phase B はテキストのみ（画像なし）→ 高速・安価
        const result = await model.generateContent(prompt);
        const fullText = result.response.text();

        const parsed = JSON.parse(extractJSON(fullText)) as {
          meals: Record<string, unknown>[];
        };

        for (const meal of parsed.meals ?? []) {
          meal.id = randomUUID();
          send("meal", { meal });
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
