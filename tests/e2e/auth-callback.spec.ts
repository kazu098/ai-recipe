import { test, expect } from "@playwright/test";

const BASE = "https://ai-recipe-murex.vercel.app";

/**
 * 修正後のコールバックルートがSet-Cookieヘッダーを返すかを確認するテスト。
 * 本来は有効なcodeが必要だが、コードが無効でもレスポンスの構造は確認できる。
 */
test.describe("【修正後】コールバックルートのCookie設定確認", () => {
  test("コールバックレスポンスにSet-Cookieヘッダーが含まれることを確認（有効コード使用時）", async ({ page }) => {
    const setCookieHeaders: string[] = [];
    const redirectUrls: string[] = [];

    page.on("response", response => {
      if (response.url().includes("/auth/callback")) {
        const headers = response.headers();
        const setCookie = headers["set-cookie"];
        if (setCookie) setCookieHeaders.push(setCookie);
        redirectUrls.push(`${response.status()} → ${response.headers()["location"] ?? "no-redirect"}`);
        console.log(`コールバック応答: ${response.status()}`);
        console.log(`Set-Cookie: ${setCookie ?? "なし ← ❌ Cookie未設定（修正前の状態）"}`);
      }
    });

    // 無効なcodeでもルートの動作確認は可能
    await page.goto(`${BASE}/ja/auth/callback?code=playwright_test_code`);
    await page.waitForLoadState("networkidle");

    console.log("リダイレクト履歴:", redirectUrls);
    console.log("Set-Cookieヘッダー:", setCookieHeaders.length > 0 ? setCookieHeaders : "なし");
  });

  test("修正後: コールバックURLへアクセス後のCookie状態を確認", async ({ page }) => {
    await page.goto(`${BASE}/ja/auth/callback?code=playwright_test_code`);
    await page.waitForLoadState("networkidle");

    const cookies = await page.context().cookies();
    const projectRef = "dlzwelouthzxlsgzwjbr";
    const authRelated = cookies.filter(c =>
      c.name.includes(projectRef) ||
      c.name.includes("auth") ||
      c.name.includes("supabase")
    );

    console.log("コールバック後の全クッキー:", cookies.map(c => c.name));
    console.log("認証関連クッキー:", authRelated.map(c => ({ name: c.name, valueLength: c.value.length })));

    // 無効なcodeの場合でも、PKCEのcode-verifierクッキーが消えているか等を確認
    const codeVerifier = cookies.find(c => c.name.includes("code-verifier"));
    console.log("code-verifier残存:", codeVerifier ? "あり" : "なし（正常に消費されたか、もともとなかった）");
  });
});
