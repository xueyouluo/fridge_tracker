"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PNG } = require("pngjs");
const { FRAME_BYTES } = require("../src/domain");
const { packNativeFourColor, progressWidth, renderDashboardHtml } = require("../src/renderer");

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

test("portrait pixels rotate into native 800x480 coordinates for drawNative", () => {
  const png = new PNG({ width: 480, height: 800 });
  png.data.fill(255);
  png.data[0] = 16;
  png.data[1] = 16;
  png.data[2] = 16;
  png.data[3] = 255;

  const frame = packNativeFourColor(PNG.sync.write(png), "portrait");
  const nativeTopRightByte = Math.floor(799 / 4);

  assert.equal(frame.length, FRAME_BYTES);
  assert.equal(frame[nativeTopRightByte], 0x54);
});
