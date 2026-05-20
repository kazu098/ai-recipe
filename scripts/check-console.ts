import { chromium } from "playwright";

const URL = process.argv[2] ?? "http://localhost:3000/ja";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors: string[] = [];
  const warnings: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
    if (msg.type() === "warning") warnings.push(msg.text());
  });

  page.on("pageerror", (err) => {
    errors.push(`[PageError] ${err.message}`);
  });

  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);

  if (errors.length === 0 && warnings.length === 0) {
    console.log("✅ コンソールエラー・警告なし");
  } else {
    if (errors.length > 0) {
      console.log(`\n❌ エラー (${errors.length}件):`);
      errors.forEach((e) => console.log(`  ${e}`));
    }
    if (warnings.length > 0) {
      console.log(`\n⚠️  警告 (${warnings.length}件):`);
      warnings.forEach((w) => console.log(`  ${w}`));
    }
  }

  await browser.close();
})();
