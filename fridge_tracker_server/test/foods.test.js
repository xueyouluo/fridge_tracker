"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { addDays, localDateKey } = require("../src/domain");
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
  const today = localDateKey("Asia/Shanghai");
  foods.createFoodItem(1, { name: "低温牛奶", category: "乳品", quantityText: "1 盒", expiresOn: addDays(today, -2) });
  foods.createFoodItem(1, { name: "酸奶", category: "乳品", quantityText: "2 杯", expiresOn: addDays(today, 1) });
  foods.createFoodItem(1, { name: "苹果", category: "水果", quantityText: "3 个", expiresOn: addDays(today, 7) });

  assert.deepEqual(foods.searchFoodItems(1, { keyword: "奶" }).items.map((item) => item.name), ["低温牛奶", "酸奶"]);
  assert.deepEqual(foods.searchFoodItems(1, { category: "水果" }).items.map((item) => item.name), ["苹果"]);
  assert.deepEqual(foods.searchFoodItems(1, { status: "expired" }).items.map((item) => item.name), ["低温牛奶"]);
  assert.deepEqual(foods.searchFoodItems(1, { expiresFrom: today, expiresTo: addDays(today, 3) }).items.map((item) => item.name), ["酸奶"]);
  assert.deepEqual(foods.searchFoodItems(1, { limit: 1, offset: 1 }), {
    items: [foods.getFoodItem(1, 2)], total: 3, offset: 1, limit: 1, hasMore: true
  });
  assert.throws(() => foods.searchFoodItems(1, { expiresFrom: addDays(today, 1), expiresTo: today }), /must not be after/);
});

test("batch food CRUD validates the whole batch before an atomic write", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const created = foods.createFoodItems(1, [
    { name: "牛奶", expiresOn: "2026-07-20" },
    { name: "苹果", expiresOn: "2026-07-21" }
  ]);
  assert.deepEqual(created.map((result) => result.item.name), ["牛奶", "苹果"]);
  const ids = created.map((result) => result.item.id);
  const updated = foods.updateFoodItems(1, ids.map((id, index) => ({ id, patch: { quantityText: `${index + 1} 份` } })));
  assert.deepEqual(updated.map((result) => result.item.quantityText), ["1 份", "2 份"]);

  assert.throws(() => foods.updateFoodItems(1, [
    { id: ids[0], patch: { name: "不应保存" } },
    { id: 999, patch: { name: "不存在" } }
  ]), /not found/);
  assert.equal(foods.getFoodItem(1, ids[0]).name, "牛奶");

  const removed = foods.deleteFoodItems(1, ids);
  assert.equal(removed.length, 2);
  assert.deepEqual(foods.listFoodItems(1), []);
});
