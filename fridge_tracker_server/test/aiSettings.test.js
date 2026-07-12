"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiSettingsService, normalizeBaseUrl } = require("../src/aiSettings");
const { createTestDatabase } = require("./helpers");

test("household AI settings encrypt API keys and remain isolated per household", () => {
  const db = createTestDatabase();
  const settings = createAiSettingsService(db, "test-encryption-secret");
  const saved = settings.saveSettings(1, 1, {
    openaiApiKey: "sk-user-one-secret",
    openaiModel: "model-one",
    openaiBaseUrl: "https://api.openai.com/v1/"
  });
  assert.equal(saved.apiKeyHint, "••••cret");
  assert.equal(saved.openaiApiKey, undefined);
  assert.equal(settings.getSettings(2).configured, false);
  assert.equal(db.prepare("SELECT api_key_encrypted FROM household_ai_settings WHERE household_id = 1").get().api_key_encrypted.includes("sk-user"), false);
  assert.deepEqual(settings.resolveRuntime(1), {
    apiKey: "sk-user-one-secret",
    model: "model-one",
    baseURL: "https://api.openai.com/v1"
  });
});

test("updating model settings preserves a blank API key and validates base URLs", () => {
  const db = createTestDatabase();
  const settings = createAiSettingsService(db, "test-encryption-secret");
  settings.saveSettings(1, 1, { openaiApiKey: "secret-key", openaiModel: "old", openaiBaseUrl: "https://api.openai.com/v1" });
  settings.saveSettings(1, 1, { openaiApiKey: "", openaiModel: "new", openaiBaseUrl: "http://127.0.0.1:11434/v1" });
  assert.equal(settings.resolveRuntime(1).apiKey, "secret-key");
  assert.equal(settings.resolveRuntime(1).model, "new");
  assert.throws(() => normalizeBaseUrl("http://example.com/v1"), /HTTPS/);
  settings.clearSettings(1);
  assert.equal(settings.resolveRuntime(1), null);
});
