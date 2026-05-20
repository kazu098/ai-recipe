import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const env = fs.readFileSync(".env.local", "utf-8");
const get = (k: string) => env.match(new RegExp(`${k}=(.+)`))?.[1].trim() ?? "";

const supabase = createClient(
  get("NEXT_PUBLIC_SUPABASE_URL"),
  get("SUPABASE_SERVICE_ROLE_KEY")
);

async function main() {
  console.log("=== profiles テーブルの内容 ===");
  const { data: profiles, error: e1 } = await supabase.from("profiles").select("*").limit(10);
  console.log("行数:", profiles?.length, "error:", e1);
  profiles?.forEach((p) => console.log(" -", p));

  console.log("\n=== profiles 直接 INSERT テスト ===");
  const testId = "00000000-0000-0000-0000-000000000001";
  const { error: e2 } = await supabase.from("profiles").insert({
    id: testId,
    email: "test-direct@example.com",
  });
  console.log("結果:", e2 || "OK");
  await supabase.from("profiles").delete().eq("id", testId);

  console.log("\n=== auth.users 一覧 ===");
  const { data: users, error: e3 } = await supabase.auth.admin.listUsers();
  console.log("ユーザー数:", users?.users?.length, "error:", e3);
  users?.users?.forEach((u) => console.log(" -", u.email, u.id, "created:", u.created_at));

  // signUp を admin で試す
  console.log("\n=== admin.createUser テスト ===");
  const { data: createData, error: e4 } = await supabase.auth.admin.createUser({
    email: `test-${Date.now()}@example.com`,
    password: "TestPass1234!",
    email_confirm: true,
  });
  console.log("createUser 結果:", e4 || `OK: ${createData.user?.id}`);

  // 後始末
  if (createData.user?.id) {
    await supabase.auth.admin.deleteUser(createData.user.id);
    console.log("(テストユーザー削除済み)");
  }
}

main().catch(console.error);
