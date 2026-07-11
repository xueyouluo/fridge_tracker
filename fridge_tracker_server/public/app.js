"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { user: null, foods: [], devices: [], users: [], canManageUsers: false, today: "", editingId: null, view: "overview" };
const views = new Set(["overview", "foods", "display", "devices", "users"]);
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
  if (!response.ok) throw new Error(body?.error || `请求失败 (${response.status})`);
  return body;
}

function toast(text) {
  message.textContent = text;
  message.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => message.classList.remove("show"), 2500);
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
  const target = views.has(view) ? view : "overview";
  state.view = target;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.viewPanel === target);
  });
  document.querySelectorAll("#mainNav [data-view-target]").forEach((button) => {
    const active = button.dataset.viewTarget === target;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (options.updateHash !== false) history.replaceState(null, "", `#${target}`);
  if (target === "display") refreshPreview();
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
  await Promise.all([loadFoods(), loadDevices(), loadUsers()]);
  const initialView = location.hash.slice(1);
  setView(views.has(initialView) ? initialView : "overview", { updateHash: false, scroll: false });
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
    : `<strong>暂无已绑定设备</strong><span>前往设备页面生成配对码</span>`;
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
  $("#userCount").textContent = `${result.users.length} 位用户`;
  $("#userScope").textContent = result.canManageUsers ? "管理员可查看全部账号" : "仅显示当前账号";
  $("#accountRole").textContent = roleText(result.currentUser.role);
  $("#accountRole").className = `role-pill ${result.currentUser.role === "admin" ? "admin" : "member"}`;
  $("#accountPanel").innerHTML = renderAccount(result.currentUser);
  $("#users").innerHTML = result.users.length
    ? result.users.map(renderUser).join("")
    : `<p class="muted">暂无用户。</p>`;
}

function displayName(user) {
  return user?.displayName || user?.login || "用户";
}

function roleText(role) {
  return role === "admin" ? "管理员" : "成员";
}

function renderAccount(user) {
  return `
    <div class="account-line"><span>显示名</span><strong>${escapeHtml(displayName(user))}</strong></div>
    <div class="account-line"><span>邮箱</span><strong>${escapeHtml(user.email || "未设置")}</strong></div>
    <div class="account-line"><span>账号</span><strong>${escapeHtml(user.login)}</strong></div>
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
      <span>${escapeHtml(formatDate(user.createdAt))}</span>
    </div>
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
  const orientation = $("#previewOrientation").value;
  screenFrame.classList.toggle("portrait", orientation === "portrait");
  screenFrame.classList.toggle("landscape", orientation === "landscape");
  updatePreviewScale();
  window.requestAnimationFrame(updatePreviewScale);
  screenPreview.src = `/api/display/preview?panel=gdem075f52&orientation=${encodeURIComponent(orientation)}&t=${Date.now()}`;
}

function updatePreviewScale() {
  const orientation = $("#previewOrientation").value;
  const native = orientation === "portrait"
    ? { width: 480, height: 800 }
    : { width: 800, height: 480 };
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
window.addEventListener("resize", () => {
  if (state.view === "display") updatePreviewScale();
});
if ("ResizeObserver" in window) {
  new ResizeObserver(() => {
    if (state.view === "display") updatePreviewScale();
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

function escapeHtml(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

renderCategoryPicker();
initialize().catch((error) => toast(error.message));
