"use strict";

const ACTIVITY_TYPES = new Set([
  "food_created",
  "food_updated",
  "food_deleted",
  "household_invite_created",
  "household_member_joined",
  "household_member_removed",
  "household_member_left",
  "device_paired"
]);

function parseMetadata(value) {
  if (!value) return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function createActivityService({ db }) {
  function record({ householdId, actorUserId = null, type, title, detail = "", metadata = {} }) {
    const normalizedHouseholdId = Number(householdId);
    if (!Number.isInteger(normalizedHouseholdId) || normalizedHouseholdId <= 0) throw new Error("householdId must be a positive integer");
    if (!ACTIVITY_TYPES.has(type)) throw new Error("unsupported activity type");
    const normalizedTitle = String(title || "").trim().slice(0, 80);
    if (!normalizedTitle) throw new Error("activity title is required");
    const normalizedDetail = String(detail || "").trim().slice(0, 240);
    const createdAt = new Date().toISOString();
    const created = db.prepare(`
      INSERT INTO household_activities
        (household_id, actor_user_id, type, title, detail, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedHouseholdId,
      actorUserId === null ? null : Number(actorUserId),
      type,
      normalizedTitle,
      normalizedDetail,
      JSON.stringify(metadata || {}),
      createdAt
    );
    return get(normalizedHouseholdId, Number(created.lastInsertRowid));
  }

  function publicActivity(row) {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      detail: row.detail,
      metadata: parseMetadata(row.metadata_json),
      createdAt: row.created_at,
      actor: row.actor_user_id ? {
        id: row.actor_user_id,
        displayName: row.actor_display_name || row.actor_login || "家庭成员",
        login: row.actor_login
      } : null
    };
  }

  const SELECT_ACTIVITY = `
    SELECT household_activities.*, users.login AS actor_login, users.display_name AS actor_display_name
    FROM household_activities
    LEFT JOIN users ON users.id = household_activities.actor_user_id
  `;

  function get(householdId, id) {
    const row = db.prepare(`${SELECT_ACTIVITY} WHERE household_activities.id = ? AND household_activities.household_id = ?`)
      .get(Number(id), Number(householdId));
    if (!row) return null;
    return publicActivity(row);
  }

  function list(householdId, { limit = 50, beforeId = null } = {}) {
    const normalizedLimit = Number(limit);
    if (!Number.isInteger(normalizedLimit) || normalizedLimit < 1 || normalizedLimit > 100) {
      throw new Error("limit must be an integer from 1 to 100");
    }
    const normalizedBeforeId = beforeId === null || beforeId === "" ? null : Number(beforeId);
    if (normalizedBeforeId !== null && (!Number.isInteger(normalizedBeforeId) || normalizedBeforeId <= 0)) {
      throw new Error("beforeId must be a positive integer");
    }
    const rows = normalizedBeforeId === null
      ? db.prepare(`${SELECT_ACTIVITY}
          WHERE household_activities.household_id = ?
          ORDER BY household_activities.id DESC LIMIT ?`)
        .all(Number(householdId), normalizedLimit + 1)
      : db.prepare(`${SELECT_ACTIVITY}
          WHERE household_activities.household_id = ? AND household_activities.id < ?
          ORDER BY household_activities.id DESC LIMIT ?`)
        .all(Number(householdId), normalizedBeforeId, normalizedLimit + 1);
    return {
      items: rows.slice(0, normalizedLimit).map(publicActivity),
      hasMore: rows.length > normalizedLimit
    };
  }

  function recordFood(householdId, actorUserId, operation, item, source = "web") {
    const types = { create: "food_created", update: "food_updated", delete: "food_deleted" };
    const titles = { create: "添加了物品", update: "更新了物品", delete: "移除了物品" };
    return record({
      householdId,
      actorUserId,
      type: types[operation],
      title: titles[operation],
      detail: `${item.name}${item.quantityText ? ` · ${item.quantityText}` : ""} · 到期 ${item.expiresOn}`,
      metadata: { source, foodId: item.id, foodName: item.name }
    });
  }

  return { get, list, record, recordFood };
}

module.exports = { ACTIVITY_TYPES, createActivityService };
