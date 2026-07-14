"use strict";

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_TRANSCRIPTION_REQUEST_CHARS = 14 * 1024 * 1024;
const MAX_RECORDING_MS = 60 * 1000;
const AUDIO_MIME_TYPES = new Set([
  "audio/aac",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a"
]);
const AUDIO_FORMATS = new Map([
  ["audio/aac", "aac"],
  ["audio/mp4", "m4a"],
  ["audio/mpeg", "mp3"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/x-m4a", "m4a"]
]);

function inputError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeAudioInput(input) {
  const mimeType = String(input.mimeType || "").trim().toLowerCase().split(";", 1)[0];
  if (!AUDIO_MIME_TYPES.has(mimeType)) throw inputError("当前录音格式不受支持，请更换浏览器后重试", 415);
  const audioBase64 = String(input.audioBase64 || "").trim();
  if (!audioBase64 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(audioBase64)) {
    throw inputError("录音数据无效");
  }
  if (audioBase64.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 + 4) {
    throw inputError("录音文件不能超过 10MB", 413);
  }
  const audio = Buffer.from(audioBase64, "base64");
  if (audio.length < 128) throw inputError("录音时间太短，请按住按钮说完后再松开", 422);
  if (audio.length > MAX_AUDIO_BYTES) throw inputError("录音文件不能超过 10MB", 413);
  const durationMs = Math.round(Number(input.durationMs));
  if (!Number.isFinite(durationMs) || durationMs < 250) {
    throw inputError("录音时间太短，请按住按钮说完后再松开", 422);
  }
  if (durationMs > MAX_RECORDING_MS + 1000) throw inputError("单次语音最长 60 秒", 413);
  return {
    dataUrl: `data:${mimeType};base64,${audioBase64}`,
    format: AUDIO_FORMATS.get(mimeType),
    durationMs,
    mimeType,
    size: audio.length
  };
}

function normalizeAsrBaseUrl(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text) throw new Error("asrBaseUrl is required when asrApiKey is configured");
  let url;
  try { url = new URL(text); } catch { throw new Error("asrBaseUrl must be a valid URL"); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("asrBaseUrl must use HTTPS; HTTP is allowed only for localhost");
  }
  if (url.username || url.password) throw new Error("asrBaseUrl must not contain credentials");
  if (url.search || url.hash) throw new Error("asrBaseUrl must not contain a query string or fragment");
  if (!url.pathname.replace(/\/+$/, "").endsWith("/api/v1")) {
    throw new Error("asrBaseUrl must end with /api/v1");
  }
  return url.toString().replace(/\/$/, "");
}

function resolveSystemAsrConfig(config = {}) {
  const apiKey = String(config.asrApiKey || "").trim();
  if (!apiKey) return null;
  const model = String(config.asrModel || "").trim();
  if (!model) throw new Error("asrModel is required when asrApiKey is configured");
  return {
    apiKey,
    model,
    baseURL: normalizeAsrBaseUrl(config.asrBaseUrl)
  };
}

function transcriptionRequest(runtime, audio) {
  if (runtime.model.startsWith("fun-asr-flash")) {
    return {
      model: runtime.model,
      input: {
        messages: [{
          role: "user",
          content: [{ type: "input_audio", input_audio: { data: audio.dataUrl } }]
        }]
      },
      parameters: { format: audio.format }
    };
  }
  return {
    model: runtime.model,
    input: {
      messages: [{
        role: "user",
        content: [{ audio: audio.dataUrl }]
      }]
    },
    parameters: {
      asr_options: { language: "zh", enable_itn: true }
    }
  };
}

function transcriptText(payload) {
  const content = payload?.output?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => typeof item === "string" ? item : item?.text || "").join("").trim();
  }
  return String(payload?.output?.text || "").trim();
}

function createTranscriptionService({ resolveRuntime, fetchImpl = globalThis.fetch } = {}) {
  if (typeof resolveRuntime !== "function") throw new Error("resolveRuntime is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch is required");

  async function transcribe(householdId, input) {
    const runtime = resolveRuntime(householdId);
    if (!runtime) throw inputError("语音识别尚未配置，请让家庭创建者在用户页面完成设置", 503);
    const audio = normalizeAudioInput(input || {});
    let payload;
    try {
      const response = await fetchImpl(`${runtime.baseURL}/services/aigc/multimodal-generation/generation`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${runtime.apiKey}`,
          "Content-Type": "application/json",
          "X-DashScope-SSE": "disable"
        },
        body: JSON.stringify(transcriptionRequest(runtime, audio)),
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error(`DashScope returned HTTP ${response.status}`);
      payload = await response.json();
    } catch (cause) {
      const error = inputError("语音转写失败，请检查语音服务配置或稍后重试", 502);
      error.cause = cause;
      throw error;
    }
    const text = transcriptText(payload);
    if (!text) throw inputError("没有听清，请再试一次", 422);
    return { text, durationMs: audio.durationMs };
  }

  return { transcribe };
}

module.exports = {
  AUDIO_MIME_TYPES,
  AUDIO_FORMATS,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_MS,
  MAX_TRANSCRIPTION_REQUEST_CHARS,
  createTranscriptionService,
  normalizeAsrBaseUrl,
  normalizeAudioInput,
  resolveSystemAsrConfig,
  transcriptionRequest,
  transcriptText
};
