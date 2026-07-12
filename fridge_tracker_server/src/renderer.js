"use strict";

const crypto = require("node:crypto");
const { chromium } = require("playwright");
const sharp = require("sharp");
const {
  DEFAULT_DISPLAY_ORIENTATION,
  DEFAULT_PANEL_PROFILE,
  displayOrientation,
  maxDisplayRows,
  panelConfig
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
    "水果": ["fruit", `<path d="M16 12c-2.2-3-7-2.5-8 2.2-1 5.3 3.7 10.7 8 12.3 4.3-1.6 9-7 8-12.3-1-4.7-5.8-5.2-8-2.2Z"/><path d="M16 11c.2-3.5 2.2-5.4 5.7-5.5-.4 3.2-2.4 5.2-5.7 5.5Zm0 0-3.2-3.2"/>`],
    "蔬菜": ["vegetable", `<path d="M13 12 22 9l-3 9-6 8-4-4 4-10Z"/><path d="m13 12-3-4m5 3 1-5m1 4 4-3M11 20l3 3"/>`],
    "肉类": ["meat", `<path d="M20.5 7.5c4.5 0 7 3.8 5.5 7.7-1.3 3.6-5.2 5.5-9.1 4.4l-4.4 4.3-4.4-4.4 4.3-4.3c-1-3.8 2.5-7.7 8.1-7.7Z"/><circle cx="20.5" cy="13.5" r="2.8"/><path d="M10.5 22c-1.5-1.4-3.8.8-2.3 2.3 1.2 1.2 2.2-.2 3.3.9 1.5 1.5 3.7-.8 2.3-2.3"/>`],
    "海鲜": ["seafood", `<path d="M6 16c4.5-5.2 10.8-6.3 16.2-2.2L27 10v12l-4.8-3.8C16.8 22.3 10.5 21.2 6 16Z"/><circle class="fill-black" cx="18.8" cy="14.8" r="1.2"/><path d="M10 13.2v5.6"/>`],
    "乳品": ["dairy", `<path d="M11 9h9.5l3.5 5v12H9V14l2-5Z"/><path d="M11 9V6h8v3m-8 0 4 5h9M15 14v12m3-7h3"/>`],
    "蛋类": ["egg", `<path d="M16 6c4 0 8.5 9.6 8.5 14.1 0 4.2-3.4 6.4-8.5 6.4s-8.5-2.2-8.5-6.4C7.5 15.6 12 6 16 6Z"/><circle cx="16" cy="20" r="3.8"/>`],
    "饮料": ["drink", `<path d="M11 10h11l2 5v11H9V15l2-5Z"/><path d="M11 10V7h10v3m-7-3V5h7m-8 11h7m-7 4h7"/>`],
    "豆制品": ["tofu", `<path d="m7 12 10-5 9 4.5-10 5L7 12Zm0 0v10l9 4.5v-10m10-5v10l-10 5"/><path d="m11 13.8 2 1m5-4 2-1m1 4 2-1"/>`],
    "熟食": ["cooked", `<path d="M7 17h18c-.8 6.2-3.9 9-9 9s-8.2-2.8-9-9Zm-2 0h22M10 14h12"/><path d="M13 11c-2-2.2 2-3.5 0-5.5m6 5.5c-2-2.2 2-3.5 0-5.5"/>`],
    "调味品": ["condiment", `<path d="M11 11h10l2 4v11H9V15l2-4Zm1 0V7h8v4m-6-4V5h4"/><path d="M12 17h8v5h-8z"/>`],
    "冷冻": ["frozen", `<path d="M16 6v20M7.3 11l17.4 10M7.3 21l17.4-10M16 6l-2.5 2.5M16 6l2.5 2.5M7.3 11l3.4.9M7.3 11l.9 3.4m16.5-3.4-3.4.9m3.4-.9-.9 3.4M7.3 21l3.4-.9M7.3 21l.9-3.4m16.5 3.4-3.4-.9m3.4.9-.9-3.4M16 26l-2.5-2.5M16 26l2.5-2.5"/>`],
    "甜点": ["dessert", `<path d="M8 24h16L11 13l-3 11Zm2.5-5h8m-9 3h12"/><path d="M11 13c.7-3 3.1-4.5 6.2-3.7 1.3-2.2 4.9-1.6 5.3 1.2.4 2.4-1.3 3.5-3.6 3.5"/><circle class="fill-black" cx="18" cy="9" r="1"/>`],
    "其他": ["other", `<path d="M8 12h16l-1.5 14h-13L8 12Zm-2 0h20M11 12V8h10v4"/><path d="M13 17h6m-6 4h6"/>`]
  };
  const [name, glyph] = icons[String(category || "").trim()] || icons["其他"];
  return `<svg class="category-icon ${name}" data-icon="${name}" viewBox="0 0 32 32" aria-hidden="true"><rect class="accent icon-badge" x="1.5" y="1.5" width="29" height="29" rx="8"/>${glyph}</svg>`;
}

function renderTriColorDashboardHtml(items, generatedAt, options, config, orientation) {
  const isPortrait = orientation === "portrait";
  const canvasWidth = isPortrait ? config.height : config.width;
  const canvasHeight = isPortrait ? config.width : config.height;
  const rowLimit = maxDisplayRows(orientation, config.id);
  const rows = items.slice(0, rowLimit);
  const expiredCount = items.filter((item) => item.status === "expired").length;
  const expiringCount = items.filter((item) => item.status === "expiring").length;
  const summaryMarkup = expiredCount || expiringCount
    ? `${expiredCount ? `<span class="badge red">${expiredCount} 项已过期</span>` : ""}
      ${expiringCount ? `<span class="badge expiring">${expiringCount} 项快过期</span>` : ""}`
    : `<span class="badge">食材状态正常</span>`;
  const rowMarkup = rows.length
    ? rows.map((item) => `
      <article class="food ${statusColor(item)}">
        <div class="icon">${categoryIcon(item.category)}</div>
        <div class="name">${htmlEscape(item.name)}</div>
        <div class="meta">${htmlEscape(item.category)}${item.quantityText ? ` / ${htmlEscape(item.quantityText)}` : ""}</div>
        <div class="days">${htmlEscape(statusLabel(item))}</div>
        <div class="bar"><span style="width:${progressWidth(item)}%"></span></div>
      </article>`).join("")
    : `<div class="empty">还没有食材<br><small>请在手机页面添加</small></div>`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${canvasWidth}, initial-scale=1">
  <title>鲜知贴</title>
  <style>
    :root { --black:#101010; --red:#c91c22; --white:#fff; }
    * { box-sizing:border-box; }
    html, body { margin:0; width:${canvasWidth}px; height:${canvasHeight}px; overflow:hidden; background:var(--white); }
    body { font-family:"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif; color:var(--black); }
    .board { width:${canvasWidth}px; height:${canvasHeight}px; padding:${isPortrait ? "10px 10px 8px" : "9px 13px 7px"}; background:var(--white); }
    header { height:${isPortrait ? "53px" : "39px"}; border-bottom:2px solid var(--black); display:flex; ${isPortrait ? "flex-direction:column; gap:3px;" : "justify-content:space-between; align-items:flex-start;"} }
    h1 { margin:0; font-size:${isPortrait ? "22px" : "21px"}; font-weight:850; letter-spacing:1px; }
    .right { ${isPortrait ? "display:flex; justify-content:space-between; width:100%;" : "text-align:right;"} font-size:${isPortrait ? "9px" : "10px"}; font-weight:700; line-height:1.35; }
    .summary { height:${isPortrait ? "38px" : "31px"}; display:flex; align-items:center; gap:8px; font-size:${isPortrait ? "12px" : "12px"}; font-weight:750; }
    .badge { border:2px solid var(--black); padding:1px 8px; }
    .badge.red { background:var(--red); color:var(--white); border-color:var(--red); }
    .badge.expiring { color:var(--red); border-color:var(--red); }
    .list { height:${isPortrait ? "270px" : "190px"}; display:grid; grid-template-rows:repeat(${rowLimit}, 1fr); }
    .food { position:relative; display:grid; ${isPortrait ? "grid-template-columns:28px 1fr auto; grid-template-rows:20px 14px; gap:0 5px; padding:2px 0 5px;" : "grid-template-columns:27px 105px 1fr 82px; align-items:center; gap:7px; padding:1px 0 5px;"} border-top:1px solid var(--black); }
    .food .icon { grid-column:1; ${isPortrait ? "grid-row:1 / 3; align-self:center;" : ""} }
    .category-icon { display:block; width:22px; height:22px; fill:none; stroke:var(--black); stroke-width:1.9; stroke-linecap:round; stroke-linejoin:round; }
    .category-icon .accent { fill:var(--white); }
    .category-icon .fill-black { fill:var(--black); stroke:var(--black); }
    .category-icon .fill-white { fill:var(--white); }
    .food.red .category-icon .accent { fill:var(--red); }
    .food .name { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-weight:850; font-size:${isPortrait ? "14px" : "14px"}; ${isPortrait ? "grid-column:2; grid-row:1; line-height:19px;" : "grid-column:2;"} }
    .food .meta { min-width:0; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; font-size:${isPortrait ? "9px" : "10px"}; font-weight:600; ${isPortrait ? "grid-column:2 / 4; grid-row:2; line-height:13px;" : "grid-column:3;"} }
    .food .days { white-space:nowrap; font-size:${isPortrait ? "13px" : "13px"}; font-weight:850; text-align:right; ${isPortrait ? "grid-column:3; grid-row:1; line-height:19px;" : "grid-column:4;"} }
    .food .bar { position:absolute; left:${isPortrait ? "33px" : "139px"}; right:0; bottom:2px; height:3px; border:1px solid var(--black); }
    .food .bar span { display:block; height:100%; background:var(--black); }
    .food.red .name, .food.red .days { color:var(--red); }
    .food.red .bar span { background:var(--red); }
    .food.yellow .category-icon .accent { fill:var(--red); }
    .food.yellow .name, .food.yellow .days { color:var(--red); font-weight:950; text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:2px; }
    .food.yellow .bar span { background:var(--red); }
    .empty { grid-row:1 / -1; display:flex; flex-direction:column; justify-content:center; align-items:center; border-top:1px solid var(--black); font-size:20px; font-weight:800; }
    .empty small { font-size:12px; margin-top:7px; }
    footer { height:${isPortrait ? "21px" : "18px"}; border-top:2px solid var(--black); display:flex; justify-content:space-between; align-items:flex-end; gap:6px; font-size:${isPortrait ? "8px" : "8px"}; padding-top:3px; font-weight:650; }
  </style>
</head>
<body>
  <main class="board">
    <header>
      <h1>鲜知贴</h1>
      <div class="right"><span>${htmlEscape(generatedAt)}</span><span>显示最需处理的 ${rowLimit} 项</span></div>
    </header>
    <section class="summary">
      ${summaryMarkup}
      <span>全部 ${items.length} 项</span>
    </section>
    <section class="list">${rowMarkup}</section>
    <footer><span>红色：已过期 / 3 天内到期</span><span>${htmlEscape(config.id)} / ${canvasWidth} x ${canvasHeight} / 三色</span></footer>
  </main>
</body>
</html>`;
}

function renderDashboardHtml(items, generatedAt, options = {}) {
  const config = panelConfig(options.panel || DEFAULT_PANEL_PROFILE);
  const orientation = displayOrientation(options.orientation || DEFAULT_DISPLAY_ORIENTATION);
  if (config.colorMode === "tri-color") {
    return renderTriColorDashboardHtml(items, generatedAt, options, config, orientation);
  }
  const isPortrait = orientation === "portrait";
  const canvasWidth = isPortrait ? config.height : config.width;
  const canvasHeight = isPortrait ? config.width : config.height;
  const rowLimit = maxDisplayRows(orientation, config.id);
  const rows = items.slice(0, rowLimit);
  const expiredCount = items.filter((item) => item.status === "expired").length;
  const expiringCount = items.filter((item) => item.status === "expiring").length;
  const summaryMarkup = expiredCount || expiringCount
    ? `${expiredCount ? `<span class="badge red">${expiredCount} 项已过期</span>` : ""}
      ${expiringCount ? `<span class="badge yellow">${expiringCount} 项快过期</span>` : ""}`
    : `<span class="badge">食材状态正常</span>`;
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
      ${summaryMarkup}
      <span>全部食材 ${items.length} 项</span>
    </section>
    <section class="list">${rowMarkup}</section>
    <footer><span>红色：已过期　黄色：3 天内到期</span><span>${htmlEscape(config.id)} / ${canvasWidth} x ${canvasHeight} ${isPortrait ? "竖屏" : "横屏"} / 四色</span></footer>
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

async function renderPng(html, panel, orientation) {
  const config = panelConfig(panel);
  const isPortrait = displayOrientation(orientation) === "portrait";
  const width = isPortrait ? config.height : config.width;
  const height = isPortrait ? config.width : config.height;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height, deviceScaleFactor: 1 } });
    await page.setContent(html, { waitUntil: "load" });
    return await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
  } finally {
    await browser.close();
  }
}

async function rawRenderedPixels(pngBuffer, config, orientation) {
  const normalizedOrientation = displayOrientation(orientation);
  const isPortrait = normalizedOrientation === "portrait";
  const sourceWidth = isPortrait ? config.height : config.width;
  const sourceHeight = isPortrait ? config.width : config.height;
  const { data, info } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== sourceWidth || info.height !== sourceHeight) {
    throw new Error(`unexpected rendered size: ${info.width}x${info.height}`);
  }
  return { data, isPortrait, sourceHeight, sourceWidth };
}

function nearestPaletteColor(rgb, palette) {
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
  return nearest;
}

async function packNativeFourColor(pngBuffer, orientation = "landscape", panel = DEFAULT_PANEL_PROFILE) {
  const config = panelConfig(panel);
  if (config.colorMode !== "four-color") throw new Error("panel does not use the four-color frame format");
  const { data, isPortrait, sourceHeight, sourceWidth } = await rawRenderedPixels(pngBuffer, config, orientation);
  const frame = Buffer.alloc(config.frameBytes, 0x55);
  const palette = [
    { code: 0, rgb: [16, 16, 16] },
    { code: 1, rgb: [255, 255, 255] },
    { code: 2, rgb: [242, 189, 22] },
    { code: 3, rgb: [201, 28, 34] }
  ];
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const offset = (y * sourceWidth + x) * 4;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      const nearest = nearestPaletteColor(rgb, palette);
      // Portrait UI is rotated into the native panel coordinates used by drawNative().
      const nativeX = isPortrait ? config.width - 1 - y : x;
      const nativeY = isPortrait ? x : y;
      const frameOffset = nativeY * (config.width / 4) + Math.floor(nativeX / 4);
      const shift = (3 - (nativeX % 4)) * 2;
      frame[frameOffset] = (frame[frameOffset] & ~(0x03 << shift)) | (nearest.code << shift);
    }
  }
  return frame;
}

async function packNativeTriColor(pngBuffer, orientation = "landscape", panel = "gdey042z98") {
  const config = panelConfig(panel);
  if (config.colorMode !== "tri-color") throw new Error("panel does not use the tri-color frame format");
  const { data, isPortrait, sourceHeight, sourceWidth } = await rawRenderedPixels(pngBuffer, config, orientation);
  const planeBytes = config.frameBytes / 2;
  const blackPlane = Buffer.alloc(planeBytes, 0xFF);
  const redPlane = Buffer.alloc(planeBytes, 0xFF);
  const palette = [
    { name: "black", rgb: [16, 16, 16] },
    { name: "white", rgb: [255, 255, 255] },
    { name: "red", rgb: [201, 28, 34] }
  ];
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < sourceWidth; x++) {
      const offset = (y * sourceWidth + x) * 4;
      const rgb = [data[offset], data[offset + 1], data[offset + 2]];
      const nearest = nearestPaletteColor(rgb, palette);
      const nativeX = isPortrait ? config.width - 1 - y : x;
      const nativeY = isPortrait ? x : y;
      const byteOffset = nativeY * (config.width / 8) + Math.floor(nativeX / 8);
      const mask = 0x80 >> (nativeX % 8);
      if (nearest.name === "black") blackPlane[byteOffset] &= ~mask;
      if (nearest.name === "red") redPlane[byteOffset] &= ~mask;
    }
  }
  return Buffer.concat([blackPlane, redPlane]);
}

async function renderFrame(items, generatedAt, panel, orientation = DEFAULT_DISPLAY_ORIENTATION) {
  const config = panelConfig(panel);
  const normalizedOrientation = displayOrientation(orientation);
  const html = renderDashboardHtml(items, generatedAt, { panel: config.id, orientation: normalizedOrientation });
  const png = await renderPng(html, config.id, normalizedOrientation);
  const frame = config.colorMode === "tri-color"
    ? await packNativeTriColor(png, normalizedOrientation, config.id)
    : await packNativeFourColor(png, normalizedOrientation, config.id);
  const etag = `"${crypto.createHash("sha256").update(frame).digest("hex")}"`;
  return { etag, frame, frameFormat: config.frameFormat, html, png };
}

module.exports = { packNativeFourColor, packNativeTriColor, progressWidth, renderDashboardHtml, renderFrame };
