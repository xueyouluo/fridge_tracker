"use strict";

const crypto = require("node:crypto");

const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function publicToken(row) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.token_prefix,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at
  };
}

function createAccessTokenService(db) {
  function listTokens(userId) {
    return db.prepare("SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC").all(userId).map(publicToken);
  }

  function createToken(userId, name, now = new Date()) {
    const cleanName = String(name || "Agent token").trim().slice(0, 60) || "Agent token";
    const token = `xzt_${crypto.randomBytes(32).toString("base64url")}`;
    const createdAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + TOKEN_TTL_MS).toISOString();
    const created = db.prepare(`
      INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, cleanName, sha256(token), token.slice(0, 12), expiresAt, createdAt);
    const row = db.prepare("SELECT * FROM api_tokens WHERE id = ?").get(Number(created.lastInsertRowid));
    return { ...publicToken(row), token };
  }

  function revokeToken(userId, id, now = new Date()) {
    const result = db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), Number(id), userId);
    if (!result.changes) {
      const error = new Error("access token not found");
      error.statusCode = 404;
      throw error;
    }
    return { ok: true };
  }

  function authenticate(token, now = new Date()) {
    if (!String(token || "").startsWith("xzt_")) return null;
    const row = db.prepare(`
      SELECT api_tokens.*, users.login, users.email, users.display_name, users.role
      FROM api_tokens JOIN users ON users.id = api_tokens.user_id
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
    `).get(sha256(token), now.toISOString());
    if (!row) return null;
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now.toISOString(), row.id);
    return { id: row.user_id, login: row.login, email: row.email, display_name: row.display_name, role: row.role };
  }

  return { listTokens, createToken, revokeToken, authenticate };
}

module.exports = { TOKEN_TTL_MS, createAccessTokenService, sha256 };
