/**
 * Store screenshot generator
 * Run: node scripts/take-screenshots.mjs
 *
 * Captures key screens at Android + iOS dimensions in ja/en.
 * Output: screenshots/{locale}/{device}/{name}.png
 *
 * Screens captured automatically:
 *   - home  : upload / landing screen
 *   - privacy: privacy policy page
 *
 * Screens to add manually (require login + real data):
 *   - analysis results, meal suggestions, recipe detail
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../screenshots");
const BASE_URL = "https://ai-recipe-murex.vercel.app";

const DEVICES = [
  {
    name: "android",
    width: 1080,
    height: 1920,
    deviceScaleFactor: 1,
    label: "Android Phone (1080×1920)",
  },
  {
    name: "iphone",
    // iPhone 15 Pro Max physical: 1320×2868 → CSS at 3x: 440×956
    width: 440,
    height: 956,
    deviceScaleFactor: 3,
    label: "iPhone 15 Pro Max (1320×2868 @ 3x)",
  },
];

const LOCALES = ["ja", "en"];

const SCREENS = [
  { name: "home", path: "/", waitFor: "networkidle" },
  { name: "privacy", path: "/privacy", waitFor: "networkidle" },
];

async function takeScreenshots() {
  const browser = await chromium.launch();

  for (const locale of LOCALES) {
    for (const device of DEVICES) {
      const context = await browser.newContext({
        viewport: { width: device.width, height: device.height },
        deviceScaleFactor: device.deviceScaleFactor,
        locale: locale === "ja" ? "ja-JP" : "en-US",
        userAgent:
          "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
      });
      const page = await context.newPage();

      for (const screen of SCREENS) {
        const url = `${BASE_URL}/${locale}${screen.path}`;
        console.log(`  📸 ${locale}/${device.name}/${screen.name} — ${url}`);

        try {
          await page.goto(url, { waitUntil: screen.waitFor, timeout: 20000 });
          // Extra wait for animations / client-side render
          await page.waitForTimeout(1500);

          const outDir = path.join(OUT_DIR, locale, device.name);
          fs.mkdirSync(outDir, { recursive: true });
          const outPath = path.join(outDir, `${screen.name}.png`);

          await page.screenshot({ path: outPath, fullPage: false });
          console.log(`     ✓ saved → ${path.relative(path.join(__dirname, ".."), outPath)}`);
        } catch (err) {
          console.error(`     ✗ failed: ${err.message}`);
        }
      }

      await context.close();
    }
  }

  await browser.close();
  console.log("\nDone. Manual screenshots still needed:");
  console.log("  • analysis results (after uploading a photo)");
  console.log("  • meal suggestions");
  console.log("  • recipe detail");
  console.log("\nAdd them to screenshots/{locale}/{android|iphone}/ and update manifest.json screenshots[] if needed.");
}

takeScreenshots().catch((e) => {
  console.error(e);
  process.exit(1);
});
