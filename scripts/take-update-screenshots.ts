/**
 * アップデートページ用スクリーンショット取得スクリプト
 * Usage: npx tsx scripts/take-update-screenshots.ts
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const BASE = "http://localhost:3000";
const OUTPUT = path.join(__dirname, "../../snapmeal-web/public/updates");
const TEST_IMAGE = path.join(__dirname, "../test-images/IMG_7828.jpeg");

const VIEWPORT = { width: 390, height: 844 };

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: "ja-JP",
  });

  const page = await context.newPage();

  // ── オンボーディングをスキップ（localStorageに設定を注入） ──────────────
  console.log("0. オンボーディングをスキップ...");
  await page.goto(`${BASE}/ja`, { waitUntil: "networkidle" });
  await sleep(1000);

  await page.evaluate(() => {
    localStorage.setItem("snapmeal_onboarding_done", "true");
    localStorage.setItem(
      "snapmeal_settings",
      JSON.stringify({
        servings: 2,
        appliances: ["hotcook", "pan"],
        ng_ingredients: "",
        has_children: false,
        taste_pref: "normal",
        cooking_policy: "",
      })
    );
  });

  await page.reload({ waitUntil: "networkidle" });
  await sleep(2000);

  // ── Step 1: ジャンル選択エリアをスクリーンショット ──────────────────────
  console.log("1. ジャンル選択エリアをスクリーンショット...");
  // ジャンル選択ボタン群が見えるようにスクロール
  const genreBtn = page.locator('button:has-text("和食"), button:has-text("洋食")').first();
  if (await genreBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await genreBtn.scrollIntoViewIfNeeded();
    await sleep(500);
    await page.screenshot({
      path: path.join(OUTPUT, "v06-genre-select.png"),
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
    console.log("   → v06-genre-select.png 保存");
  } else {
    console.log("   スキップ: ジャンル選択ボタンが見つかりません");
    await page.screenshot({ path: path.join(OUTPUT, "debug-genre.png") });
  }

  // ── Step 2: テスト画像をアップロードして解析開始 ──────────────────────
  console.log("2. テスト画像をアップロード...");
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  const fileInput = page.locator('input[type="file"][multiple]').first();
  await fileInput.waitFor({ state: "attached", timeout: 10000 });
  await fileInput.setInputFiles(TEST_IMAGE);
  await sleep(2000);

  // 解析ボタンをクリック
  console.log("3. 解析ボタンをクリック...");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(500);

  const analyzeBtn = page.locator('button:has-text("解析する")').first();
  if (!(await analyzeBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("   エラー: 解析ボタンが見つかりません");
    await page.screenshot({ path: path.join(OUTPUT, "debug-before-analyze.png") });
    await browser.close();
    return;
  }
  await analyzeBtn.click();
  await sleep(2000);

  // ── Step 3: 食材確認画面を待つ ─────────────────────────────────────────
  console.log("4. 食材確認画面を待機中...");
  try {
    await page.waitForSelector('button:has-text("この食材で献立を決める")', { timeout: 30000 });
    await sleep(1000);

    // 食材確認画面（何も選択していない状態）
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);
    await page.screenshot({
      path: path.join(OUTPUT, "v06-ingredient-confirm.png"),
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });
    console.log("   → v06-ingredient-confirm.png 保存");

    // 最初の食材チップをタップして優先指定
    const firstChip = page.locator(".rounded-full.bg-green-50").first();
    if (await firstChip.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstChip.click();
      await sleep(600);
      // 2つ目も選択
      const chips = page.locator(".rounded-full.bg-green-50");
      if ((await chips.count()) > 1) {
        await chips.nth(1).click();
        await sleep(400);
      }

      // 優先指定された状態のスクリーンショット
      await page.screenshot({
        path: path.join(OUTPUT, "v06-ingredient-priority.png"),
        clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
      });
      console.log("   → v06-ingredient-priority.png 保存");
    } else {
      console.log("   スキップ: 食材チップが見つかりません（通常確認画面のみ保存）");
    }

    // 確定ボタンをクリック
    const confirmBtn = page.locator('button:has-text("この食材で献立を決める")');
    await confirmBtn.click();
    console.log("   食材確認 → 献立生成へ");
    await sleep(5000);
  } catch {
    console.log("   食材確認画面が表示されませんでした（直接結果へ）");
  }

  // ── Step 4: 結果画面を待つ ──────────────────────────────────────────────
  console.log("5. 結果画面を待機中 (最大90秒)...");
  try {
    await page.waitForSelector('button:has-text("この献立で作る"), h2:has-text("今夜の献立")', {
      timeout: 90000,
    });
  } catch {
    console.log("   タイムアウト");
    await page.screenshot({ path: path.join(OUTPUT, "timeout-state.png") });
    await browser.close();
    return;
  }

  await sleep(1000);

  // ── Step 5: 結果画面（献立カード） ───────────────────────────────────────
  console.log("5. 結果画面のスクリーンショット...");
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({
    path: path.join(OUTPUT, "result-meal.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log("   → result-meal.png 保存");

  await page.evaluate(() => window.scrollBy(0, 350));
  await sleep(600);
  await page.screenshot({
    path: path.join(OUTPUT, "result-actions.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log("   → result-actions.png 保存");

  // ── Step 6: レシピ画面へ ───────────────────────────────────────────────────
  console.log("6. レシピ画面へ遷移...");
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);

  const selectBtn = page.locator('button:has-text("この献立で作る")').first();
  if (!(await selectBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log("   エラー: 献立選択ボタンが見つかりません");
    await browser.close();
    return;
  }
  await selectBtn.click();

  console.log("   レシピ生成を待機中 (45秒)...");
  await sleep(45000);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await page.screenshot({
    path: path.join(OUTPUT, "recipe-ingredients.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log("   → recipe-ingredients.png 保存");

  await page.evaluate(() => window.scrollBy(0, 500));
  await sleep(600);
  await page.screenshot({
    path: path.join(OUTPUT, "recipe-hotcook.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log("   → recipe-hotcook.png 保存");

  await page.evaluate(() => window.scrollBy(0, 500));
  await sleep(600);
  await page.screenshot({
    path: path.join(OUTPUT, "recipe-tips.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log("   → recipe-tips.png 保存");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(600);
  await page.screenshot({
    path: path.join(OUTPUT, "recipe-cooked-btn.png"),
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log("   → recipe-cooked-btn.png 保存");

  await browser.close();
  console.log("\n✅ 完了！スクリーンショットは", OUTPUT, "に保存しました。");
}

main().catch((err) => {
  console.error("エラー:", err);
  process.exit(1);
});
