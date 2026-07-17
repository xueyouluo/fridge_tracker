"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { migrateFoodItemFields } = require("../src/migrations");

test("legacy food items gain an empty location without losing records", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE food_items (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity_text TEXT NOT NULL,
      expires_on TEXT NOT NULL
    );
    INSERT INTO food_items VALUES (1, '牛奶', '乳品', '1 瓶', '2026-07-20');
  `);

  migrateFoodItemFields(db);
  migrateFoodItemFields(db);

  const columns = db.prepare("PRAGMA table_info(food_items)").all();
  assert.equal(columns.find((column) => column.name === "location_text")?.notnull, 1);
  const item = db.prepare("SELECT id, name, location_text FROM food_items").get();
  assert.equal(item.id, 1);
  assert.equal(item.name, "牛奶");
  assert.equal(item.location_text, "");
});
