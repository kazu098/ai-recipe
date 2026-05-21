import { NextRequest } from "next/server";
import { getAuthUserId, saveHouseholdSettings, loadHouseholdSettings } from "@/lib/supabase/db";

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const settings = await loadHouseholdSettings(userId);
  return Response.json({ settings });
}

export async function POST(req: NextRequest) {
  const userId = await getAuthUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { settings } = await req.json();
  if (!settings) return Response.json({ error: "settings required" }, { status: 400 });
  await saveHouseholdSettings(userId, settings);
  return Response.json({ ok: true });
}
