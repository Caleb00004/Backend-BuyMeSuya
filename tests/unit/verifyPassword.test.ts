import { it, expect, describe } from 'vitest'
import { verifyPassword, hashPassword } from '../../utils/password'
import { randomBytes } from "crypto"

describe("verifyPassword", () => {
  it("returns true for the correct password", () => {
    const stored = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("correct-horse-battery-staple", stored)).toBe(true);
  });

  it("returns false for an incorrect password", () => {
    const stored = hashPassword("correct-horse-battery-staple");
    expect(verifyPassword("wrong-password", stored)).toBe(false);
  });

  it("returns false when stored hash has no salt/key separator", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });

  it("returns false when stored value is empty", () => {
    expect(verifyPassword("anything", "")).toBe(false);
  });

  it("returns false when salt is missing", () => {
    expect(verifyPassword("anything", ":somekeyvalue")).toBe(false);
  });

  it("returns false when key is missing", () => {
    expect(verifyPassword("anything", "somesalt:")).toBe(false);
  });

  it("returns false when key is not valid hex / wrong length", () => {
    const salt = randomBytes(16).toString("hex");
    // Too short to match a real 64-byte scrypt key
    expect(verifyPassword("anything", `${salt}:abcd`)).toBe(false);
  });

  it("does not throw on malformed or garbage input", () => {
    expect(() => verifyPassword("", "")).not.toThrow();
    expect(() => verifyPassword("password", "a:b:c:d")).not.toThrow();
  });

  it("is case-sensitive", () => {
    const stored = hashPassword("Password123");
    expect(verifyPassword("password123", stored)).toBe(false);
  });

  it("rejects passwords with trailing/leading whitespace differences", () => {
    const stored = hashPassword("password123");
    expect(verifyPassword(" password123", stored)).toBe(false);
    expect(verifyPassword("password123 ", stored)).toBe(false);
  });

  it("produces different hashes for the same password with different salts (sanity check on test helper)", () => {
    const a = hashPassword("samepassword");
    const b = hashPassword("samepassword");
    expect(a).not.toBe(b); // different salts → different stored strings
    expect(verifyPassword("samepassword", a)).toBe(true);
    expect(verifyPassword("samepassword", b)).toBe(true);
  });

  it("takes roughly similar time whether the key is short-circuited or fully compared (timing-safety sanity check)", () => {
    // Not a rigorous timing-attack test, just a smoke check that
    // wrong passwords don't return suspiciously instantly vs right ones
    const stored = hashPassword("timing-check-password");

    const start1 = process.hrtime.bigint();
    verifyPassword("timing-check-password", stored);
    const end1 = process.hrtime.bigint();

    const start2 = process.hrtime.bigint();
    verifyPassword("completely-wrong-password", stored);
    const end2 = process.hrtime.bigint();

    const t1 = Number(end1 - start1);
    const t2 = Number(end2 - start2);

    // Both dominated by scryptSync cost, should be same order of magnitude
    expect(Math.abs(t1 - t2) / Math.max(t1, t2)).toBeLessThan(0.5);
  });
});