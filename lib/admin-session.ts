import { createHmac, timingSafeEqual } from "node:crypto";

export const ADMIN_COOKIE = "moore_made_admin";

function sessionSecret() {
  return process.env.ADMIN_SESSION_SECRET ?? "";
}

export function createAdminSessionToken() {
  const secret = sessionSecret();
  if (!secret) throw new Error("ADMIN_SESSION_SECRET is not configured.");
  return createHmac("sha256", secret).update("moore-made-admin-v1").digest("hex");
}

export function isValidAdminSession(value?: string) {
  if (!value) return false;
  let expected: string;
  try {
    expected = createAdminSessionToken();
  } catch {
    return false;
  }

  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
