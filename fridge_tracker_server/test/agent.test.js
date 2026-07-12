"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentService, toolDefinitions } = require("../src/agent");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("agent executes batch creates but stages batch deletes and consumes confirmation once", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);
  const direct = agent.executeTool(1, conversation.id, "create_foods", {
    items: [
      { name: "酸奶", expiresOn: "2026-07-20" },
      { name: "苹果", expiresOn: "2026-07-21" }
    ]
  });
  assert.equal(direct.status, "executed");
  assert.equal(direct.results[0].item.name, "酸奶");
  const pending = agent.executeTool(1, conversation.id, "delete_foods", {
    ids: direct.results.map((result) => result.item.id)
  });
  assert.equal(pending.pendingAction.summary, "删除「酸奶」、删除「苹果」");
  assert.deepEqual(pending.pendingAction.details[0], {
    operation: "delete",
    id: direct.results[0].item.id,
    name: "酸奶",
    category: "其他",
    quantityText: "",
    expiresOn: "2026-07-20"
  });
  assert.equal(pending.pendingAction.details.length, 2);
  assert.equal(foods.listFoodItems(1).length, 2);
  const confirmed = await agent.confirmAction(1, pending.pendingAction.id);
  assert.equal(confirmed.executed[0].operation, "delete");
  assert.match(confirmed.message.content, /删除「酸奶」、删除「苹果」/);
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
  const first = agent.executeTool(1, conversation.id, "delete_foods", { ids: [item.id] });
  const second = agent.executeTool(1, conversation.id, "delete_foods", { ids: [item.id] });

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

test("conversation deletion is owner scoped and cascades messages and pending actions", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(1, { name: "牛奶", expiresOn: "2026-07-20" });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1, "要删除的对话");
  const otherConversation = agent.createConversation(2, "其他用户的对话");
  const pending = agent.executeTool(1, conversation.id, "delete_foods", { ids: [item.id] });
  db.prepare(`
    INSERT INTO agent_messages (conversation_id, role, content, metadata_json, protocol, payload_json, created_at)
    VALUES (?, 'user', '测试消息', NULL, NULL, NULL, ?)
  `).run(conversation.id, new Date().toISOString());

  assert.throws(() => agent.deleteConversation(1, otherConversation.id), /conversation not found/);
  const deleted = agent.deleteConversation(1, conversation.id);
  assert.equal(deleted.title, "要删除的对话");
  assert.equal(agent.listConversations(1).length, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_messages WHERE conversation_id = ?").get(conversation.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM agent_pending_actions WHERE id = ?").get(pending.pendingAction.id).count, 0);
  assert.equal(agent.listConversations(2).length, 1);
});

test("calculated expiry creates execute after conversational confirmation", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);
  const result = agent.executeTool(1, conversation.id, "create_foods", {
    items: [{ name: "牛奶", category: "乳品", startDate: "2026-07-12", shelfLifeDays: 7 }]
  });

  assert.equal(result.status, "executed");
  assert.equal(result.results[0].item.expiresOn, "2026-07-19");
  assert.equal(foods.listFoodItems(1).length, 1);
});

test("agent cannot stage another user's food operation", () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(2, { name: "鸡蛋", expiresOn: "2026-07-20" });
  const agent = createAgentService({ db, foodService: foods });
  const conversation = agent.createConversation(1);
  assert.throws(() => agent.executeTool(1, conversation.id, "delete_foods", { ids: [item.id] }), /not found/);
});

test("agent chat tool loop executes a model-proposed single create", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  let call = 0;
  const client = { chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) {
      assert.match(request.messages[0].content, /新购语义/);
      assert.match(request.messages[0].content, /startDate 建议为今天/);
      assert.match(request.messages[0].content, /偏保守且合理的 shelfLifeDays/);
      assert.match(request.messages[0].content, /绝对不要调用 create_foods/);
      assert.match(request.messages[0].content, /只有用户明确回复确认/);
      return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "call-1", type: "function", function: { name: "create_foods", arguments: JSON.stringify({ items: [{ name: "西红柿", expiresOn: "2026-07-20" }] }) }
      }] } }] };
    }
    return { choices: [{ message: { role: "assistant", content: "已添加西红柿。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);
  const result = await agent.sendMessage(1, conversation.id, "添加西红柿");
  assert.equal(result.message.content, "已添加西红柿。");
  assert.equal(foods.listFoodItems(1)[0].name, "西红柿");
  const protocolRows = db.prepare("SELECT role, protocol, payload_json FROM agent_messages WHERE protocol IS NOT NULL ORDER BY id").all();
  assert.deepEqual(protocolRows.map((row) => [row.role, row.protocol]), [["assistant", "chat"], ["tool", "chat"]]);
  assert.equal(JSON.parse(protocolRows[0].payload_json).tool_calls[0].function.name, "create_foods");
  assert.equal(JSON.parse(protocolRows[1].payload_json).tool_call_id, "call-1");
  assert.deepEqual(agent.listMessages(1, conversation.id).map((message) => message.role), ["user", "assistant"]);
});

test("new purchases stay as editable text drafts until the user confirms", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  let call = 0;
  const client = { chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) {
      assert.equal(request.messages.at(-1).content, "刚买了一盒牛奶");
      return { choices: [{ message: { role: "assistant", content: "建议：牛奶，乳品，1 盒，购买日 2026-07-12，保鲜 7 天，到期日 2026-07-19。确认吗？" } }] };
    }
    if (call === 2) {
      assert.equal(request.messages.at(-1).content, "改成保鲜 5 天");
      return { choices: [{ message: { role: "assistant", content: "已修改：牛奶，乳品，1 盒，购买日 2026-07-12，保鲜 5 天，到期日 2026-07-17。确认吗？" } }] };
    }
    if (call === 3) {
      assert.equal(request.messages.at(-1).content, "确认");
      return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "confirm-create-1",
        type: "function",
        function: {
          name: "create_foods",
          arguments: JSON.stringify({ items: [{ name: "牛奶", category: "乳品", quantityText: "1 盒", startDate: "2026-07-12", shelfLifeDays: 5 }] })
        }
      }] } }] };
    }
    assert.equal(request.messages.at(-1).role, "tool");
    assert.match(request.messages.at(-1).content, /"status":"executed"/);
    return { choices: [{ message: { role: "assistant", content: "已添加牛奶。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);

  const draft = await agent.sendMessage(1, conversation.id, "刚买了一盒牛奶");
  assert.match(draft.message.content, /保鲜 7 天/);
  assert.equal(foods.listFoodItems(1).length, 0);

  const revised = await agent.sendMessage(1, conversation.id, "改成保鲜 5 天");
  assert.match(revised.message.content, /保鲜 5 天/);
  assert.equal(foods.listFoodItems(1).length, 0);

  const confirmed = await agent.sendMessage(1, conversation.id, "确认");
  assert.equal(confirmed.message.content, "已添加牛奶。");
  assert.equal(foods.listFoodItems(1)[0].expiresOn, "2026-07-17");
});

test("recent chat history drops leading fragments so the first history message is user", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const client = { chat: { completions: { create: async (request) => {
    assert.equal(request.messages[0].role, "system");
    assert.equal(request.messages[1].role, "user");
    assert.equal(request.messages[1].content, "保留的用户消息");
    assert.equal(request.messages.some((message) => message.role === "tool"), false);
    assert.equal(request.messages.some((message) => Array.isArray(message.tool_calls)), false);
    return { choices: [{ message: { role: "assistant", content: "历史顺序正常。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test", baseURL: "https://compatible.example/v1" });
  const conversation = agent.createConversation(1);
  const insert = db.prepare(`
    INSERT INTO agent_messages (conversation_id, role, content, metadata_json, protocol, payload_json, created_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?)
  `);
  for (let index = 0; index < 45; index += 1) {
    const role = index === 10 || index === 30 ? "user" : "assistant";
    const content = index === 10 ? "保留的用户消息" : `${role}-${index}`;
    insert.run(conversation.id, role, content, new Date(2026, 6, 12, 0, 0, index).toISOString());
  }
  const insertProtocol = db.prepare(`
    INSERT INTO agent_messages (conversation_id, role, content, metadata_json, protocol, payload_json, created_at)
    VALUES (?, ?, '', NULL, 'chat', ?, ?)
  `);
  insertProtocol.run(conversation.id, "assistant", JSON.stringify({
    role: "assistant",
    content: null,
    tool_calls: [{ id: "unfinished-call", type: "function", function: { name: "list_foods", arguments: "{}" } }]
  }), new Date(2026, 6, 12, 0, 1, 0).toISOString());
  insertProtocol.run(conversation.id, "tool", JSON.stringify({
    role: "tool",
    tool_call_id: "orphan-result",
    content: "{}"
  }), new Date(2026, 6, 12, 0, 1, 1).toISOString());

  const result = await agent.sendMessage(1, conversation.id, "继续");
  assert.equal(result.message.content, "历史顺序正常。");
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

test("agent exposes shared batch CRUD schemas and partial update rules", () => {
  assert.deepEqual(toolDefinitions.map((tool) => tool.name), ["list_foods", "get_foods", "create_foods", "update_foods", "delete_foods"]);
  const create = toolDefinitions.find((tool) => tool.name === "create_foods");
  const update = toolDefinitions.find((tool) => tool.name === "update_foods");
  const remove = toolDefinitions.find((tool) => tool.name === "delete_foods");
  assert.equal(create.parameters.properties.items.minItems, 1);
  assert.equal(create.parameters.properties.items.maxItems, 25);
  assert.match(create.description, /同一事务/);
  assert.match(update.description, /patch 表示这一项要修改的字段/);
  assert.match(update.description, /省略的字段保持原值/);
  assert.match(update.description, /expiresOn":null/);
  assert.match(update.description, /任何一项无效时全部不修改/);
  const updateItem = update.parameters.properties.items.items;
  assert.match(updateItem.properties.id.description, /不要放进 patch/);
  assert.match(updateItem.properties.patch.description, /部分更新对象/);
  assert.equal(remove.parameters.properties.ids.maxItems, 25);
});

test("agent pauses at system confirmation and resumes with a tool-free reply", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(1, { name: "牛奶", category: "乳品", expiresOn: "2026-07-12" });
  let call = 0;
  const client = { chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "delete-1", type: "function", function: { name: "delete_foods", arguments: JSON.stringify({ ids: [item.id] }) }
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

test("agent uses Chat Completions and role tool for the default OpenAI runtime", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const item = foods.createFoodItem(1, { name: "苹果", category: "水果", expiresOn: "2026-07-10" });
  let call = 0;
  const client = {
    chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "delete-chat-default-1",
      type: "function",
      function: { name: "delete_foods", arguments: JSON.stringify({ ids: [item.id] }) }
    }] } }] };
    assert.equal(request.tool_choice, "none");
    assert.equal(request.messages.at(-1).role, "tool");
    assert.equal(request.messages.at(-1).tool_call_id, "delete-chat-default-1");
    assert.match(request.messages.at(-1).content, /"status":"executed"/);
    assert.match(request.messages.at(-1).content, /"name":"苹果"/);
    return { choices: [{ message: { role: "assistant", content: "苹果已删除。" } }] };
  } } } };
  const agent = createAgentService({ db, foodService: foods, client, model: "test" });
  const conversation = agent.createConversation(1);

  const staged = await agent.sendMessage(1, conversation.id, "删除过期苹果");
  const confirmed = await agent.confirmAction(1, staged.events[0].pendingAction.id);

  assert.equal(call, 2);
  assert.equal(confirmed.message.content, "苹果已删除。");
  assert.equal(confirmed.message.metadata.toolResultReturned, true);
  assert.equal(foods.listFoodItems(1).length, 0);
  const protocolRows = db.prepare("SELECT role, protocol, payload_json FROM agent_messages WHERE protocol IS NOT NULL ORDER BY id").all();
  assert.deepEqual(protocolRows.map((row) => row.protocol), ["chat", "chat"]);
  assert.equal(JSON.parse(protocolRows[1].payload_json).tool_call_id, "delete-chat-default-1");
});

test("agent returns food lookup failures as tool output", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  let call = 0;
  const client = { chat: { completions: { create: async (request) => {
    call += 1;
    if (call === 1) return { choices: [{ message: { role: "assistant", content: null, tool_calls: [{
      id: "missing-1", type: "function", function: { name: "delete_foods", arguments: JSON.stringify({ ids: [999] }) }
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
