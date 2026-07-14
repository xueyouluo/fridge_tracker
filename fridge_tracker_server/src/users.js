"use strict";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value, options = {}) {
  const required = options.required !== false;
  const email = String(value || "").trim().toLowerCase();
  if (!email) {
    if (required) throw new Error("email is required");
    return "";
  }
  if (!EMAIL_PATTERN.test(email)) throw new Error("invalid email address");
  return email;
}

function normalizeDisplayName(value, fallback = "") {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40);
  if (name) return name;
  return String(fallback || "").trim().slice(0, 40);
}

function normalizePassword(value) {
  const password = String(value || "");
  if (password.length < 6) throw new Error("password must be at least 6 characters");
  return password;
}

function displayNameFromEmail(email) {
  return String(email || "").split("@")[0].slice(0, 40);
}

function isAdmin(user) {
  return user?.role === "admin";
}

function publicUser(row) {
  if (!row) return null;
  const result = {
    id: row.id,
    login: row.login,
    email: row.email || "",
    displayName: row.display_name || row.displayName || row.login,
    role: row.role || "member",
    isAdmin: (row.role || "member") === "admin",
    createdAt: row.created_at || row.createdAt || ""
  };
  if (row.food_count !== undefined) result.foodCount = Number(row.food_count);
  if (row.device_count !== undefined) result.deviceCount = Number(row.device_count);
  if (row.agent_input_quota !== undefined) {
    const limit = Number(row.agent_input_quota);
    const used = Number(row.agent_input_used || 0);
    result.agentQuota = { limit, used, remaining: Math.max(0, limit - used) };
  }
  return result;
}

module.exports = {
  displayNameFromEmail,
  isAdmin,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  publicUser
};
