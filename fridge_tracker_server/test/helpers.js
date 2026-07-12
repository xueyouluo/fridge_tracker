"use strict";

const { DatabaseSync } = require("node:sqlite");

function createTestDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY, login TEXT, email TEXT, display_name TEXT, role TEXT);
    CREATE TABLE households (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE household_members (
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY (household_id, user_id)
    );
    CREATE TABLE household_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accepted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      code_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, serial TEXT NOT NULL UNIQUE,
      household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
      device_token_hash TEXT NOT NULL, panel_profile TEXT NOT NULL,
      last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE food_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL, category TEXT NOT NULL, quantity_text TEXT NOT NULL,
      start_date TEXT, shelf_life_days INTEGER, expires_on TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, token_prefix TEXT NOT NULL,
      expires_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_conversations (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE household_ai_settings (
      household_id INTEGER PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      api_key_encrypted TEXT NOT NULL, api_key_hint TEXT NOT NULL,
      model TEXT NOT NULL, base_url TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL, content TEXT NOT NULL, metadata_json TEXT,
      protocol TEXT, payload_json TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE agent_pending_actions (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      actions_json TEXT NOT NULL, summary TEXT NOT NULL, expires_at TEXT NOT NULL,
      resolved_at TEXT, resolution TEXT, resume_json TEXT, created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").run(1, "one", "one@example.com", "One", "member");
  db.prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)").run(2, "two", "two@example.com", "Two", "member");
  db.prepare("INSERT INTO households VALUES (?, ?, ?, ?)").run(1, "One的家庭", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO households VALUES (?, ?, ?, ?)").run(2, "Two的家庭", "2026-01-01", "2026-01-01");
  db.prepare("INSERT INTO household_members VALUES (?, ?, ?, ?)").run(1, 1, "owner", "2026-01-01");
  db.prepare("INSERT INTO household_members VALUES (?, ?, ?, ?)").run(2, 2, "owner", "2026-01-01");
  return db;
}

module.exports = { createTestDatabase };
