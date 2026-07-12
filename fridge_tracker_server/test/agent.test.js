"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentService, toolDefinitions } = require("../src/agent");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("agent executes one safe write but stages deletes and consumes confirmation once", async () => {
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
  assert.equal(pending.pendingAction.summary, "删除「酸奶」");
  assert.deepEqual(pending.pendingAction.details[0], {
    operation: "delete",
    id: direct.executed[0].item.id,
    name: "酸奶",
    category: "其他",
    quantityText: "",
    expiresOn: "2026-07-20"
  });
  assert.equal(foods.listFoodItems(1).length, 1);
  const confirmed = await agent.confirmAction(1, pending.pendingAction.id);
  assert.equal(confirmed.executed[0].operation, "delete");
  assert.match(confirmed.message.content, /删除「酸奶」/);
  assert.equal(foods.listFoodItems(1).length, 0);
  const repeated = await agent.confirmAction(1, pending.pendingAction.id);
  assert.equal(repeated.alreadyResolved, true);
  assert.equal(repeated.resolution, "confirmed");
  assert.equal(repeated.message.content, confirmed.message.content);
  assert.equal(foods.listFoodItems(1).length, 0);
});

test("identical unresolved deletes reuse one pending action", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(1, { name: "牛奶", category: "乳品", quantityText: "1 瓶", expiresOn: "2026-07-12" });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);
  const first = agent.executeTool(1, conversation.id, "propose_food_changes", { actions: [{ operation: "delete", id: item.id }] });
  const second = agent.executeTool(1, conversation.id, "propose_food_changes", { actions: [{ operation: "delete", id: item.id }] });

  assert.equal(second.pendingAction.id, first.pendingAction.id);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_pending_actions").get().count, 1);
  assert.deepEqual(first.pendingAction.details[0], {
    operation: "delete",
    id: item.id,
    name: "牛奶",
    category: "乳品",
    quantityText: "1 瓶",
    expiresOn: "2026-07-12"
  });
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

test("agent list_foods exposes filters and returns a paginated subset", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  foods.createFoodItem(1, { name: "牛奶", category: "乳品", expiresOn: "2026-07-12" });
  foods.createFoodItem(1, { name: "苹果", category: "水果", expiresOn: "2026-07-20" });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);

  const result = agent.executeTool(1, conversation.id, "list_foods", { category: "乳品", limit: 1 });
  assert.equal(result.total, 1);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.items.map((item) => item.name), ["牛奶"]);
  const schema = toolDefinitions.find((tool) => tool.name === "list_foods").parameters.properties;
  assert.deepEqual(Object.keys(schema), ["keyword", "category", "status", "expiresFrom", "expiresTo", "limit", "offset"]);
});

test("propose_food_changes describes each operation and partial update rules", () => {
  const description = toolDefinitions.find((tool) => tool.name === "propose_food_changes").description;
  assert.match(description, /create 使用/);
  assert.match(description, /expiresOn/);
  assert.match(description, /update 使用/);
  assert.match(description, /patch 只填写需要修改的字段/);
  assert.match(description, /delete 使用/);
  assert.match(description, /系统创建确认操作/);
});

test("agent pauses at system confirmation and resumes with a tool-free reply", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(1, { name: "牛奶", category: "乳品", expiresOn: "2026-07-12" });
  let call = 0;
  const client = { chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "delete-1", type: "function", function: { name: "propose_food_changes", arguments: JSON.stringify({ actions: [{ operation: "delete", id: item.id }] }) }
    }] } }] };
    assert.equal(request.tool_choice, "none");
    assert.equal(request.messages.at(-2).tool_calls[0].id, "delete-1");
    assert.equal(request.messages.at(-1).role, "tool");
    assert.equal(request.messages.at(-1).tool_call_id, "delete-1");
    assert.match(request.messages.at(-1).content, /"status":"executed"/);
    assert.match(request.messages.at(-1).content, /"operation":"delete"/);
    assert.match(request.messages.at(-1).content, /"name":"牛奶"/);
    return { choices: [{ message: { role: "assistant", content: "牛奶已删除。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);

  const staged = await agent.sendMessage(1, conversation.id, "删除牛奶");
  assert.equal(staged.message.content, "");
  assert.equal(staged.events[0].pendingAction.summary, "删除「牛奶」");
  assert.equal(call, 1);
  assert.equal(foods.listFoodItems(1).length, 1);

  const confirmed = await agent.confirmAction(1, staged.events[0].pendingAction.id);
  assert.equal(call, 2);
  assert.equal(confirmed.message.content, "牛奶已删除。");
  assert.equal(confirmed.message.metadata.toolResultReturned, true);
  assert.equal(foods.listFoodItems(1).length, 0);
  const messages = agent.listMessages(1, conversation.id);
  const pendingEvent = messages.find((message) => message.metadata?.events?.[0]?.pendingAction)?.metadata.events[0].pendingAction;
  assert.equal(pendingEvent.resolution, "confirmed");
});

test("agent resumes a confirmed Responses tool call with function_call_output", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(1, { name: "苹果", category: "水果", expiresOn: "2026-07-10" });
  let call = 0;
  const modelOutput = [
    { id: "reasoning-1", type: "reasoning", summary: [] },
    { id: "function-1", type: "function_call", call_id: "delete-response-1", name: "propose_food_changes", arguments: JSON.stringify({ actions: [{ operation: "delete", id: item.id }] }) }
  ];
  const client = { responses: { create: async (request) => {
    call += 1;
    if (call === 1) return { output: modelOutput, output_text: "" };
    assert.equal(request.tool_choice, "none");
    assert.deepEqual(request.input.slice(-3, -1), modelOutput);
    assert.equal(request.input.at(-1).type, "function_call_output");
    assert.equal(request.input.at(-1).call_id, "delete-response-1");
    assert.match(request.input.at(-1).output, /"status":"executed"/);
    assert.match(request.input.at(-1).output, /"name":"苹果"/);
    return { output: [{ type: "message" }], output_text: "苹果已删除。" };
  } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test" });
  const conversation = agent.createConversation(1);

  const staged = await agent.sendMessage(1, conversation.id, "删除过期苹果");
  const confirmed = await agent.confirmAction(1, staged.events[0].pendingAction.id);

  assert.equal(call, 2);
  assert.equal(confirmed.message.content, "苹果已删除。");
  assert.equal(confirmed.message.metadata.toolResultReturned, true);
  assert.equal(foods.listFoodItems(1).length, 0);
});

test("agent returns food lookup failures as tool output", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  let call = 0;
  const client = { chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "missing-1", type: "function", function: { name: "propose_food_changes", arguments: JSON.stringify({ actions: [{ operation: "delete", id: 999 }] }) }
    }] } }] };
    assert.equal(request.messages.at(-1).role, "tool");
    assert.equal(request.messages.at(-1).tool_call_id, "missing-1");
    assert.deepEqual(JSON.parse(request.messages.at(-1).content), {
      status: "error",
      error: "not_found",
      message: "food item not found"
    });
    return { choices: [{ message: { role: "assistant", content: "该食材已经不存在。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);

  const result = await agent.sendMessage(1, conversation.id, "继续删除 999");

  assert.equal(call, 2);
  assert.equal(result.message.content, "该食材已经不存在。");
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
