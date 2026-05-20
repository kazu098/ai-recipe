import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const env = fs.readFileSync(".env.local", "utf-8");
const get = (k: string) => env.match(new RegExp(`${k}=(.+)`))?.[1].trim() ?? "";

const supabase = createClient(
  get("NEXT_PUBLIC_SUPABASE_URL"),
  get("SUPABASE_SERVICE_ROLE_KEY")
);

async function main() {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) { console.error("listUsers error:", error); return; }

  for (const user of data.users) {
    if (!user.email_confirmed_at) continue; // 未確認は除外
    const { error: upsertErr } = await supabase
      .from("profiles")
      .upsert(
        { id: user.id, email: user.email ?? "" },
        { onConflict: "id", ignoreDuplicates: true }
      );
    if (upsertErr) {
      console.error(`upsert failed for ${user.email}:`, upsertErr);
    } else {
      console.log(`OK: ${user.email} (${user.id})`);
    }
  }

  const { data: profiles } = await supabase.from("profiles").select("*");
  console.log("\nprofiles テーブル:");
  profiles?.forEach(p => console.log(" -", p));
}

main().catch(console.error);
