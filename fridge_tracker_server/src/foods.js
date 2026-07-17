"use strict";

const { addDays, decorateFood, localDateKey, normalizeFoodInput, parseDate, sortFoods } = require("./domain");

const FOOD_STATUSES = new Set(["expired", "expiring", "normal"]);

class FoodNotFoundError extends Error {
  constructor() {
    super("food item not found");
    this.statusCode = 404;
  }
}

function createFoodService({ db, timezone = "Asia/Shanghai", onChange = () => {}, onActivity = () => {} }) {
  function normalizeBatchIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 25) {
      throw new Error("ids must contain between 1 and 25 food IDs");
    }
    const normalized = ids.map(Number);
    if (normalized.some((id) => !Number.isInteger(id) || id <= 0)) throw new Error("food IDs must be positive integers");
    if (new Set(normalized).size !== normalized.length) throw new Error("food IDs must not contain duplicates");
    return normalized;
  }

  function decorate(row) {
    return decorateFood(row, localDateKey(timezone));
  }

  function listFoodItems(householdId) {
    const rows = db.prepare("SELECT * FROM food_items WHERE household_id = ?").all(householdId);
    return sortFoods(rows.map(decorate));
  }

  function searchFoodItems(householdId, filters = {}) {
    const keyword = String(filters.keyword || "").trim().toLocaleLowerCase().slice(0, 100);
    const category = String(filters.category || "").trim().slice(0, 20);
    const status = String(filters.status || "").trim();
    if (status && !FOOD_STATUSES.has(status)) throw new Error("unsupported food status");
    const expiresFrom = filters.expiresFrom ? parseDate(filters.expiresFrom, "expiresFrom") : null;
    const expiresTo = filters.expiresTo ? parseDate(filters.expiresTo, "expiresTo") : null;
    if (expiresFrom && expiresTo && expiresFrom > expiresTo) throw new Error("expiresFrom must not be after expiresTo");
    const limit = filters.limit === undefined ? 20 : Number(filters.limit);
    const offset = filters.offset === undefined ? 0 : Number(filters.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("limit must be an integer from 1 to 100");
    if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");

    const today = localDateKey(timezone);
    const expiringThrough = addDays(today, 3);
    const conditions = ["household_id = ?"];
    const params = [householdId];
    if (category) {
      conditions.push("category = ?");
      params.push(category);
    }
    if (status === "expired") {
      conditions.push("expires_on < ?");
      params.push(today);
    } else if (status === "expiring") {
      conditions.push("expires_on >= ? AND expires_on <= ?");
      params.push(today, expiringThrough);
    } else if (status === "normal") {
      conditions.push("expires_on > ?");
      params.push(expiringThrough);
    }
    if (expiresFrom) {
      conditions.push("expires_on >= ?");
      params.push(expiresFrom);
    }
    if (expiresTo) {
      conditions.push("expires_on <= ?");
      params.push(expiresTo);
    }
    if (keyword) {
      const escaped = keyword.replace(/[\\%_]/g, "\\$&");
      conditions.push("(name LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\' OR quantity_text LIKE ? ESCAPE '\\')");
      params.push(`%${escaped}%`, `%${escaped}%`, `%${escaped}%`);
    }

    const where = conditions.join(" AND ");
    const total = db.prepare(`SELECT COUNT(*) AS count FROM food_items WHERE ${where}`).get(...params).count;
    const rows = db.prepare(`
      SELECT * FROM food_items
      WHERE ${where}
      ORDER BY CASE WHEN expires_on < ? THEN 0 WHEN expires_on <= ? THEN 1 ELSE 2 END,
        expires_on ASC, updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, today, expiringThrough, limit, offset);
    const items = rows.map(decorate);
    return { items, total, offset, limit, hasMore: offset + items.length < total };
  }

  function getFoodItem(householdId, id) {
    const row = db.prepare("SELECT * FROM food_items WHERE id = ? AND household_id = ?").get(Number(id), householdId);
    if (!row) throw new FoodNotFoundError();
    return decorate(row);
  }

  function getFoodItems(householdId, ids) {
    return normalizeBatchIds(ids).map((id) => getFoodItem(householdId, id));
  }

  function createFoodItem(householdId, input, context = {}) {
    const item = normalizeFoodInput(input);
    const now = new Date().toISOString();
    const created = db.prepare(`
      INSERT INTO food_items
        (household_id, name, category, quantity_text, start_date, shelf_life_days, expires_on, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(householdId, item.name, item.category, item.quantityText, item.startDate, item.shelfLifeDays, item.expiresOn, now, now);
    onChange(householdId);
    const result = getFoodItem(householdId, Number(created.lastInsertRowid));
    onActivity(householdId, context.actorUserId ?? null, "create", result, context.source || "system");
    return result;
  }

  function updateFoodItem(householdId, id, patch, context = {}) {
    const row = db.prepare("SELECT * FROM food_items WHERE id = ? AND household_id = ?").get(Number(id), householdId);
    if (!row) throw new FoodNotFoundError();
    const item = normalizeFoodInput({
      name: patch.name ?? row.name,
      category: patch.category ?? row.category,
      quantityText: patch.quantityText ?? row.quantity_text,
      startDate: patch.startDate !== undefined ? patch.startDate : row.start_date,
      shelfLifeDays: patch.shelfLifeDays !== undefined ? patch.shelfLifeDays : row.shelf_life_days,
      expiresOn: patch.expiresOn !== undefined ? patch.expiresOn : row.expires_on
    });
    db.prepare(`
      UPDATE food_items SET name = ?, category = ?, quantity_text = ?, start_date = ?, shelf_life_days = ?, expires_on = ?, updated_at = ?
      WHERE id = ? AND household_id = ?
    `).run(item.name, item.category, item.quantityText, item.startDate, item.shelfLifeDays, item.expiresOn, new Date().toISOString(), Number(id), householdId);
    onChange(householdId);
    const result = getFoodItem(householdId, id);
    onActivity(householdId, context.actorUserId ?? null, "update", result, context.source || "system");
    return result;
  }

  function deleteFoodItem(householdId, id, context = {}) {
    const item = getFoodItem(householdId, id);
    db.prepare("DELETE FROM food_items WHERE id = ? AND household_id = ?").run(Number(id), householdId);
    onChange(householdId);
    onActivity(householdId, context.actorUserId ?? null, "delete", item, context.source || "system");
    return item;
  }

  function validateActions(householdId, actions) {
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > 25) {
      throw new Error("actions must contain between 1 and 25 operations");
    }
    return actions.map((action) => {
      if (action.operation === "create") return { operation: "create", input: normalizeFoodInput(action.input || {}) };
      if (action.operation === "update") {
        getFoodItem(householdId, action.id);
        return { operation: "update", id: Number(action.id), patch: action.patch || {} };
      }
      if (action.operation === "delete") {
        getFoodItem(householdId, action.id);
        return { operation: "delete", id: Number(action.id) };
      }
      throw new Error("unsupported food operation");
    });
  }

  function applyActions(householdId, actions, context = {}) {
    const normalized = validateActions(householdId, actions);
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = normalized.map((action) => {
        if (action.operation === "create") return { operation: "create", item: createFoodItem(householdId, action.input, context) };
        if (action.operation === "update") return { operation: "update", item: updateFoodItem(householdId, action.id, action.patch, context) };
        return { operation: "delete", item: deleteFoodItem(householdId, action.id, context) };
      });
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function createFoodItems(householdId, items, context = {}) {
    if (!Array.isArray(items)) throw new Error("items must be an array");
    return applyActions(householdId, items.map((input) => ({ operation: "create", input })), context);
  }

  function updateFoodItems(householdId, items, context = {}) {
    if (!Array.isArray(items)) throw new Error("items must be an array");
    const ids = normalizeBatchIds(items.map((item) => item?.id));
    const actions = items.map((item, index) => ({ operation: "update", id: ids[index], patch: item.patch || {} }));
    return applyActions(householdId, actions, context);
  }

  function deleteFoodItems(householdId, ids, context = {}) {
    return applyActions(householdId, normalizeBatchIds(ids).map((id) => ({ operation: "delete", id })), context);
  }

  return {
    listFoodItems,
    searchFoodItems,
    getFoodItem,
    getFoodItems,
    createFoodItem,
    createFoodItems,
    updateFoodItem,
    updateFoodItems,
    deleteFoodItem,
    deleteFoodItems,
    validateActions,
    applyActions
  };
}

module.exports = { FoodNotFoundError, createFoodService };
