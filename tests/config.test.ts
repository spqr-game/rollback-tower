import { describe, expect, it } from "vitest";
import { loadConfig, parseDuration } from "@/lib/config";

describe("parseDuration", () => {
  it("parses seconds/minutes/hours and bare numbers as seconds", () => {
    expect(parseDuration("300s")).toBe(300_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("45")).toBe(45_000);
  });
  it("throws on garbage", () => {
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ HOME: "/home/x" });
    expect(c.pollIntervalMs).toBe(300_000);
    expect(c.adminPassword).toBeNull();
    expect(c.webhookToken).toBeNull();
    expect(c.maxTags).toBe(50);
    expect(c.dockerConfigPath).toBe("/home/x/.docker/config.json");
  });
  it("reads overrides and requires SESSION_SECRET when password set", () => {
    expect(() =>
      loadConfig({ ADMIN_PASSWORD: "pw" }),
    ).toThrow(/SESSION_SECRET/);
    const c = loadConfig({ ADMIN_PASSWORD: "pw", SESSION_SECRET: "s", MAX_TAGS: "10" });
    expect(c.adminPassword).toBe("pw");
    expect(c.sessionSecret).toBe("s");
    expect(c.maxTags).toBe(10);
  });
});
