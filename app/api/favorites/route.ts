import { NextRequest } from "next/server";
import { getAuthUserId, getFavorites, addFavorite, removeFavorite } from "@/lib/supabase/db";

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const mealNames = await getFavorites(userId);
  return Response.json({ favorites: mealNames });
}

export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { meal_name, genre, reason, time_minutes, difficulty } = await req.json();
  if (!meal_name) return Response.json({ error: "meal_name required" }, { status: 400 });
  await addFavorite({ userId, mealName: meal_name, genre, reason, timeMinutes: time_minutes, difficulty });
  return Response.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { meal_name } = await req.json();
  if (!meal_name) return Response.json({ error: "meal_name required" }, { status: 400 });
  await removeFavorite({ userId, mealName: meal_name });
  return Response.json({ ok: true });
}
