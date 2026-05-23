/**
 * Snapmeal アプリ E2E テスト
 * 対象: http://localhost:3000
 *
 * 実行前に `npm run dev` でローカルサーバーを起動してください。
 */

import { test, expect, type Page } from "@playwright/test";
import path from "path";

const BASE = "http://localhost:3000";
const TEST_IMAGE = path.join(process.cwd(), "test-images/IMG_7828.jpeg");

// ── ヘルパー ──────────────────────────────────────────────────────────────────

/** オンボーディングをスキップしてアップロード画面を表示する */
async function gotoUpload(page: Page) {
  await page.goto(`${BASE}/ja`);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => {
    localStorage.setItem("snapmeal_onboarding_done", "true");
    localStorage.setItem(
      "snapmeal_settings",
      JSON.stringify({
        servings: 2,
        appliances: ["pan"],
        ng_ingredients: "",
        has_children: false,
        taste_pref: "normal",
        cooking_policy: "",
      })
    );
    localStorage.removeItem("snapmeal_guest_count");
  });
  await page.reload({ waitUntil: "networkidle" });
}

// ── 1. 基本UI ──────────────────────────────────────────────────────────────────

test.describe("基本UI", () => {
  test("日本語ページが正常に読み込まれる", async ({ page }) => {
    await page.goto(`${BASE}/ja`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/ja/);
    await expect(page.locator("body")).toBeVisible();

    // JSエラーがないことを確認
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.waitForTimeout(1000);
    expect(errors).toHaveLength(0);
  });

  test("英語ページが正常に読み込まれる", async ({ page }) => {
    await page.goto(`${BASE}/en`);
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/en/);
    await expect(page.locator("body")).toBeVisible();
  });

  test("初回アクセス時にオンボーディングが表示される", async ({ page }) => {
    await page.goto(`${BASE}/ja`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      localStorage.removeItem("snapmeal_onboarding_done");
    });
    await page.reload({ waitUntil: "networkidle" });

    // オンボーディングのタイトルが表示される
    await expect(
      page.getByRole("heading", { name: /Snapmeal へようこそ/ })
    ).toBeVisible({ timeout: 5000 });
  });

  test("オンボーディング完了後にアップロード画面が表示される", async ({ page }) => {
    await page.goto(`${BASE}/ja`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      localStorage.removeItem("snapmeal_onboarding_done");
    });
    await page.reload({ waitUntil: "networkidle" });

    // 人数選択（2人）
    const twoBtn = page.getByText("2人", { exact: true });
    if (await twoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await twoBtn.click();
    }

    // 「次へ」ボタンを押してオンボーディングを進める
    const nextBtn = page.getByText(/次へ/, { exact: false });
    if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(500);
      // 調理器具ページ → 次へ
      const nextBtn2 = page.getByText(/次へ/, { exact: false });
      if (await nextBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn2.click();
        await page.waitForTimeout(500);
      }
      // 完了ボタン
      const doneBtn = page.getByText(/設定完了/, { exact: false });
      if (await doneBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await doneBtn.click();
      }
    }

    // アップロード画面が表示される（カメラアイコンまたは撮影ボタン）
    await expect(
      page.getByText(/冷蔵庫を撮影する|献立、決めましょう/, { exact: false })
    ).toBeVisible({ timeout: 8000 });
  });
});

// ── 2. アップロード画面 ─────────────────────────────────────────────────────────

test.describe("アップロード画面", () => {
  test.beforeEach(async ({ page }) => {
    await gotoUpload(page);
  });

  test("アップロード画面の主要要素が表示される", async ({ page }) => {
    // 撮影/ギャラリーボタン
    await expect(page.getByText(/冷蔵庫を撮影する/, { exact: false })).toBeVisible();
    // 余力セレクター
    await expect(page.getByText(/今日の余力/, { exact: false })).toBeVisible();
    // 献立スタイル（ジャンル選択）
    await expect(page.getByText(/献立スタイルは/, { exact: false })).toBeVisible();
  });

  test("ジャンル選択ボタンが表示される", async ({ page }) => {
    // 和食・洋食・中華などのジャンルボタンが存在する
    await expect(page.getByText("和食", { exact: true })).toBeVisible();
    await expect(page.getByText("洋食", { exact: true })).toBeVisible();
    await expect(page.getByText("中華", { exact: true })).toBeVisible();
  });

  test("ジャンルを選択するとハイライトが変わる", async ({ page }) => {
    const yousyokuBtn = page.getByRole("button", { name: "洋食" });
    await yousyokuBtn.click();
    await page.waitForTimeout(300);

    // 選択後はクラスが変わって強調表示される（bg-primary など）
    const isSelected = await yousyokuBtn.evaluate((el) =>
      el.className.includes("bg-primary") || el.className.includes("text-white")
    );
    expect(isSelected).toBe(true);
  });

  test("疲れたモードをトグルできる", async ({ page }) => {
    const tiredBtn = page.getByRole("button", { name: /疲れた/ });
    await tiredBtn.click();
    await page.waitForTimeout(300);

    // クリック後に「疲れた」ボタンがアクティブになる
    const isActive = await tiredBtn.evaluate((el) =>
      el.className.includes("bg-primary") || el.className.includes("text-white")
    );
    expect(isActive).toBe(true);
  });

  test("画像をアップロードすると枚数カウンターが更新される", async ({ page }) => {
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_IMAGE);
    await page.waitForTimeout(1000);

    // 「1/5枚」のようなカウンターが表示される
    await expect(page.getByText(/1\/5|1枚/, { exact: false })).toBeVisible({ timeout: 5000 });
  });

  test("画像アップロード後に解析ボタンが活性化される", async ({ page }) => {
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_IMAGE);
    await page.waitForTimeout(1000);

    // ページをスクロールして解析ボタンを表示
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const analyzeBtn = page.getByRole("button", { name: /解析する/ });
    await expect(analyzeBtn).toBeEnabled({ timeout: 5000 });
  });

  test("ナビゲーションバーのアイコンが表示される", async ({ page }) => {
    // ヘッダーのアイコンボタン（aria-label で特定）
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Favorites" })).toBeVisible();
    await expect(page.getByRole("button", { name: "History" })).toBeVisible();
  });
});

// ── 3. 食材確認画面（新機能）─────────────────────────────────────────────────

test.describe("食材確認画面", () => {
  test.beforeEach(async ({ page }) => {
    await gotoUpload(page);

    // 画像をアップロードして解析を開始
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_IMAGE);
    await page.waitForTimeout(1500);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const analyzeBtn = page.getByRole("button", { name: /解析する/ });
    await analyzeBtn.click();

    // 食材確認画面を待つ（最大30秒）
    await page.waitForSelector('button:has-text("この食材で献立を決める")', {
      timeout: 30000,
    });
    await page.waitForTimeout(500);
  });

  test("食材確認画面のタイトルとヒントが表示される", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "認識した食材" })
    ).toBeVisible();
    await expect(
      page.getByText(/タップで優先使用/, { exact: false })
    ).toBeVisible();
  });

  test("食材チップが1つ以上表示される", async ({ page }) => {
    // 緑色の食材チップが存在する
    const chips = page.locator(".rounded-full.bg-green-50, .rounded-full.border-green-200");
    await expect(chips.first()).toBeVisible({ timeout: 5000 });
    const count = await chips.count();
    expect(count).toBeGreaterThan(0);
    console.log(`認識された食材数: ${count}`);
  });

  test("食材チップをタップすると優先指定される（アンバー色）", async ({ page }) => {
    // 最初の食材チップの食材名を取得
    const firstChipBtn = page.locator(".rounded-full.bg-green-50 button").first();
    if (await firstChipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstChipBtn.click();
    } else {
      // div wrapper 全体をクリック
      const firstChip = page.locator("[class*='rounded-full'][class*='border-green']").first();
      await firstChip.click();
    }
    await page.waitForTimeout(400);

    // アンバー色の優先チップが表示される
    const priorityChip = page.locator(
      ".bg-amber-50, [class*='amber']"
    ).first();
    await expect(priorityChip).toBeVisible({ timeout: 3000 });

    // 「優先」バッジが表示される
    await expect(page.getByText("優先", { exact: true })).toBeVisible();
  });

  test("優先指定後に再タップすると解除される", async ({ page }) => {
    // タップして優先指定
    const firstChipBtn = page.locator(".rounded-full.bg-green-50 button").first();
    if (await firstChipBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstChipBtn.click();
      await page.waitForTimeout(300);
      // 再タップで解除
      const prioritizedBtn = page.locator(".bg-amber-50 button").first();
      if (await prioritizedBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await prioritizedBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // 「優先」バッジが消える
    const priorityBadges = page.getByText("優先", { exact: true });
    await expect(priorityBadges).toHaveCount(0);
  });

  test("×ボタンで食材を削除できる", async ({ page }) => {
    const chips = page.locator("[class*='rounded-full'][class*='border-green']");
    const initialCount = await chips.count();

    // 最初のチップの×ボタンをクリック
    const deleteBtn = chips.first().locator("button[aria-label='削除'], button:has-text('×')").first();
    if (await deleteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await deleteBtn.click();
      await page.waitForTimeout(400);

      const newCount = await chips.count();
      expect(newCount).toBe(initialCount - 1);
    }
  });

  test("食材追加フォームが機能する", async ({ page }) => {
    const input = page.locator('input[placeholder*="豚バラ"]');
    await input.fill("豚こま肉");
    await page.getByRole("button", { name: "追加" }).click();
    await page.waitForTimeout(300);

    // 追加した食材がチップとして表示される
    await expect(page.getByText("豚こま肉", { exact: false })).toBeVisible();
  });

  test("何も選択せずに確定すると献立生成が始まる", async ({ page }) => {
    const confirmBtn = page.getByRole("button", { name: /この食材で献立を決める/ });
    await confirmBtn.click();

    // 解析中画面または結果画面に遷移する
    await expect(
      page.getByText(/食材をスキャン中|献立を考えています|今夜の献立/, { exact: false })
    ).toBeVisible({ timeout: 15000 });
  });

  test("「優先指定した食材」メモが選択なしで表示される", async ({ page }) => {
    // 何も選択していない状態では「全食材から提案」ノートが表示される
    await expect(
      page.getByText(/何もタップしなければ全食材から提案/, { exact: false })
    ).toBeVisible();
  });
});

// ── 4. 設定画面 ─────────────────────────────────────────────────────────────────

test.describe("設定画面", () => {
  test.beforeEach(async ({ page }) => {
    await gotoUpload(page);
  });

  /** 設定ビューが開くまで待つ */
  async function openSettings(page: Page) {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForSelector('h2:has-text("設定")', { timeout: 8000 });
  }

  test("設定アイコンをクリックすると設定画面が開く", async ({ page }) => {
    await openSettings(page);
    await expect(page.getByRole("heading", { name: "設定" })).toBeVisible();
  });

  test("設定画面に主要な設定項目が表示される", async ({ page }) => {
    await openSettings(page);
    await expect(page.getByText(/何人分で作りますか/, { exact: false })).toBeVisible();
    await expect(page.getByText(/お持ちの調理器具/, { exact: false })).toBeVisible();
  });

  test("設定画面で未ログイン状態の場合はログインCTAが表示される", async ({ page }) => {
    await openSettings(page);
    await expect(page.getByText(/ログインする/, { exact: false })).toBeVisible();
  });
});

// ── 5. i18n ─────────────────────────────────────────────────────────────────────

test.describe("i18n / ローカライゼーション", () => {
  test("日本語ページの主要テキストが日本語で表示される", async ({ page }) => {
    await gotoUpload(page);
    await expect(page.getByText(/今日の余力は？/, { exact: false })).toBeVisible();
    await expect(page.getByText(/献立スタイルは？/, { exact: false })).toBeVisible();
  });

  test("英語ページの主要テキストが英語で表示される", async ({ page }) => {
    await page.goto(`${BASE}/en`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      localStorage.setItem("snapmeal_onboarding_done", "true");
      localStorage.setItem(
        "snapmeal_settings",
        JSON.stringify({ servings: 2, appliances: ["pan"] })
      );
    });
    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByText(/How's your energy today/, { exact: false })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/Meal style/, { exact: false })).toBeVisible({ timeout: 5000 });
  });

  test("設定画面の言語切り替えボタンが表示される", async ({ page }) => {
    await gotoUpload(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.waitForSelector('h2:has-text("設定")', { timeout: 8000 });

    // 言語セクションまでスクロールして確認
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // 言語セクション（「言語 / Language」テキスト）
    await expect(page.getByText("言語 / Language", { exact: true })).toBeVisible({ timeout: 5000 });
  });
});

// ── 6. ゲスト制限 ──────────────────────────────────────────────────────────────

test.describe("ゲスト利用制限", () => {
  test("GUEST_LIMITに達するとログインプロンプトが表示される", async ({ page }) => {
    await page.goto(`${BASE}/ja`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => {
      localStorage.setItem("snapmeal_onboarding_done", "true");
      localStorage.setItem(
        "snapmeal_settings",
        JSON.stringify({ servings: 2, appliances: ["pan"] })
      );
      // GUEST_LIMIT（5）以上をセット
      localStorage.setItem("snapmeal_guest_count", "5");
    });
    await page.reload({ waitUntil: "networkidle" });

    // 画像をアップロードして解析を試みる
    const fileInput = page.locator('input[type="file"][multiple]').first();
    await fileInput.setInputFiles(TEST_IMAGE);
    await page.waitForTimeout(1000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const analyzeBtn = page.getByRole("button", { name: /解析する/ });
    await analyzeBtn.click();
    await page.waitForTimeout(1500);

    // ログインプロンプトが表示される（モーダルのタイトル）
    await expect(
      page.getByRole("heading", { name: /無料お試し回数を使い切りました/ })
    ).toBeVisible({ timeout: 5000 });
  });
});
