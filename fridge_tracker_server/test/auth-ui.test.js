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
  assert.match(html, /<script src="\/app\.js\?v=20260717-3"><\/script>/);
  assert.match(app, /const \{ renderMarkdown \} = window\.XianZhiMarkdown/);
  assert.doesNotMatch(app, /function createMarkdownRenderer\(\)/);
});

test("agent textareas submit on Enter while preserving Shift+Enter and IME composition", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing \|\| event\.keyCode === 229/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /!textarea\.disabled && !submitButton\.disabled/);
  assert.match(app, /form\.requestSubmit\(\)/);
  assert.match(app, /enableEnterToSubmit\(\$\("#agentForm"\)\)/);
  assert.match(app, /enableEnterToSubmit\(\$\("#quickAgentForm"\)\)/);
});

test("agent composers support text and pure-voice modes with upward cancel", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.equal((html.match(/placeholder="发消息或按住说话…"/g) || []).length, 1);
  assert.match(html, /placeholder="继续对话…"/);
  assert.match(html, /class="agent-send" type="submit" aria-label="发送消息"/);
  assert.equal((html.match(/data-voice-input/g) || []).length, 2);
  assert.equal((html.match(/data-voice-text-surface/g) || []).length, 2);
  assert.equal((html.match(/data-input-mode-toggle/g) || []).length, 1);
  assert.equal((html.match(/data-input-mode="voice"/g) || []).length, 1);
  assert.match(html, /aria-label="按住说话，松开发送" aria-pressed="false" hidden disabled/);
  assert.match(html, /id="voiceRecordingOverlay"[\s\S]*松手发送，上移取消[\s\S]*id="voiceRecordingWave"/);
  assert.match(css, /\.agent-compose \{[\s\S]*border-radius: 27px/);
  assert.match(css, /\.agent-send \{[\s\S]*border-radius: 50%/);
  assert.match(css, /\.agent-voice-pad\[aria-pressed="true"\]/);
  assert.match(css, /\.agent-compose\[data-input-mode="voice"\] \.agent-voice-pad \{ display: flex; \}/);
  assert.match(css, /\.voice-recording-overlay\.is-cancelling \.voice-recording-panel/);
  assert.match(css, /touch-action: none; user-select: none/);
  assert.match(app, /Math\.min\(textarea\.scrollHeight, 128\)/);
  assert.match(app, /enableAgentTextareaAutoGrow\(\$\("#agentForm"\)\)/);
  assert.match(app, /const VOICE_LONG_PRESS_MS = 280/);
  assert.match(app, /const VOICE_CANCEL_DISTANCE_PX = 72/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /new MediaRecorder\(stream/);
  assert.match(app, /"pointerdown"/);
  assert.match(app, /"pointermove"/);
  assert.match(app, /"pointerup"/);
  assert.match(app, /pointerPress\.startY - event\.clientY >= VOICE_CANCEL_DISTANCE_PX/);
  assert.match(app, /setVoiceRecordingCancelState\(controller, cancelling\)/);
  assert.match(app, /form\.dataset\.inputMode === "voice" \? "text" : "voice"/);
  assert.match(app, /setInputMode\(options\.defaultMode \|\| "voice"\)/);
  assert.match(app, /正在录音，松开发送/);
  assert.match(app, /\/api\/agent\/transcriptions/);
  assert.match(app, /textarea\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.match(app, /识别完成，正在发送/);
  assert.doesNotMatch(app, /webkitSpeechRecognition/);
  assert.match(app, /setupVoiceInput\(\$\("#agentForm"\)\)/);
  assert.match(app, /setupVoiceInput\(\$\("#quickAgentForm"\), \{/);
  assert.match(app, /buttonLongPress: true/);
  assert.match(app, /voiceFromTextSurface: false/);
});

test("overview removes its embedded assistant and exposes a global quick assistant", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.doesNotMatch(html, /id="overviewAgentForm"|id="overviewAgentResult"|data-agent-example=/);
  assert.match(html, /class="link welcome-manual-add"/);
  assert.match(html, /data-quick-agent-prompt="家里有哪些三天内到期的物品？"/);
  assert.match(html, /data-quick-agent-prompt="根据冰箱现有食材，今天可以做什么菜？"/);
  assert.equal((html.match(/data-quick-agent-prompt=/g) || []).length, 6);
  assert.match(html, />哪些已经过期<\/button>/);
  assert.match(html, />这周先处理什么<\/button>/);
  assert.match(html, />推荐消耗菜谱<\/button>/);
  assert.match(html, />记录新物品<\/button>/);
  assert.match(css, /\.overview-agent-shortcuts \{ display: flex; flex-wrap: wrap;/);
  assert.match(app, /shortcut\.dataset\.quickAgentPrompt/);
  assert.match(app, /form\.requestSubmit\(\)/);
  assert.match(html, /id="quickAgentForm"[\s\S]*id="quickAgentDialog"[\s\S]*id="quickAgentVoice"/);
  assert.match(html, /data-text-fallback/);
  assert.match(html, />打开完整助手<\/button>/);
  assert.match(css, /\.quick-agent \{[\s\S]*position: fixed; right: 24px; bottom: 24px;/);
  assert.match(app, /\$\("#quickAgentForm"\)\.classList\.toggle\("hidden", !state\.user \|\| target === "agent"\)/);
  assert.match(app, /if \(target === "agent"\) \{[\s\S]*closeQuickAgent\(\)/);
  assert.match(app, /\$\("#quickAgentOpenFull"\)\.addEventListener\("click", \(\) => setView\("agent"\)\)/);
  assert.doesNotMatch(app, /系统额度剩余/);
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
  assert.match(css, /bottom: calc\(88px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.quick-agent-dialog \{[\s\S]*max-height: min\(58dvh, 440px\)/);
});

test("phone and tablet presentation mode offers rich status, fullscreen and wake lock", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");

  assert.equal((html.match(/data-start-display/g) || []).length, 2);
  assert.match(html, /class="welcome-head"[\s\S]*data-start-display>全屏显示<\/button>/);
  assert.doesNotMatch(html, />开始展示<\/button>/);
  assert.match(html, /data-view-panel="display" aria-label="家庭信息展示模式"/);
  assert.match(html, /id="displayFullscreen"/);
  assert.match(html, /id="displayFoods"/);
  assert.match(html, /id="displayFreshnessBar"/);
  assert.match(html, /id="displayActivities"/);
  assert.match(css, /body\.presentation-view-active \.topbar \{ display: none; \}/);
  assert.match(css, /body\.presentation-view-active \.quick-agent \{[\s\S]*bottom: max\(20px, env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.ambient-grid \{[\s\S]*grid-template-columns: minmax\(280px, \.88fr\) minmax\(430px, 1\.45fr\)/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.ambient-food-list \{ grid-template-columns: 1fr; \}/);
  assert.match(app, /const views = new Set\(\["overview", "activities", "foods", "devices", "display", "agent", "users"\]\)/);
  assert.match(app, /navigator\.wakeLock\.request\("screen"\)/);
  assert.match(app, /document\.documentElement\.requestFullscreen/);
  assert.match(app, /button\.classList\.toggle\("hidden", !supported\)/);
  assert.match(app, /const DISPLAY_REFRESH_MS = 30 \* 1000;/);
  assert.match(app, /displayRefreshTimer = window\.setInterval\(refreshPresentationFoods, DISPLAY_REFRESH_MS\)/);
  assert.match(app, /state\.activities\.slice\(0, 3\)/);
  assert.match(app, /Promise\.all\(\[loadFoods\(\), loadActivities\(\)\]\)/);
  assert.match(app, /document\.addEventListener\("visibilitychange",[\s\S]*refreshPresentationFoods\(\)/);
  assert.match(css, /\.ambient-next-card \{[\s\S]*background: #f3dca9 !important;[\s\S]*color: #513b17;/);
  assert.match(css, /max-height: 420px\)[\s\S]*\.ambient-food:nth-child\(n\+3\) \{ display: none; \}/);
  assert.match(app, /document\.body\.classList\.toggle\("presentation-view-active", target === "display"\)/);
  assert.match(app, /data-display-handle="\$\{item\.id\}">快速处理<\/button>/);
  assert.match(app, /title: item \? `确认已处理“\$\{item\.name\}”？`/);
  assert.match(app, /await api\(`\/api\/foods\/\$\{handle\.dataset\.displayHandle\}`,[\s\S]*method: "DELETE"/);
  assert.match(css, /\.ambient-food-handle \{[\s\S]*min-height: 24px;/);
});

test("food management uses grouped compact rows with expandable and batch actions", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  const server = fs.readFileSync(path.resolve(publicDir, "../src/server.js"), "utf8");
  assert.match(html, /id="foodStatusFilter"/);
  assert.match(html, /id="foodSearch"[^>]*placeholder="搜索名称、分类或地点"/);
  assert.match(html, /id="foodLocationFilter"/);
  assert.match(html, /id="foodSortOrder"/);
  assert.match(html, /id="foodStatusMenu"[\s\S]*role="listbox"/);
  assert.match(html, /data-food-list-type="sort"/);
  assert.match(html, /id="foodManageToggle"/);
  assert.match(html, /id="foodBatchBar"/);
  assert.doesNotMatch(html, /class="food-table"/);
  assert.match(app, /const FOOD_LIST_GROUPS = \[/);
  assert.match(app, /data-food-expand/);
  assert.match(app, /data-food-select/);
  assert.match(app, /function renderFoodList\(\)/);
  assert.match(app, /function toggleFoodListMenu\(type\)/);
  assert.match(app, /FOOD_LIST_MENU_LABELS/);
  assert.match(app, /operation: "update_expiry"/);
  assert.match(css, /\.food-list-row/);
  assert.match(css, /\.food-filter-menu button\[aria-selected="true"\]/);
  assert.match(css, /\.food-list-tools \{ width: 100%; display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /min-height: 68px/);
  assert.match(css, /bottom: calc\(82px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(server, /url\.pathname === "\/api\/foods\/batch"/);
  assert.match(server, /foodService\.deleteFoodItems/);
  assert.match(server, /foodService\.updateFoodItems/);
  assert.match(app, /state\.foodList\.location/);
  assert.match(app, /\[item\.name, item\.category, item\.location, item\.quantityText\]/);
  assert.match(app, /days <= 36500/);
  assert.match(html, /name="location"[^>]*list="foodLocationSuggestions"/);
  assert.match(app, /\["药品", "💊"\]/);
});

test("conversation history provides an owner-scoped delete interaction", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  const server = fs.readFileSync(path.resolve(publicDir, "../src/server.js"), "utf8");
  assert.match(html, /styles\.css\?v=20260717-3/);
  assert.match(app, /data-delete-conversation/);
  assert.match(app, /删除历史对话/);
  assert.match(app, /method: "DELETE"/);
  assert.match(app, /state\.activeConversationId = result\.conversations\[0\]\?\.id \|\| null/);
  assert.match(css, /\.conversation-delete/);
  assert.match(css, /\.conversation-delete \{ opacity: 1; \}/);
  assert.match(server, /conversationMatch && req\.method === "DELETE"/);
  assert.match(server, /agentService\.deleteConversation\(user\.id/);
});

test("global quick agent only reuses the latest conversation for one hour", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(html, /app\.js\?v=20260717-3/);
  assert.match(app, /const QUICK_CONVERSATION_REUSE_MS = 60 \* 60 \* 1000/);
  assert.match(app, /async function ensureQuickConversation\(\)/);
  assert.match(app, /const latest = state\.conversations\[0\]/);
  assert.match(app, /Date\.now\(\) - updatedAt <= QUICK_CONVERSATION_REUSE_MS/);
  assert.match(app, /\$\("#quickAgentForm"\)[\s\S]*await ensureQuickConversation\(\)/);
  assert.match(app, /openQuickAgent\(\{ focus: false, loadMessages: false \}\)/);
  assert.match(app, /loadQuickAgentMessages\(\)/);
});

test("quick assistant keeps text fallback and preserves failed voice or Agent input", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /button\.disabled = supportsTextFallback \? processing : voiceUnavailable/);
  assert.match(app, /options\.onTranscribed\?\.\(result\.text\)/);
  assert.match(app, /onVoiceError: \(\) => openQuickAgent/);
  assert.match(app, /textarea\.value = content;[\s\S]*发送失败，输入内容已保留/);
  assert.match(app, /button\.title = supportsTextFallback && voiceUnavailable/);
});

test("household UI supports invitations, member controls and owner-only device pairing", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(html, /id="householdMembers"/);
  assert.match(html, /id="createHouseholdInvite"/);
  assert.match(html, /id="leaveHousehold"/);
  assert.match(app, /async function handlePendingHouseholdInvite\(\)/);
  assert.match(app, /\/api\/household\/invites\/accept/);
  assert.match(app, /permissions\.manageDevices/);
  assert.match(app, /data-remove-household-member/);
  assert.match(html, />系统 Agent<\/h2>/);
  assert.match(html, />我的 Agent<\/h2>/);
  assert.match(html, /id="systemAiSettingsCard"[\s\S]*class="[^"]*hidden/);
  assert.match(html, /id="registeredUsersCard"[\s\S]*class="[^"]*hidden/);
  assert.match(app, /systemCard\.classList\.toggle\("hidden", !state\.user\?\.isAdmin\)/);
  assert.match(app, /registeredUsersCard"\)\.classList\.toggle\("hidden", !result\.canManageUsers\)/);
  assert.match(app, /\/api\/admin\/agent\/settings/);
  assert.match(app, /个人配置仅自己可用|个人 API Key/);
  assert.doesNotMatch(html, /id="voiceSettingsForm"/);
  assert.match(app, /\/api\/agent\/voice-settings/);
});

test("user settings align account cards and explain how to configure a personal DeepSeek API key", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  assert.match(html, /https:\/\/platform\.deepseek\.com\/api_keys/);
  assert.match(html, /deepseek-v4-flash/);
  assert.match(html, /https:\/\/api\.deepseek\.com/);
  assert.match(app, /useDeepSeekPreset/);
  assert.match(app, /form\.elements\.openaiModel\.value = "deepseek-v4-flash"/);
  assert.match(css, /\.user-layout \{[^}]*align-items: stretch/);
  assert.match(css, /\.user-layout\.is-admin/);
  assert.match(css, /\.ai-provider-preset button \{ margin-left: auto; \}/);
});

test("Agent quota is visible to users and editable only from the administrator user list", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  assert.match(app, /Agent 输入额度/);
  assert.match(app, /data-user-quota/);
  assert.match(app, /agent-quota/);
  assert.match(app, /state\.canManageUsers \? `<form class="quota-form"/);
  assert.match(app, /剩余 \$\{result\.quota\.remaining\} 次/);
  assert.match(css, /\.quota-form > span \{[\s\S]*height: var\(--control-height-sm\)/);
  assert.match(css, /grid-template-areas: "limit limit" "usage save"/);
  assert.match(css, /\.quota-form button \{ grid-area: save;[\s\S]*height: var\(--control-height-md\)/);
});

test("buttons use a consistent three-level control scale", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  assert.match(css, /--control-height-sm: 32px/);
  assert.match(css, /--control-height-md: 44px/);
  assert.match(css, /--control-height-lg: 48px/);
  assert.match(css, /\.primary \{[\s\S]*height: var\(--control-height-md\)/);
  assert.match(css, /\.food-detail-actions button \{[\s\S]*height: var\(--control-height-md\)/);
  assert.match(css, /\.food-editor-actions button \{ height: var\(--control-height-lg\)/);
  assert.match(css, /\.link \{[\s\S]*min-height: var\(--control-height-sm\)/);
  assert.match(html, /id="leaveHousehold" class="danger-button hidden"/);
});

test("user page has a dedicated narrow mobile layout", () => {
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  assert.match(css, /\[data-view-panel="users"\] \.page-title h1 \{ font-size: 30px; \}/);
  assert.match(css, /\.user-layout > \.panel \{[\s\S]*min-width: 0; max-width: 100%; padding: 16px; overflow: hidden;/);
  assert.match(css, /\.household-member strong \{ grid-column: 1 \/ -1; grid-row: 1; \}/);
  assert.match(css, /\.household-member \.role-pill \{ grid-column: 1; grid-row: 3;/);
  assert.match(css, /\.household-actions button, \.household-invite button \{ width: 100%; \}/);
  assert.match(css, /\.mcp-config pre \{[\s\S]*max-width: 100%;[\s\S]*overscroll-behavior-inline: contain;/);
});

test("agent markdown tables stay inside assistant surfaces and scroll internally", () => {
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  assert.match(css, /\.quick-agent-messages \.agent-message \{ max-width: 92%; \}/);
  assert.match(css, /\.agent-markdown \{ min-width: 0; max-width: 100%; overflow-wrap: anywhere; \}/);
  assert.match(css, /\.markdown-table-wrap \{ width: 100%; min-width: 0; max-width: 100%;[\s\S]*overflow-x: auto; \}/);
});

test("pending actions show details before execution and block duplicate clicks", () => {
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  assert.match(app, /确认删除以下.*项物品/);
  assert.match(app, /确认后才会执行/);
  assert.match(app, /card\?\.dataset\.processing === "true"/);
  assert.match(app, /正在执行并生成回复/);
  assert.match(app, /button\.disabled = true/);
  assert.match(app, /\$\("#quickAgentMessages"\)\.addEventListener\("click", handleAgentActionClick\)/);
  assert.match(app, /Promise\.all\(\[loadAgentMessages\(\), loadQuickAgentMessages\(\), loadFoods\(\), loadActivities\(\)\]\)/);
  assert.doesNotMatch(app, /overviewAgentResult/);
});

test("household activity has an overview summary and a responsive full feed", () => {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
  const server = fs.readFileSync(path.resolve(publicDir, "../src/server.js"), "utf8");
  assert.match(html, /class="tile activity-summary"[\s\S]*<h2>最近操作<\/h2>/);
  assert.match(html, /data-view-target="activities">查看全部/);
  assert.match(html, /data-view-panel="activities" aria-label="家庭动态"/);
  assert.match(html, /id="activityFeed"/);
  assert.match(css, /\.activity-summary-list \{ display: grid; grid-template-columns: repeat\(3/);
  assert.match(css, /\.activity-item \{[\s\S]*grid-template-columns: 44px minmax\(0, 1fr\) auto/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*\.activity-summary-list \{ grid-template-columns: 1fr; \}/);
  assert.match(app, /async function loadActivities\(\{ append = false \} = \{\}\)/);
  assert.match(app, /\/api\/activities/);
  assert.match(server, /url\.pathname === "\/api\/activities"/);
  assert.match(server, /activityService\.recordFood/);
});
