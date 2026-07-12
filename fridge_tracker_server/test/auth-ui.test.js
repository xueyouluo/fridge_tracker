"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const publicDir = path.resolve(__dirname, "../public");

test("login form does not prefill the admin account", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const loginInput = html.match(/<input name="login"[^>]*>/)?.[0] || "";
  assert.ok(loginInput);
  assert.doesNotMatch(loginInput, /value="admin"/);
  assert.match(loginInput, /autocomplete="username"/);
});

test("login page scrubs credentials accidentally placed in the URL", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /url\.searchParams\.delete\("login"\)/);
  assert.match(app, /url\.searchParams\.delete\("password"\)/);
  assert.match(app, /window\.history\.replaceState/);
  assert.doesNotMatch(app, /searchParams\.get\("password"\)/);
});

test("the page loads markdown-it and uses the shared markdown adapter", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(html, /<script src="\/vendor\/markdown-it\.js\?v=14\.3\.0"><\/script>/);
  assert.match(html, /<script src="\/markdown\.js\?v=20260711-3"><\/script>/);
  assert.match(html, /<script src="\/app\.js\?v=20260711-5"><\/script>/);
  assert.match(app, /const \{ renderMarkdown \} = window\.XianZhiMarkdown/);
  assert.doesNotMatch(app, /function createMarkdownRenderer\(\)/);
});

test("agent textareas submit on Enter while preserving Shift+Enter and IME composition", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing \|\| event\.keyCode === 229/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /form\.requestSubmit\(\)/);
  assert.match(app, /enableEnterToSubmit\(\$\("#agentForm"\)\)/);
  assert.match(app, /enableEnterToSubmit\(\$\("#overviewAgentForm"\)\)/);
});

test("conversation composer is compact, auto-growing and uses an accessible send icon", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(html, /<textarea name="content" maxlength="4000" rows="1" placeholder="给鲜知贴发送消息"/);
  assert.match(html, /class="agent-send" type="submit" aria-label="发送消息"/);
  assert.doesNotMatch(html, /id="agentForm"[\s\S]{0,400}麦克风/);
  assert.match(css, /\.agent-compose \{[\s\S]*border-radius: 27px/);
  assert.match(css, /\.agent-send \{[\s\S]*border-radius: 50%/);
  assert.match(app, /Math\.min\(textarea\.scrollHeight, 128\)/);
  assert.match(app, /enableAgentTextareaAutoGrow\(\$\("#agentForm"\)\)/);
});

test("mobile agent view keeps chat full-height and collapses the conversation list", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(html, /id="conversationToggle"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="conversations"/);
  assert.match(html, /id="activeConversationTitle"/);
  assert.match(css, /body\.agent-view-active \{[\s\S]*grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*height: 100dvh;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.conversation-panel\.mobile-open \.conversation-list \{ display: grid; \}/);
  assert.match(css, /\.agent-messages \{ min-height: 0; max-height: none; padding: 14px; \}/);
  assert.match(app, /document\.body\.classList\.toggle\("agent-view-active", target === "agent"\)/);
  assert.match(app, /function setConversationListOpen\(open\)/);
});

test("pending actions show details before execution and block duplicate clicks", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /确认删除以下.*项食材/);
  assert.match(app, /确认后才会执行/);
  assert.match(app, /card\?\.dataset\.processing === "true"/);
  assert.match(app, /正在执行并生成回复/);
  assert.match(app, /button\.disabled = true/);
  assert.match(app, /const actionContainer = event\.currentTarget/);
  assert.match(app, /if \(actionContainer\.id === "overviewAgentResult"\)/);
  assert.doesNotMatch(app, /if \(event\.currentTarget\.id === "overviewAgentResult"\)/);
});
