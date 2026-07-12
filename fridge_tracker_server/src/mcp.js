"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { toolSpecs } = require("./foodTools");

const MCP_INSTRUCTIONS = [
  "鲜知贴用于管理当前账号所属家庭的冰箱食材和保鲜期限，帮助查询库存、临期与过期食材，并维护食材名称、品类、数量、购买或生产日期、保鲜天数和到期日。",
  "所有工具都只访问令牌所属账号当前家庭的数据。根据用户的明确意图执行新增、修改或删除；信息不足时先询问，不要自行猜测食材信息。",
  "修改和删除前先通过 list_foods 或 get_foods 获取准确 ID，绝不臆造 ID。delete_foods 是永久删除操作，调用前必须确认用户确实要求删除。",
  "本 MCP 不管理用户账号、模型配置或墨水屏设备。"
].join("\n");

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function toolError(error) {
  return { content: [{ type: "text", text: error.message || "tool call failed" }], isError: true };
}

function createMcpServer(foodService, user, resolveHouseholdId = (userId) => userId) {
  const server = new McpServer(
    { name: "xianzhitie", version: "1.0.0" },
    { instructions: MCP_INSTRUCTIONS }
  );
  const run = (handler) => async (args) => {
    try {
      return toolResult(await handler(args));
    } catch (error) {
      return toolError(error);
    }
  };

  const householdId = resolveHouseholdId(user.id);
  const handlers = {
    list_foods: (filters) => foodService.searchFoodItems(householdId, filters),
    get_foods: ({ ids }) => ({ items: foodService.getFoodItems(householdId, ids) }),
    create_foods: ({ items }) => ({ status: "executed", results: foodService.createFoodItems(householdId, items) }),
    update_foods: ({ items }) => ({ status: "executed", results: foodService.updateFoodItems(householdId, items) }),
    delete_foods: ({ ids }) => ({ status: "executed", results: foodService.deleteFoodItems(householdId, ids) })
  };
  toolSpecs.forEach(({ name, description, inputSchema, annotations }) => {
    server.registerTool(name, { description, inputSchema, annotations }, run(handlers[name]));
  });
  return server;
}

function createMcpHandler({ foodService, authenticate, resolveHouseholdId }) {
  return async function handleMcp(req, res) {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = authenticate(token);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(`${JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "invalid or expired access token" }, id: null })}\n`);
      return;
    }
    const server = createMcpServer(foodService, user, resolveHouseholdId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } finally {
      await transport.close();
      await server.close();
    }
  };
}

module.exports = { createMcpHandler, createMcpServer };
