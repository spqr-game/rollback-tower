import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  it("falls back to MAX_TAGS default on a non-numeric value", () => {
    expect(loadConfig({ MAX_TAGS: "abc" }).maxTags).toBe(50);
    expect(loadConfig({ MAX_TAGS: "-5" }).maxTags).toBe(50);
  });
});

describe("loadConfig secret files", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "rbt-secrets-"));
    writeFileSync(join(dir, "webhook"), "file-token\n");
    writeFileSync(join(dir, "password"), "  file-pw \t\n\n");
    writeFileSync(join(dir, "session"), "file-secret");
    writeFileSync(join(dir, "blank"), "  \n\t\n");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads a secret from its *_FILE variant", () => {
    const c = loadConfig({ WEBHOOK_TOKEN_FILE: join(dir, "webhook") });
    expect(c.webhookToken).toBe("file-token");
  });

  it("prefers the *_FILE variant over the plain env var", () => {
    const c = loadConfig({
      WEBHOOK_TOKEN: "env-token",
      WEBHOOK_TOKEN_FILE: join(dir, "webhook"),
    });
    expect(c.webhookToken).toBe("file-token");
  });

  it("trims trailing whitespace from file contents", () => {
    const c = loadConfig({
      ADMIN_PASSWORD_FILE: join(dir, "password"),
      SESSION_SECRET_FILE: join(dir, "session"),
    });
    expect(c.adminPassword).toBe("  file-pw");
    expect(c.sessionSecret).toBe("file-secret");
  });

  it("treats a blank file as unset", () => {
    const c = loadConfig({ WEBHOOK_TOKEN_FILE: join(dir, "blank") });
    expect(c.webhookToken).toBeNull();
  });

  it("throws when a *_FILE path cannot be read", () => {
    expect(() =>
      loadConfig({ WEBHOOK_TOKEN_FILE: join(dir, "does-not-exist") }),
    ).toThrow(/WEBHOOK_TOKEN_FILE/);
  });

  it("still enforces SESSION_SECRET when ADMIN_PASSWORD comes from a file", () => {
    expect(() =>
      loadConfig({ ADMIN_PASSWORD_FILE: join(dir, "password") }),
    ).toThrow(/SESSION_SECRET/);
  });
});
