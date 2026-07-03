"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_DISPLAY_ORIENTATION,
  FRAME_BYTES,
  addDays,
  decorateFood,
  displayOrientation,
  maxDisplayRows,
  normalizeFoodInput,
  sortFoods
} = require("../src/domain");

test("four-color native frame size matches the two supported 800x480 panels", () => {
  assert.equal(FRAME_BYTES, 96000);
});

test("portrait is the default display orientation and increases visible rows", () => {
  assert.equal(DEFAULT_DISPLAY_ORIENTATION, "portrait");
  assert.equal(displayOrientation(), "portrait");
  assert.equal(maxDisplayRows("portrait"), 9);
  assert.equal(maxDisplayRows("landscape"), 8);
  assert.throws(() => displayOrientation("upside-down"), /unsupported display orientation/);
});

test("food input accepts direct expiry dates and calculated expiry dates", () => {
  assert.equal(normalizeFoodInput({ name: "牛奶", expiresOn: "2026-05-29" }).expiresOn, "2026-05-29");
  assert.deepEqual(
    normalizeFoodInput({ name: "生菜", startDate: "2026-05-24", shelfLifeDays: 3 }),
    {
      name: "生菜",
      category: "其他",
      quantityText: "",
      startDate: "2026-05-24",
      shelfLifeDays: 3,
      expiresOn: "2026-05-27"
    }
  );
  assert.equal(addDays("2026-05-31", 1), "2026-06-01");
});

test("food states honor the expired and three-day warning boundaries", () => {
  const row = (expires_on) => ({
    id: 1,
    name: "测试",
    category: "其他",
    quantity_text: "",
    start_date: null,
    shelf_life_days: null,
    expires_on,
    created_at: "2026-05-20T00:00:00.000Z",
    updated_at: "2026-05-20T00:00:00.000Z"
  });
  assert.equal(decorateFood(row("2026-05-23"), "2026-05-24").status, "expired");
  assert.equal(decorateFood(row("2026-05-24"), "2026-05-24").status, "expiring");
  assert.equal(decorateFood(row("2026-05-27"), "2026-05-24").status, "expiring");
  assert.equal(decorateFood(row("2026-05-28"), "2026-05-24").status, "normal");
});

test("screen ordering prioritizes expired items then nearest expiry", () => {
  const items = [
    { id: 3, status: "normal", expiresOn: "2026-06-02", updatedAt: "2026-05-24T01:00:00Z" },
    { id: 2, status: "expiring", expiresOn: "2026-05-26", updatedAt: "2026-05-24T01:00:00Z" },
    { id: 1, status: "expired", expiresOn: "2026-05-22", updatedAt: "2026-05-24T01:00:00Z" }
  ];
  assert.deepEqual(sortFoods(items).map((item) => item.id), [1, 2, 3]);
});
