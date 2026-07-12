"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("shared food service scopes CRUD to the owner and invalidates on writes", () => {
  const db = createTestDatabase();
  let changes = 0;
  const foods = createFoodService({ db, timezone: "Asia/Shanghai", onChange: () => { changes += 1; } });
  const milk = foods.createFoodItem(1, { name: "牛奶", expiresOn: "2026-07-20" });
  assert.equal(milk.name, "牛奶");
  assert.equal(foods.listFoodItems(2).length, 0);
  assert.throws(() => foods.getFoodItem(2, milk.id), /not found/);
  assert.equal(foods.updateFoodItem(1, milk.id, { quantityText: "2 瓶" }).quantityText, "2 瓶");
  assert.equal(foods.deleteFoodItem(1, milk.id).id, milk.id);
  assert.equal(changes, 3);
});

test("food action batches validate before an atomic write", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  assert.throws(() => foods.applyActions(1, [
    { operation: "create", input: { name: "苹果", expiresOn: "2026-07-20" } },
    { operation: "delete", id: 999 }
  ]), /not found/);
  assert.equal(foods.listFoodItems(1).length, 0);
});

test("food search filters by keyword, category, status and expiration range with pagination", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db, timezone: "Asia/Shanghai" });
  foods.createFoodItem(1, { name: "低温牛奶", category: "乳品", quantityText: "1 盒", expiresOn: "2026-07-08" });
  foods.createFoodItem(1, { name: "酸奶", category: "乳品", quantityText: "2 杯", expiresOn: "2026-07-13" });
  foods.createFoodItem(1, { name: "苹果", category: "水果", quantityText: "3 个", expiresOn: "2026-07-20" });

  assert.deepEqual(foods.searchFoodItems(1, { keyword: "奶" }).items.map((item) => item.name), ["低温牛奶", "酸奶"]);
  assert.deepEqual(foods.searchFoodItems(1, { category: "水果" }).items.map((item) => item.name), ["苹果"]);
  assert.deepEqual(foods.searchFoodItems(1, { status: "expired" }).items.map((item) => item.name), ["低温牛奶"]);
  assert.deepEqual(foods.searchFoodItems(1, { expiresFrom: "2026-07-10", expiresTo: "2026-07-15" }).items.map((item) => item.name), ["酸奶"]);
  assert.deepEqual(foods.searchFoodItems(1, { limit: 1, offset: 1 }), {
    items: [foods.getFoodItem(1, 2)], total: 3, offset: 1, limit: 1, hasMore: true
  });
  assert.throws(() => foods.searchFoodItems(1, { expiresFrom: "2026-07-20", expiresTo: "2026-07-10" }), /must not be after/);
});
