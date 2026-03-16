import { chromium } from "playwright";

const url = process.env.TARGET_URL || "http://127.0.0.1:5566/controller";
const out = process.env.OUT_FILE || "seam-visual-verify.png";
const outCrop = process.env.OUT_CROP || "seam-visual-verify-crop.png";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForTimeout(1200); // allow aurora + layout paint

await page.screenshot({ path: out, fullPage: true });

try {
  const handle = page.locator(".ctl-panel-resize").first();
  const box = await handle.boundingBox();
  if (box) {
    const padX = 120;
    const padY = 80;
    const clip = {
      x: Math.max(0, box.x - padX),
      y: Math.max(0, box.y - padY),
      width: Math.min(1500, box.width + padX * 2),
      height: Math.min(900, box.height + padY * 2),
    };
    await page.screenshot({ path: outCrop, clip });
  }
} catch {
  // ignore crop failures
}

await browser.close();

console.log(`Saved screenshot: ${out}`);
console.log(`Saved crop: ${outCrop}`);

