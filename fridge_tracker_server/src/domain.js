"use strict";

const crypto = require("node:crypto");

const PANEL_PROFILES = new Set(["gdem075f52", "gdem0397f81"]);
const DISPLAY_ORIENTATIONS = new Set(["portrait", "landscape"]);
const DEFAULT_DISPLAY_ORIENTATION = "portrait";
const LANDSCAPE_DISPLAY_ROWS = 8;
const PORTRAIT_DISPLAY_ROWS = 9;
const DISPLAY_WIDTH = 800;
const DISPLAY_HEIGHT = 480;
const FRAME_BYTES = (DISPLAY_WIDTH * DISPLAY_HEIGHT) / 4;

function localDateKey(timezone = "Asia/Shanghai", now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseDate(value, field = "date") {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${field} must use YYYY-MM-DD`);
  }
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${field} is invalid`);
  }
  return text;
}

function addDays(dateKey, days) {
  const date = new Date(`${parseDate(dateKey)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  const from = Date.parse(`${parseDate(fromKey)}T00:00:00Z`);
  const to = Date.parse(`${parseDate(toKey)}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

function normalizeFoodInput(input) {
  const name = String(input.name || "").trim();
  if (!name || name.length > 40) {
    throw new Error("name is required and must be at most 40 characters");
  }
  const category = String(input.category || "其他").trim().slice(0, 20) || "其他";
  const quantityText = String(input.quantityText || "").trim().slice(0, 30);
  const startDate = input.startDate ? parseDate(input.startDate, "startDate") : null;
  const shelfLifeDays =
    input.shelfLifeDays === "" || input.shelfLifeDays === undefined || input.shelfLifeDays === null
      ? null
      : Number(input.shelfLifeDays);
  if (shelfLifeDays !== null && (!Number.isInteger(shelfLifeDays) || shelfLifeDays < 0 || shelfLifeDays > 3650)) {
    throw new Error("shelfLifeDays must be an integer from 0 to 3650");
  }

  let expiresOn = input.expiresOn ? parseDate(input.expiresOn, "expiresOn") : null;
  if (!expiresOn) {
    if (!startDate || shelfLifeDays === null) {
      throw new Error("provide expiresOn or both startDate and shelfLifeDays");
    }
    expiresOn = addDays(startDate, shelfLifeDays);
  }

  return { name, category, quantityText, startDate, shelfLifeDays, expiresOn };
}

function decorateFood(row, todayKey) {
  const daysRemaining = daysBetween(todayKey, row.expires_on);
  let status = "normal";
  if (daysRemaining < 0) status = "expired";
  else if (daysRemaining <= 3) status = "expiring";
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    quantityText: row.quantity_text || "",
    startDate: row.start_date,
    shelfLifeDays: row.shelf_life_days,
    expiresOn: row.expires_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysRemaining,
    status
  };
}

function sortFoods(items) {
  const rank = { expired: 0, expiring: 1, normal: 2 };
  return [...items].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.expiresOn !== b.expiresOn) return a.expiresOn.localeCompare(b.expiresOn);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

function panelProfile(value) {
  const panel = String(value || "").toLowerCase();
  if (!PANEL_PROFILES.has(panel)) throw new Error("unsupported panel profile");
  return panel;
}

function displayOrientation(value) {
  const orientation = String(value || DEFAULT_DISPLAY_ORIENTATION).toLowerCase();
  if (!DISPLAY_ORIENTATIONS.has(orientation)) throw new Error("unsupported display orientation");
  return orientation;
}

function maxDisplayRows(orientation) {
  return displayOrientation(orientation) === "portrait" ? PORTRAIT_DISPLAY_ROWS : LANDSCAPE_DISPLAY_ROWS;
}

function frameSnapshotKey(items, todayKey, panel, orientation = DEFAULT_DISPLAY_ORIENTATION) {
  const payload = JSON.stringify({
    todayKey,
    panel,
    orientation: displayOrientation(orientation),
    items: items.map((item) => [item.id, item.updatedAt, item.status, item.daysRemaining])
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

module.exports = {
  DEFAULT_DISPLAY_ORIENTATION,
  DISPLAY_HEIGHT,
  DISPLAY_ORIENTATIONS,
  DISPLAY_WIDTH,
  FRAME_BYTES,
  LANDSCAPE_DISPLAY_ROWS,
  PANEL_PROFILES,
  PORTRAIT_DISPLAY_ROWS,
  addDays,
  daysBetween,
  decorateFood,
  displayOrientation,
  frameSnapshotKey,
  localDateKey,
  maxDisplayRows,
  normalizeFoodInput,
  panelProfile,
  sortFoods
};
