"use strict";

const { addDays, decorateFood, localDateKey, normalizeFoodInput, parseDate, sortFoods } = require("./domain");

const FOOD_STATUSES = new Set(["expired", "expiring", "normal"]);

class FoodNotFoundError extends Error {
  constructor() {
    super("food item not found");
    this.statusCode = 404;
  }
}

function createFoodService({ db, timezone = "Asia/Shanghai", onChange = () => {} }) {
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

  function listFoodItems(ownerId) {
    const rows = db.prepare("SELECT * FROM food_items WHERE owner_id = ?").all(ownerId);
    return sortFoods(rows.map(decorate));
  }

  function searchFoodItems(ownerId, filters = {}) {
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
    const conditions = ["owner_id = ?"];
    const params = [ownerId];
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

  function getFoodItem(ownerId, id) {
    const row = db.prepare("SELECT * FROM food_items WHERE id = ? AND owner_id = ?").get(Number(id), ownerId);
    if (!row) throw new FoodNotFoundError();
    return decorate(row);
  }

  function getFoodItems(ownerId, ids) {
    return normalizeBatchIds(ids).map((id) => getFoodItem(ownerId, id));
  }

  function createFoodItem(ownerId, input) {
    const item = normalizeFoodInput(input);
    const now = new Date().toISOString();
    const created = db.prepare(`
      INSERT INTO food_items
        (owner_id, name, category, quantity_text, start_date, shelf_life_days, expires_on, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(ownerId, item.name, item.category, item.quantityText, item.startDate, item.shelfLifeDays, item.expiresOn, now, now);
    onChange();
    return getFoodItem(ownerId, Number(created.lastInsertRowid));
  }

  function updateFoodItem(ownerId, id, patch) {
    const row = db.prepare("SELECT * FROM food_items WHERE id = ? AND owner_id = ?").get(Number(id), ownerId);
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
      WHERE id = ? AND owner_id = ?
    `).run(item.name, item.category, item.quantityText, item.startDate, item.shelfLifeDays, item.expiresOn, new Date().toISOString(), Number(id), ownerId);
    onChange();
    return getFoodItem(ownerId, id);
  }

  function deleteFoodItem(ownerId, id) {
    const item = getFoodItem(ownerId, id);
    db.prepare("DELETE FROM food_items WHERE id = ? AND owner_id = ?").run(Number(id), ownerId);
    onChange();
    return item;
  }

  function validateActions(ownerId, actions) {
    if (!Array.isArray(actions) || actions.length === 0 || actions.length > 25) {
      throw new Error("actions must contain between 1 and 25 operations");
    }
    return actions.map((action) => {
      if (action.operation === "create") return { operation: "create", input: normalizeFoodInput(action.input || {}) };
      if (action.operation === "update") {
        getFoodItem(ownerId, action.id);
        return { operation: "update", id: Number(action.id), patch: action.patch || {} };
      }
      if (action.operation === "delete") {
        getFoodItem(ownerId, action.id);
        return { operation: "delete", id: Number(action.id) };
      }
      throw new Error("unsupported food operation");
    });
  }

  function applyActions(ownerId, actions) {
    const normalized = validateActions(ownerId, actions);
    db.exec("BEGIN IMMEDIATE");
    try {
      const results = normalized.map((action) => {
        if (action.operation === "create") return { operation: "create", item: createFoodItem(ownerId, action.input) };
        if (action.operation === "update") return { operation: "update", item: updateFoodItem(ownerId, action.id, action.patch) };
        return { operation: "delete", item: deleteFoodItem(ownerId, action.id) };
      });
      db.exec("COMMIT");
      return results;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function createFoodItems(ownerId, items) {
    if (!Array.isArray(items)) throw new Error("items must be an array");
    return applyActions(ownerId, items.map((input) => ({ operation: "create", input })));
  }

  function updateFoodItems(ownerId, items) {
    if (!Array.isArray(items)) throw new Error("items must be an array");
    const ids = normalizeBatchIds(items.map((item) => item?.id));
    const actions = items.map((item, index) => ({ operation: "update", id: ids[index], patch: item.patch || {} }));
    return applyActions(ownerId, actions);
  }

  function deleteFoodItems(ownerId, ids) {
    return applyActions(ownerId, normalizeBatchIds(ids).map((id) => ({ operation: "delete", id })));
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
