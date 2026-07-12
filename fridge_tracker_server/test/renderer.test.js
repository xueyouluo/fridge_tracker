"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");
const { FRAME_BYTES } = require("../src/domain");
const { packNativeFourColor, packNativeTriColor, progressWidth, renderDashboardHtml } = require("../src/renderer");

function food(index) {
  return {
    name: `食材 ${index}`,
    category: "蔬菜",
    quantityText: "1 份",
    expiresOn: "2026-05-30",
    daysRemaining: index,
    status: "normal"
  };
}

test("portrait dashboard shows nine rows while landscape remains eight rows", () => {
  const items = Array.from({ length: 11 }, (_, index) => food(index + 1));
  const portrait = renderDashboardHtml(items, "2026/05/25 10:30", { orientation: "portrait" });
  const landscape = renderDashboardHtml(items, "2026/05/25 10:30", { orientation: "landscape" });

  assert.match(portrait, /显示最需处理的 9 项/);
  assert.match(portrait, /class="name">食材 9<\/div>/);
  assert.doesNotMatch(portrait, /class="name">食材 10<\/div>/);
  assert.match(landscape, /显示最需处理的 8 项/);
  assert.doesNotMatch(landscape, /class="name">食材 9<\/div>/);
});

test("dashboard summary shows expired and expiring counts together", () => {
  const items = [
    { ...food(1), status: "expired", daysRemaining: -1 },
    { ...food(2), status: "expiring", daysRemaining: 2 },
    food(3)
  ];
  const html = renderDashboardHtml(items, "2026/05/25 10:30", { orientation: "portrait" });

  assert.match(html, /<span class="badge red">1 项已过期<\/span>/);
  assert.match(html, /<span class="badge yellow">1 项快过期<\/span>/);
  assert.match(html, /全部食材 3 项/);
});

test("4.2-inch tri-color layouts use compact row limits and no yellow ink", () => {
  const items = Array.from({ length: 9 }, (_, index) => ({
    ...food(index + 1),
    status: index === 0 ? "expired" : index === 1 ? "expiring" : "normal"
  }));
  const portrait = renderDashboardHtml(items, "2026/05/25 10:30", { panel: "gdey042z98", orientation: "portrait" });
  const landscape = renderDashboardHtml(items, "2026/05/25 10:30", { panel: "gdey042z98", orientation: "landscape" });

  assert.match(portrait, /width=300/);
  assert.match(portrait, /显示最需处理的 7 项/);
  assert.match(portrait, /1 项已过期/);
  assert.match(portrait, /1 项快过期/);
  assert.match(portrait, /\.badge\.expiring \{ color:var\(--red\); border-color:var\(--red\); \}/);
  assert.match(portrait, /class="name">食材 7<\/div>/);
  assert.doesNotMatch(portrait, /class="name">食材 8<\/div>/);
  assert.match(landscape, /width=400/);
  assert.match(landscape, /显示最需处理的 5 项/);
  assert.doesNotMatch(landscape, /class="name">食材 6<\/div>/);
  assert.match(portrait, /红色：已过期 \/ 3 天内到期/);
  assert.doesNotMatch(portrait, /--yellow|var\(--yellow\)/);
  assert.match(portrait, /\.food\.yellow \.name, \.food\.yellow \.days \{ color:var\(--red\); font-weight:950;/);
  assert.match(portrait, /\.food\.yellow \.bar span \{ background:var\(--red\); \}/);
  assert.doesNotMatch(portrait, /\.food\.yellow \.bar \{ border-width:2px;/);
});

test("food category icons use four-color vector graphics and unknown categories fall back", () => {
  const html = renderDashboardHtml(
    [
      { ...food(1), category: "水果" },
      { ...food(2), category: "肉类" },
      { ...food(3), category: "海鲜" },
      { ...food(4), category: "饮料" },
      { ...food(5), category: "豆制品" },
      { ...food(6), category: "熟食" },
      { ...food(7), category: "调味品" },
      { ...food(8), category: "冷冻" },
      { ...food(9), category: "甜点" }
    ],
    "2026/05/25 10:30",
    { orientation: "portrait" }
  );

  assert.match(html, /data-icon="fruit"/);
  assert.match(html, /data-icon="meat"/);
  assert.match(html, /data-icon="seafood"/);
  assert.match(html, /data-icon="drink"/);
  assert.match(html, /data-icon="tofu"/);
  assert.match(html, /data-icon="cooked"/);
  assert.match(html, /data-icon="condiment"/);
  assert.match(html, /data-icon="frozen"/);
  assert.match(html, /data-icon="dessert"/);
  assert.match(renderDashboardHtml([{ ...food(1), category: "自定义" }], "2026/05/25 10:30", { orientation: "portrait" }), /data-icon="other"/);
  assert.match(html, /\.food\.red \.category-icon \.accent \{ fill:var\(--red\); \}/);
  assert.match(html, /\.food\.yellow \.category-icon \.accent \{ fill:var\(--yellow\); \}/);
  assert.doesNotMatch(html, /<img/);
});

test("progress bars visibly distinguish the next seven days and decay over longer periods", () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, daysRemaining) => progressWidth({ daysRemaining })),
    [100, 88, 76, 64, 52, 40, 28, 20]
  );
  assert.equal(progressWidth({ daysRemaining: -1 }), 100);
  assert.equal(progressWidth({ daysRemaining: 8 }), 18);
  assert.equal(progressWidth({ daysRemaining: 10 }), 14);
  assert.equal(progressWidth({ daysRemaining: 14 }), 10);
  assert.equal(progressWidth({ daysRemaining: 30 }), 8);
});

test("portrait pixels rotate into native 800x480 coordinates for drawNative", async () => {
  const pixels = Buffer.alloc(480 * 800 * 4, 255);
  pixels[0] = 16;
  pixels[1] = 16;
  pixels[2] = 16;
  pixels[3] = 255;

  const png = await sharp(pixels, { raw: { width: 480, height: 800, channels: 4 } }).png().toBuffer();
  const frame = await packNativeFourColor(png, "portrait");
  const nativeTopRightByte = Math.floor(799 / 4);

  assert.equal(frame.length, FRAME_BYTES);
  assert.equal(frame[nativeTopRightByte], 0x54);
});

test("tri-color frames pack black and red into two 15000-byte planes", async () => {
  const pixels = Buffer.alloc(400 * 300 * 4, 255);
  pixels.set([16, 16, 16, 255], 0);
  pixels.set([201, 28, 34, 255], 4);

  const png = await sharp(pixels, { raw: { width: 400, height: 300, channels: 4 } }).png().toBuffer();
  const frame = await packNativeTriColor(png, "landscape");

  assert.equal(frame.length, 30000);
  assert.equal(frame[0], 0x7F);
  assert.equal(frame[15000], 0xBF);
});

test("tri-color portrait pixels rotate into native 400x300 coordinates", async () => {
  const pixels = Buffer.alloc(300 * 400 * 4, 255);
  pixels.set([201, 28, 34, 255], 0);

  const png = await sharp(pixels, { raw: { width: 300, height: 400, channels: 4 } }).png().toBuffer();
  const frame = await packNativeTriColor(png, "portrait");

  assert.equal(frame[15000 + 49], 0xFE);
});
