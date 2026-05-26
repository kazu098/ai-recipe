import { NextRequest } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { randomUUID } from "crypto";
import { getAuthUserId, saveMealHistory } from "@/lib/supabase/db";

type ActiveComp = { role: string; label: string };
type MealAudience = "family" | "kids" | "adults";

const ALWAYS_AVAILABLE_SEASONINGS_JA = `
醤油・塩・胡椒・砂糖・みりん・料理酒・酢・サラダ油・ごま油・バター・マヨネーズ・ケチャップ
味噌・だし（和風・コンソメ・鶏がら）・小麦粉・片栗粉・オリーブオイル・めんつゆ・ポン酢
ウスターソース・ソース・豆板醤・オイスターソース・生姜（チューブ）・にんにく（チューブ）
`.trim();

const ALWAYS_AVAILABLE_SEASONINGS_EN = `
salt, black pepper, sugar, white vinegar, apple cider vinegar, vegetable oil, olive oil, butter, mayonnaise, ketchup
chicken/beef/vegetable broth, all-purpose flour, cornstarch, soy sauce, Worcestershire sauce, hot sauce
garlic powder, onion powder, cumin, paprika, Italian seasoning, dried oregano, red pepper flakes
Dijon mustard, balsamic vinegar, honey, heavy cream, tomato paste
`.trim();

function buildSubDishFields(components: ActiveComp[]): string {
  const parts: string[] = [];
  const side = components.find((c) => c.role === "side");
  const soup = components.find((c) => c.role === "soup");
  if (side) {
    parts.push(`      "side": { "name": "${side.label}名（小鉢・副菜。汁物・スープは不可）", "matched_ingredients": ["使う食材1", ...] }`);
  }
  if (soup) {
    parts.push(`      "soup": { "name": "${soup.label}名（必ず味噌汁・スープ・汁物など液体を含む料理。サラダ・炒め物・副菜は絶対不可）", "matched_ingredients": ["使う食材1", ...] }`);
  }
  return parts.length ? ",\n" + parts.join(",\n") : "";
}

function buildCuisineNote(cuisine_pattern: string, locale: string): string {
  const isEn = locale === "en";

  // 英語ユーザーがデフォルト（japanese）のままの場合は洋食バイアスを適用
  if (isEn && cuisine_pattern === "japanese") {
    return "\n- Cuisine: Any — prefer globally familiar dishes (Western, Mediterranean, global). Japanese dishes acceptable if ingredients call for them. Avoid defaulting to purely Japanese dishes (nikujaga, teriyaki, etc.).";
  }

  const notes: Record<string, { en: string; ja: string }> = {
    western:  { en: "- Cuisine: Western (American/European). Suggest pasta, grilled meats, tacos, burgers, salads, soups. NOT Japanese-style western food.", ja: "- ジャンル: 洋食（欧米スタイル）。パスタ・グリル料理・タコス・バーガー・サラダ・スープなど。日本化した洋食（ハンバーグ・コロッケ等）は避ける。" },
    korean:   { en: "- Cuisine: Korean. Suggest bibimbap, bulgogi, kimchi jjigae, japchae, tteokbokki, dakgalbi, doenjang jjigae, pajeon.", ja: "- ジャンル: 韓国料理。ビビンバ・プルコギ・キムチチゲ・チャプチェ・トッポッキ・タッカルビ・テンジャンチゲ・チヂミ。" },
    chinese:  { en: "- Cuisine: Chinese. Suggest mapo tofu, kung pao chicken, fried rice, lo mein, dumplings, sweet and sour pork, hot and sour soup.", ja: "- ジャンル: 中華料理。麻婆豆腐・宮保鶏丁・チャーハン・焼きそば・餃子・酢豚・酸辣湯。" },
    japanese: { en: "- Cuisine: Japanese. Suggest miso soup, yakitori, karaage, nikujaga, oyakodon, teriyaki, agedashi tofu.", ja: "- ジャンル: 和食。味噌汁・焼き鳥・唐揚げ・肉じゃが・親子丼・照り焼き・揚げ出し豆腐。" },
    ethnic:   { en: "- Cuisine: Ethnic/Global. Suggest Thai curry, pad thai, tikka masala, tacos, pho, shakshuka, nasi goreng.", ja: "- ジャンル: エスニック。グリーンカレー・パッタイ・ティッカマサラ・タコス・フォー・シャクシュカ・ナシゴレン。" },
  };
  const note = notes[cuisine_pattern];
  if (!note) return "";
  return "\n" + (isEn ? note.en : note.ja);
}

function buildAudienceSection(audience: MealAudience, locale: string, tiredMode: boolean): string {
  const selected: MealAudience = ["family", "kids", "adults"].includes(audience) ? audience : "family";
  if (locale === "en") {
    const base = tiredMode
      ? "- Low-energy mode: keep it fast and low-effort, while still offering a different repertoire from the first suggestion."
      : "- Normal mode: prioritize variety, balance, and a dinner that feels acceptable for the whole household.";
    const details: Record<MealAudience, string[]> = {
      family: [
        "- Target: a household dinner for parents and children, not solo cooking.",
        "- Prefer a child-friendly base seasoning; adults can add spice or condiments after serving.",
        "- Avoid spicy, bitter, or very strong flavors unless requested.",
        base,
      ],
      kids: [
        "- Target: children first, while still acceptable for adults.",
        "- Use mild seasoning, soft textures, bite-sized cuts, and familiar flavors.",
        "- Avoid spicy or strongly aromatic dishes unless requested.",
        base,
      ],
      adults: [
        "- Target: adults in the household. Child constraints can be relaxed.",
        "- More varied cuisines and stronger flavors are acceptable if they match the ingredients.",
        "- Still suggest a practical home dinner, not a solo convenience meal unless requested.",
        base,
      ],
    };
    return `\n[Meal Audience]\n${details[selected].join("\n")}\n`;
  }

  const base = tiredMode
    ? "- 疲れたモードでは、時短・低負荷を優先しつつ、1案目と違うレパートリーを出すこと。"
    : "- 通常モードでは、家族の夕食としてのバランス・満足感・レパートリーの広がりを優先すること。";
  const details: Record<MealAudience, string[]> = {
    family: [
      "- 対象: 子どもを含む家庭の夕食。一人暮らし向けの自分用簡単飯ではない。",
      "- 子どもも食べやすいベースの味付けにし、大人は後から辛味・薬味・調味料で調整できる料理を優先。",
      "- リクエストがない限り、辛すぎる・苦味が強い・香りが強すぎる料理は避ける。",
      base,
    ],
    kids: [
      "- 対象: 子ども優先。大人も食べられるが、子どもの食べやすさを最優先。",
      "- 辛さ控えめ、やわらかめ、一口サイズ、なじみのある味を優先。",
      "- リクエストがない限り、辛味やクセの強い香味野菜を主役にしない。",
      base,
    ],
    adults: [
      "- 対象: 大人向け。子ども向け制約はゆるめてよい。",
      "- 食材に合うなら、少し大人っぽい味付けや異国料理も選んでよい。",
      "- ただし家庭の夕食として現実的な料理にし、一人向けの手抜き飯には寄せすぎない。",
      base,
    ],
  };
  return `\n【食べる人】\n${details[selected].join("\n")}\n`;
}

function buildPrompt(
  ingredients: string[],
  tired_mode: boolean,
  meal_1_name: string,
  meal_1_type: string,
  meal_components: ActiveComp[],
  locale: string,
  has_hotcook: boolean,
  user_request: string,
  meal_audience: MealAudience = "family",
  cuisine_pattern = "japanese",
  priority_ingredients: string[] = []
): string {
  const isEn = locale === "en";
  const [type2, type3] = tired_mode
    ? ["no_shopping", "best"]
    : ["quick", "no_shopping"];

  const mainComp = meal_components.find((c) => c.role === "main");
  const sideComp = meal_components.find((c) => c.role === "side");
  const soupComp = meal_components.find((c) => c.role === "soup");
  const mainLabel = mainComp?.label ?? (isEn ? "Main dish" : "メイン");

  const hotcookNote = has_hotcook
    ? isEn
      ? "- Appliance: Hotcook available. Prefer waterless cooking, braises, soups, and steamed dishes."
      : "- 調理器具: ホットクックあり。無水調理・煮物・スープ・蒸し物を優先"
    : "";

  const hasUserRequest = user_request.trim().length > 0;
  const seasonings = isEn ? ALWAYS_AVAILABLE_SEASONINGS_EN : ALWAYS_AVAILABLE_SEASONINGS_JA;
  const ingredientList = ingredients.join(isEn ? ", " : "、");
  const priorityNote = priority_ingredients.length > 0
    ? isEn
      ? `\n[Priority ingredients — MUST USE these in BOTH suggested dishes]: ${priority_ingredients.join(", ")}\n`
      : `\n【優先使用食材 — 両方の提案料理に必ずこれらを使うこと】: ${priority_ingredients.join("、")}\n`
    : "";
  const ingredientSelectionRule = isEn
    ? `- Fridge contents are candidate ingredients, not a checklist. Do NOT try to use all recognized ingredients.
- Select only the ingredients that naturally fit each dish. It is OK to leave recognized ingredients unused.
- For each main dish, usually use 1-4 core fridge ingredients unless the dish naturally needs more.
- Do NOT invent non-pantry ingredients. Without a user request, each dish name and dish content must be explainable using only matched_ingredients + pantry staples.
- matched_ingredients must be a subset of the recognized fridge list and must include only ingredients actually used in that dish.`
    : `- 認識した食材は「候補」であり、全部使う必要はありません。全食材を無理に使い切ろうとしないこと。
- 各料理に自然に合う食材だけを選んで使うこと。認識食材が余っても問題ありません。
- 各メイン料理では、基本的に冷蔵庫食材を1〜4個程度に絞ること（料理として自然な場合だけ増やしてよい）。
- 認識外の肉・魚・野菜・豆腐などを勝手に前提にした料理名にしないこと。リクエストがない場合、各料理名と料理内容は matched_ingredients + 常備調味料だけで説明できること。
- matched_ingredients は認識済み冷蔵庫食材の部分集合にし、その料理に実際に使う食材だけを入れること。`;

  if (isEn) {
    const componentNote = [
      sideComp ? `${sideComp.label} (side dish)` : "",
      soupComp ? `${soupComp.label} (must be a liquid dish: soup, broth, etc.)` : "",
    ].filter(Boolean).join(" + ");

    const missingRule = hasUserRequest
      ? `- If a requested ingredient is not in the fridge, add it to missing_ingredients\n- matched_ingredients must only include items from the fridge list`
      : `- Prioritize dishes using only current fridge items and pantry staples\n- [STRICT] Add any ingredient needed but not in the fridge or pantry to missing_ingredients\n- [STRICT] Only set missing_ingredients to [] after confirming no ingredient is missing`;

    const userRequestBlock = hasUserRequest
      ? `\n==========================================
[TOP PRIORITY — MUST FOLLOW]
User request: "${user_request.trim()}"
==========================================

- If ingredients are specified (e.g. "I want to use cabbage and pork") → both suggestions must feature those ingredients as the star.
- If a dish is specified (e.g. "I want curry") → suggest 2 variations of that dish (e.g. Japanese curry, dry curry).
- If requested ingredients are not in the fridge, add them to missing_ingredients.
`
      : "";

    const reminderBlock = hasUserRequest
      ? `\n==========================================
🔴 Reminder:
MUST follow user request "${user_request.trim()}".
BOTH suggestions must feature the requested ingredient/dish as the star.
==========================================
`
      : "";

    return `You are a home cooking expert.
${userRequestBlock}
[Pantry staples (always available)]
${seasonings}

Fridge contents:
${ingredientList}
${priorityNote}

Meal structure: ${mainLabel}${componentNote ? ` + ${componentNote}` : " only"}
${buildAudienceSection(meal_audience, locale, tired_mode)}${hotcookNote}${buildCuisineNote(cuisine_pattern, locale)}

"${meal_1_name}" (${meal_1_type}) has already been suggested.
Suggest 2 more ${mainLabel} dishes using the above ingredients${hasUserRequest ? " and the user request" : " and pantry staples"}.

Requirements:
- meal_2 type: "${type2}"
- meal_3 type: "${type3}"
- Choose a different genre, main ingredient, and cooking method from "${meal_1_name}"

[Required rules]
${ingredientSelectionRule}
${missingRule}
${soupComp ? "- soup must be a liquid dish (miso soup, broth, stew). Never a salad or stir-fry." : ""}
${reminderBlock}
Output JSON only (no code block, no explanation):
{
  "meals": [
    {
      "type": "${type2}",
      "name": "${hasUserRequest ? "Dish name featuring requested ingredient/dish" : mainLabel + " dish name"}",
      "reason": "Why this dish (1 sentence, under 30 words)",
      "time_minutes": number,
      "difficulty": "easy|medium|hard",
      "matched_ingredients": ["fridge items used in this dish"],
      "missing_ingredients": ${hasUserRequest ? `["requested items not in fridge + other needed items"]` : "[]"},
      "genre": "Japanese|Western|Chinese|Asian",
      "main_ingredient": "meat|fish|egg|vegetable|noodle|rice",
      "cooking_method": "stir-fry|simmer|grill|fry|steam|salad"${buildSubDishFields(meal_components)}
    },
    {
      "type": "${type3}",
      "name": "${hasUserRequest ? "Dish name featuring requested ingredient/dish" : mainLabel + " dish name"}",
      "reason": "Why this dish (1 sentence, under 30 words)",
      "time_minutes": number,
      "difficulty": "easy|medium|hard",
      "matched_ingredients": [...],
      "missing_ingredients": ${hasUserRequest ? `[...]` : "[]"},
      "genre": "Japanese|Western|Chinese|Asian",
      "main_ingredient": "meat|fish|egg|vegetable|noodle|rice",
      "cooking_method": "stir-fry|simmer|grill|fry|steam|salad"${buildSubDishFields(meal_components)}
    }
  ]
}`;
  }

  // Japanese prompt
  const componentNote = [
    sideComp ? `${sideComp.label}（小鉢・副菜）` : "",
    soupComp ? `${soupComp.label}（味噌汁・スープ・汁物など液体の料理のみ）` : "",
  ].filter(Boolean).join("・");

  const missingIngredientsRule = hasUserRequest
    ? `- リクエスト食材が冷蔵庫にない場合は必ず missing_ingredients に追加すること
- matched_ingredients には冷蔵庫の食材リストにあるもののみ入れること`
    : `- 今ある食材と常備調味料だけで作れる料理を最優先で選ぶこと
- 【絶対厳守】料理名・料理に使う食材（野菜・肉・魚・豆腐など）が matched_ingredients にも常備調味料リストにもない場合、その食材を必ず missing_ingredients に追加すること。絶対に隠蔽してはならない
- 【絶対厳守】missing_ingredients を [] にするときは、料理名・料理内容に冷蔵庫にない食材が一切含まれていないことを確認してから出力すること`;

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

  return `あなたは家庭料理の専門家です。
${userRequestBlock}
【絶対条件】
以下の調味料・基本食材は常に自宅にあるものとして扱ってください:
${seasonings}

冷蔵庫にある食材:
${ingredientList}
${priorityNote}

献立構成: ${mainLabel}${componentNote ? `・${componentNote}` : "のみ"}
${buildAudienceSection(meal_audience, locale, tired_mode)}${hotcookNote}${buildCuisineNote(cuisine_pattern, locale)}

「${meal_1_name}」（${meal_1_type}）は既に提案済みです。
上記の食材${hasUserRequest ? "とユーザーリクエスト" : "と常備調味料だけ"}で作れる${mainLabel}をあと2案提案してください。

条件:
- meal_2 の type: "${type2}"
- meal_3 の type: "${type3}"
- 「${meal_1_name}」と異なるジャンル・主食材・調理法にすること

【必須ルール】
${ingredientSelectionRule}
${missingIngredientsRule}
${soupComp ? `- soupには必ず味噌汁・スープ・汁物など液体を含む料理を設定すること。サラダ・炒め物・副菜は絶対不可` : ""}
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
    cuisine_pattern = "japanese",
    locale = "ja",
    appliances = [],
    meal_audience = "family",
    user_request = "",
    priority_ingredients = [],
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
          user_request,
          meal_audience as MealAudience,
          cuisine_pattern as string,
          priority_ingredients as string[]
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
