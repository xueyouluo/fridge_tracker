"use strict";

const DEFAULT_AGENT_INPUT_QUOTA = 100;
const MAX_AGENT_INPUT_QUOTA = 1_000_000;
const HISTORICAL_QUOTA_MIGRATION = "20260714_agent_input_quota_100";

class AgentQuotaError extends Error {
  constructor(message, statusCode = 400, code = "agent_quota_error") {
    super(message);
    this.name = "AgentQuotaError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeQuotaLimit(value) {
  if (value === null || value === "" || typeof value === "boolean") {
    throw new AgentQuotaError(`limit must be an integer between 0 and ${MAX_AGENT_INPUT_QUOTA}`);
  }
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_AGENT_INPUT_QUOTA) {
    throw new AgentQuotaError(`limit must be an integer between 0 and ${MAX_AGENT_INPUT_QUOTA}`);
  }
  return limit;
}

function publicQuota(row) {
  if (!row) return null;
  const limit = Number(row.agent_input_quota);
  const used = Number(row.agent_input_used);
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used)
  };
}

function createAgentQuotaService(db) {
  function getQuota(userId) {
    const row = db.prepare(`
      SELECT agent_input_quota, agent_input_used FROM users WHERE id = ?
    `).get(userId);
    if (!row) throw new AgentQuotaError("user not found", 404, "user_not_found");
    return publicQuota(row);
  }

  function setQuota(userId, value) {
    const limit = normalizeQuotaLimit(value);
    const changed = db.prepare("UPDATE users SET agent_input_quota = ? WHERE id = ?").run(limit, userId);
    if (!changed.changes) throw new AgentQuotaError("user not found", 404, "user_not_found");
    return getQuota(userId);
  }

  function consumeInput(userId) {
    const changed = db.prepare(`
      UPDATE users
      SET agent_input_used = agent_input_used + 1
      WHERE id = ? AND agent_input_used < agent_input_quota
    `).run(userId);
    if (changed.changes) return getQuota(userId);
    const row = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!row) throw new AgentQuotaError("user not found", 404, "user_not_found");
    throw new AgentQuotaError("系统 Agent 输入额度已用完，请配置个人 API Key 或联系管理员增加额度", 429, "agent_quota_exhausted");
  }

  return { consumeInput, getQuota, setQuota };
}

function grantHistoricalAgentQuota(db) {
  if (db.prepare("SELECT name FROM app_migrations WHERE name = ?").get(HISTORICAL_QUOTA_MIGRATION)) return false;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE users
      SET agent_input_quota = MIN(agent_input_used + ?, ?)
      WHERE agent_input_quota - agent_input_used < ?
    `).run(DEFAULT_AGENT_INPUT_QUOTA, MAX_AGENT_INPUT_QUOTA, DEFAULT_AGENT_INPUT_QUOTA);
    db.prepare("INSERT INTO app_migrations (name, applied_at) VALUES (?, ?)")
      .run(HISTORICAL_QUOTA_MIGRATION, new Date().toISOString());
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  AgentQuotaError,
  DEFAULT_AGENT_INPUT_QUOTA,
  HISTORICAL_QUOTA_MIGRATION,
  MAX_AGENT_INPUT_QUOTA,
  createAgentQuotaService,
  grantHistoricalAgentQuota,
  normalizeQuotaLimit,
  publicQuota
};
