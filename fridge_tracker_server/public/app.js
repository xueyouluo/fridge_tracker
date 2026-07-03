"use strict";

const $ = (selector) => document.querySelector(selector);
const state = { user: null, foods: [], devices: [], users: [], canManageUsers: false, today: "", editingId: null, view: "overview" };
const views = new Set(["overview", "foods", "display", "devices", "users"]);
const loginPanel = $("#loginPanel");
const workspace = $("#workspace");
const message = $("#message");
const foodForm = $("#foodForm");
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
    button.classList.toggle("active", button.dataset.viewTarget === target);
  });
  if (options.updateHash !== false) history.replaceState(null, "", `#${target}`);
  if (target === "display") refreshPreview();
  if (options.scroll !== false) window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToFoodForm() {
  window.requestAnimationFrame(() => {
    document.querySelector(".entry")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
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
  $("#todayText").textContent = `今天 ${result.today} · 屏幕按到期紧急度排序`;
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
    : `<strong>暂无已绑定设备</strong><span>前往设备页面输入绑定码</span>`;
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

function editFood(id) {
  const item = state.foods.find((food) => food.id === id);
  if (!item) return;
  setView("foods", { scroll: false });
  state.editingId = id;
  $("#formTitle").textContent = "编辑食材";
  $("#cancelEdit").classList.remove("hidden");
  foodForm.elements.id.value = id;
  foodForm.elements.name.value = item.name;
  foodForm.elements.category.value = item.category;
  foodForm.elements.quantityText.value = item.quantityText;
  foodForm.elements.expiresOn.value = item.expiresOn;
  foodForm.elements.startDate.value = item.startDate || "";
  foodForm.elements.shelfLifeDays.value = item.shelfLifeDays ?? "";
  scrollToFoodForm();
}

function resetFoodForm() {
  state.editingId = null;
  foodForm.reset();
  foodForm.elements.category.value = "水果";
  $("#formTitle").textContent = "添加食材";
  $("#cancelEdit").classList.add("hidden");
}

function formPayload(form) {
  const data = new FormData(form);
  return {
    name: data.get("name"),
    category: data.get("category"),
    quantityText: data.get("quantityText"),
    expiresOn: data.get("expiresOn") || null,
    startDate: data.get("startDate") || null,
    shelfLifeDays: data.get("shelfLifeDays") || null
  };
}

document.addEventListener("click", (event) => {
  const link = event.target.closest("[data-view-target]");
  if (!link) return;
  if (link.hasAttribute("data-new-food")) {
    resetFoodForm();
    setView(link.dataset.viewTarget, { scroll: false });
    scrollToFoodForm();
    return;
  }
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
  try {
    const url = state.editingId ? `/api/foods/${state.editingId}` : "/api/foods";
    await api(url, { method: state.editingId ? "PATCH" : "POST", body: JSON.stringify(formPayload(foodForm)) });
    resetFoodForm();
    await loadFoods();
    toast("食材信息已保存");
  } catch (error) {
    toast(error.message);
  }
});

$("#cancelEdit").addEventListener("click", resetFoodForm);
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
    editFood(Number(edit.dataset.edit));
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

$("#claimForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const claimCode = new FormData(event.target).get("claimCode");
    await api("/api/devices/claim", { method: "POST", body: JSON.stringify({ claimCode }) });
    event.target.reset();
    await loadDevices();
    toast("设备已绑定");
  } catch (error) {
    toast(error.message);
  }
});

function escapeHtml(text) {
  return String(text ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

initialize().catch((error) => toast(error.message));
