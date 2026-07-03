"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { PNG } = require("pngjs");
const { chromium } = require("playwright");
const {
  DEFAULT_DISPLAY_ORIENTATION,
  DISPLAY_HEIGHT,
  DISPLAY_WIDTH,
  FRAME_BYTES,
  displayOrientation,
  maxDisplayRows
} = require("./domain");

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusLabel(item) {
  if (item.daysRemaining < 0) return `已过期 ${Math.abs(item.daysRemaining)} 天`;
  if (item.daysRemaining === 0) return "今天到期";
  return `${item.daysRemaining} 天`;
}

function statusColor(item) {
  if (item.status === "expired") return "red";
  if (item.status === "expiring") return "yellow";
  return "black";
}

function categoryIcon(category) {
  const icons = {
    "水果": `<svg class="category-icon fruit" data-icon="fruit" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="M16 9c8 0 11 4 10 10-1 6-7 11-10 12-3-1-9-6-10-12-1-6 2-10 10-10Z"/><path class="fill-black" d="m16 10-6-3 4-2 2 3 2-5 2 4 5-1-5 5Z"/><path d="M12 16h1m6-1h1m-5 7h1" /></svg>`,
    "蔬菜": `<svg class="category-icon vegetable" data-icon="vegetable" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="M16 30C4 26 5 11 16 4c11 7 12 22 0 26Z"/><path d="M16 29V8m0 11-6-5m6 9 7-7" /></svg>`,
    "肉类": `<svg class="category-icon meat" data-icon="meat" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="M21 4c6 0 9 5 8 10-1 6-7 10-12 8l-4 4-5-5 4-4C10 10 15 4 21 4Z"/><path class="fill-white" d="M13 20 9 24"/><path class="fill-white" d="M10 23c-2-2-5 1-3 3s4-1 5 0 4-1 2-3"/></svg>`,
    "海鲜": `<svg class="category-icon seafood" data-icon="seafood" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="M4 16c6-8 14-8 20-3l5-4v14l-5-4c-6 5-14 5-20-3Z"/><circle class="fill-black" cx="19.5" cy="14" r="1.5"/><path d="M10 12v8" /></svg>`,
    "乳品": `<svg class="category-icon dairy" data-icon="dairy" viewBox="0 0 32 32" aria-hidden="true"><path class="fill-white" d="M10 5h11l3 6v18H8V11Z"/><path class="accent" d="M9 16h14v7H9Z"/><path d="M10 5v6h14M14 5v6" /></svg>`,
    "蛋类": `<svg class="category-icon egg" data-icon="egg" viewBox="0 0 32 32" aria-hidden="true"><path class="fill-white" d="M16 3c6 0 11 13 10 19-1 5-5 8-10 8S7 27 6 22C5 16 10 3 16 3Z"/><circle class="accent" cx="16" cy="20" r="5"/></svg>`,
    "饮料": `<svg class="category-icon drink" data-icon="drink" viewBox="0 0 32 32" aria-hidden="true"><path class="fill-white" d="M12 8h9l2 5v16H10V13Z"/><path class="accent" d="M11 18h11v8H11Z"/><path d="M12 8h9M14 4h7v4M19 4v-2" /></svg>`,
    "豆制品": `<svg class="category-icon tofu" data-icon="tofu" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="m5 12 12-6 10 5-12 6Z"/><path class="fill-white" d="M5 12v12l10 4V17l12-6v12l-12 5"/><path d="M11 13h1m5-2h1m3 3h1" /></svg>`,
    "熟食": `<svg class="category-icon cooked" data-icon="cooked" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="M5 17h22c-1 8-5 11-11 11S6 25 5 17Z"/><path d="M4 17h24M8 14h16M13 10c-2-3 2-4 0-7m6 7c-2-3 2-4 0-7" /></svg>`,
    "调味品": `<svg class="category-icon condiment" data-icon="condiment" viewBox="0 0 32 32" aria-hidden="true"><path class="fill-white" d="M12 8h8l3 6v15H9V14Z"/><path class="accent" d="M10 17h12v8H10Z"/><path d="M12 8V4h8v4M14 4V2h4" /></svg>`,
    "冷冻": `<svg class="category-icon frozen" data-icon="frozen" viewBox="0 0 32 32" aria-hidden="true"><circle class="accent" cx="16" cy="16" r="13"/><path d="M16 4v24M6 10l20 12M6 22l20-12m-10-8-3 4m3-4 3 4m-13 2 5 1m-5-1 2 5m18-5-5 1m5-1-2 5M6 22l5-1m-5 1 2-5m18 5-5-1m5 1-2-5m-8 11-3-4m3 4 3-4"/></svg>`,
    "甜点": `<svg class="category-icon dessert" data-icon="dessert" viewBox="0 0 32 32" aria-hidden="true"><path class="accent" d="M5 25h23L11 12Z"/><path class="fill-white" d="M8 21h15M10 17h8"/><path d="M11 12c1-4 7-4 8 0M15 8V5m0 0c3-2 5-1 5 1-2 1-4 1-5-1Z"/></svg>`,
    "其他": `<svg class="category-icon other" data-icon="other" viewBox="0 0 32 32" aria-hidden="true"><path class="fill-white" d="M8 10h16l-2 19H10Z"/><path class="accent" d="M11 16h10v7H11Z"/><path d="M6 10h20M11 6h10" /></svg>`
  };
  return icons[String(category || "").trim()] || icons["其他"];
}

function renderDashboardHtml(items, generatedAt, options = {}) {
  const orientation = displayOrientation(options.orientation || DEFAULT_DISPLAY_ORIENTATION);
  const isPortrait = orientation === "portrait";
  const canvasWidth = isPortrait ? DISPLAY_HEIGHT : DISPLAY_WIDTH;
  const canvasHeight = isPortrait ? DISPLAY_WIDTH : DISPLAY_HEIGHT;
  const rowLimit = maxDisplayRows(orientation);
  const rows = items.slice(0, rowLimit);
  const expiredCount = items.filter((item) => item.status === "expired").length;
  const expiringCount = items.filter((item) => item.status === "expiring").length;
  const headerStatus = expiredCount
    ? `${expiredCount} 项已过期`
    : expiringCount
      ? `${expiringCount} 项临期`
      : "食材状态正常";
  const rowMarkup = rows.length
    ? rows.map((item) => `
      <article class="food ${statusColor(item)}">
        <div class="icon">${categoryIcon(item.category)}</div>
        <div class="name">${htmlEscape(item.name)}</div>
        <div class="meta">${htmlEscape(item.category)}${item.quantityText ? ` / ${htmlEscape(item.quantityText)}` : ""}　到期 ${htmlEscape(item.expiresOn)}</div>
        <div class="days">${htmlEscape(statusLabel(item))}</div>
        <div class="bar"><span style="width:${progressWidth(item)}%"></span></div>
      </article>`).join("")
    : `<div class="empty">还没有食材<br><small>请在手机页面添加食材信息</small></div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${canvasWidth}, initial-scale=1">
  <title>鲜知贴</title>
  <style>
    :root { --black:#101010; --red:#c91c22; --yellow:#f2bd16; --white:#fff; }
    * { box-sizing:border-box; }
    html, body { margin:0; width:${canvasWidth}px; height:${canvasHeight}px; overflow:hidden; background:var(--white); }
    body { font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif; color:var(--black); }
    .board { width:${canvasWidth}px; height:${canvasHeight}px; padding:${isPortrait ? "20px 18px 16px" : "17px 22px 16px"}; background:var(--white); }
    header { height:${isPortrait ? "78px" : "55px"}; border-bottom:3px solid var(--black); display:flex; ${isPortrait ? "flex-direction:column; gap:9px;" : "justify-content:space-between; align-items:flex-start;"} }
    h1 { margin:0; font-size:${isPortrait ? "29px" : "27px"}; font-weight:800; letter-spacing:1px; }
    .right { ${isPortrait ? "display:flex; justify-content:space-between; width:100%;" : "text-align:right;"} font-size:${isPortrait ? "14px" : "15px"}; font-weight:700; line-height:1.42; }
    .summary { height:${isPortrait ? "48px" : "38px"}; display:flex; align-items:center; gap:15px; font-size:${isPortrait ? "16px" : "17px"}; font-weight:750; }
    .badge { border:2px solid var(--black); padding:2px 13px; }
    .badge.red { background:var(--red); color:var(--white); border-color:var(--red); }
    .badge.yellow { background:var(--yellow); color:var(--black); border-color:var(--black); }
    .list { height:${isPortrait ? "590px" : "350px"}; display:grid; grid-template-rows:repeat(${rowLimit}, 1fr); }
    .food { position:relative; display:grid; ${isPortrait ? "grid-template-columns:36px 1fr auto; grid-template-rows:27px 17px; align-items:baseline; gap:0 8px; padding:3px 0 6px;" : "grid-template-columns:38px 180px 1fr 125px; align-items:center; gap:16px; padding:2px 0 8px;"} border-top:1px solid var(--black); }
    .food .icon { grid-column:1; ${isPortrait ? "grid-row:1 / 3; align-self:center;" : ""} }
    .category-icon { display:block; width:${isPortrait ? "30px" : "30px"}; height:${isPortrait ? "30px" : "30px"}; fill:none; stroke:var(--black); stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
    .category-icon .accent { fill:var(--white); }
    .category-icon .fill-black { fill:var(--black); stroke:var(--black); }
    .category-icon .fill-white { fill:var(--white); }
    .food.red .category-icon .accent { fill:var(--red); }
    .food.yellow .category-icon .accent { fill:var(--yellow); }
    .food .name { font-weight:850; font-size:${isPortrait ? "18px" : "21px"}; ${isPortrait ? "grid-column:2; grid-row:1; line-height:25px;" : "grid-column:2;"} }
    .food .meta { font-size:${isPortrait ? "12px" : "15px"}; font-weight:600; ${isPortrait ? "grid-column:2 / 4; grid-row:2; line-height:16px;" : "grid-column:3; align-self:start; margin-top:6px;"} }
    .food .days { font-size:${isPortrait ? "17px" : "20px"}; font-weight:850; text-align:right; ${isPortrait ? "grid-column:3; grid-row:1; justify-self:end; line-height:25px;" : "grid-column:4;"} }
    .food .bar { position:absolute; left:${isPortrait ? "44px" : "250px"}; right:0; bottom:${isPortrait ? "3px" : "5px"}; height:${isPortrait ? "4px" : "5px"}; border:1px solid var(--black); }
    .food .bar span { display:block; height:100%; background:var(--black); }
    .food.red .name, .food.red .days { color:var(--red); }
    .food.red .bar span { background:var(--red); }
    .food.yellow .bar span { background:var(--yellow); }
    .empty { grid-row:1 / -1; display:flex; flex-direction:column; justify-content:center; align-items:center; border-top:1px solid var(--black); font-size:28px; font-weight:800; }
    .empty small { font-size:17px; margin-top:12px; }
    footer { height:${isPortrait ? "34px" : "20px"}; border-top:2px solid var(--black); display:flex; ${isPortrait ? "flex-direction:column; gap:3px;" : "justify-content:space-between;"} font-size:${isPortrait ? "12px" : "13px"}; padding-top:5px; font-weight:650; }
  </style>
</head>
<body>
  <main class="board">
    <header>
      <h1>鲜知贴</h1>
      <div class="right"><span>${htmlEscape(generatedAt)}</span><span>显示最需处理的 ${rowLimit} 项</span></div>
    </header>
    <section class="summary">
      <span class="badge ${expiredCount ? "red" : expiringCount ? "yellow" : ""}">${htmlEscape(headerStatus)}</span>
      <span>全部食材 ${items.length} 项</span>
    </section>
    <section class="list">${rowMarkup}</section>
    <footer><span>红色：已过期　黄色：3 天内到期</span><span>${htmlEscape(options.panel || "gdem075f52")} / ${canvasWidth} x ${canvasHeight} ${isPortrait ? "竖屏" : "横屏"} / 四色</span></footer>
  </main>
</body>
</html>`;
}

function progressWidth(item) {
  if (item.daysRemaining < 0) return 100;
  const urgentWidths = [100, 88, 76, 64, 52, 40, 28, 20];
  if (item.daysRemaining <= 7) return urgentWidths[item.daysRemaining];
  return Math.max(8, Math.round((20 * 7) / item.daysRemaining));
}

async function launchBrowser(browserPath) {
  try {
    return await chromium.launch({ headless: true });
  } catch (firstError) {
    const fallbacks = [
      browserPath,
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ].filter(Boolean);
    for (const executablePath of fallbacks) {
      if (!fs.existsSync(executablePath)) continue;
      try {
        return await chromium.launch({ headless: true, executablePath });
      } catch {
        // Continue to the next locally installed browser.
      }
    }
    throw firstError;
  }
}

async function renderPng(html, browserPath, orientation) {
  const isPortrait = displayOrientation(orientation) === "portrait";
  const width = isPortrait ? DISPLAY_HEIGHT : DISPLAY_WIDTH;
  const height = isPortrait ? DISPLAY_WIDTH : DISPLAY_HEIGHT;
  const browser = await launchBrowser(browserPath);
  try {
    const page = await browser.newPage({ viewport: { width, height, deviceScaleFactor: 1 } });
    await page.setContent(html, { waitUntil: "load" });
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
  } finally {
    await browser.close();
  }
}

function packNativeFourColor(pngBuffer, orientation = "landscape") {
  const normalizedOrientation = displayOrientation(orientation);
  const isPortrait = normalizedOrientation === "portrait";
  const sourceWidth = isPortrait ? DISPLAY_HEIGHT : DISPLAY_WIDTH;
  const sourceHeight = isPortrait ? DISPLAY_WIDTH : DISPLAY_HEIGHT;
  const png = PNG.sync.read(pngBuffer);
  if (png.width !== sourceWidth || png.height !== sourceHeight) {
    throw new Error(`unexpected rendered size: ${png.width}x${png.height}`);
  }
  const frame = Buffer.alloc(FRAME_BYTES, 0x55);
  const palette = [
    { code: 0, rgb: [16, 16, 16] },
    { code: 1, rgb: [255, 255, 255] },
    { code: 2, rgb: [242, 189, 22] },
    { code: 3, rgb: [201, 28, 34] }
  ];
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const offset = (y * sourceWidth + x) * 4;
      const rgb = [png.data[offset], png.data[offset + 1], png.data[offset + 2]];
      let nearest = palette[0];
      let distance = Number.POSITIVE_INFINITY;
      for (const candidate of palette) {
        const nextDistance =
          (rgb[0] - candidate.rgb[0]) ** 2 +
          (rgb[1] - candidate.rgb[1]) ** 2 +
          (rgb[2] - candidate.rgb[2]) ** 2;
        if (nextDistance < distance) {
          nearest = candidate;
          distance = nextDistance;
        }
      }
      // Portrait UI is rotated into the native panel coordinates used by drawNative().
      const nativeX = isPortrait ? DISPLAY_WIDTH - 1 - y : x;
      const nativeY = isPortrait ? x : y;
      const frameOffset = nativeY * (DISPLAY_WIDTH / 4) + Math.floor(nativeX / 4);
      const shift = (3 - (nativeX % 4)) * 2;
      frame[frameOffset] = (frame[frameOffset] & ~(0x03 << shift)) | (nearest.code << shift);
    }
  }
  return frame;
}

async function renderFrame(items, generatedAt, panel, browserPath, orientation = DEFAULT_DISPLAY_ORIENTATION) {
  const normalizedOrientation = displayOrientation(orientation);
  const html = renderDashboardHtml(items, generatedAt, { panel, orientation: normalizedOrientation });
  const png = await renderPng(html, browserPath, normalizedOrientation);
  const frame = packNativeFourColor(png, normalizedOrientation);
  const etag = `"${crypto.createHash("sha256").update(frame).digest("hex")}"`;
  return { etag, frame, html, png };
}

module.exports = { packNativeFourColor, progressWidth, renderDashboardHtml, renderFrame };
