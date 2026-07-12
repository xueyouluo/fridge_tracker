"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  FRAME_BYTES,
  DEFAULT_DISPLAY_ORIENTATION,
  PANEL_CONFIGS,
  addDays,
  displayOrientation,
  frameSnapshotKey,
  localDateKey,
  panelConfig,
  panelProfile
} = require("./domain");
const { createFoodService } = require("./foods");
const { createAccessTokenService } = require("./accessTokens");
const { createAiSettingsService } = require("./aiSettings");
const { createAgentService } = require("./agent");
const { createMcpHandler } = require("./mcp");
const { createHouseholdService } = require("./households");
const { renderDashboardHtml, renderFrame } = require("./renderer");
const {
  displayNameFromEmail,
  isAdmin,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  publicUser
} = require("./users");
const {
  generatePairingCode,
  normalizePairingCode,
  pairingCodeExpiresAt
} = require("./pairing");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = process.env.FRIDGE_TRACKER_CONFIG || path.join(ROOT, "config.json");
const DEFAULT_CONFIG = {
  host: "127.0.0.1",
  port: 8788,
  timezone: "Asia/Shanghai",
  databasePath: "data/fridge_v2.sqlite",
  secureCookies: false,
  adminLogin: "admin",
  adminEmail: "",
  adminPassword: "fridge-demo",
  demoDeviceToken: "local-fridge-device-token",
  credentialEncryptionKey: ""
};

const config = loadConfig();
const databasePath = path.resolve(ROOT, config.databasePath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
const frameCache = new Map();

initializeDatabase();
const householdService = createHouseholdService({ db, hashValue: sha256 });
householdService.ensureHouseholds();
seedLocalDemo();
householdService.ensureHouseholds();
const foodService = createFoodService({ db, timezone: config.timezone, onChange: invalidateFrames });
const accessTokenService = createAccessTokenService(db);
const aiSettingsService = createAiSettingsService(db, config.credentialEncryptionKey || config.adminPassword);
const agentService = createAgentService({
  db,
  foodService,
  timezone: config.timezone,
  resolveRuntime: (userId) => aiSettingsService.resolveRuntime(householdService.householdIdForUser(userId)),
  resolveHouseholdId: householdService.householdIdForUser
});
const handleMcp = createMcpHandler({
  foodService,
  authenticate: accessTokenService.authenticate,
  resolveHouseholdId: householdService.householdIdForUser
});

function loadConfig() {
  let custom = {};
  if (fs.existsSync(CONFIG_PATH)) {
    custom = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  }
  return {
    ...DEFAULT_CONFIG,
    ...custom,
    port: Number(custom.port || process.env.PORT || DEFAULT_CONFIG.port),
    host: String(process.env.HOST || custom.host || DEFAULT_CONFIG.host)
  };
}

function initializeDatabase() {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      email TEXT,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS households (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS household_members (
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
      joined_at TEXT NOT NULL,
      PRIMARY KEY (household_id, user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS household_single_owner_idx
      ON household_members(household_id) WHERE role = 'owner';
    CREATE TABLE IF NOT EXISTS household_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accepted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      code_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL UNIQUE,
      household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
      device_token_hash TEXT NOT NULL,
      panel_profile TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_pairing_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity_text TEXT NOT NULL,
      start_date TEXT,
      shelf_life_days INTEGER,
      expires_on TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      token_prefix TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_conversations (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS household_ai_settings (
      household_id INTEGER PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
      updated_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      api_key_encrypted TEXT NOT NULL,
      api_key_hint TEXT NOT NULL,
      model TEXT NOT NULL,
      base_url TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT,
      protocol TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_pending_actions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
      actions_json TEXT NOT NULL,
      summary TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT,
      resolution TEXT,
      resume_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens(user_id);
    CREATE INDEX IF NOT EXISTS household_invites_household_idx ON household_invites(household_id, expires_at);
    CREATE INDEX IF NOT EXISTS agent_conversations_user_idx ON agent_conversations(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS agent_messages_conversation_idx ON agent_messages(conversation_id, id);
  `);
  migrateUsersTable();
  ensureLegacyUserHouseholds();
  migrateHouseholdScopeTables();
  migrateAiSettingsTable();
  migrateAgentMessagesTable();
  migrateAgentPendingActionsTable();
}

function migrateAgentMessagesTable() {
  const columns = new Set(db.prepare("PRAGMA table_info(agent_messages)").all().map((column) => column.name));
  if (!columns.has("protocol")) db.exec("ALTER TABLE agent_messages ADD COLUMN protocol TEXT");
  if (!columns.has("payload_json")) db.exec("ALTER TABLE agent_messages ADD COLUMN payload_json TEXT");
}

function migrateAgentPendingActionsTable() {
  const columns = new Set(db.prepare("PRAGMA table_info(agent_pending_actions)").all().map((column) => column.name));
  if (!columns.has("resume_json")) db.exec("ALTER TABLE agent_pending_actions ADD COLUMN resume_json TEXT");
}

function migrateUsersTable() {
  const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
  if (!columns.has("email")) db.exec("ALTER TABLE users ADD COLUMN email TEXT");
  if (!columns.has("display_name")) db.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT ''");
  if (!columns.has("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'");
  if (!columns.has("updated_at")) db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL AND email != ''");
  db.prepare("UPDATE users SET display_name = login WHERE display_name = ''").run();
  db.prepare("UPDATE users SET role = 'member' WHERE role IS NULL OR role = ''").run();
  db.prepare("UPDATE users SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = ''").run();
}

function ensureLegacyUserHouseholds() {
  const users = db.prepare(`
    SELECT users.id, users.login, users.display_name, users.created_at
    FROM users LEFT JOIN household_members ON household_members.user_id = users.id
    WHERE household_members.user_id IS NULL
  `).all();
  const insertHousehold = db.prepare("INSERT INTO households (name, created_at, updated_at) VALUES (?, ?, ?)");
  const insertMember = db.prepare("INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)");
  users.forEach((user) => {
    const now = user.created_at || new Date().toISOString();
    const name = `${String(user.display_name || user.login || "我的").trim().slice(0, 50) || "我的"}的家庭`;
    const household = insertHousehold.run(name, now, now);
    insertMember.run(Number(household.lastInsertRowid), user.id, now);
  });
}

function migrateHouseholdScopeTables() {
  db.exec("DROP TABLE IF EXISTS frame_revisions");
  const deviceColumns = new Set(db.prepare("PRAGMA table_info(devices)").all().map((column) => column.name));
  if (!deviceColumns.has("household_id")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE devices_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serial TEXT NOT NULL UNIQUE,
        household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
        device_token_hash TEXT NOT NULL,
        panel_profile TEXT NOT NULL,
        last_seen_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO devices_migrated
        (id, serial, household_id, device_token_hash, panel_profile, last_seen_at, created_at, updated_at)
      SELECT id, serial,
        (SELECT household_id FROM household_members WHERE user_id = devices.owner_id),
        device_token_hash, panel_profile, last_seen_at, created_at, updated_at
      FROM devices;
      DROP TABLE devices;
      ALTER TABLE devices_migrated RENAME TO devices;
      PRAGMA foreign_keys = ON;
    `);
  }

  const foodColumns = new Set(db.prepare("PRAGMA table_info(food_items)").all().map((column) => column.name));
  if (!foodColumns.has("household_id")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE food_items_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        quantity_text TEXT NOT NULL,
        start_date TEXT,
        shelf_life_days INTEGER,
        expires_on TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO food_items_migrated
        (id, household_id, name, category, quantity_text, start_date, shelf_life_days, expires_on, created_at, updated_at)
      SELECT id,
        (SELECT household_id FROM household_members WHERE user_id = food_items.owner_id),
        name, category, quantity_text, start_date, shelf_life_days, expires_on, created_at, updated_at
      FROM food_items;
      DROP TABLE food_items;
      ALTER TABLE food_items_migrated RENAME TO food_items;
      PRAGMA foreign_keys = ON;
    `);
  }

  const pairingColumns = new Set(db.prepare("PRAGMA table_info(device_pairing_codes)").all().map((column) => column.name));
  if (!pairingColumns.has("household_id")) {
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE device_pairing_codes_migrated (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
        created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO device_pairing_codes_migrated
        (id, household_id, created_by_user_id, code_hash, expires_at, used_at, created_at)
      SELECT id,
        (SELECT household_id FROM household_members WHERE user_id = device_pairing_codes.user_id),
        user_id, code_hash, expires_at, used_at, created_at
      FROM device_pairing_codes;
      DROP TABLE device_pairing_codes;
      ALTER TABLE device_pairing_codes_migrated RENAME TO device_pairing_codes;
      PRAGMA foreign_keys = ON;
    `);
  }
}

function migrateAiSettingsTable() {
  const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_ai_settings'").get();
  if (!legacy) return;
  db.exec(`
    INSERT OR IGNORE INTO household_ai_settings
      (household_id, updated_by_user_id, api_key_encrypted, api_key_hint, model, base_url, updated_at)
    SELECT household_members.household_id, user_ai_settings.user_id,
      user_ai_settings.api_key_encrypted, user_ai_settings.api_key_hint,
      user_ai_settings.model, user_ai_settings.base_url, user_ai_settings.updated_at
    FROM user_ai_settings
    JOIN household_members ON household_members.user_id = user_ai_settings.user_id
    WHERE user_ai_settings.user_id = (
      SELECT candidate.user_id
      FROM user_ai_settings AS candidate
      JOIN household_members AS candidate_member ON candidate_member.user_id = candidate.user_id
      WHERE candidate_member.household_id = household_members.household_id
      ORDER BY CASE candidate_member.role WHEN 'owner' THEN 0 ELSE 1 END, candidate.updated_at DESC
      LIMIT 1
    );
    DROP TABLE user_ai_settings;
  `);
}

function seedLocalDemo() {
  const now = new Date().toISOString();
  let user = db.prepare("SELECT * FROM users WHERE login = ?").get(config.adminLogin);
  const adminEmail = normalizeEmail(config.adminEmail, { required: false });
  const adminDisplayName = normalizeDisplayName(config.adminLogin, "admin");
  if (!user) {
    const created = db
      .prepare(`
        INSERT INTO users (login, email, display_name, role, password_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(config.adminLogin, adminEmail, adminDisplayName, "admin", hashSecret(config.adminPassword), now, now);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(created.lastInsertRowid));
  } else if (!verifySecret(config.adminPassword, user.password_hash)) {
    db.prepare("UPDATE users SET password_hash = ?, display_name = ?, role = 'admin', updated_at = ? WHERE id = ?")
      .run(hashSecret(config.adminPassword), adminDisplayName, now, user.id);
    const emailOwner = adminEmail
      ? db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(adminEmail, user.id)
      : null;
    if (adminEmail && user.email !== adminEmail && !emailOwner) {
      db.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ?").run(adminEmail, now, user.id);
    }
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
    console.log(`Configured password updated for local account: ${config.adminLogin}`);
  } else {
    db.prepare("UPDATE users SET role = 'admin', display_name = COALESCE(NULLIF(display_name, ''), ?), updated_at = ? WHERE id = ?")
      .run(adminDisplayName, now, user.id);
    const emailOwner = adminEmail
      ? db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(adminEmail, user.id)
      : null;
    if (adminEmail && user.email !== adminEmail && !emailOwner) {
      db.prepare("UPDATE users SET email = ?, updated_at = ? WHERE id = ?").run(adminEmail, now, user.id);
    }
    user = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id);
  }
  const householdId = householdService.createPersonalHousehold(user.id);
  let device = db.prepare("SELECT * FROM devices WHERE serial = ?").get("local-demo-screen");
  if (!device) {
    db.prepare(`
      INSERT INTO devices
        (serial, household_id, device_token_hash, panel_profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "local-demo-screen",
      householdId,
      sha256(config.demoDeviceToken),
      "gdem075f52",
      now,
      now
    );
  }
  const foodCount = db.prepare("SELECT COUNT(*) AS count FROM food_items WHERE household_id = ?").get(householdId).count;
  if (foodCount === 0) {
    const today = localDateKey(config.timezone);
    const examples = [
      ["草莓", "水果", "1 盒", -1],
      ["三文鱼", "肉类", "200g", 1],
      ["生菜", "蔬菜", "1 颗", 2],
      ["牛奶", "乳品", "1 瓶", 5],
      ["鸡蛋", "蛋类", "6 个", 12]
    ];
    const insert = db.prepare(`
      INSERT INTO food_items
        (household_id, name, category, quantity_text, expires_on, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [name, category, quantityText, days] of examples) {
      const expiresOn = addDays(today, days);
      insert.run(householdId, name, category, quantityText, expiresOn, now, now);
    }
  }
}

function hashSecret(value) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(value), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function verifySecret(value, stored) {
  const [salt, expected] = String(stored || "").split(":");
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(String(value), salt, 32);
  const expectedBuffer = Buffer.from(expected, "hex");
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").filter(Boolean).map((cookie) => {
      const [key, ...parts] = cookie.trim().split("=");
      return [key, decodeURIComponent(parts.join("="))];
    })
  );
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(sha256(token), userId, expires.toISOString(), now.toISOString());
  return { token, expires };
}

function sessionCookie(session) {
  const flags = `HttpOnly; Path=/; SameSite=Lax; Expires=${session.expires.toUTCString()}${config.secureCookies ? "; Secure" : ""}`;
  return `fridge_session=${session.token}; ${flags}`;
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).fridge_session;
  if (!token) return null;
  return db.prepare(`
    SELECT users.id, users.login, users.email, users.display_name, users.role, users.created_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(sha256(token), new Date().toISOString()) || null;
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) sendJson(res, 401, { error: "login required" });
  return user;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function requireDevice(req, res) {
  const token = bearerToken(req);
  if (!token) {
    sendJson(res, 401, { error: "device token required" });
    return null;
  }
  const device = db.prepare("SELECT * FROM devices WHERE device_token_hash = ?").get(sha256(token));
  if (!device) sendJson(res, 401, { error: "invalid device token" });
  return device || null;
}

function allFoods(ownerId) {
  return foodService.listFoodItems(ownerId);
}

function findUserByIdentity(identity) {
  const raw = String(identity || "").trim();
  if (!raw) return null;
  const email = raw.includes("@") ? normalizeEmail(raw, { required: false }) : "";
  if (email) {
    return db.prepare("SELECT * FROM users WHERE login = ? OR email = ?").get(email, email) || null;
  }
  return db.prepare("SELECT * FROM users WHERE login = ?").get(raw) || null;
}

function userRowsFor(current) {
  const fields = `
    users.id,
    users.login,
    users.email,
    users.display_name,
    users.role,
    users.created_at,
    users.updated_at,
    (SELECT COUNT(*) FROM food_items WHERE household_id =
      (SELECT household_id FROM household_members WHERE user_id = users.id)) AS food_count,
    (SELECT COUNT(*) FROM devices WHERE household_id =
      (SELECT household_id FROM household_members WHERE user_id = users.id)) AS device_count
  `;
  if (isAdmin(current)) {
    return db.prepare(`
      SELECT ${fields}
      FROM users
      ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC
    `).all();
  }
  return db.prepare(`SELECT ${fields} FROM users WHERE id = ?`).all(current.id);
}

function displayTimestamp() {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: config.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
}

function invalidateFrames() {
  frameCache.clear();
}

async function getRenderedFrame(ownerId, panel, orientation = DEFAULT_DISPLAY_ORIENTATION) {
  const foods = allFoods(ownerId);
  const today = localDateKey(config.timezone);
  const snapshot = frameSnapshotKey(foods, today, panel, orientation);
  const key = `${ownerId}:${panel}:${orientation}:${snapshot}`;
  if (frameCache.has(key)) return frameCache.get(key);
  const result = await renderFrame(foods, displayTimestamp(), panel, orientation);
  if (frameCache.size >= 8) {
    frameCache.clear();
  }
  frameCache.set(key, result);
  return result;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) reject(new Error("request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body, headers = {}) {
  const value = `${JSON.stringify(body)}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(value);
}

function sendText(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendBuffer(res, status, body, contentType, headers = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function servePublic(res, filename, contentType) {
  sendBuffer(res, 200, fs.readFileSync(path.join(ROOT, "public", filename)), contentType);
}

function publicDevice(device) {
  return {
    id: device.id,
    serial: device.serial,
    panelProfile: device.panel_profile,
    lastSeenAt: device.last_seen_at
  };
}

function cleanupPairingCodes(nowIso = new Date().toISOString()) {
  db.prepare("DELETE FROM device_pairing_codes WHERE used_at IS NOT NULL OR expires_at <= ?").run(nowIso);
}

function createDevicePairingCode(userId) {
  const membership = householdService.requireOwner(userId);
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = pairingCodeExpiresAt(now);
  cleanupPairingCodes(createdAt);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generatePairingCode();
    const codeHash = sha256(code);
    const existing = db.prepare("SELECT id FROM device_pairing_codes WHERE code_hash = ?").get(codeHash);
    if (existing) continue;
    db.prepare(`
      INSERT INTO device_pairing_codes (household_id, created_by_user_id, code_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(membership.householdId, userId, codeHash, expiresAt, createdAt);
    return { code, expiresAt };
  }
  throw new Error("could not generate pairing code");
}

function findDevicePairingCode(value) {
  const code = normalizePairingCode(value);
  if (!code) return { error: "missing" };
  const now = new Date().toISOString();
  const pairing = db.prepare("SELECT * FROM device_pairing_codes WHERE code_hash = ?").get(sha256(code));
  if (!pairing) return { error: "not_found" };
  if (pairing.used_at) return { error: "used" };
  if (pairing.expires_at <= now) return { error: "expired" };
  return { code, pairing };
}

function consumeDevicePairingCode(pairing, nowIso = new Date().toISOString()) {
  if (pairing.expires_at <= nowIso) return { error: "expired" };
  const updated = db.prepare(`
    UPDATE device_pairing_codes SET used_at = ? WHERE id = ? AND used_at IS NULL AND expires_at > ?
  `).run(nowIso, pairing.id, nowIso);
  if (!updated.changes) return { error: "used" };
  return {};
}

function sendPairingCodeError(res, result) {
  const messages = {
    missing: ["pairing code is required", 400],
    not_found: ["pairing code not found", 404],
    used: ["pairing code has already been used", 410],
    expired: ["pairing code has expired", 410]
  };
  const [message, status] = messages[result.error] || ["invalid pairing code", 400];
  sendJson(res, status, { error: message });
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    const panelProfiles = Object.fromEntries(Object.entries(PANEL_CONFIGS).map(([id, panel]) => [id, {
      width: panel.width,
      height: panel.height,
      colorMode: panel.colorMode,
      frameFormat: panel.frameFormat,
      frameBytes: panel.frameBytes
    }]));
    sendJson(res, 200, {
      ok: true,
      timezone: config.timezone,
      frameBytes: FRAME_BYTES,
      panelProfiles,
      agentMode: "household-settings-personal-conversations"
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await readJson(req);
    const user = findUserByIdentity(body.login || body.email);
    if (!user || !verifySecret(body.password, user.password_hash)) {
      sendJson(res, 401, { error: "invalid login or password" });
      return true;
    }
    const session = createSession(user.id);
    sendJson(res, 200, publicUser(user), { "Set-Cookie": sessionCookie(session) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = normalizePassword(body.password);
    const displayName = normalizeDisplayName(body.displayName, displayNameFromEmail(email));
    const existing = db.prepare("SELECT id FROM users WHERE login = ? OR email = ?").get(email, email);
    if (existing) {
      sendJson(res, 409, { error: "email has already been registered" });
      return true;
    }
    const now = new Date().toISOString();
    const created = db.prepare(`
      INSERT INTO users (login, email, display_name, role, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(email, email, displayName, "member", hashSecret(password), now, now);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(created.lastInsertRowid));
    householdService.createPersonalHousehold(user.id);
    const session = createSession(user.id);
    sendJson(res, 201, publicUser(user), { "Set-Cookie": sessionCookie(session) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = parseCookies(req.headers.cookie).fridge_session;
    if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
    sendJson(res, 200, { ok: true }, { "Set-Cookie": "fridge_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0" });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = currentUser(req);
    sendJson(res, 200, { user: publicUser(user) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/device/register") {
    const body = await readJson(req);
    const serial = String(body.serial || "").trim().slice(0, 60);
    const panel = panelProfile(body.panel || "gdem075f52");
    if (!serial) throw new Error("serial is required");
    const pairingResult = findDevicePairingCode(body.pairingCode);
    if (pairingResult.error) {
      sendPairingCodeError(res, pairingResult);
      return true;
    }
    const existing = db.prepare("SELECT * FROM devices WHERE serial = ?").get(serial);
    if (existing?.household_id && existing.household_id !== pairingResult.pairing.household_id) {
      sendJson(res, 409, { error: "device already belongs to another household" });
      return true;
    }
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date().toISOString();
    const consumed = consumeDevicePairingCode(pairingResult.pairing, now);
    if (consumed.error) {
      sendPairingCodeError(res, consumed);
      return true;
    }
    if (existing) {
      db.prepare(`
        UPDATE devices SET household_id = ?, device_token_hash = ?, panel_profile = ?, updated_at = ? WHERE id = ?
      `).run(pairingResult.pairing.household_id, sha256(token), panel, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO devices (serial, household_id, device_token_hash, panel_profile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(serial, pairingResult.pairing.household_id, sha256(token), panel, now, now);
    }
    sendJson(res, 201, { serial, panelProfile: panel, deviceToken: token });
    return true;
  }

  if (req.method === "GET" && (url.pathname === "/api/device/frame.bin" || url.pathname === "/api/device/frame.png")) {
    const device = requireDevice(req, res);
    if (!device) return true;
    if (!device.household_id) {
      sendJson(res, 409, { error: "device has not been paired" });
      return true;
    }
    const panel = panelProfile(url.searchParams.get("panel") || device.panel_profile);
    const orientation = displayOrientation(url.searchParams.get("orientation") || DEFAULT_DISPLAY_ORIENTATION);
    const frame = await getRenderedFrame(device.household_id, panel, orientation);
    db.prepare("UPDATE devices SET last_seen_at = ?, panel_profile = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), panel, new Date().toISOString(), device.id);
    if (req.headers["if-none-match"] === frame.etag) {
      res.writeHead(304, { ETag: frame.etag, "Cache-Control": "no-cache" });
      res.end();
      return true;
    }
    const data = url.pathname.endsWith(".png") ? frame.png : frame.frame;
    const type = url.pathname.endsWith(".png") ? "image/png" : "application/octet-stream";
    const headers = { ETag: frame.etag, "X-Panel-Profile": panel, "X-Display-Orientation": orientation };
    if (!url.pathname.endsWith(".png")) headers["X-Frame-Format"] = panelConfig(panel).frameFormat;
    sendBuffer(res, 200, data, type, headers);
    return true;
  }

  const user = requireUser(req, res);
  if (!user) return true;
  const householdId = householdService.householdIdForUser(user.id);

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, {
      currentUser: publicUser(user),
      canManageUsers: isAdmin(user),
      users: userRowsFor(user).map(publicUser)
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/household") {
    sendJson(res, 200, householdService.publicHousehold(user.id));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/household/invites") {
    const invite = householdService.createInvite(user.id);
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const protocol = forwardedProto || (config.secureCookies ? "https" : "http");
    const host = req.headers.host || `${config.host}:${config.port}`;
    sendJson(res, 201, { ...invite, inviteUrl: `${protocol}://${host}/?invite=${invite.code}` });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/household/invites/inspect") {
    sendJson(res, 200, householdService.inspectInvite(url.searchParams.get("code")));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/household/invites/accept") {
    const result = householdService.acceptInvite(user.id, (await readJson(req)).code);
    invalidateFrames();
    sendJson(res, 200, result);
    return true;
  }

  const householdMemberMatch = url.pathname.match(/^\/api\/household\/members\/(\d+)$/);
  if (householdMemberMatch && req.method === "DELETE") {
    sendJson(res, 200, householdService.removeMember(user.id, Number(householdMemberMatch[1])));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/household/leave") {
    sendJson(res, 200, householdService.leaveHousehold(user.id));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/foods") {
    sendJson(res, 200, { items: allFoods(householdId), today: localDateKey(config.timezone) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/foods") {
    sendJson(res, 201, foodService.createFoodItem(householdId, await readJson(req)));
    return true;
  }

  const foodMatch = url.pathname.match(/^\/api\/foods\/(\d+)$/);
  if (foodMatch && req.method === "PATCH") {
    sendJson(res, 200, foodService.updateFoodItem(householdId, Number(foodMatch[1]), await readJson(req)));
    return true;
  }

  if (foodMatch && req.method === "DELETE") {
    sendJson(res, 200, { ok: true, deleted: foodService.deleteFoodItem(householdId, Number(foodMatch[1])) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/access-tokens") {
    sendJson(res, 200, { tokens: accessTokenService.listTokens(user.id) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/access-tokens") {
    const body = await readJson(req);
    sendJson(res, 201, accessTokenService.createToken(user.id, body.name));
    return true;
  }

  const tokenMatch = url.pathname.match(/^\/api\/access-tokens\/(\d+)$/);
  if (tokenMatch && req.method === "DELETE") {
    sendJson(res, 200, accessTokenService.revokeToken(user.id, Number(tokenMatch[1])));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/agent/conversations") {
    sendJson(res, 200, { configured: agentService.isConfigured(user.id), conversations: agentService.listConversations(user.id) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/agent/settings") {
    const membership = householdService.membershipFor(user.id);
    const settings = aiSettingsService.getSettings(membership.householdId);
    sendJson(res, 200, membership.role === "owner"
      ? { ...settings, canManage: true, scope: "household" }
      : { configured: settings.configured, canManage: false, scope: "household" });
    return true;
  }

  if (req.method === "PUT" && url.pathname === "/api/agent/settings") {
    const membership = householdService.requireOwner(user.id);
    sendJson(res, 200, { ...aiSettingsService.saveSettings(membership.householdId, user.id, await readJson(req)), canManage: true, scope: "household" });
    return true;
  }

  if (req.method === "DELETE" && url.pathname === "/api/agent/settings") {
    const membership = householdService.requireOwner(user.id);
    sendJson(res, 200, aiSettingsService.clearSettings(membership.householdId));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/conversations") {
    const body = await readJson(req);
    sendJson(res, 201, agentService.createConversation(user.id, body.title));
    return true;
  }

  const conversationMatch = url.pathname.match(/^\/api\/agent\/conversations\/([^/]+)$/);
  if (conversationMatch && req.method === "DELETE") {
    sendJson(res, 200, { deleted: agentService.deleteConversation(user.id, decodeURIComponent(conversationMatch[1])) });
    return true;
  }

  const messagesMatch = url.pathname.match(/^\/api\/agent\/conversations\/([^/]+)\/messages$/);
  if (messagesMatch && req.method === "GET") {
    sendJson(res, 200, { messages: agentService.listMessages(user.id, decodeURIComponent(messagesMatch[1])) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/messages") {
    const body = await readJson(req);
    sendJson(res, 200, await agentService.sendMessage(user.id, body.conversationId, body.content));
    return true;
  }

  const agentActionMatch = url.pathname.match(/^\/api\/agent\/actions\/([^/]+)\/(confirm|cancel)$/);
  if (agentActionMatch && req.method === "POST") {
    const id = decodeURIComponent(agentActionMatch[1]);
    const result = agentActionMatch[2] === "confirm" ? await agentService.confirmAction(user.id, id) : await agentService.cancelAction(user.id, id);
    sendJson(res, 200, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/devices") {
    sendJson(res, 200, { devices: db.prepare("SELECT * FROM devices WHERE household_id = ?").all(householdId).map(publicDevice) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/devices/pairing-codes") {
    sendJson(res, 201, createDevicePairingCode(user.id));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/display/preview") {
    const panel = panelProfile(url.searchParams.get("panel") || "gdem075f52");
    const orientation = displayOrientation(url.searchParams.get("orientation") || DEFAULT_DISPLAY_ORIENTATION);
    sendText(res, 200, renderDashboardHtml(allFoods(householdId), displayTimestamp(), { panel, orientation }), "text/html; charset=utf-8");
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/display/frame.png") {
    const panel = panelProfile(url.searchParams.get("panel") || "gdem075f52");
    const orientation = displayOrientation(url.searchParams.get("orientation") || DEFAULT_DISPLAY_ORIENTATION);
    const frame = await getRenderedFrame(householdId, panel, orientation);
    sendBuffer(res, 200, frame.png, "image/png", { ETag: frame.etag });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/mcp") {
      await handleMcp(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const found = await routeApi(req, res, url);
      if (!found) sendJson(res, 404, { error: "not found" });
      return;
    }
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      servePublic(res, "index.html", "text/html; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/app.js") {
      servePublic(res, "app.js", "text/javascript; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/markdown.js") {
      servePublic(res, "markdown.js", "text/javascript; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/vendor/markdown-it.js") {
      sendBuffer(res, 200, fs.readFileSync(path.join(ROOT, "node_modules", "markdown-it", "dist", "markdown-it.min.js")), "text/javascript; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/styles.css") {
      servePublic(res, "styles.css", "text/css; charset=utf-8");
      return;
    }
    if (req.method === "GET" && url.pathname === "/favicon.svg") {
      servePublic(res, "favicon.svg", "image/svg+xml; charset=utf-8");
      return;
    }
    sendText(res, 404, "not found\n");
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.statusCode || 400, { error: error.message, ...(error.code ? { code: error.code } : {}) });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`XianZhi Tie listening on http://${config.host}:${config.port}`);
  console.log(`Database: ${databasePath}`);
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log(`Local demo login: ${config.adminLogin} / ${config.adminPassword}`);
    console.log(`Demo device token: ${config.demoDeviceToken}`);
  }
});
