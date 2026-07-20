import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

describe("session", () => {
  it("verifies a token it signed", () => {
    const token = signSession("secret");
    expect(verifySession("secret", token)).toBe(true);
  });
  it("rejects tampering or a wrong secret", () => {
    const token = signSession("secret");
    expect(verifySession("other", token)).toBe(false);
    expect(verifySession("secret", `${token}x`)).toBe(false);
  });
});
