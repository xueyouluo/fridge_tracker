"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { createMcpServer } = require("../src/mcp");
const { createFoodService } = require("../src/foods");
const { createTestDatabase } = require("./helpers");

test("MCP exposes scoped food CRUD tools", async () => {
  const db = createTestDatabase();
  const foods = createFoodService({ db });
  const server = createMcpServer(foods, { id: 1 });
  const client = new Client({ name: "test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name), ["list_foods", "get_food", "create_food", "update_food", "delete_food"]);
  const created = await client.callTool({ name: "create_food", arguments: { name: "豆腐", expiresOn: "2026-07-20" } });
  assert.equal(created.isError, undefined);
  const listed = await client.callTool({ name: "list_foods", arguments: {} });
  assert.match(listed.content[0].text, /豆腐/);
  const filtered = await client.callTool({ name: "list_foods", arguments: { keyword: "不存在" } });
  assert.equal(filtered.structuredContent.total, 0);
  assert.deepEqual(filtered.structuredContent.items, []);
  await client.close();
  await server.close();
});
