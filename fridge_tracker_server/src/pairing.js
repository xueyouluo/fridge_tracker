"use strict";

const crypto = require("node:crypto");

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;

function normalizePairingCode(value) {
  return String(value || "").trim().replace(/[\s-]/g, "").toUpperCase();
}

function generatePairingCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (let index = 0; index < PAIRING_CODE_LENGTH; index += 1) {
    code += PAIRING_CODE_ALPHABET[bytes[index] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

function pairingCodeExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PAIRING_CODE_TTL_MS).toISOString();
}

module.exports = {
  PAIRING_CODE_TTL_MS,
  generatePairingCode,
  normalizePairingCode,
  pairingCodeExpiresAt
};
