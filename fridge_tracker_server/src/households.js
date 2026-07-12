"use strict";

const crypto = require("node:crypto");

const HOUSEHOLD_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const INVITE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

class HouseholdError extends Error {
  constructor(message, statusCode = 400, code = "household_error") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function generateInviteCode(length = 10) {
  let code = "";
  for (let index = 0; index < length; index += 1) {
    code += INVITE_ALPHABET[crypto.randomInt(INVITE_ALPHABET.length)];
  }
  return code;
}

function normalizeInviteCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^23456789A-HJ-NP-Z]/g, "").slice(0, 10);
}

function createHouseholdService({ db, hashValue }) {
  function createPersonalHousehold(userId) {
    const user = db.prepare("SELECT id, login, display_name FROM users WHERE id = ?").get(userId);
    if (!user) throw new HouseholdError("user not found", 404, "user_not_found");
    const current = db.prepare("SELECT household_id FROM household_members WHERE user_id = ?").get(userId);
    if (current) return current.household_id;
    const now = new Date().toISOString();
    const baseName = String(user.display_name || user.login || "我的").trim().slice(0, 50) || "我的";
    const created = db.prepare("INSERT INTO households (name, created_at, updated_at) VALUES (?, ?, ?)")
      .run(`${baseName}的家庭`, now, now);
    const householdId = Number(created.lastInsertRowid);
    db.prepare("INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
      .run(householdId, userId, now);
    return householdId;
  }

  function ensureHouseholds() {
    const users = db.prepare(`
      SELECT users.id FROM users
      LEFT JOIN household_members ON household_members.user_id = users.id
      WHERE household_members.user_id IS NULL
    `).all();
    users.forEach((user) => createPersonalHousehold(user.id));
  }

  function membershipFor(userId) {
    const row = db.prepare(`
      SELECT household_members.household_id, household_members.role, households.name
      FROM household_members JOIN households ON households.id = household_members.household_id
      WHERE household_members.user_id = ?
    `).get(userId);
    if (!row) throw new HouseholdError("household membership not found", 409, "membership_not_found");
    return { householdId: row.household_id, role: row.role, name: row.name };
  }

  function householdIdForUser(userId) {
    return membershipFor(userId).householdId;
  }

  function requireOwner(userId) {
    const membership = membershipFor(userId);
    if (membership.role !== "owner") throw new HouseholdError("only the household owner can perform this action", 403, "owner_required");
    return membership;
  }

  function publicHousehold(userId) {
    const membership = membershipFor(userId);
    const members = db.prepare(`
      SELECT users.id, users.login, users.email, users.display_name, household_members.role, household_members.joined_at
      FROM household_members JOIN users ON users.id = household_members.user_id
      WHERE household_members.household_id = ?
      ORDER BY CASE household_members.role WHEN 'owner' THEN 0 ELSE 1 END, household_members.joined_at ASC
    `).all(membership.householdId).map((row) => ({
      id: row.id,
      login: row.login,
      email: row.email || "",
      displayName: row.display_name || row.login,
      householdRole: row.role,
      joinedAt: row.joined_at
    }));
    return {
      household: { id: membership.householdId, name: membership.name },
      currentRole: membership.role,
      permissions: {
        manageFoods: true,
        manageDevices: membership.role === "owner",
        manageMembers: membership.role === "owner",
        leaveHousehold: membership.role === "member"
      },
      members
    };
  }

  function inviteRow(value) {
    const code = normalizeInviteCode(value);
    if (code.length !== 10) throw new HouseholdError("invalid household invite", 404, "invite_not_found");
    const row = db.prepare(`
      SELECT household_invites.*, households.name AS household_name,
        users.display_name AS inviter_name, users.login AS inviter_login
      FROM household_invites
      JOIN households ON households.id = household_invites.household_id
      JOIN users ON users.id = household_invites.created_by_user_id
      WHERE household_invites.code_hash = ?
    `).get(hashValue(code));
    if (!row) throw new HouseholdError("invalid household invite", 404, "invite_not_found");
    if (row.used_at) throw new HouseholdError("household invite has already been used", 410, "invite_used");
    if (row.expires_at <= new Date().toISOString()) throw new HouseholdError("household invite has expired", 410, "invite_expired");
    return { code, row };
  }

  function createInvite(userId) {
    const membership = requireOwner(userId);
    const now = new Date();
    db.prepare("DELETE FROM household_invites WHERE expires_at <= ? OR used_at IS NOT NULL").run(now.toISOString());
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = generateInviteCode();
      try {
        const expiresAt = new Date(now.getTime() + HOUSEHOLD_INVITE_TTL_MS).toISOString();
        db.prepare(`
          INSERT INTO household_invites (household_id, created_by_user_id, code_hash, expires_at, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(membership.householdId, userId, hashValue(code), expiresAt, now.toISOString());
        return { code, expiresAt };
      } catch (error) {
        if (!String(error.message).includes("UNIQUE")) throw error;
      }
    }
    throw new HouseholdError("could not generate household invite", 500, "invite_generation_failed");
  }

  function inspectInvite(value) {
    const { row } = inviteRow(value);
    return {
      household: { id: row.household_id, name: row.household_name },
      inviter: { displayName: row.inviter_name || row.inviter_login },
      expiresAt: row.expires_at
    };
  }

  function assertDisposableHousehold(userId, membership) {
    const memberCount = db.prepare("SELECT COUNT(*) AS count FROM household_members WHERE household_id = ?").get(membership.householdId).count;
    const foodCount = db.prepare("SELECT COUNT(*) AS count FROM food_items WHERE household_id = ?").get(membership.householdId).count;
    const deviceCount = db.prepare("SELECT COUNT(*) AS count FROM devices WHERE household_id = ?").get(membership.householdId).count;
    if (membership.role !== "owner" || memberCount !== 1 || foodCount !== 0 || deviceCount !== 0) {
      throw new HouseholdError("current household contains data or other members", 409, "household_not_empty");
    }
    const member = db.prepare("SELECT user_id FROM household_members WHERE household_id = ?").get(membership.householdId);
    if (!member || member.user_id !== userId) throw new HouseholdError("current household cannot be replaced", 409, "household_not_disposable");
  }

  function acceptInvite(userId, value) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const { row } = inviteRow(value);
      const current = membershipFor(userId);
      if (current.householdId === row.household_id) throw new HouseholdError("user already belongs to this household", 409, "already_member");
      assertDisposableHousehold(userId, current);
      const now = new Date().toISOString();
      const consumed = db.prepare(`
        UPDATE household_invites SET used_at = ?, accepted_by_user_id = ?
        WHERE id = ? AND used_at IS NULL AND expires_at > ?
      `).run(now, userId, row.id, now);
      if (!consumed.changes) throw new HouseholdError("household invite is no longer available", 410, "invite_unavailable");
      db.prepare("DELETE FROM household_members WHERE user_id = ?").run(userId);
      db.prepare("DELETE FROM households WHERE id = ?").run(current.householdId);
      db.prepare("INSERT INTO household_members (household_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)")
        .run(row.household_id, userId, now);
      db.exec("COMMIT");
      return publicHousehold(userId);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function removeMember(ownerUserId, memberUserId) {
    const owner = requireOwner(ownerUserId);
    const target = db.prepare("SELECT role FROM household_members WHERE household_id = ? AND user_id = ?")
      .get(owner.householdId, Number(memberUserId));
    if (!target) throw new HouseholdError("household member not found", 404, "member_not_found");
    if (target.role === "owner") throw new HouseholdError("household owner cannot be removed", 409, "owner_cannot_leave");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM household_members WHERE household_id = ? AND user_id = ?").run(owner.householdId, Number(memberUserId));
      createPersonalHousehold(Number(memberUserId));
      db.exec("COMMIT");
      return publicHousehold(ownerUserId);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function leaveHousehold(userId) {
    const membership = membershipFor(userId);
    if (membership.role === "owner") throw new HouseholdError("household owner cannot leave", 409, "owner_cannot_leave");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM household_members WHERE user_id = ?").run(userId);
      createPersonalHousehold(userId);
      db.exec("COMMIT");
      return publicHousehold(userId);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  return {
    acceptInvite,
    createInvite,
    createPersonalHousehold,
    ensureHouseholds,
    householdIdForUser,
    inspectInvite,
    membershipFor,
    publicHousehold,
    removeMember,
    requireOwner,
    leaveHousehold
  };
}

module.exports = {
  HOUSEHOLD_INVITE_TTL_MS,
  HouseholdError,
  createHouseholdService,
  generateInviteCode,
  normalizeInviteCode
};
