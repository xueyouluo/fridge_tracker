"use strict";

const crypto = require("node:crypto");
const OpenAI = require("openai").default;
const { localDateKey } = require("./domain");
const { agentToolDefinitions: toolDefinitions } = require("./foodTools");

const PENDING_TTL_MS = 5 * 60 * 1000;

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

function createAgentService({ db, foodService, timezone = "Asia/Shanghai", resolveRuntime, resolveHouseholdId = (userId) => userId, consumeInput, getQuota, apiKey, model, baseURL, client, clientFactory }) {
  function householdIdFor(userId) {
    return resolveHouseholdId(userId);
  }
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

  function deleteConversation(userId, id) {
    const conversation = requireConversation(userId, id);
    db.prepare("DELETE FROM agent_conversations WHERE id = ? AND user_id = ?").run(String(id), userId);
    return publicConversation(conversation);
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
    return db.prepare("SELECT * FROM agent_messages WHERE conversation_id = ? AND protocol IS NULL ORDER BY id ASC").all(conversationId).map(publicMessage).map((message) => {
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

  function saveProtocolMessage(conversationId, protocol, role, payload) {
    const now = new Date().toISOString();
    const content = typeof payload?.content === "string" ? payload.content : "";
    db.prepare(`
      INSERT INTO agent_messages (conversation_id, role, content, metadata_json, protocol, payload_json, created_at)
      VALUES (?, ?, ?, NULL, ?, ?, ?)
    `).run(conversationId, role, content, protocol, JSON.stringify(payload), now);
    db.prepare("UPDATE agent_conversations SET updated_at = ? WHERE id = ?").run(now, conversationId);
  }

  function actionDetails(userId, actions) {
    return actions.map((action) => {
      if (action.operation === "create") {
        return { operation: "create", name: action.input.name, category: action.input.category, quantityText: action.input.quantityText, expiresOn: action.input.expiresOn };
      }
      const current = foodService.getFoodItem(householdIdFor(userId), action.id);
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
    const normalized = foodService.validateActions(householdIdFor(userId), actions);
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
    const householdId = householdIdFor(userId);
    if (name === "list_foods") return foodService.searchFoodItems(householdId, args);
    if (name === "get_foods") return { items: foodService.getFoodItems(householdId, args.ids) };
    if (name === "create_foods") return { status: "executed", results: foodService.createFoodItems(householdId, args.items) };
    if (name === "update_foods") return { status: "executed", results: foodService.updateFoodItems(householdId, args.items) };
    if (name === "delete_foods") {
      const actions = (args.ids || []).map((id) => ({ operation: "delete", id }));
      foodService.validateActions(householdId, actions);
      return { pendingAction: createPendingAction(userId, conversationId, actions, resume) };
    }
    throw new Error("unsupported agent tool");
  }

  function toolError(error) {
    return {
      status: "error",
      error: error.statusCode === 404 ? "not_found" : "tool_failed",
      message: error.message
    };
  }

  function processToolCalls(userId, conversationId, calls, resumeForCall = () => null) {
    return calls.map((call) => {
      try {
        return {
          ...call,
          result: executeTool(userId, conversationId, call.name, call.arguments, resumeForCall(call))
        };
      } catch (error) {
        return { ...call, result: toolError(error) };
      }
    });
  }

  function instructions() {
    const today = localDateKey(timezone);
    return `你是鲜知贴食材管理助手。今天是 ${today}，时区 ${timezone}。回答简洁、明确。使用 YYYY-MM-DD 展示最终日期。\n` +
      "查询、修改或删除前先列出食材并使用准确 ID；同名匹配多项时必须追问。" +
      "调用 list_foods 时优先使用 keyword、category、status、expiresFrom 或 expiresTo 缩小范围；结果 hasMore 为 true 时按需使用 offset 继续查询。" +
      `当用户表达添加、新购、刚买、采购、带回等新增语义时，只要食材名称明确就直接调用 create_foods，不要先询问用户确认。若未提供日期，把 startDate 设为今天 ${today}，根据食材名称、品类和常见冷藏条件选择偏保守且合理的 shelfLifeDays。` +
      "常见参考：海鲜 1 天，生鲜肉类 2 天，叶菜、菌菇、豆制品和熟食 3 天，牛奶酸奶及多数水果 7 天，鸡蛋 21 天，冷冻食品 90 天；不完全匹配时结合具体食品合理判断。" +
      "用户没说品类时根据食材名称推断；没说数量时可省略 quantityText，不要为此追问。用户明确提供的日期、数量或保鲜天数优先于默认推断。只有名称本身不明确、无法判断要添加什么时才追问。工具成功后简要说明已添加的食材及推断的品类、购买日、保鲜天数和到期日，并告知用户可继续对话修改。" +
      "所有 get/create/update/delete 工具都接收 1 到 25 项；尽量把同类操作合并成一次批量调用。update_foods 只在 patch 中填写需要修改的字段；如果修改 startDate 或 shelfLifeDays 后要重新计算到期日，同时传 expiresOn: null。" +
      "识别出准确删除对象后直接调用 delete_foods，不要先询问用户是否确认；删除确认完全由系统执行层处理，模型无需说明确认流程。" +
      "调用工具时不要输出正在查询、正在调用、准备删除等中间过程，也不要重复展示系统确认卡已经提供的待操作清单。" +
      "不要声称操作成功，除非工具结果明确显示 status 为 executed。不要重复提交同一批变更。";
  }

  function sanitizeChatHistory(messages) {
    const toolResults = new Map(messages
      .filter((message) => message.role === "tool" && message.tool_call_id)
      .map((message) => [message.tool_call_id, message]));
    const history = [];
    for (const message of messages) {
      if (message.role === "tool") continue;
      if (!Array.isArray(message.tool_calls)) {
        history.push(message);
        continue;
      }
      const results = message.tool_calls.map((call) => toolResults.get(call.id));
      if (results.every(Boolean)) history.push(message, ...results);
    }
    return history;
  }

  function recentHistory(conversationId) {
    const rows = db.prepare(`
      SELECT role, content, protocol, payload_json FROM agent_messages
      WHERE conversation_id = ? AND (protocol IS NULL OR protocol = 'chat')
      ORDER BY id DESC LIMIT 40
    `).all(conversationId).reverse();
    const firstUserIndex = rows.findIndex((row) => row.role === "user" && row.protocol === null);
    if (firstUserIndex === -1) return [];
    const messages = rows.slice(firstUserIndex).map((row) => {
      if (!row.payload_json) return { role: row.role, content: row.content };
      try { return JSON.parse(row.payload_json); } catch { return { role: row.role, content: row.content }; }
    });
    return sanitizeChatHistory(messages);
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
      saveProtocolMessage(conversationId, "chat", "assistant", choice);
      const handled = processToolCalls(userId, conversationId, calls, () => ({ protocol: "chat", messages }));
      events.push(...handled.map((call) => call.result));
      if (handled.some((call) => call.result.pendingAction)) return { text: "", events };
      for (const call of handled) {
        const toolMessage = { role: "tool", tool_call_id: call.id, content: JSON.stringify(call.result) };
        saveProtocolMessage(conversationId, "chat", "tool", toolMessage);
        messages.push(toolMessage);
      }
    }
    throw new Error("agent exceeded the tool-call limit");
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
    const history = recentHistory(row.conversation_id);
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
        const toolMessage = { role: "tool", tool_call_id: callId, content: JSON.stringify(toolResult) };
        saveProtocolMessage(row.conversation_id, "chat", "tool", toolMessage);
        const response = await ai.chat.completions.create({
          model: runtime.model,
          messages: [
            ...chatMessages,
            toolMessage
          ],
          tools: toolDefinitions.map((tool) => ({ type: "function", function: tool })),
          tool_choice: "none"
        });
        return response.choices[0]?.message?.content || fallback;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  async function sendMessage(userId, conversationId, content) {
    const runtime = runtimeFor(userId);
    if (!runtime) {
      const error = new Error("Agent 未配置，请填写个人 API Key 或联系管理员配置系统 Agent");
      error.statusCode = 503;
      throw error;
    }
    const ai = clientFor(runtime);
    const conversation = requireConversation(userId, conversationId);
    const text = String(content || "").trim().slice(0, 4000);
    if (!text) throw new Error("message is required");
    const quota = runtime.mode === "personal"
      ? (getQuota ? getQuota(userId) : null)
      : consumeInput ? consumeInput(userId) : (getQuota ? getQuota(userId) : null);
    saveMessage(conversationId, "user", text);
    if (conversation.title === "新对话") db.prepare("UPDATE agent_conversations SET title = ? WHERE id = ?").run(text.slice(0, 30), conversationId);
    const result = await runChat(userId, conversationId, recentHistory(conversationId), ai, runtime.model);
    const metadata = { events: result.events };
    const message = saveMessage(conversationId, "assistant", result.text, metadata);
    return { message, events: result.events, mode: runtime.mode || "system", ...(quota ? { quota } : {}) };
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
    const results = foodService.applyActions(householdIdFor(userId), actions);
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
    deleteConversation,
    listMessages,
    sendMessage,
    confirmAction: (userId, id) => resolvePending(userId, id, true),
    cancelAction: (userId, id) => resolvePending(userId, id, false),
    executeTool
  };
}

module.exports = { PENDING_TTL_MS, createAgentService, summarizeActions, toolDefinitions };
