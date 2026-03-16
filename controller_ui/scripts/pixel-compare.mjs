import { chromium } from "playwright";
import { readFileSync } from "fs";
import { PNG } from "pngjs";

const url = "http://127.0.0.1:5566/controller";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
await page.goto(url, { waitUntil: "load", timeout: 30_000 });
await page.waitForTimeout(1500);

const buf = await page.screenshot({ type: "png" });
const img = PNG.sync.read(buf);

function px(x, y) {
  const idx = (img.width * y + x) << 2;
  return { r: img.data[idx], g: img.data[idx + 1], b: img.data[idx + 2], a: img.data[idx + 3] };
}

// Get bounding boxes of key elements
const videoBox = await page.locator(".video-container").first().boundingBox();
const panelBox = await page.locator(".ctl-panel").first().boundingBox();
const stageBox = await page.locator(".ctl-stage").first().boundingBox();

console.log("=== Element Bounding Boxes ===");
console.log("video-container:", JSON.stringify(videoBox));
console.log("ctl-panel:", JSON.stringify(panelBox));
console.log("ctl-stage:", JSON.stringify(stageBox));

console.log("\n=== Pixel Samples ===");

// Sample points in the "background" area around each panel
// Left side: stage padding area (between stage edge and video-container)
if (stageBox && videoBox) {
  const leftBgX = Math.round(stageBox.x + 2); // left padding of stage
  const leftBgY = Math.round(stageBox.y + stageBox.height / 2);
  console.log(`Left bg (stage padding) [${leftBgX},${leftBgY}]:`, px(leftBgX, leftBgY));

  const leftBgTopX = Math.round(videoBox.x + videoBox.width / 2);
  const leftBgTopY = Math.round(stageBox.y + 2); // top padding
  console.log(`Left bg (top padding) [${leftBgTopX},${leftBgTopY}]:`, px(leftBgTopX, leftBgTopY));
}

// Right side: panel margin area
if (panelBox) {
  const rightBgX = Math.round(panelBox.x - 2); // left margin of panel
  const rightBgY = Math.round(panelBox.y + panelBox.height / 2);
  console.log(`Right bg (panel left margin) [${rightBgX},${rightBgY}]:`, px(rightBgX, rightBgY));

  const rightBgTopX = Math.round(panelBox.x + panelBox.width / 2);
  const rightBgTopY = Math.round(panelBox.y - 2); // top margin
  console.log(`Right bg (top margin) [${rightBgTopX},${rightBgTopY}]:`, px(rightBgTopX, rightBgTopY));
}

// Sample inside elements
if (videoBox) {
  const vx = Math.round(videoBox.x + 20);
  const vy = Math.round(videoBox.y + 20);
  console.log(`Inside video-container [${vx},${vy}]:`, px(vx, vy));
  
  const vmx = Math.round(videoBox.x + videoBox.width / 2);
  const vmy = Math.round(videoBox.y + videoBox.height / 2);
  console.log(`Inside video-container center [${vmx},${vmy}]:`, px(vmx, vmy));
}

if (panelBox) {
  const px2 = Math.round(panelBox.x + 20);
  const py2 = Math.round(panelBox.y + 20);
  console.log(`Inside ctl-panel [${px2},${py2}]:`, px(px2, py2));
  
  const pmx = Math.round(panelBox.x + panelBox.width / 2);
  const pmy = Math.round(panelBox.y + panelBox.height / 2);
  console.log(`Inside ctl-panel center [${pmx},${pmy}]:`, px(pmx, pmy));
}

// Also get computed styles
const styles = await page.evaluate(() => {
  const vc = document.querySelector('.video-container');
  const cp = document.querySelector('.ctl-panel');
  const cs = (el) => {
    const s = getComputedStyle(el);
    return {
      background: s.background,
      backdropFilter: s.backdropFilter,
      boxShadow: s.boxShadow,
      border: s.border,
      opacity: s.opacity,
    };
  };
  return {
    videoContainer: cs(vc),
    ctlPanel: cs(cp),
  };
});

console.log("\n=== Computed Styles ===");
console.log("video-container:", JSON.stringify(styles.videoContainer, null, 2));
console.log("ctl-panel:", JSON.stringify(styles.ctlPanel, null, 2));

await browser.close();
