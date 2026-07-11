"use strict";

const { decorateFood, localDateKey, normalizeFoodInput, sortFoods } = require("./domain");

class FoodNotFoundError extends Error {
  constructor() {
    super("food item not found");
    this.statusCode = 404;
  }
}

function createFoodService({ db, timezone = "Asia/Shanghai", onChange = () => {} }) {
  function decorate(row) {
    return decorateFood(row, localDateKey(timezone));
  }

  function listFoodItems(ownerId) {
    const rows = db.prepare("SELECT * FROM food_items WHERE owner_id = ?").all(ownerId);
    return sortFoods(rows.map(decorate));
  }

  function getFoodItem(ownerId, id) {
    const row = db.prepare("SELECT * FROM food_items WHERE id = ? AND owner_id = ?").get(Number(id), ownerId);
    if (!row) throw new FoodNotFoundError();
    return decorate(row);
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

  return { listFoodItems, getFoodItem, createFoodItem, updateFoodItem, deleteFoodItem, validateActions, applyActions };
}

module.exports = { FoodNotFoundError, createFoodService };
