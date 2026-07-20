import { describe, expect, it } from "vitest";
import { tokenMatches } from "@/lib/auth/webhook";

describe("tokenMatches", () => {
  it("is false when no expected token is configured", () => {
    expect(tokenMatches(null, "anything")).toBe(false);
  });
  it("is false on mismatch and true on exact match", () => {
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", null)).toBe(false);
  });
});
