"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const z = require("zod/v4");

const foodInputSchema = {
  name: z.string().min(1).max(40).describe("Food name"),
  category: z.string().max(20).optional().describe("Food category; defaults to 其他"),
  quantityText: z.string().max(30).optional().describe("Human-readable quantity, for example 1 盒"),
  startDate: z.string().nullable().optional().describe("Purchase or production date in YYYY-MM-DD"),
  shelfLifeDays: z.number().int().min(0).max(3650).nullable().optional(),
  expiresOn: z.string().nullable().optional().describe("Expiration date in YYYY-MM-DD; required unless startDate and shelfLifeDays are supplied. Set null on update to recalculate from startDate and shelfLifeDays")
};

const foodListSchema = {
  keyword: z.string().max(100).optional().describe("Fuzzy match against name, category, or quantity"),
  category: z.string().max(20).optional().describe("Exact category match"),
  status: z.enum(["expired", "expiring", "normal"]).optional(),
  expiresFrom: z.string().optional().describe("Inclusive expiration lower bound in YYYY-MM-DD"),
  expiresTo: z.string().optional().describe("Inclusive expiration upper bound in YYYY-MM-DD"),
  limit: z.number().int().min(1).max(100).optional().describe("Page size; defaults to 20"),
  offset: z.number().int().min(0).optional().describe("Page offset; defaults to 0")
};

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

  server.registerTool("list_foods", {
    description: "Filter food items owned by the authenticated user. Results are ordered by expiration urgency and paginated.",
    inputSchema: foodListSchema,
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, run((filters) => foodService.searchFoodItems(user.id, filters)));

  server.registerTool("get_food", {
    description: "Get one food item owned by the authenticated user.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { readOnlyHint: true, openWorldHint: false }
  }, run(({ id }) => foodService.getFoodItem(user.id, id)));

  server.registerTool("create_food", {
    description: "Create a food item. Supply expiresOn, or both startDate and shelfLifeDays. Dates use YYYY-MM-DD.",
    inputSchema: foodInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
  }, run((input) => foodService.createFoodItem(user.id, input)));

  server.registerTool("update_food", {
    description: "Partially update one food item owned by the authenticated user.",
    inputSchema: { id: z.number().int().positive(), ...Object.fromEntries(Object.entries(foodInputSchema).map(([key, value]) => [key, value.optional()])) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, run(({ id, ...patch }) => foodService.updateFoodItem(user.id, id, patch)));

  server.registerTool("delete_food", {
    description: "Permanently delete one food item owned by the authenticated user.",
    inputSchema: { id: z.number().int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
  }, run(({ id }) => ({ deleted: foodService.deleteFoodItem(user.id, id) })));
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
