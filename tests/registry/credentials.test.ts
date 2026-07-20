import { describe, expect, it, vi } from "vitest";
import { credentialForRegistry, parseDockerConfig } from "@/lib/registry/credentials";

const b64 = (s: string): string => Buffer.from(s).toString("base64");

describe("credentialForRegistry", () => {
  it("decodes basic auth for a matching registry", () => {
    const cfg = parseDockerConfig(
      JSON.stringify({ auths: { "ghcr.io": { auth: b64("user:pass") } } }),
    );
    expect(credentialForRegistry(cfg, "ghcr.io")).toEqual({
      username: "user",
      password: "pass",
    });
  });
  it("maps docker hub host to the index.docker.io key", () => {
    const cfg = parseDockerConfig(
      JSON.stringify({ auths: { "https://index.docker.io/v1/": { auth: b64("u:p") } } }),
    );
    expect(credentialForRegistry(cfg, "registry-1.docker.io")).toEqual({
      username: "u",
      password: "p",
    });
  });
  it("returns null and warns when a credential helper is configured", () => {
    const warn = vi.fn();
    const cfg = parseDockerConfig(JSON.stringify({ auths: {}, credsStore: "desktop" }));
    expect(credentialForRegistry(cfg, "ghcr.io", warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
  it("returns null when no entry exists", () => {
    const cfg = parseDockerConfig(JSON.stringify({ auths: {} }));
    expect(credentialForRegistry(cfg, "ghcr.io")).toBeNull();
  });
});
