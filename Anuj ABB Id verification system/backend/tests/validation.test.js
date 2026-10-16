import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  createCredentialSchema,
  createPersonSchema,
  createUserSchema,
  loginSchema,
  missingCategoryFields,
  updateSettingSchema,
  verifyGateSchema,
} from "../src/validation/schemas.js";

describe("Validation Schemas & Strict Input Sanitization", () => {
  test("loginSchema accepts valid inputs and rejects missing fields", () => {
    assert.ok(loginSchema.parse({ username: "admin", password: "password-123" }));
    assert.throws(() => loginSchema.parse({ username: "", password: "password-123" }));
    assert.throws(() => loginSchema.parse({ username: "admin", password: "" }));
    // Strict schema rejects injected unrecognized properties
    assert.throws(() => loginSchema.parse({ username: "admin", password: "pwd", role: "admin" }));
  });

  test("createUserSchema enforces 12-character minimum password and valid usernames", () => {
    const valid = {
      username: "john.doe",
      fullName: "John Doe",
      role: "security_staff",
      password: "secure-password-123",
      email: "john@example.com",
    };
    assert.ok(createUserSchema.parse(valid));

    // Under 12 chars
    assert.throws(() => createUserSchema.parse({ ...valid, password: "short" }));
    // Invalid username chars
    assert.throws(() => createUserSchema.parse({ ...valid, username: "john doe" }));
    // Invalid role
    assert.throws(() => createUserSchema.parse({ ...valid, role: "superuser" }));
  });

  test("verifyGateSchema requires code and direction", () => {
    assert.ok(verifyGateSchema.parse({ code: "ABB-WRK-001", direction: "entry" }));
    assert.ok(verifyGateSchema.parse({ code: "ABB-WRK-001", direction: "exit" }));
    assert.throws(() => verifyGateSchema.parse({ code: "", direction: "entry" }));
    assert.throws(() => verifyGateSchema.parse({ code: "ABB-WRK-001", direction: "sideways" }));
  });

  test("createPersonSchema validates worker, intern, and visitor inputs", () => {
    const validWorker = {
      category: "worker",
      fullName: "Ramesh Sharma",
      workerRef: "WRK-102",
      contractorCompany: "ABB Power Grids",
    };
    assert.ok(createPersonSchema.parse(validWorker));

    const validVisitor = {
      category: "visitor",
      fullName: "Auditor Smith",
      purposeOfVisit: "Annual Safety Inspection",
      personToMeet: "Plant Manager",
    };
    assert.ok(createPersonSchema.parse(validVisitor));
    assert.throws(() => createPersonSchema.parse({ ...validVisitor, fullName: "" }));
  });

  test("missingCategoryFields enforces category-specific requirements", () => {
    assert.deepEqual(missingCategoryFields("worker", { fullName: "Worker 1" }), ["workerRef"]);
    assert.deepEqual(missingCategoryFields("worker", { workerRef: "W-1" }), []);
    assert.deepEqual(missingCategoryFields("visitor", { fullName: "Visitor 1" }), [
      "purposeOfVisit",
      "personToMeet",
    ]);
  });

  test("createCredentialSchema validates dates and kind", () => {
    const valid = {
      personId: "person-uuid-1",
      kind: "id_card",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
    };
    assert.ok(createCredentialSchema.parse(valid));
    assert.throws(() => createCredentialSchema.parse({ ...valid, validFrom: "not-a-date" }));
  });

  test("updateSettingSchema validates keys and value length", () => {
    assert.ok(updateSettingSchema.parse({ key: "session.timeout_minutes", value: "30" }));
    assert.throws(() => updateSettingSchema.parse({ key: "Session_Timeout", value: "30" }));
  });
});
