#!/usr/bin/env npx tsx
/**
 * 画像認識テストスクリプト
 *
 * 使い方:
 *   npx tsx scripts/test-image-recognition.ts [model]
 *
 * model の選択肢:
 *   gemini-2.5-flash-lite (デフォルト)
 *   gemini-2.5-flash
 *   gemini-2.5-flash-no-think
 *   gemini-2.5-pro
 *   gpt-4o
 *
 * test-images/ への画像の置き方:
 *   ファイル直置き  → 1枚テスト (例: test-images/fridge.jpg)
 *   サブディレクトリ → 複数枚テスト (例: test-images/set1/front.jpg, side.jpg)
 *
 * 正解データ (任意):
 *   test-images/expected.json に記述すると精度検証が有効になる
 *
 * 前提: npm run dev でサーバーが起動していること
 */

import * as fs from "fs";
import * as path from "path";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const MODEL = process.argv[2] ?? "gemini-2.5-flash-lite";
const TEST_IMAGES_DIR = path.join(process.cwd(), "test-images");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// --- Types ---

interface Meal {
  name: string;
  reason: string;
  time_minutes: number;
  difficulty: string;
  matched_ingredients: string[];
  missing_ingredients: string[];
}

interface DonePayload {
  ingredients: string[];
  meal: Meal;
}

interface TestCase {
  label: string;
  files: string[];
}

interface Expected {
  [label: string]: string[];
}

interface TestResult {
  label: string;
  hitRate: number | null;
  error?: string;
}

// --- Helpers ---

function isImageFile(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function imageToDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
  };
  const mime = mimeMap[ext] ?? "image/jpeg";
  const data = fs.readFileSync(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}

function collectTestCases(): TestCase[] {
  if (!fs.existsSync(TEST_IMAGES_DIR)) {
    console.error(`test-images/ ディレクトリが見つかりません: ${TEST_IMAGES_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(TEST_IMAGES_DIR, { withFileTypes: true });
  const cases: TestCase[] = [];

  for (const entry of entries) {
    if (entry.name === "expected.json") continue;

    if (entry.isFile() && isImageFile(entry.name)) {
      cases.push({
        label: entry.name,
        files: [path.join(TEST_IMAGES_DIR, entry.name)],
      });
    } else if (entry.isDirectory()) {
      const subDir = path.join(TEST_IMAGES_DIR, entry.name);
      const imageFiles = fs
        .readdirSync(subDir)
        .filter(isImageFile)
        .sort()
        .map((f) => path.join(subDir, f));

      if (imageFiles.length > 0) {
        cases.push({ label: entry.name, files: imageFiles });
      }
    }
  }

  return cases.sort((a, b) => a.label.localeCompare(b.label));
}

function loadExpected(): Expected {
  const p = path.join(TEST_IMAGES_DIR, "expected.json");
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as Expected;
  } catch {
    console.warn("  ⚠ expected.json のパースに失敗しました。スキップします。");
    return {};
  }
}

// --- API ---

async function callPlayground(imageDataUrls: string[]): Promise<DonePayload> {
  const response = await fetch(`${BASE_URL}/api/playground`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, imageDataUrls }),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const text = await response.text();
  const lines = text.split("\n");

  let nextIsDone = false;
  let nextIsError = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "event: done") {
      nextIsDone = true;
    } else if (trimmed === "event: error") {
      nextIsError = true;
    } else if (trimmed.startsWith("data: ")) {
      const json = trimmed.slice(6);
      if (nextIsDone) return JSON.parse(json) as DonePayload;
      if (nextIsError) {
        const err = JSON.parse(json) as { message: string };
        throw new Error(`APIエラー: ${err.message}`);
      }
    } else if (trimmed === "") {
      nextIsDone = false;
      nextIsError = false;
    }
  }

  throw new Error("SSEレスポンスに done イベントが見つかりませんでした");
}

// --- Output ---

function printResult(tc: TestCase, result: DonePayload, expected: string[] | undefined): number | null {
  const div = "─".repeat(60);
  console.log(`\n${div}`);
  console.log(`📁 ${tc.label}  (${tc.files.length}枚)`);
  if (tc.files.length > 1) {
    tc.files.forEach((f) => console.log(`   ${path.basename(f)}`));
  }
  console.log(div);

  console.log(`\n🥕 認識した食材 (${result.ingredients.length}件):`);
  console.log(`   ${result.ingredients.join(", ")}`);

  const meal = result.meal;
  console.log(`\n🍽  提案献立: ${meal.name}`);
  console.log(`   ${meal.reason}`);
  console.log(`   調理時間: ${meal.time_minutes}分  難易度: ${meal.difficulty}`);
  if (meal.missing_ingredients.length > 0) {
    console.log(`   買い足し: ${meal.missing_ingredients.join(", ")}`);
  }

  if (!expected || expected.length === 0) return null;

  const recognizedLower = new Set(result.ingredients.map((s) => s.toLowerCase()));
  const hits = expected.filter((e) => recognizedLower.has(e.toLowerCase()));
  const misses = expected.filter((e) => !recognizedLower.has(e.toLowerCase()));
  const extras = result.ingredients.filter(
    (r) => !expected.map((e) => e.toLowerCase()).includes(r.toLowerCase())
  );
  const hitRate = Math.round((hits.length / expected.length) * 100);

  console.log(`\n✅ 精度検証:`);
  console.log(`   ヒット率: ${hits.length}/${expected.length} (${hitRate}%)`);
  if (hits.length > 0) console.log(`   一致:     ${hits.join(", ")}`);
  if (misses.length > 0) console.log(`   未認識:   ${misses.join(", ")}`);
  if (extras.length > 0) console.log(`   余分認識: ${extras.join(", ")}`);

  return hitRate;
}

// --- Main ---

async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`🔍 画像認識テスト`);
  console.log(`   モデル  : ${MODEL}`);
  console.log(`   サーバー: ${BASE_URL}`);
  console.log(`${"═".repeat(60)}`);

  const cases = collectTestCases();
  if (cases.length === 0) {
    console.log("\ntest-images/ に画像ファイルまたはサブディレクトリを追加してください。");
    return;
  }
  console.log(`   テストケース: ${cases.length}件`);

  const expected = loadExpected();
  const results: TestResult[] = [];

  for (const tc of cases) {
    process.stdout.write(`\n⏳ ${tc.label} を処理中...`);
    const start = Date.now();

    try {
      const dataUrls = tc.files.map(imageToDataUrl);
      const result = await callPlayground(dataUrls);
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(` ${elapsed}s\n`);

      const hitRate = printResult(tc, result, expected[tc.label]);
      results.push({ label: tc.label, hitRate });
    } catch (err) {
      process.stdout.write(" ❌ エラー\n");
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ${msg}`);
      results.push({ label: tc.label, hitRate: null, error: msg });
    }
  }

  // サマリー
  const withExpected = results.filter((r) => r.hitRate !== null);
  console.log(`\n${"═".repeat(60)}`);
  console.log(`📊 サマリー  (モデル: ${MODEL})`);
  console.log(`${"═".repeat(60)}`);

  results.forEach((r) => {
    const status = r.error
      ? "❌ エラー"
      : r.hitRate !== null
      ? `${r.hitRate}%`
      : "(正解データなし)";
    console.log(`   ${r.label}: ${status}`);
  });

  if (withExpected.length > 0) {
    const avg = Math.round(
      withExpected.reduce((s, r) => s + r.hitRate!, 0) / withExpected.length
    );
    console.log(`\n   平均ヒット率: ${avg}%  (${withExpected.length}/${results.length}件)`);
  }

  console.log("\n✅ 完了\n");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
