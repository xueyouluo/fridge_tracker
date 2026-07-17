"use strict";

function migrateFoodItemFields(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(food_items)").all().map((column) => column.name));
  if (!columns.has("location_text")) {
    db.exec("ALTER TABLE food_items ADD COLUMN location_text TEXT NOT NULL DEFAULT ''");
  }
}

module.exports = { migrateFoodItemFields };
