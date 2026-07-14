"use strict";

const $ = (selector) => document.querySelector(selector);
const { renderMarkdown } = window.XianZhiMarkdown;
const voiceControllers = new WeakMap();
let activeVoiceController = null;
let voiceRecordingOverlayOwner = null;

function scrubSensitiveAuthQuery() {
  const url = new URL(window.location.href);
  const hadSensitiveAuthQuery = url.searchParams.has("login") || url.searchParams.has("password");
  if (!hadSensitiveAuthQuery) return;
  url.searchParams.delete("login");
  url.searchParams.delete("password");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

scrubSensitiveAuthQuery();
const state = { user: null, household: null, householdInvite: null, pendingInviteCode: new URL(window.location.href).searchParams.get("invite") || "", foods: [], devices: [], users: [], tokens: [], conversations: [], aiSettings: null, systemAiSettings: null, activeConversationId: null, agentConfigured: false, agentMode: "unconfigured", agentQuota: null, voiceConfigured: false, canManageUsers: false, today: "", editingId: null, view: "overview" };
const OVERVIEW_CONVERSATION_REUSE_MS = 60 * 60 * 1000;
const MAX_VOICE_RECORDING_MS = 60 * 1000;
const VOICE_LONG_PRESS_MS = 280;
const VOICE_CANCEL_DISTANCE_PX = 72;
const views = new Set(["overview", "foods", "devices", "agent", "users"]);
const loginPanel = $("#loginPanel");
const workspace = $("#workspace");
const message = $("#message");
const foodForm = $("#foodForm");
const foodEditor = {
  overlay: $("#foodEditorOverlay"),
  panel: $(".food-editor"),
  title: $("#foodEditorTitle"),
  hint: $("#foodEditorHint"),
  close: $("#foodEditorClose"),
  cancel: $("#foodEditorCancel"),
  save: $("#saveFood")
};
const CATEGORY_OPTIONS = [
  ["水果", "🍓"], ["蔬菜", "🥬"], ["肉类", "🥩"], ["海鲜", "🐟"],
  ["乳品", "🥛"], ["蛋类", "🥚"], ["饮料", "🥤"], ["豆制品", "🫘"],
  ["熟食", "🍱"], ["调味品", "🧂"], ["冷冻", "❄️"], ["甜点", "🍰"], ["其他", "📦"]
];
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const screenFrame = $("#screenFrame");
const screenPreview = $("#screenPreview");
const voiceRecordingOverlay = $("#voiceRecordingOverlay");
const voiceRecordingTitle = $("#voiceRecordingTitle");
const voiceRecordingHint = $("#voiceRecordingHint");
const voiceRecordingWave = $("#voiceRecordingWave");
const dialog = {
  overlay: $("#dialogOverlay"),
  eyebrow: $("#dialogEyebrow"),
  title: $("#dialogTitle"),
  body: $("#dialogBody"),
  cancel: $("#dialogCancel"),
  confirm: $("#dialogConfirm")
};
let closeActiveDialog = null;
let foodEditorPreviousFocus = null;
let foodEditorBaseline = "";
let expiryMode = "direct";
let activeCalendarTarget = null;
let calendarCursor = new Date();

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
  if (!response.ok) {
    const error = new Error(body?.error || `请求失败 (${response.status})`);
    error.code = body?.code || "";
    error.status = response.status;
    throw error;
  }
  return body;
}

function toast(text) {
  message.textContent = text;
  message.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => message.classList.remove("show"), 2500);
}

function mcpUrl() {
  return new URL("/mcp", window.location.origin).href;
}

function agentSetupPrompt(token) {
  return `请帮我安装“鲜知贴”MCP：名称设为 xianzhitie，服务地址是 ${mcpUrl()}，Bearer Token 是 ${token}。请按当前 Agent 客户端支持的方式完成配置，将令牌作为 XIANZHITIE_MCP_TOKEN 环境变量安全保存，不要把令牌写进项目文件、提交到 Git 或在回复中重复展示；配置后验证 MCP 是否能连接，并告诉我是否需要重启客户端。`;
}

function setAuthMode(mode) {
  const register = mode === "register";
  loginForm.classList.toggle("hidden", register);
  registerForm.classList.toggle("hidden", !register);
  $("#authTitle").textContent = register ? "注册鲜知贴" : "登录鲜知贴";
  $("#authHint").textContent = register ? "用邮箱创建一个本地账号" : "进入你的本地家庭工作台";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === mode);
  });
}

function confirmDialog({
  eyebrow = "需要确认",
  title = "确认操作",
  body = "",
  cancelText = "取消",
  confirmText = "确定",
  tone = "default"
}) {
  return new Promise((resolve) => {
    closeActiveDialog?.(false);
    const previousFocus = document.activeElement;

    const close = (confirmed) => {
      dialog.overlay.classList.add("hidden");
      dialog.overlay.setAttribute("aria-hidden", "true");
      dialog.cancel.removeEventListener("click", handleCancel);
      dialog.confirm.removeEventListener("click", handleConfirm);
      dialog.overlay.removeEventListener("click", handleOverlayClick);
      document.removeEventListener("keydown", handleKeyDown);
      closeActiveDialog = null;
      previousFocus?.focus?.({ preventScroll: true });
      resolve(confirmed);
    };

    const handleCancel = () => close(false);
    const handleConfirm = () => close(true);
    const handleOverlayClick = (event) => {
      if (event.target === dialog.overlay) close(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        close(false);
        return;
      }
      if (event.key === "Tab") {
        const focusable = [dialog.cancel, dialog.confirm];
        const currentIndex = focusable.indexOf(document.activeElement);
        const offset = event.shiftKey ? -1 : 1;
        const nextIndex = currentIndex === -1
          ? 0
          : (currentIndex + offset + focusable.length) % focusable.length;
        event.preventDefault();
        focusable[nextIndex].focus({ preventScroll: true });
      }
    };

    closeActiveDialog = close;
    dialog.eyebrow.textContent = eyebrow;
    dialog.title.textContent = title;
    dialog.body.textContent = body;
    dialog.cancel.textContent = cancelText;
    dialog.confirm.textContent = confirmText;
    dialog.confirm.classList.toggle("danger", tone === "danger");
    dialog.overlay.classList.remove("hidden");
    dialog.overlay.setAttribute("aria-hidden", "false");
    dialog.cancel.addEventListener("click", handleCancel);
    dialog.confirm.addEventListener("click", handleConfirm);
    dialog.overlay.addEventListener("click", handleOverlayClick);
    document.addEventListener("keydown", handleKeyDown);
    dialog.cancel.focus({ preventScroll: true });
  });
}

function setView(view, options = {}) {
  const normalized = view === "display" ? "devices" : view;
  const target = views.has(normalized) ? normalized : "overview";
  state.view = target;
  document.body.classList.toggle("agent-view-active", target === "agent");
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === target);
  });
  document.querySelectorAll("#mainNav [data-view-target]").forEach((button) => {
    const active = button.dataset.viewTarget === target;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (options.updateHash !== false) history.replaceState(null, "", `${location.pathname}${location.search}#${target}`);
  if (target === "devices") refreshPreview();
  if (target === "agent") loadAgent().catch((error) => toast(error.message));
  if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
}

function dateKeyFromDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(key) {
  const [year, month, day] = String(key || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day, 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

function currentDateKey() {
  return state.today || dateKeyFromDate(new Date());
}

function offsetDateKey(key, days) {
  const date = dateFromKey(key);
  if (!date) return "";
  date.setDate(date.getDate() + Number(days));
  return dateKeyFromDate(date);
}

function formatFoodDate(key) {
  const date = dateFromKey(key);
  if (!date) return "";
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

function renderCategoryPicker() {
  $("#categoryPicker").innerHTML = CATEGORY_OPTIONS.map(([name, icon]) => `
    <button class="category-option" type="button" role="option" aria-selected="false" data-category="${name}">
      <span aria-hidden="true">${icon}</span><span>${name}</span>
    </button>
  `).join("");
}

function setCategory(value) {
  const category = String(value || "");
  const option = CATEGORY_OPTIONS.find(([name]) => name === category);
  foodForm.elements.category.value = category;
  $("#selectedCategoryIcon").textContent = option?.[1] || (category ? "📦" : "＋");
  $("#selectedCategoryText").textContent = category || "请选择分类";
  document.querySelectorAll("[data-category]").forEach((button) => {
    const selected = button.dataset.category === category;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-selected", String(selected));
  });
  if (category) clearFieldError("category");
}

function closeCategoryPicker() {
  $("#categoryPicker").classList.add("hidden");
  $("#categoryTrigger").setAttribute("aria-expanded", "false");
}

function toggleCategoryPicker() {
  const picker = $("#categoryPicker");
  const opening = picker.classList.contains("hidden");
  closeCalendar();
  picker.classList.toggle("hidden", !opening);
  $("#categoryTrigger").setAttribute("aria-expanded", String(opening));
}

function clearFieldError(name) {
  const error = document.querySelector(`[data-error-for="${name}"]`);
  if (!error) return;
  error.textContent = "";
  error.closest(".field-group")?.classList.remove("invalid");
  if (name === "expiresOn") error.closest(".expiry-panel")?.classList.remove("invalid");
}

function clearFoodFormErrors() {
  document.querySelectorAll("#foodForm .field-error").forEach((error) => {
    error.textContent = "";
  });
  document.querySelectorAll("#foodForm .invalid").forEach((field) => field.classList.remove("invalid"));
}

function setFieldError(name, text) {
  const error = document.querySelector(`[data-error-for="${name}"]`);
  if (!error) return;
  error.textContent = text;
  error.closest(".field-group")?.classList.add("invalid");
  if (name === "expiresOn") error.closest(".expiry-panel")?.classList.add("invalid");
}

function updateDatePresets() {
  const selected = foodForm.elements.expiresOn.value;
  document.querySelectorAll("[data-date-offset]").forEach((button) => {
    button.classList.toggle("selected", selected === offsetDateKey(currentDateKey(), Number(button.dataset.dateOffset)));
  });
}

function updateShelfLifePresets() {
  const selected = foodForm.elements.shelfLifeDays.value;
  document.querySelectorAll("[data-shelf-life]").forEach((button) => {
    button.classList.toggle("selected", selected === button.dataset.shelfLife);
  });
}

function updateCalculatedExpiry() {
  const output = $("#calculatedExpiry");
  const startDate = foodForm.elements.startDate.value;
  const daysText = foodForm.elements.shelfLifeDays.value;
  const days = Number(daysText);
  if (startDate && daysText !== "" && Number.isInteger(days) && days >= 0 && days <= 3650) {
    const expiry = offsetDateKey(startDate, days);
    output.textContent = `预计到期：${formatFoodDate(expiry)}`;
    output.classList.add("ready");
  } else {
    output.textContent = "填写日期和保鲜天数后显示预计到期日";
    output.classList.remove("ready");
  }
}

function setDateValue(name, value) {
  foodForm.elements[name].value = value || "";
  const label = document.querySelector(`[data-date-label="${name}"]`);
  if (label) label.textContent = value ? formatFoodDate(value) : name === "expiresOn" ? "选择其他日期" : "选择日期";
  clearFieldError(name);
  if (name === "expiresOn") updateDatePresets();
  if (name === "startDate") updateCalculatedExpiry();
}

function setExpiryMode(mode, { initialize = false } = {}) {
  expiryMode = mode === "calculated" ? "calculated" : "direct";
  document.querySelectorAll("[data-expiry-mode]").forEach((button) => {
    const active = button.dataset.expiryMode === expiryMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-expiry-panel]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.expiryPanel !== expiryMode);
  });
  if (expiryMode === "calculated" && !initialize && !foodForm.elements.startDate.value) {
    setDateValue("startDate", currentDateKey());
  }
  closeCalendar();
  clearFieldError("expiresOn");
  clearFieldError("startDate");
  clearFieldError("shelfLifeDays");
  updateCalculatedExpiry();
}

function closeCalendar() {
  activeCalendarTarget = null;
  $("#foodCalendar").classList.add("hidden");
  document.querySelectorAll("[data-date-target]").forEach((button) => button.setAttribute("aria-expanded", "false"));
}

function renderCalendar() {
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const firstDay = new Date(year, month, 1, 12).getDay();
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const selected = activeCalendarTarget ? foodForm.elements[activeCalendarTarget].value : "";
  const today = currentDateKey();
  $("#calendarMonth").textContent = `${year} 年 ${month + 1} 月`;
  const cells = Array.from({ length: firstDay }, () => `<span class="calendar-spacer"></span>`);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKeyFromDate(new Date(year, month, day, 12));
    const classes = ["calendar-day", key === today ? "today" : "", key === selected ? "selected" : ""].filter(Boolean).join(" ");
    cells.push(`<button class="${classes}" type="button" data-calendar-date="${key}" aria-label="${formatFoodDate(key)}">${day}</button>`);
  }
  $("#calendarGrid").innerHTML = cells.join("");
}

function openCalendar(target) {
  closeCategoryPicker();
  activeCalendarTarget = target;
  const selectedDate = dateFromKey(foodForm.elements[target].value || currentDateKey());
  calendarCursor = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
  $("#foodCalendar").classList.remove("hidden");
  document.querySelectorAll("[data-date-target]").forEach((button) => {
    button.setAttribute("aria-expanded", String(button.dataset.dateTarget === target));
  });
  renderCalendar();
}

function foodEditorStateKey() {
  return JSON.stringify({
    id: foodForm.elements.id.value,
    name: foodForm.elements.name.value,
    category: foodForm.elements.category.value,
    quantityText: foodForm.elements.quantityText.value,
    expiryMode,
    expiresOn: foodForm.elements.expiresOn.value,
    startDate: foodForm.elements.startDate.value,
    shelfLifeDays: foodForm.elements.shelfLifeDays.value
  });
}

function finishFoodEditorClose() {
  foodEditor.overlay.classList.add("hidden");
  foodEditor.overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  document.removeEventListener("keydown", handleFoodEditorKeyDown);
  closeCategoryPicker();
  closeCalendar();
  state.editingId = null;
  foodEditorPreviousFocus?.focus?.({ preventScroll: true });
  foodEditorPreviousFocus = null;
}

async function requestFoodEditorClose({ force = false } = {}) {
  if (!force && foodEditorStateKey() !== foodEditorBaseline) {
    const discard = await confirmDialog({
      eyebrow: "尚未保存",
      title: "要放弃这次修改吗？",
      body: "关闭后，本次填写的内容不会保存。",
      confirmText: "放弃修改",
      tone: "danger"
    });
    if (!discard) return;
  }
  finishFoodEditorClose();
}

function handleFoodEditorKeyDown(event) {
  if (foodEditor.overlay.classList.contains("hidden") || !dialog.overlay.classList.contains("hidden")) return;
  if (event.key === "Escape") {
    if (!$("#categoryPicker").classList.contains("hidden")) closeCategoryPicker();
    else if (!$("#foodCalendar").classList.contains("hidden")) closeCalendar();
    else requestFoodEditorClose();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = [...foodEditor.panel.querySelectorAll("button:not([disabled]), input:not([disabled])")]
    .filter((element) => element.offsetParent !== null && element.type !== "hidden");
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openFoodEditor(item = null, trigger = document.activeElement) {
  closeActiveDialog?.(false);
  foodForm.reset();
  clearFoodFormErrors();
  closeCategoryPicker();
  closeCalendar();
  state.editingId = item?.id ?? null;
  foodForm.elements.id.value = item?.id ?? "";
  foodForm.elements.name.value = item?.name || "";
  foodForm.elements.quantityText.value = item?.quantityText || "";
  setCategory(item?.category || "");
  setDateValue("expiresOn", item?.expiresOn || "");
  setDateValue("startDate", item?.startDate || "");
  foodForm.elements.shelfLifeDays.value = item?.shelfLifeDays ?? "";
  updateShelfLifePresets();
  setExpiryMode(item?.startDate && item?.shelfLifeDays !== null ? "calculated" : "direct", { initialize: true });
  foodEditor.title.textContent = item ? "编辑食材" : "添加食材";
  foodEditor.hint.textContent = item ? "修改后会同步更新概览和墨水屏内容。" : "填写食材名称、分类和到期信息即可。";
  foodEditor.save.textContent = item ? "保存修改" : "添加食材";
  foodEditorPreviousFocus = trigger;
  foodEditor.overlay.classList.remove("hidden");
  foodEditor.overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  document.addEventListener("keydown", handleFoodEditorKeyDown);
  foodEditorBaseline = foodEditorStateKey();
  window.requestAnimationFrame(() => foodForm.elements.name.focus({ preventScroll: true }));
}

function validateFoodForm() {
  clearFoodFormErrors();
  const focusTargets = [];
  if (!foodForm.elements.name.value.trim()) {
    setFieldError("name", "请输入食材名称");
    focusTargets.push(foodForm.elements.name);
  }
  if (!foodForm.elements.category.value) {
    setFieldError("category", "请选择食材分类");
    focusTargets.push($("#categoryTrigger"));
  }
  if (expiryMode === "direct") {
    if (!foodForm.elements.expiresOn.value) {
      setFieldError("expiresOn", "请选择到期日期");
      focusTargets.push(document.querySelector('[data-date-target="expiresOn"]'));
    }
  } else {
    if (!foodForm.elements.startDate.value) {
      setFieldError("startDate", "请选择购买或生产日期");
      focusTargets.push(document.querySelector('[data-date-target="startDate"]'));
    }
    const value = foodForm.elements.shelfLifeDays.value;
    const days = Number(value);
    if (value === "") {
      setFieldError("shelfLifeDays", "请输入保鲜天数");
      focusTargets.push(foodForm.elements.shelfLifeDays);
    } else if (!Number.isInteger(days) || days < 0 || days > 3650) {
      setFieldError("shelfLifeDays", "请输入 0 至 3650 之间的整数");
      focusTargets.push(foodForm.elements.shelfLifeDays);
    }
  }
  focusTargets[0]?.focus?.({ preventScroll: false });
  return focusTargets.length === 0;
}

async function initialize() {
  const result = await api("/api/auth/me");
  if (result.user) await enterWorkspace(result.user);
}

async function enterWorkspace(user) {
  state.user = user;
  loginPanel.classList.add("hidden");
  workspace.classList.remove("hidden");
  $("#mainNav").classList.remove("hidden");
  $("#sessionActions").classList.remove("hidden");
  $("#accountName").textContent = displayName(user);
  $("#welcomeUser").textContent = displayName(user);
  await loadHousehold();
  await Promise.all([loadFoods(), loadDevices(), loadUsers(), loadTokens(), loadAiSettings(), loadVoiceSettings(), loadConversations()]);
  const initialView = location.hash.slice(1);
  setView(initialView || "overview", { updateHash: false, scroll: false });
  await handlePendingHouseholdInvite();
}

function householdRoleText(role) {
  return role === "owner" ? "家庭创建者" : "家庭成员";
}

function renderHouseholdMember(member) {
  const canRemove = state.household?.permissions.manageMembers && member.householdRole === "member";
  return `<article class="household-member">
    <strong>${escapeHtml(member.displayName)}</strong>
    <small>${escapeHtml(member.email || member.login)}</small>
    <span class="role-pill ${member.householdRole === "owner" ? "admin" : "member"}">${escapeHtml(householdRoleText(member.householdRole))}</span>
    ${canRemove ? `<button type="button" data-remove-household-member="${member.id}">移除</button>` : ""}
  </article>`;
}

async function loadHousehold() {
  const result = await api("/api/household");
  state.household = result;
  $("#householdName").textContent = result.household.name;
  $("#householdRole").textContent = householdRoleText(result.currentRole);
  $("#householdRole").className = `role-pill ${result.currentRole === "owner" ? "admin" : "member"}`;
  $("#householdHint").textContent = result.currentRole === "owner"
    ? "你可以邀请家人、管理成员和配对设备，所有成员共同维护食材。"
    : "你和家人共同维护食材；成员邀请和设备配对由家庭创建者管理。";
  $("#householdMembers").innerHTML = result.members.map(renderHouseholdMember).join("");
  $("#createHouseholdInvite").classList.toggle("hidden", !result.permissions.manageMembers);
  $("#leaveHousehold").classList.toggle("hidden", !result.permissions.leaveHousehold);
  $("#generatePairingCode").classList.toggle("hidden", !result.permissions.manageDevices);
  $("#devicePairingHint").textContent = result.permissions.manageDevices
    ? "先生成一次性配对码，再在 ESP32 配网页填写该码。配对成功后设备会关联到当前家庭。"
    : "设备由家庭创建者管理；你仍可查看设备状态和共享的屏幕画面。";
}

async function handlePendingHouseholdInvite() {
  const code = state.pendingInviteCode;
  if (!code) return;
  try {
    const invite = await api(`/api/household/invites/inspect?code=${encodeURIComponent(code)}`);
    const confirmed = await confirmDialog({
      eyebrow: "家庭邀请",
      title: `加入“${invite.household.name}”？`,
      body: `${invite.inviter.displayName} 邀请你共同管理家庭食材和屏幕内容。加入后，你当前的空家庭会被替换。`,
      confirmText: "加入家庭"
    });
    if (!confirmed) return;
    await api("/api/household/invites/accept", { method: "POST", body: JSON.stringify({ code }) });
    state.pendingInviteCode = "";
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("invite");
    history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    await Promise.all([loadHousehold(), loadFoods(), loadDevices(), loadUsers()]);
    toast("已加入家庭");
  } catch (error) {
    toast(error.code === "household_not_empty" ? "当前家庭已有食材或设备，暂时无法加入其他家庭" : error.message);
  }
}

async function loadFoods() {
  const result = await api("/api/foods");
  state.foods = result.items;
  state.today = result.today;
  $("#foodCount").textContent = `${result.items.length} 项食材`;
  $("#todayText").textContent = `今天 ${result.today} · 按到期紧急度排序`;
  renderMetrics();
  $("#foods").innerHTML = result.items.length
    ? result.items.map(renderFood).join("")
    : `<tr><td class="table-empty" colspan="5">尚未添加食材。</td></tr>`;
  $("#overviewFoods").innerHTML = result.items.length
    ? result.items.slice(0, 4).map(renderPriorityFood).join("")
    : `<p class="muted">添加食材后，这里会优先展示即将到期的内容。</p>`;
}

function renderMetrics() {
  const expired = state.foods.filter((food) => food.status === "expired").length;
  const expiring = state.foods.filter((food) => food.status === "expiring").length;
  $("#totalCount").textContent = state.foods.length;
  $("#expiredCount").textContent = expired;
  $("#expiringCount").textContent = expiring;
}

function statusText(item) {
  if (item.status === "expired") return `已过期 ${Math.abs(item.daysRemaining)} 天`;
  if (item.daysRemaining === 0) return "今天到期";
  return `${item.daysRemaining} 天`;
}

function renderPriorityFood(item) {
  return `<article class="priority-food">
    <strong>${escapeHtml(item.name)}</strong>
    <small>${escapeHtml(item.category)} · 到期 ${escapeHtml(item.expiresOn)}</small>
    <span class="tag ${item.status}">${escapeHtml(statusText(item))}</span>
  </article>`;
}

function renderFood(item) {
  return `<tr class="food-row">
    <td data-label="食材"><strong class="food-name">${escapeHtml(item.name)}</strong>${item.quantityText ? `<small>${escapeHtml(item.quantityText)}</small>` : ""}</td>
    <td data-label="分类"><span class="category-pill">${escapeHtml(item.category)}</span></td>
    <td data-label="到期日" class="food-date">${escapeHtml(item.expiresOn)}</td>
    <td data-label="状态"><span class="tag ${item.status}">${escapeHtml(statusText(item))}</span></td>
    <td data-label="操作"><div class="actions">
      <button type="button" data-edit="${item.id}">编辑</button>
      <button type="button" class="delete" data-delete="${item.id}">删除</button>
    </div></td>
  </tr>`;
}

async function loadDevices() {
  const result = await api("/api/devices");
  state.devices = result.devices;
  $("#devices").innerHTML = result.devices.length
    ? result.devices.map(renderDevice).join("")
    : `<p class="muted">尚未绑定屏幕设备。</p>`;
  const recent = result.devices.find((device) => device.lastSeenAt) || result.devices[0];
  $("#overviewDevice").innerHTML = recent
    ? `<strong>${escapeHtml(recent.serial)}</strong><span>${recent.lastSeenAt ? `最近同步 ${escapeHtml(formatTime(recent.lastSeenAt))}` : "已绑定，等待首次同步"}</span>`
    : `<strong>暂无已绑定设备</strong><span>${state.household?.permissions.manageDevices ? "前往设备页面生成配对码" : "请联系家庭创建者配对设备"}</span>`;
}

function renderDevice(device) {
  return `<article class="device">
    <strong>${escapeHtml(device.serial)}</strong>
    <span>${escapeHtml(device.panelProfile)} · ${device.lastSeenAt ? `最近同步 ${escapeHtml(formatTime(device.lastSeenAt))}` : "等待首次同步"}</span>
  </article>`;
}

async function loadUsers() {
  const result = await api("/api/users");
  state.user = result.currentUser;
  state.users = result.users;
  state.canManageUsers = result.canManageUsers;
  $("#userLayout").classList.toggle("is-admin", result.canManageUsers);
  $("#userCount").classList.toggle("hidden", !result.canManageUsers);
  $("#registeredUsersCard").classList.toggle("hidden", !result.canManageUsers);
  $("#userCount").textContent = result.canManageUsers ? `${result.users.length} 位用户` : "";
  $("#userScope").textContent = result.canManageUsers ? "管理员可查看全部账号" : "仅显示当前账号";
  $("#accountRole").textContent = roleText(result.currentUser.role);
  $("#accountRole").className = `role-pill ${result.currentUser.role === "admin" ? "admin" : "member"}`;
  $("#accountPanel").innerHTML = renderAccount(result.currentUser);
  $("#users").innerHTML = result.users.length
    ? result.users.map(renderUser).join("")
    : `<p class="muted">暂无用户。</p>`;
}

async function loadTokens() {
  const result = await api("/api/access-tokens");
  state.tokens = result.tokens;
  $("#accessTokens").innerHTML = result.tokens.length ? result.tokens.map((token) => `
    <article class="token-row">
      <div><strong>${escapeHtml(token.name)}</strong><code>${escapeHtml(token.prefix)}…</code></div>
      <small>${token.revokedAt ? "已撤销" : `有效期至 ${escapeHtml(formatDate(token.expiresAt))}`}${token.lastUsedAt ? ` · 最近使用 ${escapeHtml(formatTime(token.lastUsedAt))}` : ""}</small>
      ${token.revokedAt ? "" : `<button class="delete" type="button" data-revoke-token="${token.id}">撤销</button>`}
    </article>
  `).join("") : `<p class="muted">尚未创建 MCP 访问令牌。</p>`;
}

async function loadAiSettings() {
  const result = await api("/api/agent/settings");
  state.aiSettings = result;
  const form = $("#aiSettingsForm");
  $("#aiSettingsHint").textContent = result.configured
    ? "当前优先使用你的个人配置，不消耗系统输入额度；API Key 不会再次回显。"
    : result.systemConfigured
      ? "当前使用管理员提供的系统 Agent；填写个人配置后会自动优先使用你的 API Key。"
      : "系统 Agent 尚未配置，你可以填写自己的 API Key 后立即使用。";
  $("#aiSettingsState").textContent = result.configured
    ? `个人配置 ${result.apiKeyHint}`
    : result.systemConfigured ? "使用系统配置" : "未配置";
  form.elements.openaiApiKey.value = "";
  form.elements.openaiApiKey.placeholder = result.configured
    ? `${result.apiKeyHint}（留空保留）`
    : "首次配置必填";
  form.elements.openaiModel.value = result.openaiModel || "";
  form.elements.openaiBaseUrl.value = result.openaiBaseUrl || "https://api.openai.com/v1";
  $("#clearAiSettings").disabled = !result.configured;

  const systemCard = $("#systemAiSettingsCard");
  const systemForm = $("#systemAiSettingsForm");
  systemCard.classList.toggle("hidden", !state.user?.isAdmin);
  if (!state.user?.isAdmin) {
    state.systemAiSettings = { configured: result.systemConfigured };
    return;
  }

  const system = await api("/api/admin/agent/settings");
  state.systemAiSettings = system;
  $("#systemAiSettingsState").textContent = system.configured ? `已配置 ${system.apiKeyHint}` : "未配置";
  $("#systemAiSettingsHint").textContent = "这套配置供未设置个人 API Key 的注册用户使用，API Key 不会再次回显。";
  systemForm.elements.openaiApiKey.value = "";
  systemForm.elements.openaiApiKey.placeholder = system.configured
    ? `${system.apiKeyHint}（留空保留）`
    : "首次配置必填";
  systemForm.elements.openaiModel.value = system.openaiModel || "";
  systemForm.elements.openaiBaseUrl.value = system.openaiBaseUrl || "https://api.openai.com/v1";
  $("#clearSystemAiSettings").disabled = !system.configured;
}

async function loadVoiceSettings() {
  const result = await api("/api/agent/voice-settings");
  state.voiceConfigured = result.configured;
  [$("#agentForm"), $("#overviewAgentForm")].forEach(updateVoiceButtonAvailability);
}

async function loadConversations() {
  const result = await api("/api/agent/conversations");
  state.agentConfigured = result.configured;
  state.agentMode = result.mode;
  state.agentQuota = result.quota;
  state.conversations = result.conversations;
  const available = isAgentAvailable();
  $("#agentStatus").textContent = result.mode === "personal"
    ? "个人 Agent 已连接 · 不消耗系统额度"
    : result.mode === "system"
      ? result.quota.remaining > 0 ? `系统 Agent 已连接 · 剩余 ${result.quota.remaining} 次` : "系统输入额度已用完"
      : "Agent 未配置";
  $("#overviewAgentStatus").textContent = result.mode === "personal"
    ? "正在使用个人 API Key，不消耗系统输入额度。"
    : result.mode === "system"
      ? result.quota.remaining > 0
        ? `系统额度剩余 ${result.quota.remaining} / ${result.quota.limit} 次输入`
        : "系统输入额度已用完，可填写个人 API Key 或联系管理员增加额度。"
      : "Agent 未配置，请填写个人 API Key 或联系管理员配置系统 Agent。";
  setAgentFormAvailability($("#agentForm"), available);
  setAgentFormAvailability($("#overviewAgentForm"), available);
  if (!result.conversations.some((conversation) => conversation.id === state.activeConversationId)) {
    state.activeConversationId = result.conversations[0]?.id || null;
  }
  renderConversations();
  if (state.activeConversationId) {
    await loadAgentMessages();
  } else {
    $("#agentMessages").innerHTML = `<div class="agent-empty"><strong>开始一段新对话</strong><span>点击“新对话”，或直接在下方输入你想做的事。</span></div>`;
  }
}

function renderConversations() {
  const activeConversation = state.conversations.find((conversation) => conversation.id === state.activeConversationId);
  $("#activeConversationTitle").textContent = activeConversation?.title || "新对话";
  $("#conversations").innerHTML = state.conversations.length ? state.conversations.map((conversation) => `
    <div class="conversation-row ${conversation.id === state.activeConversationId ? "active" : ""}">
      <button type="button" class="conversation-item ${conversation.id === state.activeConversationId ? "active" : ""}" data-conversation="${escapeHtml(conversation.id)}">
        <strong>${escapeHtml(conversation.title)}</strong><small>${escapeHtml(formatTime(conversation.updatedAt))}</small>
      </button>
      <button type="button" class="conversation-delete" data-delete-conversation="${escapeHtml(conversation.id)}" aria-label="删除对话：${escapeHtml(conversation.title)}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>
      </button>
    </div>
  `).join("") : `<p class="muted">点击“新对话”开始。</p>`;
}

function setConversationListOpen(open) {
  const expanded = window.matchMedia("(max-width: 640px)").matches && open;
  $("#conversationPanel").classList.toggle("mobile-open", expanded);
  $("#conversationToggle").setAttribute("aria-expanded", String(expanded));
}

function renderPendingDetail(detail) {
  const actionLabels = { create: "新增", update: "修改", delete: "删除" };
  const metadata = [detail.category, detail.quantityText, detail.expiresOn ? `到期 ${detail.expiresOn}` : ""].filter(Boolean);
  return `<li><strong>${escapeHtml(actionLabels[detail.operation] || "变更")}「${escapeHtml(detail.name || "食材")}」</strong>
    ${metadata.length ? `<span>${metadata.map(escapeHtml).join(" · ")}</span>` : ""}
  </li>`;
}

function renderAgentEvent(event, seenPendingIds = new Set()) {
  if (event.pendingAction) {
    const pending = event.pendingAction;
    const pendingKey = pending.resolution ? pending.id : JSON.stringify(pending.actions || pending.summary);
    if (seenPendingIds.has(pendingKey)) return "";
    seenPendingIds.add(pendingKey);
    if (pending.resolution) {
      return `<div class="agent-result ${pending.resolution === "cancelled" ? "cancelled" : ""}">${pending.resolution === "confirmed" ? "操作已确认执行" : "操作已取消"}</div>`;
    }
    const details = pending.details || [];
    const onlyDeletes = details.length > 0 && details.every((detail) => detail.operation === "delete");
    const confirmationTitle = onlyDeletes ? `确认删除以下 ${details.length} 项食材？` : "确认执行以下变更？";
    return `<article class="pending-action" data-pending-card="${escapeHtml(pending.id)}">
      <strong>${escapeHtml(confirmationTitle)}</strong><span>${escapeHtml(pending.summary)}</span>
      ${details.length ? `<ul class="pending-details">${details.map(renderPendingDetail).join("")}</ul>` : ""}
      <small>确认后才会执行 · 有效期至 ${escapeHtml(formatTime(pending.expiresAt))}</small>
      <div><button type="button" class="quiet" data-agent-cancel="${escapeHtml(pending.id)}">取消</button><button type="button" class="primary" data-agent-confirm="${escapeHtml(pending.id)}">确认执行</button></div>
    </article>`;
  }
  if (event.executed) return `<div class="agent-result">已完成 ${event.executed.length} 项变更</div>`;
  return "";
}

function renderAgentMessage(message, seenPendingIds = new Set()) {
  const events = message.metadata?.events || [];
  const content = message.content
    ? `<div class="${message.role === "assistant" ? "agent-markdown" : "agent-plain"}">${message.role === "assistant" ? renderMarkdown(message.content) : escapeHtml(message.content).replaceAll("\n", "<br>")}</div>`
    : "";
  return `<article class="agent-message ${message.role}">
    ${content}
    ${events.map((event) => renderAgentEvent(event, seenPendingIds)).join("")}
  </article>`;
}

async function loadAgentMessages() {
  if (!state.activeConversationId) return;
  const result = await api(`/api/agent/conversations/${encodeURIComponent(state.activeConversationId)}/messages`);
  const seenPendingIds = new Set();
  $("#agentMessages").innerHTML = result.messages.length
    ? result.messages.map((message) => renderAgentMessage(message, seenPendingIds)).join("")
    : `<div class="agent-empty"><strong>直接说出你想做的事</strong><span>例如：“帮我添加一盒牛奶，7 月 20 日到期。”</span></div>`;
  $("#agentMessages").scrollTop = $("#agentMessages").scrollHeight;
}

async function loadAgent() {
  await loadConversations();
}

async function createConversation() {
  const conversation = await api("/api/agent/conversations", { method: "POST", body: JSON.stringify({ title: "新对话" }) });
  state.activeConversationId = conversation.id;
  await loadConversations();
  return conversation;
}

async function ensureOverviewConversation() {
  const latest = state.conversations[0];
  const updatedAt = Date.parse(latest?.updatedAt || "");
  if (latest && Number.isFinite(updatedAt) && Date.now() - updatedAt <= OVERVIEW_CONVERSATION_REUSE_MS) {
    state.activeConversationId = latest.id;
    return latest;
  }
  return createConversation();
}

function displayName(user) {
  return user?.displayName || user?.login || "用户";
}

function roleText(role) {
  return role === "admin" ? "管理员" : "成员";
}

function isAgentAvailable() {
  return state.agentMode === "personal" || (state.agentMode === "system" && Number(state.agentQuota?.remaining || 0) > 0);
}

function renderAccount(user) {
  return `
    <div class="account-line"><span>显示名</span><strong>${escapeHtml(displayName(user))}</strong></div>
    <div class="account-line"><span>邮箱</span><strong>${escapeHtml(user.email || "未设置")}</strong></div>
    <div class="account-line"><span>账号</span><strong>${escapeHtml(user.login)}</strong></div>
    <div class="account-line"><span>Agent 输入额度</span><strong>${escapeHtml(user.agentQuota?.remaining ?? 0)} / ${escapeHtml(user.agentQuota?.limit ?? 0)} 次</strong></div>
    <div class="account-line"><span>注册时间</span><strong>${escapeHtml(formatDate(user.createdAt))}</strong></div>
  `;
}

function renderUser(user) {
  return `<article class="user-card">
    <strong>${escapeHtml(displayName(user))}</strong>
    <small>${escapeHtml(user.email || user.login)}</small>
    <span class="role-pill ${user.role === "admin" ? "admin" : "member"}">${escapeHtml(roleText(user.role))}</span>
    <div class="user-meta">
      <span>${escapeHtml(user.foodCount ?? 0)} 项食材</span>
      <span>${escapeHtml(user.deviceCount ?? 0)} 台设备</span>
      <span>Agent 剩余 ${escapeHtml(user.agentQuota?.remaining ?? 0)} / ${escapeHtml(user.agentQuota?.limit ?? 0)} 次</span>
      <span>${escapeHtml(formatDate(user.createdAt))}</span>
    </div>
    ${state.canManageUsers ? `<form class="quota-form" data-user-quota="${user.id}">
      <label>总额度 <input name="limit" type="number" min="0" max="1000000" step="1" value="${escapeHtml(user.agentQuota?.limit ?? 100)}" required></label>
      <span>已用 ${escapeHtml(user.agentQuota?.used ?? 0)} 次</span>
      <button class="quiet" type="submit">保存额度</button>
    </form>` : ""}
  </article>`;
}

function formatTime(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDate(value) {
  if (!value) return "未知";
  return new Date(value).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function renderPairingCode(result) {
  $("#pairingCodeText").textContent = result.code;
  $("#pairingCodeExpires").textContent = `有效期至 ${formatTime(result.expiresAt)}`;
  $("#pairingCodePanel").classList.remove("hidden");
}

function refreshPreview() {
  const panel = $("#previewPanel").value;
  const orientation = $("#previewOrientation").value;
  screenFrame.classList.toggle("portrait", orientation === "portrait");
  screenFrame.classList.toggle("landscape", orientation === "landscape");
  updatePreviewScale();
  window.requestAnimationFrame(updatePreviewScale);
  const isTriColor = panel === "gdey042z98";
  const rowLimit = isTriColor
    ? (orientation === "portrait" ? 7 : 5)
    : (orientation === "portrait" ? 9 : 8);
  $("#previewEyebrow").textContent = isTriColor ? "三色电子纸" : "四色电子纸";
  $("#previewRowLimit").textContent = `${rowLimit} 项`;
  $("#previewRowLabel").textContent = `${orientation === "portrait" ? "竖屏" : "横屏"}展示上限`;
  $("#previewFrameBytes").textContent = isTriColor ? "30 KB" : "96 KB";
  $("#previewFrameLabel").textContent = isTriColor ? "三色双平面协议" : "四色原生帧协议";
  $("#previewDescription").textContent = isTriColor
    ? "已过期和三天内到期都使用红色；临期项目同时保留粗体和下划线，便于区分。内容改变后，设备下次唤醒时刷新画面。"
    : "红色表示已过期，黄色表示三天内到期。内容改变后，设备下次唤醒时刷新画面。";
  screenPreview.src = `/api/display/preview?panel=${encodeURIComponent(panel)}&orientation=${encodeURIComponent(orientation)}&t=${Date.now()}`;
}

function updatePreviewScale() {
  const panel = $("#previewPanel").value;
  const orientation = $("#previewOrientation").value;
  const panelSize = panel === "gdey042z98"
    ? { width: 400, height: 300 }
    : { width: 800, height: 480 };
  const native = orientation === "portrait"
    ? { width: panelSize.height, height: panelSize.width }
    : panelSize;
  const container = screenFrame.parentElement;
  if (!container || container.clientWidth < 50) {
    window.requestAnimationFrame(updatePreviewScale);
    return;
  }
  const containerStyle = getComputedStyle(container);
  const screenStyle = getComputedStyle(screenFrame);
  const containerPaddingX = parseFloat(containerStyle.paddingLeft) + parseFloat(containerStyle.paddingRight);
  const screenPaddingX = parseFloat(screenStyle.paddingLeft) + parseFloat(screenStyle.paddingRight);
  const availableWidth = Math.max(1, container.clientWidth - containerPaddingX - screenPaddingX);
  const scale = Math.min(1, availableWidth / native.width);
  screenFrame.style.setProperty("--screen-native-width", `${native.width}px`);
  screenFrame.style.setProperty("--screen-native-height", `${native.height}px`);
  screenFrame.style.setProperty("--screen-scaled-width", `${Math.round(native.width * scale)}px`);
  screenFrame.style.setProperty("--screen-scaled-height", `${Math.round(native.height * scale)}px`);
  screenFrame.style.setProperty("--screen-scale", scale.toFixed(4));
}

function editFood(id, trigger) {
  const item = state.foods.find((food) => food.id === id);
  if (!item) return;
  openFoodEditor(item, trigger);
}

function formPayload(form) {
  const data = new FormData(form);
  return {
    name: data.get("name"),
    category: data.get("category"),
    quantityText: data.get("quantityText"),
    expiresOn: expiryMode === "direct" ? data.get("expiresOn") || null : null,
    startDate: expiryMode === "calculated" ? data.get("startDate") || null : null,
    shelfLifeDays: expiryMode === "calculated" ? data.get("shelfLifeDays") || null : null
  };
}

document.addEventListener("click", (event) => {
  const newFood = event.target.closest("[data-new-food]");
  if (newFood) {
    openFoodEditor(null, newFood);
    return;
  }
  const link = event.target.closest("[data-view-target]");
  if (!link) return;
  setView(link.dataset.viewTarget);
  if (link.dataset.deviceSection === "preview") {
    window.requestAnimationFrame(() => $("#devicePreviewSection").scrollIntoView({ behavior: "smooth", block: "start" }));
  }
});

window.addEventListener("hashchange", () => {
  if (state.user) setView(location.hash.slice(1), { updateHash: false });
});

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(event.target);
    const user = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ login: data.get("login"), password: data.get("password") })
    });
    await enterWorkspace(user);
  } catch (error) {
    toast(error.message);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = new FormData(event.target);
    const user = await api("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        email: data.get("email"),
        displayName: data.get("displayName"),
        password: data.get("password")
      })
    });
    event.target.reset();
    await enterWorkspace(user);
    toast("账号已创建");
  } catch (error) {
    toast(error.message);
  }
});

$("#logout").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  location.hash = "";
  location.reload();
});

foodForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateFoodForm()) return;
  const editing = Boolean(state.editingId);
  foodEditor.save.disabled = true;
  try {
    const url = state.editingId ? `/api/foods/${state.editingId}` : "/api/foods";
    await api(url, { method: state.editingId ? "PATCH" : "POST", body: JSON.stringify(formPayload(foodForm)) });
    await loadFoods();
    await requestFoodEditorClose({ force: true });
    toast(editing ? "食材信息已更新" : "食材已添加");
  } catch (error) {
    toast(`保存失败：${error.message}`);
  } finally {
    foodEditor.save.disabled = false;
  }
});

foodEditor.close.addEventListener("click", () => requestFoodEditorClose());
foodEditor.cancel.addEventListener("click", () => requestFoodEditorClose());
foodEditor.overlay.addEventListener("click", (event) => {
  if (event.target === foodEditor.overlay) requestFoodEditorClose();
});
$("#categoryTrigger").addEventListener("click", toggleCategoryPicker);
$("#categoryPicker").addEventListener("click", (event) => {
  const option = event.target.closest("[data-category]");
  if (!option) return;
  setCategory(option.dataset.category);
  closeCategoryPicker();
  $("#categoryTrigger").focus({ preventScroll: true });
});
document.querySelectorAll("[data-expiry-mode]").forEach((button) => {
  button.addEventListener("click", () => setExpiryMode(button.dataset.expiryMode));
});
document.querySelectorAll("[data-date-offset]").forEach((button) => {
  button.addEventListener("click", () => {
    setDateValue("expiresOn", offsetDateKey(currentDateKey(), Number(button.dataset.dateOffset)));
    closeCalendar();
  });
});
document.querySelectorAll("[data-shelf-life]").forEach((button) => {
  button.addEventListener("click", () => {
    foodForm.elements.shelfLifeDays.value = button.dataset.shelfLife;
    clearFieldError("shelfLifeDays");
    updateShelfLifePresets();
    updateCalculatedExpiry();
  });
});
document.querySelectorAll("[data-date-target]").forEach((button) => {
  button.addEventListener("click", () => {
    if (activeCalendarTarget === button.dataset.dateTarget && !$("#foodCalendar").classList.contains("hidden")) closeCalendar();
    else openCalendar(button.dataset.dateTarget);
  });
});
$("#calendarPrevious").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1, 12);
  renderCalendar();
});
$("#calendarNext").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1, 12);
  renderCalendar();
});
$("#calendarGrid").addEventListener("click", (event) => {
  const day = event.target.closest("[data-calendar-date]");
  if (!day || !activeCalendarTarget) return;
  setDateValue(activeCalendarTarget, day.dataset.calendarDate);
  closeCalendar();
});
foodForm.elements.name.addEventListener("input", () => clearFieldError("name"));
foodForm.elements.shelfLifeDays.addEventListener("input", () => {
  clearFieldError("shelfLifeDays");
  updateShelfLifePresets();
  updateCalculatedExpiry();
});
$("#refreshPreview").addEventListener("click", refreshPreview);
$("#previewOrientation").addEventListener("change", refreshPreview);
$("#previewPanel").addEventListener("change", refreshPreview);
window.addEventListener("resize", () => {
  if (state.view === "devices") updatePreviewScale();
});
if ("ResizeObserver" in window) {
  new ResizeObserver(() => {
    if (state.view === "devices") updatePreviewScale();
  }).observe(screenFrame);
}

$("#foods").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit]");
  if (edit) {
    editFood(Number(edit.dataset.edit), edit);
    return;
  }
  const remove = event.target.closest("[data-delete]");
  if (remove) {
    const item = state.foods.find((food) => food.id === Number(remove.dataset.delete));
    const confirmed = await confirmDialog({
      eyebrow: "删除食材",
      title: "确定删除该食材吗？",
      body: item
        ? `${item.name} 将从冰箱记录中移除，墨水屏下次刷新时也会同步更新。`
        : "删除后将无法在列表中继续显示。",
      confirmText: "删除",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      await api(`/api/foods/${remove.dataset.delete}`, { method: "DELETE" });
      await loadFoods();
      toast("食材已删除");
    } catch (error) {
      toast(error.message);
    }
  }
});

$("#generatePairingCode").addEventListener("click", async () => {
  try {
    const result = await api("/api/devices/pairing-codes", { method: "POST", body: "{}" });
    renderPairingCode(result);
    toast("配对码已生成");
  } catch (error) {
    toast(error.message);
  }
});

$("#createHouseholdInvite").addEventListener("click", async () => {
  try {
    const result = await api("/api/household/invites", { method: "POST", body: "{}" });
    state.householdInvite = result;
    $("#householdInviteCode").textContent = result.code;
    $("#householdInviteExpires").textContent = `有效期至 ${formatTime(result.expiresAt)}，使用一次后失效`;
    $("#householdInvitePanel").classList.remove("hidden");
    toast("家庭邀请已生成");
  } catch (error) {
    toast(error.message);
  }
});

$("#copyHouseholdInvite").addEventListener("click", async () => {
  if (!state.householdInvite?.inviteUrl) return;
  try {
    await navigator.clipboard.writeText(state.householdInvite.inviteUrl);
    toast("邀请链接已复制");
  } catch {
    toast(`复制失败，请分享邀请码 ${state.householdInvite.code}`);
  }
});

$("#householdMembers").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-household-member]");
  if (!button) return;
  const member = state.household?.members.find((item) => item.id === Number(button.dataset.removeHouseholdMember));
  const confirmed = await confirmDialog({
    eyebrow: "家庭成员",
    title: `移除“${member?.displayName || "该成员"}”？`,
    body: "移除后，对方将立即失去这个家庭的食材、设备和屏幕访问权限，并获得一个新的空家庭。",
    confirmText: "移除",
    tone: "danger"
  });
  if (!confirmed) return;
  try {
    await api(`/api/household/members/${button.dataset.removeHouseholdMember}`, { method: "DELETE" });
    await loadHousehold();
    toast("家庭成员已移除");
  } catch (error) {
    toast(error.message);
  }
});

$("#leaveHousehold").addEventListener("click", async () => {
  const confirmed = await confirmDialog({
    eyebrow: "退出家庭",
    title: `退出“${state.household?.household.name || "当前家庭"}”？`,
    body: "退出后你将无法访问当前家庭的食材、设备和屏幕内容，系统会为你创建一个新的空家庭。",
    confirmText: "退出",
    tone: "danger"
  });
  if (!confirmed) return;
  try {
    await api("/api/household/leave", { method: "POST", body: "{}" });
    state.householdInvite = null;
    $("#householdInvitePanel").classList.add("hidden");
    await Promise.all([loadHousehold(), loadFoods(), loadDevices(), loadUsers()]);
    toast("已退出家庭");
  } catch (error) {
    toast(error.message);
  }
});

$("#tokenForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  button.disabled = true;
  try {
    const data = new FormData(event.target);
    const result = await api("/api/access-tokens", { method: "POST", body: JSON.stringify({ name: data.get("name") }) });
    $("#newTokenValue").textContent = result.token;
    $("#agentSetupPrompt").textContent = agentSetupPrompt(result.token);
    $("#newTokenPanel").classList.remove("hidden");
    event.target.reset();
    await loadTokens();
    toast("访问令牌已生成");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#aiSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = new FormData(event.target);
    await api("/api/agent/settings", {
      method: "PUT",
      body: JSON.stringify({
        openaiApiKey: data.get("openaiApiKey"),
        openaiModel: data.get("openaiModel"),
        openaiBaseUrl: data.get("openaiBaseUrl")
      })
    });
    await Promise.all([loadAiSettings(), loadConversations()]);
    toast("个人模型配置已保存");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#useDeepSeekPreset").addEventListener("click", () => {
  const form = $("#aiSettingsForm");
  form.elements.openaiModel.value = "deepseek-v4-flash";
  form.elements.openaiBaseUrl.value = "https://api.deepseek.com";
  form.elements.openaiApiKey.focus();
  toast("已填入 DeepSeek 参数，请粘贴 API Key");
});

$("#clearAiSettings").addEventListener("click", async () => {
  const confirmed = await confirmDialog({
    title: "改用系统 Agent？",
    body: "你的个人 API Key 和模型配置会被清除；历史对话不会删除。之后将使用系统 Agent 和个人系统额度。",
    confirmText: "改用系统配置"
  });
  if (!confirmed) return;
  try {
    await api("/api/agent/settings", { method: "DELETE" });
    await Promise.all([loadAiSettings(), loadConversations()]);
    toast("已改用系统 Agent");
  } catch (error) {
    toast(error.message);
  }
});

$("#systemAiSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const data = new FormData(event.target);
    await api("/api/admin/agent/settings", {
      method: "PUT",
      body: JSON.stringify({
        openaiApiKey: data.get("openaiApiKey"),
        openaiModel: data.get("openaiModel"),
        openaiBaseUrl: data.get("openaiBaseUrl")
      })
    });
    await Promise.all([loadAiSettings(), loadConversations()]);
    toast("系统 Agent 配置已保存");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#clearSystemAiSettings").addEventListener("click", async () => {
  const confirmed = await confirmDialog({
    title: "清除系统 Agent？",
    body: "清除后，未设置个人 API Key 的用户将无法使用 Agent；个人配置和历史对话不会删除。",
    confirmText: "清除系统配置",
    tone: "danger"
  });
  if (!confirmed) return;
  try {
    await api("/api/admin/agent/settings", { method: "DELETE" });
    await Promise.all([loadAiSettings(), loadConversations()]);
    toast("系统 Agent 配置已清除");
  } catch (error) {
    toast(error.message);
  }
});

$("#users").addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-user-quota]");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const data = new FormData(form);
    await api(`/api/users/${encodeURIComponent(form.dataset.userQuota)}/agent-quota`, {
      method: "PATCH",
      body: JSON.stringify({ limit: Number(data.get("limit")) })
    });
    await Promise.all([loadUsers(), loadConversations()]);
    toast("Agent 额度已更新");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#copyToken").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#newTokenValue").textContent);
    toast("令牌已复制");
  } catch {
    toast("复制失败，请手动选择令牌");
  }
});

$("#copyAgentSetup").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("#agentSetupPrompt").textContent);
    toast("Agent 配置指令已复制");
  } catch {
    toast("复制失败，请手动选择配置指令");
  }
});

$("#accessTokens").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-revoke-token]");
  if (!button) return;
  const confirmed = await confirmDialog({ title: "撤销访问令牌？", body: "使用该令牌的 Agent 将立即无法访问食材。", confirmText: "撤销", tone: "danger" });
  if (!confirmed) return;
  try {
    await api(`/api/access-tokens/${button.dataset.revokeToken}`, { method: "DELETE" });
    await loadTokens();
    toast("令牌已撤销");
  } catch (error) {
    toast(error.message);
  }
});

$("#newConversation").addEventListener("click", () => {
  setConversationListOpen(false);
  createConversation().catch((error) => toast(error.message));
});

$("#conversationToggle").addEventListener("click", () => {
  setConversationListOpen($("#conversationToggle").getAttribute("aria-expanded") !== "true");
});

$("#conversations").addEventListener("click", async (event) => {
  const remove = event.target.closest("[data-delete-conversation]");
  if (remove) {
    const conversation = state.conversations.find((item) => item.id === remove.dataset.deleteConversation);
    const confirmed = await confirmDialog({
      eyebrow: "删除历史对话",
      title: `删除“${conversation?.title || "这段对话"}”？`,
      body: "对话消息和未完成的确认操作都会一并删除，且无法恢复。",
      confirmText: "删除",
      tone: "danger"
    });
    if (!confirmed) return;
    try {
      await api(`/api/agent/conversations/${encodeURIComponent(remove.dataset.deleteConversation)}`, { method: "DELETE" });
      if (state.activeConversationId === remove.dataset.deleteConversation) state.activeConversationId = null;
      await loadConversations();
      setConversationListOpen(false);
      toast("对话已删除");
    } catch (error) {
      toast(error.message);
    }
    return;
  }
  const button = event.target.closest("[data-conversation]");
  if (!button) return;
  state.activeConversationId = button.dataset.conversation;
  renderConversations();
  setConversationListOpen(false);
  await loadAgentMessages();
});

$("#agentMessages").addEventListener("click", () => setConversationListOpen(false));
window.addEventListener("resize", () => {
  if (!window.matchMedia("(max-width: 640px)").matches) setConversationListOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setConversationListOpen(false);
});

$("#agentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const textarea = event.target.elements.content;
  const content = textarea.value.trim();
  if (!content) return;
  if (!state.activeConversationId) await createConversation();
  const button = event.target.querySelector('[type="submit"]');
  const voiceButton = event.target.querySelector("[data-voice-input]");
  textarea.disabled = true;
  button.disabled = true;
  if (voiceButton) updateVoiceButtonAvailability(event.target);
  textarea.value = "";
  resizeAgentTextarea(textarea);
  $("#agentMessages").insertAdjacentHTML("beforeend", `<article class="agent-message user"><div>${escapeHtml(content)}</div></article><article id="agentThinking" class="agent-message assistant thinking"><div>正在处理…</div></article>`);
  $("#agentMessages").scrollTop = $("#agentMessages").scrollHeight;
  try {
    await api("/api/agent/messages", { method: "POST", body: JSON.stringify({ conversationId: state.activeConversationId, content }) });
    await Promise.all([loadConversations(), loadFoods()]);
  } catch (error) {
    $("#agentThinking")?.remove();
    textarea.value = content;
    resizeAgentTextarea(textarea);
    toast(`发送失败，输入内容已保留：${agentSendErrorMessage(error)}`);
  } finally {
    textarea.disabled = !isAgentAvailable();
    button.disabled = !isAgentAvailable();
    if (voiceButton) updateVoiceButtonAvailability(event.target);
    textarea.focus();
  }
});

$("#overviewAgentForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const textarea = event.target.elements.content;
  const content = textarea.value.trim();
  if (!content) return;
  await ensureOverviewConversation();
  const button = event.target.querySelector('[type="submit"]');
  const voiceButton = event.target.querySelector("[data-voice-input]");
  textarea.disabled = true;
  button.disabled = true;
  if (voiceButton) updateVoiceButtonAvailability(event.target);
  $("#overviewAgentResult").classList.remove("hidden");
  $("#overviewAgentResult").innerHTML = `<article class="agent-message assistant thinking"><div>正在处理…</div></article>`;
  try {
    const result = await api("/api/agent/messages", { method: "POST", body: JSON.stringify({ conversationId: state.activeConversationId, content }) });
    textarea.value = "";
    $("#overviewAgentResult").innerHTML = renderAgentMessage(result.message);
    await Promise.all([loadConversations(), loadFoods()]);
  } catch (error) {
    const message = agentSendErrorMessage(error);
    $("#overviewAgentResult").innerHTML = `<div class="agent-quick-error">发送失败，输入内容已保留：${escapeHtml(message)}</div>`;
    toast(`发送失败，输入内容已保留：${message}`);
  } finally {
    textarea.disabled = !isAgentAvailable();
    button.disabled = !isAgentAvailable();
    if (voiceButton) updateVoiceButtonAvailability(event.target);
    textarea.focus();
  }
});

async function handleAgentActionClick(event) {
  const actionContainer = event.currentTarget;
  const confirm = event.target.closest("[data-agent-confirm]");
  const cancel = event.target.closest("[data-agent-cancel]");
  if (!confirm && !cancel) return;
  const card = (confirm || cancel).closest(".pending-action");
  if (card?.dataset.processing === "true") return;
  const id = confirm?.dataset.agentConfirm || cancel.dataset.agentCancel;
  const buttons = card ? [...card.querySelectorAll("button")] : [confirm || cancel];
  const actionButton = confirm || cancel;
  const originalLabel = actionButton.textContent;
  if (card) {
    card.dataset.processing = "true";
    card.setAttribute("aria-busy", "true");
  }
  buttons.forEach((button) => { button.disabled = true; });
  actionButton.textContent = confirm ? "正在执行并生成回复…" : "正在取消…";
  try {
    const result = await api(`/api/agent/actions/${encodeURIComponent(id)}/${confirm ? "confirm" : "cancel"}`, { method: "POST", body: "{}" });
    await Promise.all([loadAgentMessages(), loadFoods()]);
    if (state.view === "devices") refreshPreview();
    if (actionContainer.id === "overviewAgentResult") {
      actionContainer.innerHTML = result.message
        ? renderAgentMessage(result.message)
        : `<div class="agent-result">${confirm ? "操作已确认执行" : "操作已取消"}</div>`;
    }
    const completedText = result.alreadyResolved
      ? (result.resolution === "confirmed" ? "操作已经执行，无需重复确认" : "操作已经取消")
      : (confirm ? "操作已确认执行" : "操作已取消");
    toast(completedText);
  } catch (error) {
    if (card) {
      delete card.dataset.processing;
      card.removeAttribute("aria-busy");
    }
    buttons.forEach((button) => { button.disabled = false; });
    actionButton.textContent = originalLabel;
    toast(error.message);
  }
}

$("#agentMessages").addEventListener("click", handleAgentActionClick);
$("#overviewAgentResult").addEventListener("click", handleAgentActionClick);

function enableEnterToSubmit(form) {
  const textarea = form.querySelector("textarea");
  textarea.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    const submitButton = form.querySelector('[type="submit"]');
    if (!textarea.disabled && !submitButton.disabled) form.requestSubmit();
  });
}

function resizeAgentTextarea(textarea) {
  textarea.style.height = "40px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
}

function agentSendErrorMessage(error) {
  if (error?.message === "Connection error.") return "无法连接家庭 Agent 模型，请检查用户页面里的模型配置";
  return error?.message || "发送给助手失败，请稍后重试";
}

function enableAgentTextareaAutoGrow(form) {
  const textarea = form.querySelector("textarea");
  textarea.addEventListener("input", () => resizeAgentTextarea(textarea));
  resizeAgentTextarea(textarea);
}

function setAgentFormAvailability(form, available) {
  form.classList.toggle("agent-disabled", !available);
  form.querySelector("textarea").disabled = !available;
  form.querySelector('[type="submit"]').disabled = !available;
  if (!available) voiceControllers.get(form)?.abort();
  updateVoiceButtonAvailability(form);
}

function updateVoiceButtonAvailability(form) {
  const button = form.querySelector("[data-voice-input]");
  const modeToggle = form.querySelector("[data-input-mode-toggle]");
  if (!button) return;
  const controller = voiceControllers.get(form);
  const processing = controller?.isProcessing() === true;
  const formUnavailable = form.querySelector("textarea")?.disabled === true;
  const voiceUnavailable = !controller || formUnavailable || !state.agentConfigured || !state.voiceConfigured || processing;
  button.disabled = voiceUnavailable;
  if (modeToggle) modeToggle.disabled = voiceUnavailable;
  button.title = !state.voiceConfigured
    ? "系统语音识别尚未配置"
    : "按住说话，松开发送";
}

function initializeVoiceRecordingWave() {
  if (!voiceRecordingWave || voiceRecordingWave.childElementCount) return;
  const bars = Array.from({ length: 38 }, (_, index) => {
    const bar = document.createElement("span");
    bar.style.setProperty("--voice-bar-height", `${10 + ((index * 13) % 25)}px`);
    return bar;
  });
  voiceRecordingWave.replaceChildren(...bars);
}

function showVoiceRecordingOverlay(owner, { preparing = false } = {}) {
  if (!voiceRecordingOverlay) return;
  voiceRecordingOverlayOwner = owner;
  voiceRecordingOverlay.classList.remove("hidden", "is-cancelling");
  voiceRecordingOverlay.setAttribute("aria-hidden", "false");
  voiceRecordingTitle.textContent = preparing ? "正在准备麦克风…" : "正在收音…";
  voiceRecordingHint.textContent = "松手发送，上移取消";
  document.body.classList.add("voice-recording-open");
}

function setVoiceRecordingCancelState(owner, cancelling) {
  if (!voiceRecordingOverlay || voiceRecordingOverlayOwner !== owner) return;
  voiceRecordingOverlay.classList.toggle("is-cancelling", cancelling);
  voiceRecordingTitle.textContent = cancelling ? "松手取消" : "正在收音…";
  voiceRecordingHint.textContent = cancelling ? "下移可继续录音" : "松手发送，上移取消";
}

function hideVoiceRecordingOverlay(owner) {
  if (!voiceRecordingOverlay || (owner && voiceRecordingOverlayOwner !== owner)) return;
  voiceRecordingOverlay.classList.add("hidden");
  voiceRecordingOverlay.classList.remove("is-cancelling");
  voiceRecordingOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("voice-recording-open");
  voiceRecordingOverlayOwner = null;
}

function preferredAudioMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  if (typeof window.MediaRecorder?.isTypeSupported !== "function") return "";
  return candidates.find((mimeType) => window.MediaRecorder.isTypeSupported(mimeType)) || "";
}

function audioBlobBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "").split(",", 2)[1] || ""), { once: true });
    reader.addEventListener("error", () => reject(new Error("读取录音失败，请重试")), { once: true });
    reader.readAsDataURL(blob);
  });
}

function microphoneErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return window.isSecureContext
      ? "未获得麦克风权限，请在浏览器设置中允许访问"
      : "麦克风需要 HTTPS，请通过安全地址打开页面";
  }
  if (error?.name === "NotFoundError") return "没有找到可用的麦克风";
  if (error?.name === "NotReadableError") return "麦克风正被其他应用占用";
  return error?.message || "无法启动录音，请重试";
}

function setupVoiceInput(form) {
  const button = form.querySelector("[data-voice-input]");
  const textSurface = form.querySelector("[data-voice-text-surface]");
  const modeToggle = form.querySelector("[data-input-mode-toggle]");
  const status = form.querySelector("[data-voice-status]");
  const textarea = form.querySelector("textarea");
  const submitButton = form.querySelector('[type="submit"]');
  const recordingSupported = Boolean(button && textSurface && modeToggle && status && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  if (!recordingSupported) {
    if (modeToggle) {
      modeToggle.disabled = true;
      modeToggle.title = "当前浏览器不支持网页录音";
    }
    return;
  }

  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let starting = false;
  let recording = false;
  let processing = false;
  let releaseRequested = false;
  let cancelRequested = false;
  let maximumTimer = null;
  let statusTimer = null;
  let longPressTimer = null;
  let pointerPress = null;

  function updateStatus(text, { error = false, clearAfter = 0 } = {}) {
    clearTimeout(statusTimer);
    status.textContent = text;
    status.classList.toggle("error", error);
    if (clearAfter) {
      statusTimer = setTimeout(() => {
        status.textContent = "";
        status.classList.remove("error");
      }, clearAfter);
    }
  }

  function stopStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function setRecordingUi(active) {
    form.classList.toggle("is-recording", active);
    button.setAttribute("aria-pressed", String(active));
    button.setAttribute("aria-label", active ? "松开发送" : "按住说话，松开发送");
    submitButton.disabled = active || processing || textarea.disabled || !state.agentConfigured;
  }

  function setInputMode(mode, { focus = false } = {}) {
    const nextMode = mode === "voice" ? "voice" : "text";
    form.dataset.inputMode = nextMode;
    modeToggle.setAttribute("aria-label", nextMode === "voice" ? "切换到文本输入" : "切换到纯语音输入");
    if (focus && nextMode === "text") {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }

  function resetPointerPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    pointerPress = null;
    form.classList.remove("is-long-press-pending");
  }

  async function finishRecording() {
    clearTimeout(maximumTimer);
    hideVoiceRecordingOverlay(controller);
    const durationMs = Math.max(0, Date.now() - startedAt);
    const mimeType = String(recorder?.mimeType || preferredAudioMimeType() || "audio/webm").split(";", 1)[0];
    const blob = new Blob(chunks, { type: mimeType });
    const cancelled = cancelRequested;
    recorder = null;
    chunks = [];
    recording = false;
    starting = false;
    setRecordingUi(false);
    stopStream();
    if (activeVoiceController === controller) activeVoiceController = null;
    if (cancelled) {
      updateStatus("已取消录音", { clearAfter: 1800 });
      updateVoiceButtonAvailability(form);
      return;
    }
    if (durationMs < 350 || blob.size < 128) {
      updateStatus("按住时间太短，请说完后再松开", { error: true, clearAfter: 3200 });
      updateVoiceButtonAvailability(form);
      return;
    }

    processing = true;
    button.classList.add("is-processing");
    updateVoiceButtonAvailability(form);
    updateStatus("正在识别并发送…");
    try {
      const result = await api("/api/agent/transcriptions", {
        method: "POST",
        body: JSON.stringify({
          mimeType,
          audioBase64: await audioBlobBase64(blob),
          durationMs
        })
      });
      textarea.value = result.text;
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      processing = false;
      button.classList.remove("is-processing");
      updateVoiceButtonAvailability(form);
      button.disabled = true;
      updateStatus("识别完成，正在发送…", { clearAfter: 1800 });
      form.requestSubmit();
    } catch (error) {
      processing = false;
      button.classList.remove("is-processing");
      updateVoiceButtonAvailability(form);
      updateStatus(error.message, { error: true, clearAfter: 4200 });
      toast(error.message);
    }
  }

  const controller = {
    abort() {
      resetPointerPress();
      hideVoiceRecordingOverlay(controller);
      if (starting) {
        releaseRequested = true;
        cancelRequested = true;
        return;
      }
      if (!recording || recorder?.state === "inactive") return;
      cancelRequested = true;
      recorder.stop();
    },
    isBusy() {
      return starting || recording || processing;
    },
    isProcessing() {
      return processing;
    }
  };
  voiceControllers.set(form, controller);

  async function beginRecording() {
    if (button.disabled || controller.isBusy()) return;
    activeVoiceController?.abort();
    activeVoiceController = controller;
    releaseRequested = false;
    cancelRequested = false;
    starting = true;
    setRecordingUi(true);
    updateVoiceButtonAvailability(form);
    updateStatus("正在请求麦克风…");
    showVoiceRecordingOverlay(controller, { preparing: true });
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      if (releaseRequested) {
        starting = false;
        setRecordingUi(false);
        hideVoiceRecordingOverlay(controller);
        stopStream();
        if (activeVoiceController === controller) activeVoiceController = null;
        updateVoiceButtonAvailability(form);
        updateStatus(cancelRequested ? "已取消录音" : "麦克风已就绪，请重新按住说话", { clearAfter: 2600 });
        return;
      }
      const preferredMimeType = preferredAudioMimeType();
      recorder = new MediaRecorder(stream, {
        ...(preferredMimeType ? { mimeType: preferredMimeType } : {}),
        audioBitsPerSecond: 32_000
      });
      chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        finishRecording().catch((error) => {
          processing = false;
          button.classList.remove("is-processing");
          updateVoiceButtonAvailability(form);
          updateStatus(error.message, { error: true, clearAfter: 4200 });
        });
      }, { once: true });
      recorder.start(250);
      startedAt = Date.now();
      starting = false;
      recording = true;
      setRecordingUi(true);
      updateVoiceButtonAvailability(form);
      updateStatus("正在录音，松开发送");
      showVoiceRecordingOverlay(controller);
      setVoiceRecordingCancelState(controller, pointerPress?.cancelling === true);
      maximumTimer = setTimeout(() => {
        updateStatus("已到 60 秒，正在识别并发送…");
        hideVoiceRecordingOverlay(controller);
        if (recorder?.state === "recording") recorder.stop();
      }, MAX_VOICE_RECORDING_MS);
    } catch (error) {
      starting = false;
      recording = false;
      setRecordingUi(false);
      hideVoiceRecordingOverlay(controller);
      stopStream();
      if (activeVoiceController === controller) activeVoiceController = null;
      updateVoiceButtonAvailability(form);
      updateStatus(microphoneErrorMessage(error), { error: true, clearAfter: 4200 });
    }
  }

  function releaseRecording(cancel = false) {
    if (starting) {
      releaseRequested = true;
      cancelRequested = cancel;
      hideVoiceRecordingOverlay(controller);
      return;
    }
    if (!recording || recorder?.state !== "recording") return;
    cancelRequested = cancel;
    hideVoiceRecordingOverlay(controller);
    recorder.stop();
  }

  function focusTextarea() {
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function handlePointerDown(event, source, { delayed = false } = {}) {
    if (event.button !== 0) return;
    if (button.disabled || controller.isBusy()) return;
    event.preventDefault();
    resetPointerPress();
    source.setPointerCapture?.(event.pointerId);
    pointerPress = {
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
      activated: !delayed,
      suppressTap: false,
      cancelling: false
    };
    if (!delayed) {
      beginRecording();
      return;
    }
    form.classList.add("is-long-press-pending");
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (!pointerPress) return;
      pointerPress.activated = true;
      form.classList.remove("is-long-press-pending");
      navigator.vibrate?.(12);
      beginRecording();
    }, VOICE_LONG_PRESS_MS);
  }

  function handlePointerMove(event) {
    if (!pointerPress || pointerPress.pointerId !== event.pointerId) return;
    const horizontalDistance = Math.abs(event.clientX - pointerPress.startX);
    const verticalDistance = Math.abs(event.clientY - pointerPress.startY);
    if (!pointerPress.activated) {
      if (Math.max(horizontalDistance, verticalDistance) > 12) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        pointerPress.suppressTap = true;
        form.classList.remove("is-long-press-pending");
      }
      return;
    }
    event.preventDefault();
    const cancelling = pointerPress.startY - event.clientY >= VOICE_CANCEL_DISTANCE_PX;
    if (cancelling === pointerPress.cancelling) return;
    pointerPress.cancelling = cancelling;
    setVoiceRecordingCancelState(controller, cancelling);
  }

  function handlePointerUp(event) {
    if (!pointerPress || pointerPress.pointerId !== event.pointerId) return;
    event.preventDefault();
    const { activated, cancelling, source, suppressTap } = pointerPress;
    resetPointerPress();
    if (activated) {
      releaseRecording(cancelling);
      return;
    }
    if (!suppressTap && source === textSurface) focusTextarea();
  }

  function handlePointerCancel(event) {
    if (!pointerPress || pointerPress.pointerId !== event.pointerId) return;
    const activated = pointerPress.activated;
    resetPointerPress();
    if (activated) releaseRecording(true);
  }

  textSurface.addEventListener("pointerdown", (event) => handlePointerDown(event, textSurface, { delayed: true }));
  textSurface.addEventListener("pointermove", handlePointerMove);
  textSurface.addEventListener("pointerup", handlePointerUp);
  textSurface.addEventListener("pointercancel", handlePointerCancel);
  textSurface.addEventListener("contextmenu", (event) => {
    if (form.classList.contains("is-long-press-pending") || controller.isBusy()) event.preventDefault();
  });
  button.addEventListener("pointerdown", (event) => handlePointerDown(event, button));
  button.addEventListener("pointermove", handlePointerMove);
  button.addEventListener("pointerup", handlePointerUp);
  button.addEventListener("pointercancel", handlePointerCancel);
  button.addEventListener("keydown", (event) => {
    if (![" ", "Enter"].includes(event.key) || event.repeat) return;
    event.preventDefault();
    beginRecording();
  });
  button.addEventListener("keyup", (event) => {
    if (![" ", "Enter"].includes(event.key)) return;
    event.preventDefault();
    releaseRecording(false);
  });
  button.addEventListener("click", (event) => event.preventDefault());
  button.addEventListener("contextmenu", (event) => event.preventDefault());
  modeToggle.addEventListener("click", () => {
    if (modeToggle.disabled || controller.isBusy()) return;
    setInputMode(form.dataset.inputMode === "voice" ? "text" : "voice", { focus: form.dataset.inputMode === "voice" });
  });
  button.hidden = false;
  setInputMode("text");
  updateVoiceButtonAvailability(form);
}

initializeVoiceRecordingWave();
enableEnterToSubmit($("#agentForm"));
enableEnterToSubmit($("#overviewAgentForm"));
enableAgentTextareaAutoGrow($("#agentForm"));
setupVoiceInput($("#agentForm"));
setupVoiceInput($("#overviewAgentForm"));

function escapeHtml(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

renderCategoryPicker();
initialize().catch((error) => toast(error.message));
