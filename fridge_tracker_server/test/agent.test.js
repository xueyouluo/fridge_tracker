"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentService } = require("../src/agent");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("agent executes one safe write but stages deletes and consumes confirmation once", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);
  const direct = agent.executeTool(1, conversation.id, "propose_food_changes", {
    actions: [{ operation: "create", input: { name: "酸奶", expiresOn: "2026-07-20" } }]
  });
  assert.equal(direct.executed[0].item.name, "酸奶");
  const pending = agent.executeTool(1, conversation.id, "propose_food_changes", {
    actions: [{ operation: "delete", id: direct.executed[0].item.id }]
  });
  assert.equal(foods.listFoodItems(1).length, 1);
  const confirmed = agent.confirmAction(1, pending.pendingAction.id);
  assert.equal(confirmed.executed[0].operation, "delete");
  assert.equal(foods.listFoodItems(1).length, 0);
  assert.throws(() => agent.confirmAction(1, pending.pendingAction.id), /already/);
});

test("agent cannot stage another user's food operation", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(2, { name: "鸡蛋", expiresOn: "2026-07-20" });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);
  assert.throws(() => agent.executeTool(1, conversation.id, "propose_food_changes", {
    actions: [{ operation: "delete", id: item.id }]
  }), /not found/);
});

test("agent chat tool loop executes a model-proposed single create", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  let call = 0;
  const client = { chat: { completions: { create: async () => {
    call += 1;
    if (call === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "call-1", type: "function", function: { name: "propose_food_changes", arguments: JSON.stringify({ actions: [{ operation: "create", input: { name: "西红柿", expiresOn: "2026-07-20" } }] }) }
    }] } }] };
    return { choices: [{ message: { role: "assistant", content: "已添加西红柿。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);
  const result = await agent.sendMessage(1, conversation.id, "添加西红柿");
  assert.equal(result.message.content, "已添加西红柿。");
  assert.equal(foods.listFoodItems(1)[0].name, "西红柿");
});

test("agent model failures do not write food changes", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const client = { chat: { completions: { create: async () => { throw new Error("model timeout"); } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);
  await assert.rejects(() => agent.sendMessage(1, conversation.id, "添加牛奶"), /model timeout/);
  assert.equal(foods.listFoodItems(1).length, 0);
});
