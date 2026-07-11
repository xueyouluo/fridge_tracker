"use strict";

const crypto = require("node:crypto");
const OpenAI = require("openai").default;
const { localDateKey } = require("./domain");

const PENDING_TTL_MS = 5 * 60 * 1000;

const foodFields = {
  name: { type: "string" },
  category: { type: "string" },
  quantityText: { type: "string" },
  startDate: { type: ["string", "null"] },
  shelfLifeDays: { type: ["integer", "null"] },
  expiresOn: { type: ["string", "null"] }
};

const toolDefinitions = [
  {
    name: "list_foods",
    description: "列出当前用户的全部食材、ID、到期日和状态。修改前先用它消除同名歧义。",
    parameters: { type: "object", additionalProperties: false, properties: {} }
  },
  {
    name: "get_food",
    description: "按 ID 获取当前用户的一项食材。",
    parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "integer" } } }
  },
  {
    name: "propose_food_changes",
    description: "提交完整食材变更数组。单项新增或修改会直接执行；删除或多项变更会等待用户确认。",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["actions"],
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["operation"],
            properties: {
              operation: { type: "string", enum: ["create", "update", "delete"] },
              id: { type: "integer" },
              input: { type: "object", additionalProperties: false, properties: foodFields },
              patch: { type: "object", additionalProperties: false, properties: foodFields }
            }
          }
        }
      }
    }
  }
];

function publicConversation(row) {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

function publicMessage(row) {
  return { id: row.id, role: row.role, content: row.content, metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null, createdAt: row.created_at };
}

function summarizeActions(actions) {
  return actions.map((action) => {
    if (action.operation === "create") return `新增 ${action.input?.name || "食材"}`;
    if (action.operation === "update") return `修改 #${action.id}`;
    return `删除 #${action.id}`;
  }).join("、");
}

function createAgentService({ db, foodService, timezone = "Asia/Shanghai", resolveRuntime, apiKey, model, baseURL, client, clientFactory }) {
  function runtimeFor(userId) {
    if (resolveRuntime) return resolveRuntime(userId);
    if (client && model) return { client, model, baseURL };
    if (apiKey && model) return { apiKey, model, baseURL };
    return null;
  }

  function isConfigured(userId) {
    return Boolean(runtimeFor(userId));
  }

  function listConversations(userId) {
    return db.prepare("SELECT * FROM agent_conversations WHERE user_id = ? ORDER BY updated_at DESC").all(userId).map(publicConversation);
  }

  function createConversation(userId, title = "新对话") {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    db.prepare("INSERT INTO agent_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, userId, String(title || "新对话").trim().slice(0, 60) || "新对话", now, now);
    return publicConversation(db.prepare("SELECT * FROM agent_conversations WHERE id = ?").get(id));
  }

  function requireConversation(userId, id) {
    const row = db.prepare("SELECT * FROM agent_conversations WHERE id = ? AND user_id = ?").get(String(id), userId);
    if (!row) {
      const error = new Error("conversation not found");
      error.statusCode = 404;
      throw error;
    }
    return row;
  }

  function listMessages(userId, conversationId) {
    requireConversation(userId, conversationId);
    return db.prepare("SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY id ASC").all(conversationId).map(publicMessage);
  }

  function saveMessage(conversationId, role, content, metadata = null) {
    const now = new Date().toISOString();
    const created = db.prepare("INSERT INTO agent_messages (conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(conversationId, role, String(content || ""), metadata ? JSON.stringify(metadata) : null, now);
    db.prepare("UPDATE agent_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return publicMessage(db.prepare("SELECT * FROM agent_messages WHERE id = ?").get(Number(created.lastInsertRowid)));
  }

  function createPendingAction(userId, conversationId, actions) {
    foodService.validateActions(userId, actions);
    const now = new Date();
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO agent_pending_actions (id, user_id, conversation_id, actions_json, summary, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, conversationId, JSON.stringify(actions), summarizeActions(actions), new Date(now.getTime() + PENDING_TTL_MS).toISOString(), now.toISOString());
    return { id, summary: summarizeActions(actions), actions, expiresAt: new Date(now.getTime() + PENDING_TTL_MS).toISOString() };
  }

  function executeTool(userId, conversationId, name, args) {
    if (name === "list_foods") return { items: foodService.listFoodItems(userId) };
    if (name === "get_food") return foodService.getFoodItem(userId, args.id);
    if (name !== "propose_food_changes") throw new Error("unsupported agent tool");
    const actions = args.actions || [];
    foodService.validateActions(userId, actions);
    const requiresConfirmation = actions.length > 1 || actions.some((action) => action.operation === "delete");
    if (requiresConfirmation) return { pendingAction: createPendingAction(userId, conversationId, actions) };
    return { executed: foodService.applyActions(userId, actions) };
  }

  function processToolCalls(userId, conversationId, calls) {
    const writeCalls = calls.filter((call) => call.name === "propose_food_changes");
    let combinedWriteResult = null;
    if (writeCalls.length > 1) {
      const actions = writeCalls.flatMap((call) => call.arguments.actions || []);
      combinedWriteResult = { pendingAction: createPendingAction(userId, conversationId, actions) };
    }
    return calls.map((call) => ({
      ...call,
      result: combinedWriteResult && call.name === "propose_food_changes"
        ? combinedWriteResult
        : executeTool(userId, conversationId, call.name, call.arguments)
    }));
  }

  function instructions() {
    const today = localDateKey(timezone);
    return `你是鲜知贴食材管理助手。今天是 ${today}，时区 ${timezone}。回答简洁、明确。使用 YYYY-MM-DD 展示最终日期。\n` +
      "查询、修改或删除前先列出食材并使用准确 ID；同名匹配多项时必须追问。缺少到期日且没有开始日期与保鲜天数时必须追问。" +
      "不要声称操作成功，除非工具结果明确显示 executed。pendingAction 表示等待用户确认。每次变更只调用一次 propose_food_changes。";
  }

  function recentHistory(conversationId) {
    return db.prepare("SELECT role, content FROM agent_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 40")
      .all(conversationId).reverse().map((row) => ({ role: row.role, content: row.content }));
  }

  async function runResponses(userId, conversationId, history, ai, activeModel) {
    let input = history;
    const events = [];
    for (let round = 0; round < 6; round += 1) {
      const response = await ai.responses.create({
        model: activeModel,
        instructions: instructions(),
        input,
        tools: toolDefinitions.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
        parallel_tool_calls: false,
        store: false
      });
      const calls = (response.output || []).filter((item) => item.type === "function_call").map((item) => ({
        id: item.call_id,
        name: item.name,
        arguments: JSON.parse(item.arguments || "{}")
      }));
      if (!calls.length) return { text: response.output_text || "操作已处理。", events };
      const handled = processToolCalls(userId, conversationId, calls);
      events.push(...handled.map((call) => call.result));
      input = [...input, ...(response.output || []), ...handled.map((call) => ({ type: "function_call_output", call_id: call.id, output: JSON.stringify(call.result) }))];
    }
    throw new Error("agent exceeded the tool-call limit");
  }

  async function runChat(userId, conversationId, history, ai, activeModel) {
    const messages = [{ role: "system", content: instructions() }, ...history];
    const events = [];
    for (let round = 0; round < 6; round += 1) {
      const response = await ai.chat.completions.create({
        model: activeModel,
        messages,
        tools: toolDefinitions.map((tool) => ({ type: "function", function: tool })),
        tool_choice: "auto",
        parallel_tool_calls: false
      });
      const choice = response.choices[0]?.message;
      if (!choice) throw new Error("model returned no message");
      messages.push(choice);
      const calls = (choice.tool_calls || []).map((call) => ({ id: call.id, name: call.function.name, arguments: JSON.parse(call.function.arguments || "{}") }));
      if (!calls.length) return { text: choice.content || "操作已处理。", events };
      const handled = processToolCalls(userId, conversationId, calls);
      events.push(...handled.map((call) => call.result));
      for (const call of handled) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(call.result) });
    }
    throw new Error("agent exceeded the tool-call limit");
  }

  function preferChat(activeBaseURL) {
    if (!activeBaseURL) return false;
    try { return !/(^|\.)openai\.com$/i.test(new URL(activeBaseURL).hostname); } catch { return true; }
  }

  async function sendMessage(userId, conversationId, content) {
    const runtime = runtimeFor(userId);
    if (!runtime) {
      const error = new Error("Agent 未配置，请先在用户页面填写自己的模型 API Key、模型和 Base URL");
      error.statusCode = 503;
      throw error;
    }
    const ai = runtime.client || (clientFactory
      ? clientFactory(runtime)
      : new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseURL || undefined, timeout: 60000, maxRetries: 1 }));
    const conversation = requireConversation(userId, conversationId);
    const text = String(content || "").trim().slice(0, 4000);
    if (!text) throw new Error("message is required");
    saveMessage(conversationId, "user", text);
    if (conversation.title === "新对话") db.prepare("UPDATE agent_conversations SET title = ? WHERE id = ?").run(text.slice(0, 30), conversationId);
    const history = recentHistory(conversationId);
    let result;
    if (preferChat(runtime.baseURL)) {
      result = await runChat(userId, conversationId, history, ai, runtime.model);
    } else {
      try {
        result = await runResponses(userId, conversationId, history, ai, runtime.model);
      } catch (error) {
        if (!(error.status === 404 || /unsupported|unknown endpoint|not found/i.test(error.message))) throw error;
        result = await runChat(userId, conversationId, history, ai, runtime.model);
      }
    }
    const metadata = { events: result.events };
    const message = saveMessage(conversationId, "assistant", result.text, metadata);
    return { message, events: result.events };
  }

  function resolvePending(userId, id, confirm) {
    const now = new Date().toISOString();
    const row = db.prepare("SELECT * FROM agent_pending_actions WHERE id = ? AND user_id = ?").get(String(id), userId);
    if (!row) {
      const error = new Error("pending action not found");
      error.statusCode = 404;
      throw error;
    }
    if (row.resolved_at) throw new Error("pending action has already been resolved");
    if (row.expires_at <= now) throw new Error("pending action has expired");
    if (!confirm) {
      db.prepare("UPDATE agent_pending_actions SET resolved_at = ?, resolution = 'cancelled' WHERE id = ? AND resolved_at IS NULL").run(now, row.id);
      return { cancelled: true };
    }
    const actions = JSON.parse(row.actions_json);
    const results = foodService.applyActions(userId, actions);
    const changed = db.prepare("UPDATE agent_pending_actions SET resolved_at = ?, resolution = 'confirmed' WHERE id = ? AND resolved_at IS NULL").run(now, row.id);
    if (!changed.changes) throw new Error("pending action has already been resolved");
    saveMessage(row.conversation_id, "assistant", `已确认执行：${row.summary}`, { executed: results });
    return { executed: results };
  }

  return {
    isConfigured,
    listConversations,
    createConversation,
    listMessages,
    sendMessage,
    confirmAction: (userId, id) => resolvePending(userId, id, true),
    cancelAction: (userId, id) => resolvePending(userId, id, false),
    executeTool
  };
}

module.exports = { PENDING_TTL_MS, createAgentService, summarizeActions, toolDefinitions };
