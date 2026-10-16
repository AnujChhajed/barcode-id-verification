import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  APPROVED,
  REJECTED,
  UNABLE_TO_VERIFY,
  evaluateCredential,
  gateResultFor,
  isValidCredential,
} from "../src/domain/credential-validity.js";

describe("Domain Security & Fail-Closed Rules", () => {
  const activeCred = {
    status: "active",
    valid_from: "2026-01-01",
    valid_to: "2026-12-31",
  };
  const today = "2026-06-15";

  test("approved when credential and person are active and within date window", () => {
    const verdict = evaluateCredential(activeCred, "active", today);
    assert.equal(verdict.valid, true);
    assert.equal(gateResultFor(verdict), APPROVED);
    assert.equal(isValidCredential(activeCred, "active", today), true);
  });

  test("fail-closed: missing credential evaluates to REJECTED (not_found)", () => {
    const verdict = evaluateCredential(null, "active", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "not_found");
    assert.equal(gateResultFor(verdict), REJECTED);
  });

  test("fail-closed: unreadable or malformed today evaluates to UNABLE_TO_VERIFY", () => {
    const verdict = evaluateCredential(activeCred, "active", "invalid-date");
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "indeterminate");
    assert.equal(gateResultFor(verdict), UNABLE_TO_VERIFY);
  });

  test("person termination immediately overrides credential validity", () => {
    const verdict = evaluateCredential(activeCred, "terminated", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "person_terminated");
    assert.equal(gateResultFor(verdict), REJECTED);
  });

  test("person suspension immediately overrides credential validity", () => {
    const verdict = evaluateCredential(activeCred, "suspended", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "person_suspended");
    assert.equal(gateResultFor(verdict), REJECTED);
  });

  test("credential expiry evaluates to expired", () => {
    const expiredCred = {
      status: "active",
      valid_from: "2025-01-01",
      valid_to: "2025-12-31",
    };
    const verdict = evaluateCredential(expiredCred, "active", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "expired");
    assert.equal(gateResultFor(verdict), REJECTED);
  });

  test("credential not yet valid evaluates to not_yet_valid", () => {
    const futureCred = {
      status: "active",
      valid_from: "2027-01-01",
      valid_to: "2027-12-31",
    };
    const verdict = evaluateCredential(futureCred, "active", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "not_yet_valid");
    assert.equal(gateResultFor(verdict), REJECTED);
  });

  test("credential suspended evaluates to suspended", () => {
    const suspendedCred = { ...activeCred, status: "suspended" };
    const verdict = evaluateCredential(suspendedCred, "active", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "suspended");
    assert.equal(gateResultFor(verdict), REJECTED);
  });

  test("credential terminated evaluates to terminated", () => {
    const terminatedCred = { ...activeCred, status: "terminated" };
    const verdict = evaluateCredential(terminatedCred, "active", today);
    assert.equal(verdict.valid, false);
    assert.equal(verdict.code, "terminated");
    assert.equal(gateResultFor(verdict), REJECTED);
  });
});
