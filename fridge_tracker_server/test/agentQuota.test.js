"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAgentService } = require("../src/agent");
const { createAgentQuotaService, DEFAULT_AGENT_INPUT_QUOTA, grantHistoricalAgentQuota } = require("../src/agentQuota");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("new accounts start with 100 Agent inputs and administrators can change the total limit", () => {
  const db = createTestDatabase();
  const quotas = createAgentQuotaService(db);

  assert.deepEqual(quotas.getQuota(1), { limit: DEFAULT_AGENT_INPUT_QUOTA, used: 0, remaining: 100 });
  assert.deepEqual(quotas.setQuota(1, 2), { limit: 2, used: 0, remaining: 2 });
  assert.deepEqual(quotas.consumeInput(1), { limit: 2, used: 1, remaining: 1 });
  assert.deepEqual(quotas.consumeInput(1), { limit: 2, used: 2, remaining: 0 });
  assert.throws(() => quotas.consumeInput(1), (error) => error.statusCode === 429 && error.code === "agent_quota_exhausted");
  assert.deepEqual(quotas.setQuota(1, 5), { limit: 5, used: 2, remaining: 3 });
  assert.throws(() => quotas.setQuota(1, -1), /between 0 and 1000000/);
  assert.throws(() => quotas.setQuota(1, null), /between 0 and 1000000/);
});

test("historical accounts receive at least 100 remaining inputs exactly once", () => {
  const db = createTestDatabase();
  db.prepare("UPDATE users SET agent_input_quota = 50, agent_input_used = 20 WHERE id = 1").run();
  db.prepare("UPDATE users SET agent_input_quota = 500, agent_input_used = 10 WHERE id = 2").run();

  assert.equal(grantHistoricalAgentQuota(db), true);
  assert.deepEqual({ ...db.prepare("SELECT agent_input_quota, agent_input_used FROM users WHERE id = 1").get() }, {
    agent_input_quota: 120,
    agent_input_used: 20
  });
  assert.equal(db.prepare("SELECT agent_input_quota FROM users WHERE id = 2").get().agent_input_quota, 500);
  assert.equal(grantHistoricalAgentQuota(db), false);
});

test("one accepted user message consumes one input and exhausted requests never reach the model", async () => {
  const db = createTestDatabase();
  const quotas = createAgentQuotaService(db);
  quotas.setQuota(1, 1);
  let modelCalls = 0;
  const client = { chat: { completions: { create: async () => {
    modelCalls += 1;
    return { choices: [{ message: { role: "assistant", content: "已收到。" } }] };
  } } } };
  const agent = createAgentService({
    db,
    foodService: createFoodService({ db }),
    client,
    model: "test",
    consumeInput: quotas.consumeInput,
    getQuota: quotas.getQuota
  });
  const conversation = agent.createConversation(1);

  const first = await agent.sendMessage(1, conversation.id, "第一条");
  assert.deepEqual(first.quota, { limit: 1, used: 1, remaining: 0 });
  await assert.rejects(() => agent.sendMessage(1, conversation.id, "第二条"), (error) => error.statusCode === 429);
  assert.equal(modelCalls, 1);
});

test("a personal API key bypasses system input quota consumption", async () => {
  const db = createTestDatabase();
  const quotas = createAgentQuotaService(db);
  quotas.setQuota(1, 0);
  const client = { chat: { completions: { create: async () => ({
    choices: [{ message: { role: "assistant", content: "个人配置回复。" } }]
  }) } } };
  const agent = createAgentService({
    db,
    foodService: createFoodService({ db }),
    resolveRuntime: () => ({ client, model: "personal-model", mode: "personal" }),
    consumeInput: quotas.consumeInput,
    getQuota: quotas.getQuota
  });
  const conversation = agent.createConversation(1);

  const result = await agent.sendMessage(1, conversation.id, "使用我的 Key");
  assert.equal(result.mode, "personal");
  assert.deepEqual(result.quota, { limit: 0, used: 0, remaining: 0 });
});
