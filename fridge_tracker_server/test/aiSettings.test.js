"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiSettingsService, normalizeBaseUrl } = require("../src/aiSettings");
const { createTestDatabase } = require("./helpers");

test("system AI settings encrypt the shared API key and provide a fallback runtime", () => {
  const db = createTestDatabase();
  const settings = createAiSettingsService(db, "test-encryption-secret");
  const saved = settings.saveSystemSettings(1, {
    openaiApiKey: "sk-user-one-secret",
    openaiModel: "model-one",
    openaiBaseUrl: "https://api.openai.com/v1/"
  });
  assert.equal(saved.apiKeyHint, "••••cret");
  assert.equal(saved.openaiApiKey, undefined);
  assert.equal(db.prepare("SELECT api_key_encrypted FROM system_ai_settings WHERE id = 1").get().api_key_encrypted.includes("sk-user"), false);
  assert.deepEqual(settings.resolveRuntime(2), {
    apiKey: "sk-user-one-secret",
    model: "model-one",
    baseURL: "https://api.openai.com/v1",
    mode: "system"
  });
});

test("personal AI settings override the system runtime and stay isolated by user", () => {
  const db = createTestDatabase();
  const settings = createAiSettingsService(db, "test-encryption-secret");
  settings.saveSystemSettings(1, { openaiApiKey: "system-key", openaiModel: "system", openaiBaseUrl: "https://api.openai.com/v1" });
  settings.saveUserSettings(1, { openaiApiKey: "personal-key", openaiModel: "personal", openaiBaseUrl: "http://127.0.0.1:11434/v1" });
  settings.saveUserSettings(1, { openaiApiKey: "", openaiModel: "personal-new", openaiBaseUrl: "http://127.0.0.1:11434/v1" });

  assert.deepEqual(settings.runtimeStatus(1), {
    configured: true,
    mode: "personal",
    personalConfigured: true,
    systemConfigured: true
  });
  assert.equal(settings.resolveRuntime(1).apiKey, "personal-key");
  assert.equal(settings.resolveRuntime(1).model, "personal-new");
  assert.equal(settings.resolveRuntime(1).mode, "personal");
  assert.equal(settings.resolveRuntime(2).apiKey, "system-key");
  assert.equal(settings.resolveRuntime(2).mode, "system");
  assert.equal(db.prepare("SELECT api_key_encrypted FROM user_ai_settings WHERE user_id = 1").get().api_key_encrypted.includes("personal-key"), false);
  assert.throws(() => normalizeBaseUrl("http://example.com/v1"), /HTTPS/);
  settings.clearUserSettings(1);
  assert.equal(settings.resolveRuntime(1).mode, "system");
  settings.clearSystemSettings();
  assert.equal(settings.resolveRuntime(1), null);
});
