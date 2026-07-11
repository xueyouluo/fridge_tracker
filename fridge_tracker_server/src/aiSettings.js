"use strict";

const crypto = require("node:crypto");

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

function encryptionKey(secret) {
  return crypto.scryptSync(String(secret || ""), "xianzhitie-user-ai-settings", 32);
}

function encryptSecret(value, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptSecret(value, secret) {
  const [version, iv, tag, encrypted] = String(value || "").split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("invalid encrypted credential");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

function normalizeBaseUrl(value) {
  const text = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  let url;
  try { url = new URL(text); } catch { throw new Error("openaiBaseUrl must be a valid URL"); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("openaiBaseUrl must use HTTPS; HTTP is allowed only for localhost");
  }
  if (url.username || url.password) throw new Error("openaiBaseUrl must not contain credentials");
  return url.toString().replace(/\/$/, "");
}

function publicSettings(row) {
  if (!row) return { configured: false, openaiModel: "", openaiBaseUrl: DEFAULT_BASE_URL, apiKeyHint: "" };
  return {
    configured: true,
    openaiModel: row.model,
    openaiBaseUrl: row.base_url,
    apiKeyHint: row.api_key_hint,
    updatedAt: row.updated_at
  };
}

function createAiSettingsService(db, secret) {
  if (!secret) throw new Error("credentialEncryptionKey is required");

  function getSettings(userId) {
    return publicSettings(db.prepare("SELECT * FROM user_ai_settings WHERE user_id = ?").get(userId));
  }

  function saveSettings(userId, input) {
    const existing = db.prepare("SELECT * FROM user_ai_settings WHERE user_id = ?").get(userId);
    const apiKey = String(input.openaiApiKey || "").trim();
    const model = String(input.openaiModel || "").trim().slice(0, 120);
    const baseUrl = normalizeBaseUrl(input.openaiBaseUrl);
    if (!model) throw new Error("openaiModel is required");
    if (!apiKey && !existing) throw new Error("openaiApiKey is required");
    const encrypted = apiKey ? encryptSecret(apiKey, secret) : existing.api_key_encrypted;
    const hint = apiKey ? `••••${apiKey.slice(-4)}` : existing.api_key_hint;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_ai_settings (user_id, api_key_encrypted, api_key_hint, model, base_url, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        api_key_encrypted = excluded.api_key_encrypted,
        api_key_hint = excluded.api_key_hint,
        model = excluded.model,
        base_url = excluded.base_url,
        updated_at = excluded.updated_at
    `).run(userId, encrypted, hint, model, baseUrl, now);
    return getSettings(userId);
  }

  function clearSettings(userId) {
    db.prepare("DELETE FROM user_ai_settings WHERE user_id = ?").run(userId);
    return { ok: true };
  }

  function resolveRuntime(userId) {
    const row = db.prepare("SELECT * FROM user_ai_settings WHERE user_id = ?").get(userId);
    if (!row) return null;
    try {
      return { apiKey: decryptSecret(row.api_key_encrypted, secret), model: row.model, baseURL: row.base_url };
    } catch {
      const error = new Error("无法解密模型 API Key，请在用户页面重新保存配置");
      error.statusCode = 503;
      throw error;
    }
  }

  return { getSettings, saveSettings, clearSettings, resolveRuntime };
}

module.exports = { DEFAULT_BASE_URL, createAiSettingsService, decryptSecret, encryptSecret, normalizeBaseUrl };
