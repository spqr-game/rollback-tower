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
  function makeClient(tags: string[]) {
    return {
      listTags: vi.fn(async () => tags),
      resolveDigest: vi.fn(async (_repo: string, tag: string) => `sha256:${tag}`),
      getCreated: vi.fn(async (_repo: string, tag: string) => `created:${tag}`),
    };
  }

  it("returns the newest maxTags names and flags truncation", async () => {
    const client = makeClient(["1.0.0", "1.1.0", "1.2.0"]);
    const warn = vi.fn();
    const result = await listRollbackTargets(parseImageRef("org/app"), client, 2, {
      warn,
    });
    expect(result.truncated).toBe(true);
    expect(result.targets.map((t) => t.tag)).toEqual(["1.2.0", "1.1.0"]);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("enriches only the first five tags with digest/created when tagInfo is on", async () => {
    const tags = ["9", "8", "7", "6", "5", "4", "3"];
    const client = makeClient(tags);
    const result = await listRollbackTargets(parseImageRef("org/app"), client, 50, {
      tagInfo: true,
    });
    // sorted: non-semver falls back to reverse localeCompare -> 9,8,...3
    expect(result.targets.slice(0, 5).every((t) => t.digest && t.created)).toBe(true);
    expect(result.targets.slice(5).every((t) => t.digest === null && t.created === null)).toBe(true);
    expect(client.resolveDigest).toHaveBeenCalledTimes(5);
    expect(client.getCreated).toHaveBeenCalledTimes(5);
    expect(result.targets[0]).toEqual({ tag: "9", digest: "sha256:9", created: "created:9" });
  });

  it("fetches no per-tag info when tagInfo is off", async () => {
    const client = makeClient(["3.0.0", "2.0.0", "1.0.0"]);
    const result = await listRollbackTargets(parseImageRef("org/app"), client, 50, {
      tagInfo: false,
    });
    expect(result.targets.every((t) => t.digest === null && t.created === null)).toBe(true);
    expect(client.resolveDigest).not.toHaveBeenCalled();
    expect(client.getCreated).not.toHaveBeenCalled();
    expect(client.listTags).toHaveBeenCalledTimes(1);
  });

  it("keeps a tag (with null info) when its digest lookup fails", async () => {
    const client = makeClient(["1.0.0"]);
    client.resolveDigest.mockRejectedValueOnce(new Error("429"));
    const result = await listRollbackTargets(parseImageRef("org/app"), client, 50, {
      tagInfo: true,
    });
    expect(result.targets).toEqual([{ tag: "1.0.0", digest: null, created: "created:1.0.0" }]);
  });
});
