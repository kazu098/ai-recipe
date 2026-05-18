import { NextRequest } from "next/server";
import { getAuthUserId, markMealSelected } from "@/lib/supabase/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getAuthUserId();
  if (!userId) return new Response("Unauthorized", { status: 401 });

  const { meal_name } = await req.json();
  if (!meal_name) return new Response("meal_name required", { status: 400 });

  await markMealSelected({
    userId,
    sessionId: params.id,
    mealName: meal_name,
  });

  return new Response(null, { status: 204 });
}
