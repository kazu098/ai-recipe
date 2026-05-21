import { NextRequest } from "next/server";
import { getAuthUserId, saveFeedback } from "@/lib/supabase/db";

export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { session_id, meal_name, was_cooked, family_reaction, reaction_memo, next_time_memo } = await req.json();
  if (!session_id || !meal_name) {
    return Response.json({ error: "session_id and meal_name required" }, { status: 400 });
  }

  await saveFeedback({
    userId,
    sessionId: session_id,
    mealName: meal_name,
    wasCooked: was_cooked,
    familyReaction: family_reaction,
    reactionMemo: reaction_memo,
    nextTimeMemo: next_time_memo,
  });

  return Response.json({ ok: true });
}
