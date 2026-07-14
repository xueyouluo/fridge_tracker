"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTranscriptionService, normalizeAudioInput, resolveSystemAsrConfig } = require("../src/transcription");

function audioInput(overrides = {}) {
  return {
    mimeType: "audio/webm;codecs=opus",
    audioBase64: Buffer.alloc(512, 7).toString("base64"),
    durationMs: 1200,
    ...overrides
  };
}

test("short recorded audio is sent to Qwen ASR as a base64 data URL", async () => {
  let url;
  let request;
  let resolvedHouseholdId;
  const service = createTranscriptionService({
    resolveRuntime(householdId) {
      resolvedHouseholdId = householdId;
      return { apiKey: "secret", model: "qwen3-asr-flash", baseURL: "https://workspace.example/api/v1" };
    },
    async fetchImpl(inputUrl, options) {
      url = inputUrl;
      request = options;
      return {
        ok: true,
        async json() {
          return { output: { choices: [{ message: { content: [{ text: "添加一盒牛奶，七月二十日到期" }] } }] } };
        }
      };
    }
  });
  const result = await service.transcribe(9, audioInput());
  assert.equal(resolvedHouseholdId, 9);
  assert.equal(result.text, "添加一盒牛奶，七月二十日到期");
  assert.equal(url, "https://workspace.example/api/v1/services/aigc/multimodal-generation/generation");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer secret");
  assert.equal(request.headers["X-DashScope-SSE"], "disable");
  const body = JSON.parse(request.body);
  assert.equal(body.model, "qwen3-asr-flash");
  assert.match(body.input.messages[0].content[0].audio, /^data:audio\/webm;base64,/);
  assert.deepEqual(body.parameters.asr_options, { language: "zh", enable_itn: true });
});

test("Fun-ASR receives browser audio with its model-specific request and response shape", async () => {
  let request;
  const service = createTranscriptionService({
    resolveRuntime: () => ({
      apiKey: "system-secret",
      model: "fun-asr-flash-2026-06-15",
      baseURL: "https://workspace.example/api/v1"
    }),
    async fetchImpl(inputUrl, options) {
      request = { inputUrl, options };
      return { ok: true, json: async () => ({ output: { text: "冰箱里还有多少牛奶" } }) };
    }
  });
  const result = await service.transcribe(3, audioInput());
  const body = JSON.parse(request.options.body);
  assert.equal(result.text, "冰箱里还有多少牛奶");
  assert.equal(body.model, "fun-asr-flash-2026-06-15");
  assert.equal(body.input.messages[0].content[0].type, "input_audio");
  assert.match(body.input.messages[0].content[0].input_audio.data, /^data:audio\/webm;base64,/);
  assert.deepEqual(body.parameters, { format: "webm" });
});

test("system ASR configuration stays disabled without a key and validates configured endpoints", () => {
  assert.equal(resolveSystemAsrConfig({
    asrApiKey: "",
    asrModel: "fun-asr-flash-2026-06-15",
    asrBaseUrl: ""
  }), null);
  assert.deepEqual(resolveSystemAsrConfig({
    asrApiKey: "secret",
    asrModel: "fun-asr-flash-2026-06-15",
    asrBaseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/"
  }), {
    apiKey: "secret",
    model: "fun-asr-flash-2026-06-15",
    baseURL: "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1"
  });
  assert.throws(() => resolveSystemAsrConfig({
    asrApiKey: "secret",
    asrModel: "fun-asr-flash-2026-06-15",
    asrBaseUrl: "http://example.com/api/v1"
  }), /HTTPS/);
});

test("transcription validates duration, format, size and configuration", async () => {
  assert.throws(() => normalizeAudioInput(audioInput({ durationMs: 100 })), /时间太短/);
  assert.throws(() => normalizeAudioInput(audioInput({ mimeType: "video/webm" })), /格式不受支持/);
  assert.throws(() => normalizeAudioInput(audioInput({ audioBase64: "not base64" })), /录音数据无效/);
  const service = createTranscriptionService({ resolveRuntime: () => null });
  await assert.rejects(() => service.transcribe(1, audioInput()), /尚未配置/);
});

test("provider failures and empty transcripts return user-safe errors", async () => {
  const runtime = () => ({ apiKey: "secret", model: "qwen3-asr-flash", baseURL: "https://workspace.example/api/v1" });
  const failed = createTranscriptionService({
    resolveRuntime: runtime,
    fetchImpl: async () => { throw new Error("provider secret detail"); }
  });
  await assert.rejects(() => failed.transcribe(1, audioInput()), /语音转写失败/);
  const empty = createTranscriptionService({
    resolveRuntime: runtime,
    fetchImpl: async () => ({ ok: true, json: async () => ({ output: { choices: [{ message: { content: [] } }] } }) })
  });
  await assert.rejects(() => empty.transcribe(1, audioInput()), /没有听清/);
});
