import { timingSafeEqual } from "node:crypto";

export function tokenMatches(expected: string | null, provided: string | null): boolean {
  if (!expected || !provided) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
