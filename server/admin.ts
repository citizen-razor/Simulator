/**
 * Admin mode: a PIN (ADMIN_PIN in .env) unlocks editing the topic/tag and grading
 * libraries and marking rubric criteria. The browser sends it in the X-Admin-Pin header.
 *
 * This is a light lock for a single machine until real accounts exist; it is not a
 * substitute for logins. With no ADMIN_PIN set, everyone is admin.
 * Wrong PINs are counted: after 5 failures in a minute, admin requests are refused for a minute.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { HttpError } from "./storage";

const hash = (s: string) => createHash("sha256").update(s).digest();
const PIN = process.env.ADMIN_PIN?.trim() || null;
const PIN_HASH = PIN ? hash(PIN) : null;

let failures: number[] = [];
let lockedUntil = 0;

export const adminPinRequired = () => PIN_HASH !== null;

export function checkPin(pin: unknown): boolean {
  if (!PIN_HASH) return true;
  const now = Date.now();
  if (now < lockedUntil) throw new HttpError(429, "Too many wrong PINs. Try again in a minute.");
  // Compare hashes in constant time so response timing doesn't leak the PIN.
  const ok = typeof pin === "string" && timingSafeEqual(hash(pin), PIN_HASH);
  if (!ok) {
    failures = [...failures.filter((t) => now - t < 60_000), now];
    if (failures.length >= 5) {
      lockedUntil = now + 60_000;
      failures = [];
    }
  }
  return ok;
}

export function requireAdmin(req: Request) {
  if (!checkPin(req.get("X-Admin-Pin"))) throw new HttpError(403, "Admin PIN required.");
}
