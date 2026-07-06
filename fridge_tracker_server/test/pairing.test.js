"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PAIRING_CODE_TTL_MS,
  generatePairingCode,
  normalizePairingCode,
  pairingCodeExpiresAt
} = require("../src/pairing");

test("pairing codes are normalized for manual entry", () => {
  assert.equal(normalizePairingCode(" a7k-2 q9 "), "A7K2Q9");
  assert.equal(normalizePairingCode(""), "");
});

test("generated pairing codes use a compact uppercase alphabet", () => {
  const code = generatePairingCode(() => Buffer.from([0, 1, 2, 3, 4, 5]));
  assert.equal(code, "ABCDEF");
  assert.match(generatePairingCode(), /^[A-Z2-9]{6}$/);
});

test("pairing codes expire after the configured short window", () => {
  const now = new Date("2026-07-06T12:00:00.000Z");
  assert.equal(
    pairingCodeExpiresAt(now),
    new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString()
  );
});
