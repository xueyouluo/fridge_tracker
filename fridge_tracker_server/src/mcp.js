"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { toolSpecs } = require("./foodTools");

function toolResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], structuredContent: value };
}

function toolError(error) {
  return { content: [{ type: "text", text: error.message || "tool call failed" }], isError: true };
}

function createMcpServer(foodService, user) {
  const server = new McpServer({ name: "xianzhitie", version: "1.0.0" });
  const run = (handler) => async (args) => {
    try {
      return toolResult(await handler(args));
    } catch (error) {
      return toolError(error);
    }
  };

  const handlers = {
    list_foods: (filters) => foodService.searchFoodItems(user.id, filters),
    get_foods: ({ ids }) => ({ items: foodService.getFoodItems(user.id, ids) }),
    create_foods: ({ items }) => ({ status: "executed", results: foodService.createFoodItems(user.id, items) }),
    update_foods: ({ items }) => ({ status: "executed", results: foodService.updateFoodItems(user.id, items) }),
    delete_foods: ({ ids }) => ({ status: "executed", results: foodService.deleteFoodItems(user.id, ids) })
  };
  toolSpecs.forEach(({ name, description, inputSchema, annotations }) => {
    server.registerTool(name, { description, inputSchema, annotations }, run(handlers[name]));
  });
  return server;
}

function createMcpHandler({ foodService, authenticate }) {
  return async function handleMcp(req, res) {
    const header = String(req.headers.authorization || "");
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    const user = authenticate(token);
    if (!user) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(`${JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "invalid or expired access token" }, id: null })}\n`);
      return;
    }
    const server = createMcpServer(foodService, user);
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
