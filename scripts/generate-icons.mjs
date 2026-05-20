/**
 * PWA icon generator
 * Run: node scripts/generate-icons.mjs
 *
 * Generates all required icon sizes from icon-512x512.png
 * and creates a maskable variant with full-bleed green background.
 */

import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "../public");
const SOURCE = path.join(PUBLIC, "icon-512x512.png");

const GREEN = { r: 42, g: 107, b: 84, alpha: 1 };

const SIZES = [48, 72, 96, 128, 144, 192, 256, 384];

async function generateRegular() {
  for (const size of SIZES) {
    const out = path.join(PUBLIC, `icon-${size}x${size}.png`);
    await sharp(SOURCE).resize(size, size).toFile(out);
    console.log(`  ✓ icon-${size}x${size}.png`);
  }
  // 32x32 and 180x180 (already exist, keep in sync)
  for (const size of [32, 180]) {
    const out = path.join(PUBLIC, `icon-${size}x${size}.png`);
    await sharp(SOURCE).resize(size, size).toFile(out);
    console.log(`  ✓ icon-${size}x${size}.png`);
  }
}

async function generateMaskable() {
  // Maskable safe zone = inner 80% circle.
  // Scale icon to 76% of canvas so design stays safely inside.
  const CANVAS = 512;
  const INNER = Math.round(CANVAS * 0.76); // ~389px

  const resized = await sharp(SOURCE).resize(INNER, INNER).toBuffer();

  const offset = Math.round((CANVAS - INNER) / 2);

  const maskable = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: GREEN,
    },
  })
    .composite([{ input: resized, top: offset, left: offset }])
    .png()
    .toBuffer();

  await sharp(maskable)
    .toFile(path.join(PUBLIC, "icon-maskable-512x512.png"));
  console.log("  ✓ icon-maskable-512x512.png");

  // Also generate 192 maskable (minimum required by some validators)
  const CANVAS2 = 192;
  const INNER2 = Math.round(CANVAS2 * 0.76);
  const offset2 = Math.round((CANVAS2 - INNER2) / 2);
  const resized2 = await sharp(SOURCE).resize(INNER2, INNER2).toBuffer();

  await sharp({
    create: {
      width: CANVAS2,
      height: CANVAS2,
      channels: 4,
      background: GREEN,
    },
  })
    .composite([{ input: resized2, top: offset2, left: offset2 }])
    .png()
    .toFile(path.join(PUBLIC, "icon-maskable-192x192.png"));
  console.log("  ✓ icon-maskable-192x192.png");
}

console.log("Generating regular icons...");
await generateRegular();
console.log("Generating maskable icons...");
await generateMaskable();
console.log("Done.");
