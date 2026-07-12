"use strict";

const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFoodService } = require("../src/foods");
const { createHouseholdService, generateInviteCode, normalizeInviteCode } = require("../src/households");
const { createTestDatabase } = require("./helpers");

const hashValue = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

test("household invite codes use the compact ten-character alphabet", () => {
  const code = generateInviteCode();
  assert.match(code, /^[23456789A-HJ-NP-Z]{10}$/);
  assert.equal(normalizeInviteCode(` ${code.slice(0, 5)}-${code.slice(5).toLowerCase()} `), code);
});

test("an empty personal household can accept one invite and share food scope", () => {
  const db = createTestDatabase();
  const households = createHouseholdService({ db, hashValue });
  const foods = createFoodService({ db });
  const invite = households.createInvite(1);

  const preview = households.inspectInvite(invite.code);
  assert.equal(preview.household.name, "One的家庭");
  assert.equal(preview.inviter.displayName, "One");

  const joined = households.acceptInvite(2, invite.code);
  assert.equal(joined.currentRole, "member");
  assert.deepEqual(joined.members.map((member) => member.id), [1, 2]);
  assert.throws(() => households.inspectInvite(invite.code), (error) => error.code === "invite_used");
  assert.throws(() => households.createInvite(2), (error) => error.code === "owner_required");

  const householdId = households.householdIdForUser(1);
  foods.createFoodItem(householdId, { name: "牛奶", category: "乳品", expiresOn: "2026-07-20" });
  assert.equal(foods.listFoodItems(households.householdIdForUser(2))[0].name, "牛奶");

  const left = households.leaveHousehold(2);
  assert.equal(left.currentRole, "owner");
  assert.equal(foods.listFoodItems(households.householdIdForUser(2)).length, 0);
  assert.equal(foods.listFoodItems(households.householdIdForUser(1)).length, 1);
});

test("an account with household data cannot accept another household invite", () => {
  const db = createTestDatabase();
  const households = createHouseholdService({ db, hashValue });
  const foods = createFoodService({ db });
  foods.createFoodItem(households.householdIdForUser(2), { name: "鸡蛋", category: "蛋类", expiresOn: "2026-07-25" });
  const invite = households.createInvite(1);

  assert.throws(() => households.acceptInvite(2, invite.code), (error) => error.code === "household_not_empty");
  assert.equal(households.householdIdForUser(2), 2);
  assert.equal(foods.listFoodItems(2)[0].name, "鸡蛋");
  assert.equal(households.inspectInvite(invite.code).household.id, 1);
});

test("only the owner can remove a member and removed members receive an empty household", () => {
  const db = createTestDatabase();
  const households = createHouseholdService({ db, hashValue });
  households.acceptInvite(2, households.createInvite(1).code);
  assert.throws(() => households.removeMember(2, 1), (error) => error.code === "owner_required");
  assert.throws(() => households.removeMember(1, 1), (error) => error.code === "owner_cannot_leave");

  const result = households.removeMember(1, 2);
  assert.deepEqual(result.members.map((member) => member.id), [1]);
  assert.equal(households.membershipFor(2).role, "owner");
  assert.notEqual(households.householdIdForUser(2), households.householdIdForUser(1));
});
