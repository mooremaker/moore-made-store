import { createHash, randomBytes } from "crypto";

export function newPaymentShareToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPaymentShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
