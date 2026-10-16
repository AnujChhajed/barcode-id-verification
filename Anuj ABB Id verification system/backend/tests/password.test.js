import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { hashPassword, verifyPassword } from "../src/auth/password.js";

describe("Password Security & Hashing (scrypt RFC 7914)", () => {
  test("hashes password with memory-hard scrypt and unique salt", () => {
    const password = "abb-secure-password-2026";
    const hash1 = hashPassword(password);
    const hash2 = hashPassword(password);

    assert.notEqual(hash1, hash2, "hashes should have unique salts");
    assert.ok(hash1.startsWith("scrypt$16384$8$1$"), "hash must use safe scrypt parameters");
    assert.equal(verifyPassword(password, hash1), true);
    assert.equal(verifyPassword(password, hash2), true);
    assert.equal(verifyPassword("wrong-password", hash1), false);
  });

  test("rejects empty or invalid passwords safely", () => {
    assert.throws(() => hashPassword(""), TypeError);
    assert.throws(() => hashPassword(null), TypeError);
    assert.equal(verifyPassword("", "scrypt$16384$8$1$fake$fake"), false);
    assert.equal(verifyPassword("some-password", "invalid-hash-format"), false);
    assert.equal(verifyPassword("some-password", null), false);
  });
});
