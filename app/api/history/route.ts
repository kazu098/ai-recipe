import { getAuthUserId, getSessionHistory } from "@/lib/supabase/db";

export async function GET() {
  const userId = await getAuthUserId();
  if (!userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const { sessions } = await getSessionHistory(userId);
  return Response.json({ sessions });
}
