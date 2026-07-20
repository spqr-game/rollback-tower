import { createHmac, timingSafeEqual } from "node:crypto";

const PAYLOAD = "rollback-tower";

export function signSession(secret: string): string {
  const mac = createHmac("sha256", secret).update(PAYLOAD).digest("hex");
  return `${PAYLOAD}.${mac}`;
}

export function verifySession(secret: string, value: string): boolean {
  const expected = signSession(secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}
