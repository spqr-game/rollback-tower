import { describe, expect, it } from "vitest";
import { formatImageRef, parseImageRef } from "@/lib/registry/ref";

describe("parseImageRef", () => {
  it("defaults docker hub library namespace and latest tag", () => {
    expect(parseImageRef("nginx")).toEqual({
      registry: "registry-1.docker.io",
      repository: "library/nginx",
      tag: "latest",
      digest: null,
    });
  });
  it("keeps user namespace on docker hub", () => {
    expect(parseImageRef("chad3814/app:1.2.3")).toEqual({
      registry: "registry-1.docker.io",
      repository: "chad3814/app",
      tag: "1.2.3",
      digest: null,
    });
  });
  it("detects custom registry by dot/port/localhost in first segment", () => {
    expect(parseImageRef("ghcr.io/mozilla-ocho/post-host:edge")).toEqual({
      registry: "ghcr.io",
      repository: "mozilla-ocho/post-host",
      tag: "edge",
      digest: null,
    });
    expect(parseImageRef("localhost:5000/thing:1").registry).toBe("localhost:5000");
  });
  it("parses digest pins", () => {
    const r = parseImageRef("nginx@sha256:abc");
    expect(r.digest).toBe("sha256:abc");
    expect(r.tag).toBe("latest");
  });
});

describe("formatImageRef", () => {
  it("round-trips a hub ref back to short form", () => {
    const r = parseImageRef("chad3814/app:1.2.3");
    expect(formatImageRef(r)).toBe("chad3814/app:1.2.3");
  });
});
