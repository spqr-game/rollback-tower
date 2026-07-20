import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scan", () => ({ scan: vi.fn(async () => ({ scannedAt: "t", containers: [] })) }));

describe("webhook route", () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_TOKEN;
  });
  it("returns 503 when no token configured", async () => {
    const { POST } = await import("@/app/api/webhook/route");
    const res = await POST(new Request("http://x/api/webhook"));
    expect(res.status).toBe(503);
  });
  it("returns 401 on bad token and 200 on good token", async () => {
    process.env.WEBHOOK_TOKEN = "secret";
    vi.resetModules();
    const { POST } = await import("@/app/api/webhook/route");
    const bad = await POST(new Request("http://x/api/webhook?token=nope"));
    expect(bad.status).toBe(401);
    const ok = await POST(new Request("http://x/api/webhook?token=secret"));
    expect(ok.status).toBe(200);
  });
});
