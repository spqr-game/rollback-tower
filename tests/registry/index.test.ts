import { describe, expect, it, vi } from "vitest";
import { listRollbackTargets, sortTags } from "@/lib/registry";
import { parseImageRef } from "@/lib/registry/ref";

describe("sortTags", () => {
  it("orders semver descending with non-semver last", () => {
    expect(sortTags(["1.2.0", "1.10.0", "1.9.0", "latest"])).toEqual([
      "1.10.0",
      "1.9.0",
      "1.2.0",
      "latest",
    ]);
  });
});

describe("listRollbackTargets", () => {
  it("resolves the newest maxTags and flags truncation", async () => {
    const client = {
      listTags: vi.fn(async () => ["1.0.0", "1.1.0", "1.2.0"]),
      resolveDigest: vi.fn(async (_repo: string, tag: string) => `sha256:${tag}`),
      getCreated: vi.fn(async () => "2026-01-01T00:00:00Z"),
    };
    const warn = vi.fn();
    const result = await listRollbackTargets(parseImageRef("org/app"), client, 2, warn);
    expect(result.truncated).toBe(true);
    expect(result.targets.map((t) => t.tag)).toEqual(["1.2.0", "1.1.0"]);
    expect(result.targets[0]).toEqual({
      tag: "1.2.0",
      digest: "sha256:1.2.0",
      created: "2026-01-01T00:00:00Z",
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});
