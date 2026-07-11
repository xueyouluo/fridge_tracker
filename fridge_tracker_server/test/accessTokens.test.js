"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccessTokenService } = require("../src/accessTokens");
const { createTestDatabase } = require("./helpers");

test("personal access tokens are shown once, hashed, scoped and revocable", () => {
  const db = createTestDatabase();
  const tokens = createAccessTokenService(db);
  const created = tokens.createToken(1, "Codex");
  assert.match(created.token, /^xzt_/);
  assert.equal(tokens.listTokens(1)[0].token, undefined);
  assert.equal(db.prepare("SELECT token_hash FROM api_tokens WHERE id = ?").get(created.id).token_hash.includes(created.token), false);
  assert.equal(tokens.authenticate(created.token).id, 1);
  assert.equal(tokens.authenticate(created.token, new Date("2100-01-01T00:00:00.000Z")), null);
  tokens.revokeToken(1, created.id);
  assert.equal(tokens.authenticate(created.token), null);
  assert.throws(() => tokens.revokeToken(2, created.id), /not found/);
});
