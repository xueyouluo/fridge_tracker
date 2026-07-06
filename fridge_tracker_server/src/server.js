"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const {
  FRAME_BYTES,
  DEFAULT_DISPLAY_ORIENTATION,
  decorateFood,
  displayOrientation,
  frameSnapshotKey,
  localDateKey,
  normalizeFoodInput,
  panelProfile,
  sortFoods
} = require("./domain");
const { renderDashboardHtml, renderFrame } = require("./renderer");
const {
  displayNameFromEmail,
  isAdmin,
  normalizeDisplayName,
  normalizeEmail,
  normalizePassword,
  publicUser
} = require("./users");

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
  demoClaimCode: "FRIDGE-DEMO",
  provisioningKey: "local-provisioning-key"
};

const config = loadConfig();
const databasePath = path.resolve(ROOT, config.databasePath);
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new DatabaseSync(databasePath);
const frameCache = new Map();

initializeDatabase();
seedLocalDemo();

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
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial TEXT NOT NULL UNIQUE,
      owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      claim_code_hash TEXT NOT NULL,
      device_token_hash TEXT NOT NULL,
      panel_profile TEXT NOT NULL,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS food_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      quantity_text TEXT NOT NULL,
      start_date TEXT,
      shelf_life_days INTEGER,
      expires_on TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frame_revisions (
      device_id INTEGER PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      etag TEXT NOT NULL,
      generated_at TEXT NOT NULL
    );
  `);
  migrateUsersTable();
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
  let device = db.prepare("SELECT * FROM devices WHERE serial = ?").get("local-demo-screen");
  if (!device) {
    db.prepare(`
      INSERT INTO devices
        (serial, owner_id, claim_code_hash, device_token_hash, panel_profile, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "local-demo-screen",
      user.id,
      sha256(config.demoClaimCode),
      sha256(config.demoDeviceToken),
      "gdem075f52",
      now,
      now
    );
  }
  const foodCount = db.prepare("SELECT COUNT(*) AS count FROM food_items WHERE owner_id = ?").get(user.id).count;
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
        (owner_id, name, category, quantity_text, expires_on, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [name, category, quantityText, days] of examples) {
      const expiresOn = addCalendarDays(today, days);
      insert.run(user.id, name, category, quantityText, expiresOn, now, now);
    }
  }
}

function addCalendarDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  const today = localDateKey(config.timezone);
  const rows = db.prepare("SELECT * FROM food_items WHERE owner_id = ?").all(ownerId);
  return sortFoods(rows.map((row) => decorateFood(row, today)));
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
    (SELECT COUNT(*) FROM food_items WHERE owner_id = users.id) AS food_count,
    (SELECT COUNT(*) FROM devices WHERE owner_id = users.id) AS device_count
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

function recordFrameRevision(deviceId, etag) {
  const now = new Date().toISOString();
  const previous = db.prepare("SELECT * FROM frame_revisions WHERE device_id = ?").get(deviceId);
  if (!previous) {
    db.prepare("INSERT INTO frame_revisions (device_id, revision, etag, generated_at) VALUES (?, ?, ?, ?)")
      .run(deviceId, 1, etag, now);
    return 1;
  }
  if (previous.etag === etag) return previous.revision;
  const revision = previous.revision + 1;
  db.prepare("UPDATE frame_revisions SET revision = ?, etag = ?, generated_at = ? WHERE device_id = ?")
    .run(revision, etag, now, deviceId);
  return revision;
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
    paired: Boolean(device.owner_id),
    lastSeenAt: device.last_seen_at
  };
}

async function routeApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, timezone: config.timezone, frameBytes: FRAME_BYTES });
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
    if (String(req.headers["x-provisioning-key"] || body.provisioningKey || "") !== config.provisioningKey) {
      sendJson(res, 401, { error: "invalid provisioning key" });
      return true;
    }
    const serial = String(body.serial || "").trim().slice(0, 60);
    const claimCode = String(body.claimCode || "").trim().toUpperCase().slice(0, 30);
    const panel = panelProfile(body.panel || "gdem075f52");
    if (!serial || !claimCode) throw new Error("serial and claimCode are required");
    const token = crypto.randomBytes(32).toString("hex");
    const now = new Date().toISOString();
    const existing = db.prepare("SELECT * FROM devices WHERE serial = ?").get(serial);
    if (existing) {
      db.prepare(`
        UPDATE devices SET claim_code_hash = ?, device_token_hash = ?, panel_profile = ?, updated_at = ? WHERE id = ?
      `).run(sha256(claimCode), sha256(token), panel, now, existing.id);
    } else {
      db.prepare(`
        INSERT INTO devices (serial, claim_code_hash, device_token_hash, panel_profile, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(serial, sha256(claimCode), sha256(token), panel, now, now);
    }
    sendJson(res, 201, { serial, panelProfile: panel, deviceToken: token });
    return true;
  }

  if (req.method === "GET" && (url.pathname === "/api/device/frame.bin" || url.pathname === "/api/device/frame.png")) {
    const device = requireDevice(req, res);
    if (!device) return true;
    if (!device.owner_id) {
      sendJson(res, 409, { error: "device has not been claimed" });
      return true;
    }
    const panel = panelProfile(url.searchParams.get("panel") || device.panel_profile);
    const orientation = displayOrientation(url.searchParams.get("orientation") || DEFAULT_DISPLAY_ORIENTATION);
    const frame = await getRenderedFrame(device.owner_id, panel, orientation);
    const revision = recordFrameRevision(device.id, frame.etag);
    db.prepare("UPDATE devices SET last_seen_at = ?, panel_profile = ?, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), panel, new Date().toISOString(), device.id);
    if (req.headers["if-none-match"] === frame.etag) {
      res.writeHead(304, { ETag: frame.etag, "X-Frame-Revision": revision, "Cache-Control": "no-cache" });
      res.end();
      return true;
    }
    const data = url.pathname.endsWith(".png") ? frame.png : frame.frame;
    const type = url.pathname.endsWith(".png") ? "image/png" : "application/octet-stream";
    sendBuffer(res, 200, data, type, { ETag: frame.etag, "X-Frame-Revision": revision, "X-Panel-Profile": panel, "X-Display-Orientation": orientation });
    return true;
  }

  const user = requireUser(req, res);
  if (!user) return true;

  if (req.method === "GET" && url.pathname === "/api/users") {
    sendJson(res, 200, {
      currentUser: publicUser(user),
      canManageUsers: isAdmin(user),
      users: userRowsFor(user).map(publicUser)
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/foods") {
    sendJson(res, 200, { items: allFoods(user.id), today: localDateKey(config.timezone) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/foods") {
    const item = normalizeFoodInput(await readJson(req));
    const now = new Date().toISOString();
    const created = db.prepare(`
      INSERT INTO food_items
        (owner_id, name, category, quantity_text, start_date, shelf_life_days, expires_on, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(user.id, item.name, item.category, item.quantityText, item.startDate, item.shelfLifeDays, item.expiresOn, now, now);
    invalidateFrames();
    const row = db.prepare("SELECT * FROM food_items WHERE id = ?").get(Number(created.lastInsertRowid));
    sendJson(res, 201, decorateFood(row, localDateKey(config.timezone)));
    return true;
  }

  const foodMatch = url.pathname.match(/^\/api\/foods\/(\d+)$/);
  if (foodMatch && req.method === "PATCH") {
    const id = Number(foodMatch[1]);
    const existing = db.prepare("SELECT * FROM food_items WHERE id = ? AND owner_id = ?").get(id, user.id);
    if (!existing) {
      sendJson(res, 404, { error: "food item not found" });
      return true;
    }
    const body = await readJson(req);
    const item = normalizeFoodInput({
      name: body.name ?? existing.name,
      category: body.category ?? existing.category,
      quantityText: body.quantityText ?? existing.quantity_text,
      startDate: body.startDate !== undefined ? body.startDate : existing.start_date,
      shelfLifeDays: body.shelfLifeDays !== undefined ? body.shelfLifeDays : existing.shelf_life_days,
      expiresOn: body.expiresOn !== undefined ? body.expiresOn : existing.expires_on
    });
    db.prepare(`
      UPDATE food_items SET name = ?, category = ?, quantity_text = ?, start_date = ?, shelf_life_days = ?, expires_on = ?, updated_at = ?
      WHERE id = ? AND owner_id = ?
    `).run(item.name, item.category, item.quantityText, item.startDate, item.shelfLifeDays, item.expiresOn, new Date().toISOString(), id, user.id);
    invalidateFrames();
    sendJson(res, 200, decorateFood(db.prepare("SELECT * FROM food_items WHERE id = ?").get(id), localDateKey(config.timezone)));
    return true;
  }

  if (foodMatch && req.method === "DELETE") {
    const deleted = db.prepare("DELETE FROM food_items WHERE id = ? AND owner_id = ?").run(Number(foodMatch[1]), user.id);
    if (!deleted.changes) {
      sendJson(res, 404, { error: "food item not found" });
      return true;
    }
    invalidateFrames();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/devices") {
    sendJson(res, 200, { devices: db.prepare("SELECT * FROM devices WHERE owner_id = ?").all(user.id).map(publicDevice) });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/devices/claim") {
    const body = await readJson(req);
    const claimCode = String(body.claimCode || "").trim().toUpperCase();
    const device = db.prepare("SELECT * FROM devices WHERE claim_code_hash = ?").get(sha256(claimCode));
    if (!device) {
      sendJson(res, 404, { error: "binding code not found" });
      return true;
    }
    if (device.owner_id && device.owner_id !== user.id) {
      sendJson(res, 409, { error: "device already belongs to another user" });
      return true;
    }
    db.prepare("UPDATE devices SET owner_id = ?, updated_at = ? WHERE id = ?").run(user.id, new Date().toISOString(), device.id);
    sendJson(res, 200, publicDevice({ ...device, owner_id: user.id }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/display/preview") {
    const panel = panelProfile(url.searchParams.get("panel") || "gdem075f52");
    const orientation = displayOrientation(url.searchParams.get("orientation") || DEFAULT_DISPLAY_ORIENTATION);
    sendText(res, 200, renderDashboardHtml(allFoods(user.id), displayTimestamp(), { panel, orientation }), "text/html; charset=utf-8");
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/display/frame.png") {
    const panel = panelProfile(url.searchParams.get("panel") || "gdem075f52");
    const orientation = displayOrientation(url.searchParams.get("orientation") || DEFAULT_DISPLAY_ORIENTATION);
    const frame = await getRenderedFrame(user.id, panel, orientation);
    sendBuffer(res, 200, frame.png, "image/png", { ETag: frame.etag });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
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
    sendJson(res, 400, { error: error.message });
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
