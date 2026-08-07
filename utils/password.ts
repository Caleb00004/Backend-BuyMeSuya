import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const verifyPassword = (password: string, stored: string) => {
    const [salt, key] = stored.split(":");
    if (!salt || !key) return false;

    const derivedBuf = scryptSync(password, salt, 64);
    const keyBuf = Buffer.from(key, "hex");

    // Buffers must be equal length or timingSafeEqual throws
    if (derivedBuf.length !== keyBuf.length) return false;

    return timingSafeEqual(derivedBuf, keyBuf);
};

export const hashPassword = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString("hex")}`;
};
