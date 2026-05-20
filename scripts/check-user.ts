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
  const user = data?.users?.find(u => u.email === "kazutaka.yoshinaga@gmail.com");
  if (user) {
    console.log("email:", user.email);
    console.log("id:", user.id);
    console.log("email_confirmed_at:", user.email_confirmed_at);
    console.log("confirmation_sent_at:", user.confirmation_sent_at);
    console.log("confirmed:", !!user.email_confirmed_at);
  } else {
    console.log("ユーザーが見つかりません");
  }
}

main().catch(console.error);
