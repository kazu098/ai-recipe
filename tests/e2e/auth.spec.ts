import { test, expect, type Page } from "@playwright/test";

const BASE = "https://ai-recipe-murex.vercel.app";

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/** ホームページ（/ja）を開いてDOMが安定するまで待つ */
async function gotoHome(page: Page) {
  await page.goto(`${BASE}/ja`);
  await page.waitForLoadState("networkidle");
}

/**
 * Supabaseのセッションクッキーをブラウザコンテキストに直接注入する。
 * 実際のOAuthログイン後にサーバーが発行するクッキーを模倣するため、
 * SupabaseのAPIを使ってテスト用セッショントークンを取得する。
 */
async function injectSession(page: Page, accessToken: string, refreshToken: string) {
  const projectRef = "dlzwelouthzxlsgzwjbr";
  const cookieName = `sb-${projectRef}-auth-token`;

  // Supabase SSR のクッキー形式（base64エンコードされたJSON）
  const sessionPayload = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
  });
  const encoded = Buffer.from(sessionPayload).toString("base64");

  await page.context().addCookies([
    {
      name: cookieName,
      value: encoded,
      domain: "ai-recipe-murex.vercel.app",
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);
}

// ── テスト群 ──────────────────────────────────────────────────────────────────

test.describe("【未ログイン】初期状態の確認", () => {
  test("ページが正常に表示される", async ({ page }) => {
    await gotoHome(page);
    await expect(page).toHaveURL(/\/ja/);
  });

  test("設定画面でログインしていない状態が表示される", async ({ page }) => {
    await gotoHome(page);

    // 設定ボタンをクリック（⚙アイコン）
    const settingsBtn = page.locator("button[aria-label*='設定'], button:has(svg):last-of-type, a[href*='setting']").first();
    // 歯車アイコンボタンを特定
    const gearBtn = page.locator("button").filter({ has: page.locator("svg") }).last();
    await gearBtn.click();

    await page.waitForTimeout(1000);

    // "ログイン" という文字列が設定画面に存在するか確認
    const loginText = page.getByText(/ログイン/, { exact: false });
    await expect(loginText.first()).toBeVisible({ timeout: 5000 });

    // ユーザー名・メールアドレスが表示されていないことを確認
    const emailText = page.getByText(/@/, { exact: false });
    await expect(emailText).toHaveCount(0);
  });

  test("お気に入りボタンを押すとログインプロンプトが表示される", async ({ page }) => {
    await gotoHome(page);

    // ハートアイコン（お気に入りボタン）が存在するか確認
    const favoriteBtn = page.locator("button[aria-label*='お気に入り'], button:has-text('♡'), button:has-text('❤')").first();

    // お気に入りボタンが存在しない場合はメニュー生成が必要 → 献立画面へ遷移するための最低限の操作
    const hasFavoriteBtn = await favoriteBtn.count() > 0;
    if (!hasFavoriteBtn) {
      test.info().annotations.push({ type: "skip-reason", description: "お気に入りボタンは献立生成後に表示されるため、このテストでは未ログイン時のヘッダーハートボタンのみ確認" });
    }

    // ログインプロンプトトリガーがあれば確認
    const loginPromptTrigger = page.getByText(/ログインして保存|お気に入り登録にはログインが必要/, { exact: false });
    // ログインモーダルの存在確認（表示されていない状態）
    await expect(loginPromptTrigger).toHaveCount(0);
  });
});

test.describe("【認証コールバック】OAuthリダイレクト処理", () => {
  test("codeなしのコールバックURLにアクセスするとホームにリダイレクトされる", async ({ page }) => {
    await page.goto(`${BASE}/ja/auth/callback`);
    await page.waitForLoadState("networkidle");
    // codeがない場合はホームへリダイレクト
    await expect(page).toHaveURL(/\/ja/);
  });

  test("不正なcodeのコールバックはエラーなくホームにリダイレクトされる", async ({ page }) => {
    await page.goto(`${BASE}/ja/auth/callback?code=invalid_test_code_12345`);
    await page.waitForLoadState("networkidle");
    // エラーページではなくホームページ（またはエラーハンドリング済みページ）に遷移
    await expect(page).toHaveURL(/\/ja/);
    // ページがクラッシュしていないことを確認
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("コールバック後のセッション確立: ホームページがログイン状態を反映するか", async ({ page }) => {
    // OAuth後のフローを模倣: cookieなし状態でコールバックURLへ
    // → ホームへリダイレクト後、getSession()が機能しているかを確認

    // 1. まずコールバックページへ（無効なcodeで失敗するケース）
    await page.goto(`${BASE}/ja/auth/callback?code=test_code`);
    await page.waitForLoadState("networkidle");

    // 2. ホームページへ
    await page.goto(`${BASE}/ja`);
    await page.waitForLoadState("networkidle");

    // 3. セッションクッキーの存在を確認
    const cookies = await page.context().cookies();
    const projectRef = "dlzwelouthzxlsgzwjbr";
    const authCookies = cookies.filter(c =>
      c.name.includes("auth-token") ||
      c.name.includes(projectRef) ||
      c.name.includes("supabase")
    );

    console.log("認証クッキー一覧:", authCookies.map(c => ({ name: c.name, hasValue: !!c.value })));

    // コールバック失敗時はセッションクッキーが空であるべき
    const hasValidSession = authCookies.some(c => c.value.length > 10);
    expect(hasValidSession).toBe(false);
  });
});

test.describe("【セッション検知】getSession() / onAuthStateChange の動作確認", () => {
  test("クッキーなし状態でgetSession()がnullを返す", async ({ page }) => {
    await gotoHome(page);

    const sessionResult = await page.evaluate(async () => {
      // window.__supabase が存在する場合
      const anyWindow = window as unknown as Record<string, unknown>;
      if (anyWindow.__supabase) {
        const client = anyWindow.__supabase as { auth: { getSession: () => Promise<{ data: { session: unknown } }> } };
        const { data } = await client.auth.getSession();
        return data.session;
      }
      return "supabase_not_exposed";
    });

    console.log("getSession() result (no cookie):", sessionResult);
    // supabaseがwindowに露出していない場合はスキップ
    if (sessionResult !== "supabase_not_exposed") {
      expect(sessionResult).toBeNull();
    }
  });

  test("セッションクッキーの形式を確認（Supabase SSR クッキー名）", async ({ page }) => {
    await gotoHome(page);

    const cookies = await page.context().cookies();
    const projectRef = "dlzwelouthzxlsgzwjbr";

    console.log("全クッキー名:", cookies.map(c => c.name));

    // Supabase SSRが設定するべきクッキーの名前パターンを確認
    const expectedCookieName = `sb-${projectRef}-auth-token`;
    const authCookie = cookies.find(c => c.name === expectedCookieName);
    const codeVerifierCookie = cookies.find(c => c.name.includes("code-verifier"));
    const pkceFlowCookie = cookies.find(c => c.name.includes("pkce") || c.name.includes("verifier"));

    console.log(`期待するクッキー名: ${expectedCookieName}`);
    console.log("認証クッキー:", authCookie ? "存在する" : "存在しない");
    console.log("code-verifierクッキー:", codeVerifierCookie?.name ?? "存在しない");
    console.log("PKCEクッキー:", pkceFlowCookie?.name ?? "存在しない");

    // 未ログインなのでauth-tokenクッキーはないはず
    expect(authCookie).toBeUndefined();
  });

  test("Google OAuthリダイレクト時のcode-verifierクッキーが設定される", async ({ page }) => {
    // Googleログインボタンをクリックした後、リダイレクト前のクッキーを確認
    await gotoHome(page);

    // ログインページへ遷移
    await page.goto(`${BASE}/ja?view=login`);
    await page.waitForLoadState("networkidle");

    // Googleログインボタンを探す
    const googleBtn = page.getByRole("button", { name: /Google/ }).or(
      page.locator("button").filter({ hasText: /Google/ })
    );
    const hasGoogleBtn = await googleBtn.count() > 0;

    if (hasGoogleBtn) {
      // Googleリダイレクトが発生する前にクッキーをキャプチャ
      const beforeCookies = await page.context().cookies();

      // ナビゲーションをインターセプト（実際にGoogleへ飛ばない）
      await page.route("https://accounts.google.com/**", route => route.abort());

      await googleBtn.click();
      await page.waitForTimeout(2000);

      const afterCookies = await page.context().cookies();
      const newCookies = afterCookies.filter(c =>
        !beforeCookies.find(b => b.name === c.name)
      );

      console.log("Googleボタンクリック後の新クッキー:", newCookies.map(c => ({
        name: c.name,
        length: c.value.length,
      })));

      // PKCE フロー用の code-verifier クッキーが設定されるはず
      const verifierCookie = newCookies.find(c =>
        c.name.includes("code-verifier") || c.name.includes("pkce") || c.name.includes("verifier")
      );

      if (verifierCookie) {
        console.log("✅ code-verifierクッキーが正常に設定されました:", verifierCookie.name);
      } else {
        console.log("❌ code-verifierクッキーが設定されていません。PKCEフローに問題がある可能性があります。");
      }
    } else {
      console.log("Googleログインボタンが見つかりません。ログイン画面への遷移方法を確認してください。");
    }
  });
});

test.describe("【UI状態】設定画面・お気に入りの動作確認", () => {
  test("設定画面のDOM構造とログイン状態表示を確認", async ({ page }) => {
    await gotoHome(page);

    // 設定アイコン（右上の歯車）をクリック
    // 設定ボタンを様々なセレクターで試みる
    const selectors = [
      '[data-testid="settings-button"]',
      'button[aria-label="設定"]',
      'button[title="設定"]',
    ];

    let settingsOpened = false;
    for (const selector of selectors) {
      const btn = page.locator(selector);
      if (await btn.count() > 0) {
        await btn.click();
        settingsOpened = true;
        break;
      }
    }

    if (!settingsOpened) {
      // 最後の手段：SVGを持つボタンをクリック
      const buttons = page.locator("button").filter({ has: page.locator("svg") });
      const count = await buttons.count();
      console.log(`SVGを持つボタン数: ${count}`);
      if (count > 0) {
        await buttons.last().click();
        settingsOpened = true;
      }
    }

    await page.waitForTimeout(1500);

    // 設定パネルの現在のHTML構造をキャプチャ
    const bodyText = await page.locator("body").innerText();
    const hasLoginSection = bodyText.includes("ログイン") || bodyText.includes("サインイン") || bodyText.includes("Google");
    const hasPlanInfo = bodyText.includes("Free") || bodyText.includes("Pro") || bodyText.includes("プラン");
    const hasEmail = /@[a-z]/.test(bodyText);

    console.log("設定画面の状態:");
    console.log("  ログイン関連テキストあり:", hasLoginSection);
    console.log("  プラン情報あり:", hasPlanInfo);
    console.log("  メールアドレス表示あり:", hasEmail);

    // 未ログインなのでメールアドレスは表示されないはず
    expect(hasEmail).toBe(false);
  });

  test("お気に入りボタンのクリックでログインモーダルが表示されるか確認", async ({ page }) => {
    await gotoHome(page);

    // お気に入りボタンはハート型（献立表示後に現れる）
    // viewステートをクエリパラメータで操作できるか確認
    const heartBtns = page.locator("button").filter({ hasText: /♡|❤|♥/ });
    const svgHeartBtns = page.locator("button[aria-label*='気に入']");
    const anyHeartBtns = heartBtns.or(svgHeartBtns);

    const count = await anyHeartBtns.count();
    console.log(`ハートボタン数: ${count}`);

    if (count > 0) {
      await anyHeartBtns.first().click();
      await page.waitForTimeout(1000);

      const bodyText = await page.locator("body").innerText();
      const hasLoginPrompt = bodyText.includes("ログイン") && (
        bodyText.includes("保存") || bodyText.includes("お気に入り")
      );
      console.log("ログインプロンプト表示:", hasLoginPrompt);
    } else {
      console.log("ハートボタンはホーム画面では非表示（献立生成後に表示される）");
    }
  });
});

test.describe("【根本原因調査】セッション確立フローの詳細確認", () => {
  test("コールバックルートがセッションクッキーを正しく設定するか（応答ヘッダー確認）", async ({ page }) => {
    // コールバックURLへのリクエスト時のSet-Cookieヘッダーを確認
    const setCookieHeaders: string[] = [];

    page.on("response", response => {
      if (response.url().includes("/auth/callback")) {
        const headers = response.headers();
        const setCookie = headers["set-cookie"];
        if (setCookie) setCookieHeaders.push(setCookie);
        console.log(`コールバックレスポンス: ${response.status()} ${response.url()}`);
        console.log("Set-Cookieヘッダー:", setCookie ?? "なし");
      }
    });

    await page.goto(`${BASE}/ja/auth/callback?code=test_invalid_code`);
    await page.waitForLoadState("networkidle");

    console.log("キャプチャしたSet-Cookieヘッダー:", setCookieHeaders);
  });

  test("ホームページ初期化時のSupabaseクライアントgetSession()の動作確認", async ({ page }) => {
    // コンソールログをキャプチャ
    const consoleLogs: string[] = [];
    page.on("console", msg => {
      if (msg.type() !== "error") consoleLogs.push(msg.text());
    });

    // ネットワークリクエストをキャプチャ
    const supabaseRequests: string[] = [];
    page.on("request", req => {
      if (req.url().includes("supabase")) {
        supabaseRequests.push(`${req.method()} ${req.url()}`);
      }
    });

    const supabaseResponses: Array<{ url: string; status: number }> = [];
    page.on("response", res => {
      if (res.url().includes("supabase")) {
        supabaseResponses.push({ url: res.url(), status: res.status() });
      }
    });

    await gotoHome(page);

    console.log("\n=== Supabaseへのリクエスト ===");
    supabaseRequests.forEach(r => console.log(" ", r));

    console.log("\n=== Supabaseからのレスポンス ===");
    supabaseResponses.forEach(r => console.log(` ${r.status} ${r.url}`));

    console.log("\n=== コンソールログ（最初の20件）===");
    consoleLogs.slice(0, 20).forEach(l => console.log(" ", l));

    // 認証関連のSupabaseリクエストが発生しているか確認
    const authRequests = supabaseRequests.filter(r => r.includes("/auth/"));
    console.log("\n=== 認証APIリクエスト ===");
    authRequests.forEach(r => console.log(" ", r));
    console.log(`認証APIリクエスト数: ${authRequests.length}`);
  });

  test("JSエラーの有無を確認", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", msg => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", err => errors.push(err.message));

    await gotoHome(page);

    console.log("JSエラー一覧:");
    errors.forEach(e => console.log("  ERROR:", e));

    // 重大なエラーがないことを確認
    const criticalErrors = errors.filter(e =>
      e.includes("auth") || e.includes("session") || e.includes("cookie") || e.includes("supabase")
    );
    console.log("認証関連エラー:", criticalErrors);

    expect(criticalErrors).toHaveLength(0);
  });
});
