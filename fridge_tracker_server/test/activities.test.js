"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createActivityService } = require("../src/activities");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("household activities are scoped, ordered and include the actor", () => {
  const db = createTestDatabase();
  const activities = createActivityService({ db });
  activities.record({
    householdId: 1,
    actorUserId: 1,
    type: "household_invite_created",
    title: "创建了家庭邀请",
    detail: "邀请链接将在 24 小时后失效"
  });
  activities.record({
    householdId: 2,
    actorUserId: 2,
    type: "household_invite_created",
    title: "创建了家庭邀请"
  });

  const result = activities.list(1, { limit: 10 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].actor.displayName, "One");
  assert.equal(result.items[0].detail, "邀请链接将在 24 小时后失效");
  assert.equal(result.hasMore, false);
});

test("food writes create actor-aware activity entries from every source", () => {
  const db = createTestDatabase();
  const activities = createActivityService({ db });
  const foods = createFoodService({ db, onActivity: (...args) => activities.recordFood(...args) });
  const milk = foods.createFoodItem(1, { name: "牛奶", quantityText: "1 盒", expiresOn: "2026-07-20" }, { actorUserId: 1, source: "web" });
  foods.updateFoodItem(1, milk.id, { quantityText: "2 盒" }, { actorUserId: 1, source: "agent" });
  foods.deleteFoodItem(1, milk.id, { actorUserId: 1, source: "mcp" });

  const result = activities.list(1, { limit: 2 });
  assert.deepEqual(result.items.map((item) => item.type), ["food_deleted", "food_updated"]);
  assert.deepEqual(result.items.map((item) => item.metadata.source), ["mcp", "agent"]);
  assert.equal(result.items[0].detail, "牛奶 · 2 盒 · 到期 2026-07-20");
  assert.equal(result.hasMore, true);
  assert.deepEqual(activities.list(2).items, []);
});

test("activity pagination uses a stable descending id cursor", () => {
  const db = createTestDatabase();
  const activities = createActivityService({ db });
  for (let index = 1; index <= 3; index += 1) {
    activities.record({
      householdId: 1,
      actorUserId: 1,
      type: "food_created",
      title: "添加了物品",
      detail: `食材 ${index}`
    });
  }
  const first = activities.list(1, { limit: 2 });
  const second = activities.list(1, { limit: 2, beforeId: first.items.at(-1).id });
  assert.deepEqual(first.items.map((item) => item.detail), ["食材 3", "食材 2"]);
  assert.deepEqual(second.items.map((item) => item.detail), ["食材 1"]);
  assert.equal(second.hasMore, false);
});
