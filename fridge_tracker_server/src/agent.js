"use strict";

const crypto = require("node:crypto");
const OpenAI = require("openai").default;
const { localDateKey } = require("./domain");

const PENDING_TTL_MS = 5 * 60 * 1000;

const foodFields = {
  name: { type: "string", description: "食材名称；create 时必填，update 时仅在修改名称时填写" },
  category: { type: "string", description: "品类；create 省略时默认为其他" },
  quantityText: { type: "string", description: "人类可读数量，例如 1 盒" },
  startDate: { type: ["string", "null"], description: "开始日期，YYYY-MM-DD" },
  shelfLifeDays: { type: ["integer", "null"], description: "保鲜天数，0 到 3650" },
  expiresOn: { type: ["string", "null"], description: "到期日，YYYY-MM-DD；create 时可用它代替 startDate+shelfLifeDays；update 要按 startDate+shelfLifeDays 重新计算时传 null" }
};

const listFoodFields = {
  keyword: { type: "string", description: "模糊匹配名称、品类或数量" },
  category: { type: "string", description: "精确匹配品类" },
  status: { type: "string", enum: ["expired", "expiring", "normal"], description: "按过期状态筛选" },
  expiresFrom: { type: "string", description: "到期日下界，含当天，YYYY-MM-DD" },
  expiresTo: { type: "string", description: "到期日上界，含当天，YYYY-MM-DD" },
  limit: { type: "integer", minimum: 1, maximum: 100, description: "返回数量，默认 20" },
  offset: { type: "integer", minimum: 0, description: "分页偏移，默认 0" }
};

const toolDefinitions = [
  {
    name: "list_foods",
    description: "筛选当前用户的食材并返回 ID、到期日和状态。优先使用关键词、品类、状态或日期范围缩小结果；修改前用准确 ID 消除歧义。",
    parameters: { type: "object", additionalProperties: false, properties: listFoodFields }
  },
  {
    name: "get_food",
    description: "按 ID 获取当前用户的一项食材。",
    parameters: { type: "object", additionalProperties: false, required: ["id"], properties: { id: { type: "integer" } } }
  },
  {
    name: "propose_food_changes",
    description: [
      "提交 1 到 25 项食材变更，识别出准确对象后直接调用，不要在调用前自行询问确认。",
      'create 使用 {"operation":"create","input":{...}}：input.name 必填；提供 expiresOn，或同时提供 startDate 和 shelfLifeDays；category 省略时默认为“其他”，其余字段可省略。',
      'update 使用 {"operation":"update","id":123,"patch":{...}}：id 是 list_foods/get_food 返回的准确食材 ID；patch 只填写需要修改的字段，不要补齐未修改字段；要根据 startDate+shelfLifeDays 重新计算到期日时同时传 expiresOn: null。',
      'delete 使用 {"operation":"delete","id":123}：只传准确 ID，不要传 input 或 patch。',
      "单项 create/update 可直接执行；delete 或一次包含多项变更时由系统创建确认操作，模型不要重复提交或自行描述确认流程。"
    ].join("\n"),
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
              id: { type: "integer", description: "update 和 delete 必填" },
              input: { type: "object", additionalProperties: false, required: ["name"], properties: foodFields, description: "create 必填；name 必填，并提供 expiresOn 或 startDate+shelfLifeDays" },
              patch: { type: "object", additionalProperties: false, properties: foodFields, description: "update 必填；只填写需要修改的字段" }
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
    return db.prepare("SELECT * FROM agent_messages WHERE conversation_id = ? ORDER BY id ASC").all(conversationId).map(publicMessage).map((message) => {
      const events = message.metadata?.events;
      if (!Array.isArray(events)) return message;
      return {
        ...message,
        metadata: {
          ...message.metadata,
          events: events.map((event) => {
            if (!event.pendingAction?.id) return event;
            const pending = db.prepare("SELECT actions_json, resolved_at, resolution FROM agent_pending_actions WHERE id = ? AND user_id = ?").get(event.pendingAction.id, userId);
            if (!pending) return event;
            let details = event.pendingAction.details;
            if (!details && !pending.resolved_at) {
              try { details = actionDetails(userId, JSON.parse(pending.actions_json)); } catch { details = []; }
            }
            return { pendingAction: { ...event.pendingAction, details, resolvedAt: pending.resolved_at, resolution: pending.resolution } };
          })
        }
      };
    });
  }

  function saveMessage(conversationId, role, content, metadata = null) {
    const now = new Date().toISOString();
    const created = db.prepare("INSERT INTO agent_messages (conversation_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(conversationId, role, String(content || ""), metadata ? JSON.stringify(metadata) : null, now);
    db.prepare("UPDATE agent_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
    return publicMessage(db.prepare("SELECT * FROM agent_messages WHERE id = ?").get(Number(created.lastInsertRowid)));
  }

  function actionDetails(userId, actions) {
    return actions.map((action) => {
      if (action.operation === "create") {
        return { operation: "create", name: action.input.name, category: action.input.category, quantityText: action.input.quantityText, expiresOn: action.input.expiresOn };
      }
      const current = foodService.getFoodItem(userId, action.id);
      if (action.operation === "update") {
        return {
          operation: "update",
          id: action.id,
          name: action.patch.name ?? current.name,
          category: action.patch.category ?? current.category,
          quantityText: action.patch.quantityText ?? current.quantityText,
          expiresOn: action.patch.expiresOn ?? current.expiresOn
        };
      }
      return { operation: "delete", id: action.id, name: current.name, category: current.category, quantityText: current.quantityText, expiresOn: current.expiresOn };
    });
  }

  function summarizeDetails(details) {
    const labels = { create: "新增", update: "修改", delete: "删除" };
    return details.map((detail) => `${labels[detail.operation]}「${detail.name}」`).join("、");
  }

  function createPendingAction(userId, conversationId, actions, resume = null) {
    const normalized = foodService.validateActions(userId, actions);
    const encodedActions = JSON.stringify(normalized);
    const details = actionDetails(userId, normalized);
    const summary = summarizeDetails(details);
    const now = new Date();
    const nowIso = now.toISOString();
    const existing = db.prepare(`
      SELECT * FROM agent_pending_actions
      WHERE user_id = ? AND conversation_id = ? AND resolved_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC
    `).all(userId, conversationId, nowIso).find((row) => row.actions_json === encodedActions);
    if (existing) {
      if (resume) db.prepare("UPDATE agent_pending_actions SET resume_json = ? WHERE id = ?").run(JSON.stringify(resume), existing.id);
      return { id: existing.id, summary: existing.summary, actions: normalized, details, expiresAt: existing.expires_at };
    }
    const id = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + PENDING_TTL_MS).toISOString();
    db.prepare(`
      INSERT INTO agent_pending_actions (id, user_id, conversation_id, actions_json, summary, expires_at, resume_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, conversationId, encodedActions, summary, expiresAt, resume ? JSON.stringify(resume) : null, nowIso);
    return { id, summary, actions: normalized, details, expiresAt };
  }

  function executeTool(userId, conversationId, name, args, resume = null) {
    if (name === "list_foods") return foodService.searchFoodItems(userId, args);
    if (name === "get_food") return foodService.getFoodItem(userId, args.id);
    if (name !== "propose_food_changes") throw new Error("unsupported agent tool");
    const actions = args.actions || [];
    foodService.validateActions(userId, actions);
    const requiresConfirmation = actions.length > 1 || actions.some((action) => action.operation === "delete");
    if (requiresConfirmation) return { pendingAction: createPendingAction(userId, conversationId, actions, resume) };
    return { executed: foodService.applyActions(userId, actions) };
  }

  function toolError(error) {
    return {
      status: "error",
      error: error.statusCode === 404 ? "not_found" : "tool_failed",
      message: error.message
    };
  }

  function processToolCalls(userId, conversationId, calls, resumeForCall = () => null) {
    const writeCalls = calls.filter((call) => call.name === "propose_food_changes");
    let combinedWriteResult = null;
    if (writeCalls.length > 1) {
      const actions = writeCalls.flatMap((call) => call.arguments.actions || []);
      combinedWriteResult = { pendingAction: createPendingAction(userId, conversationId, actions, resumeForCall(writeCalls[0])) };
    }
    return calls.map((call) => {
      try {
        return {
          ...call,
          result: combinedWriteResult && call.name === "propose_food_changes"
            ? combinedWriteResult
            : executeTool(userId, conversationId, call.name, call.arguments, resumeForCall(call))
        };
      } catch (error) {
        return { ...call, result: toolError(error) };
      }
    });
  }

  function instructions() {
    const today = localDateKey(timezone);
    return `你是鲜知贴食材管理助手。今天是 ${today}，时区 ${timezone}。回答简洁、明确。使用 YYYY-MM-DD 展示最终日期。\n` +
      "查询、修改或删除前先列出食材并使用准确 ID；同名匹配多项时必须追问。缺少到期日且没有开始日期与保鲜天数时必须追问。" +
      "调用 list_foods 时优先使用 keyword、category、status、expiresFrom 或 expiresTo 缩小范围；结果 hasMore 为 true 时按需使用 offset 继续查询。" +
      "update 只在 patch 中填写需要修改的字段；如果修改 startDate 或 shelfLifeDays 后要重新计算到期日，同时传 expiresOn: null。" +
      "识别出准确删除对象后直接调用 propose_food_changes，不要先询问用户是否确认；删除和批量操作的确认完全由系统执行层处理，模型无需说明确认流程。" +
      "调用工具时不要输出正在查询、正在调用、准备删除等中间过程，也不要重复展示系统确认卡已经提供的待操作清单。" +
      "不要声称操作成功，除非工具结果明确显示 executed。每次变更只调用一次 propose_food_changes，不要重复提交同一变更。";
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
      const handled = processToolCalls(userId, conversationId, calls, () => ({
        protocol: "responses",
        input: [...input, ...(response.output || [])]
      }));
      events.push(...handled.map((call) => call.result));
      if (handled.some((call) => call.result.pendingAction)) return { text: "", events };
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
      const handled = processToolCalls(userId, conversationId, calls, () => ({ protocol: "chat", messages }));
      events.push(...handled.map((call) => call.result));
      if (handled.some((call) => call.result.pendingAction)) return { text: "", events };
      for (const call of handled) messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(call.result) });
    }
    throw new Error("agent exceeded the tool-call limit");
  }

  function preferChat(activeBaseURL) {
    if (!activeBaseURL) return false;
    try { return !/(^|\.)openai\.com$/i.test(new URL(activeBaseURL).hostname); } catch { return true; }
  }

  function clientFor(runtime) {
    return runtime.client || (clientFactory
      ? clientFactory(runtime)
      : new OpenAI({ apiKey: runtime.apiKey, baseURL: runtime.baseURL || undefined, timeout: 60000, maxRetries: 1 }));
  }

  function executedSummary(results) {
    const labels = { create: "新增", update: "修改", delete: "删除" };
    return results.map((result) => `${labels[result.operation] || "处理"}「${result.item?.name || "食材"}」`).join("、");
  }

  async function resumePendingReply(userId, row, toolResult, fallback) {
    const runtime = runtimeFor(userId);
    if (!runtime) return fallback;
    let resume;
    try { resume = row.resume_json ? JSON.parse(row.resume_json) : null; } catch { resume = null; }
    if (!resume) return fallback;
    const ai = clientFor(runtime);
    const history = recentHistory(row.conversation_id).filter((message) => message.content);
    try {
      const chatMessages = Array.isArray(resume.messages)
        ? resume.messages
        : resume.assistantMessage
          ? [{ role: "system", content: instructions() }, ...history, resume.assistantMessage]
          : null;
      if (resume.protocol === "chat" && chatMessages) {
        const assistantCall = [...chatMessages].reverse().find((message) => Array.isArray(message.tool_calls));
        const callId = assistantCall?.tool_calls?.[0]?.id;
        if (!callId) return fallback;
        const response = await ai.chat.completions.create({
          model: runtime.model,
          messages: [
            ...chatMessages,
            { role: "tool", tool_call_id: callId, content: JSON.stringify(toolResult) }
          ],
          tools: toolDefinitions.map((tool) => ({ type: "function", function: tool })),
          tool_choice: "none"
        });
        return response.choices[0]?.message?.content || fallback;
      }
      const responseInput = Array.isArray(resume.input)
        ? resume.input
        : Array.isArray(resume.output)
          ? [...history, ...resume.output]
          : null;
      if (resume.protocol !== "responses" || !responseInput) return fallback;
      const call = [...responseInput].reverse().find((item) => item.type === "function_call");
      if (!call?.call_id) return fallback;
      const response = await ai.responses.create({
        model: runtime.model,
        instructions: instructions(),
        input: [...responseInput, { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(toolResult) }],
        tools: toolDefinitions.map((tool) => ({ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false })),
        tool_choice: "none",
        store: false
      });
      return response.output_text || fallback;
    } catch {
      return fallback;
    }
  }

  async function sendMessage(userId, conversationId, content) {
    const runtime = runtimeFor(userId);
    if (!runtime) {
      const error = new Error("Agent 未配置，请先在用户页面填写自己的模型 API Key、模型和 Base URL");
      error.statusCode = 503;
      throw error;
    }
    const ai = clientFor(runtime);
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

  async function resolvePending(userId, id, confirm) {
    const now = new Date().toISOString();
    const row = db.prepare("SELECT * FROM agent_pending_actions WHERE id = ? AND user_id = ?").get(String(id), userId);
    if (!row) {
      const error = new Error("pending action not found");
      error.statusCode = 404;
      throw error;
    }
    if (row.resolved_at) {
      const recent = db.prepare("SELECT * FROM agent_messages WHERE conversation_id = ? AND created_at >= ? ORDER BY id DESC LIMIT 20")
        .all(row.conversation_id, row.resolved_at).map(publicMessage);
      const message = recent.find((item) => item.metadata?.executed || item.metadata?.cancelled) || null;
      return {
        alreadyResolved: true,
        resolution: row.resolution,
        executed: message?.metadata?.executed,
        cancelled: row.resolution === "cancelled",
        message
      };
    }
    if (row.expires_at <= now) throw new Error("pending action has expired");
    if (!confirm) {
      db.prepare("UPDATE agent_pending_actions SET resolved_at = ?, resolution = 'cancelled' WHERE id = ? AND resolved_at IS NULL").run(now, row.id);
      const fallback = `已取消：${row.summary}。`;
      const reply = await resumePendingReply(userId, row, { status: "cancelled", summary: row.summary }, fallback);
      const message = saveMessage(row.conversation_id, "assistant", reply, { cancelled: true, toolResultReturned: true });
      return { cancelled: true, message };
    }
    const actions = JSON.parse(row.actions_json);
    const results = foodService.applyActions(userId, actions);
    const changed = db.prepare("UPDATE agent_pending_actions SET resolved_at = ?, resolution = 'confirmed' WHERE id = ? AND resolved_at IS NULL").run(now, row.id);
    if (!changed.changes) throw new Error("pending action has already been resolved");
    const reply = await resumePendingReply(userId, row, { status: "executed", results }, `已执行：${executedSummary(results)}。`);
    const message = saveMessage(row.conversation_id, "assistant", reply, { executed: results, toolResultReturned: true });
    return { executed: results, message };
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
