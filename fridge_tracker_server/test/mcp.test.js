"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createMcpServer } = require("../src/mcp");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("MCP exposes scoped batch food CRUD tools", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const server = createMcpServer(foods, { id: 2 }, () => 1);
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  assert.match(client.getInstructions(), /管理当前账号所属家庭的有效期物品/);
  assert.match(client.getInstructions(), /健康相关物品没有明确到期信息时必须追问/);
  assert.match(client.getInstructions(), /绝不臆造 ID/);
  assert.match(client.getInstructions(), /不管理用户账号、模型配置或墨水屏设备/);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_foods", "get_foods", "create_foods", "update_foods", "delete_foods"]);
  const created = await client.callTool({
    name: "create_foods",
    arguments: { items: [{ name: "豆腐", location: "冰箱冷藏层", expiresOn: "2026-07-20" }, { name: "牛奶", category: "乳品", location: "冰箱冷藏层", expiresOn: "2026-07-21" }] }
  });
  assert.equal(created.isError, undefined);
  assert.equal(created.structuredContent.status, "executed");
  assert.equal(created.structuredContent.results.length, 2);
  const listed = await client.callTool({ name: "list_foods", arguments: {} });
  assert.match(listed.content[0].text, /豆腐/);
  assert.equal(listed.structuredContent.items[0].location, "冰箱冷藏层");
  const byLocation = await client.callTool({ name: "list_foods", arguments: { location: "冰箱冷藏层" } });
  assert.equal(byLocation.structuredContent.total, 2);
  const ids = listed.structuredContent.items.map((item) => item.id);
  const fetched = await client.callTool({ name: "get_foods", arguments: { ids } });
  assert.equal(fetched.structuredContent.items.length, 2);
  const updated = await client.callTool({
    name: "update_foods",
    arguments: { items: [{ id: ids[0], patch: { quantityText: "2 盒" } }, { id: ids[1], patch: { quantityText: "1 瓶" } }] }
  });
  assert.equal(updated.structuredContent.results.length, 2);
  const filtered = await client.callTool({ name: "list_foods", arguments: { keyword: "不存在" } });
  assert.equal(filtered.structuredContent.total, 0);
  assert.deepEqual(filtered.structuredContent.items, []);
  const removed = await client.callTool({ name: "delete_foods", arguments: { ids } });
  assert.equal(removed.structuredContent.results.length, 2);
  await client.close();
  await server.close();
});
