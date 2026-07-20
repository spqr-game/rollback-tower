import { describe, expect, it } from "vitest";
import { computeStatus, shouldAutoUpdate } from "@/lib/scan/status";
import type { WatchedContainer } from "@/lib/docker/watch";

const base: WatchedContainer = {
  id: "c",
  name: "web",
  image: "nginx:latest",
  currentDigest: "sha256:aaa",
  labels: {},
  rolledBack: null,
};

describe("computeStatus", () => {
  it("reports error when an error is present", () => {
    expect(computeStatus({ container: base, upstreamDigest: null, error: "x" })).toBe("error");
  });
  it("reports rolled-back regardless of upstream", () => {
    expect(
      computeStatus({ container: { ...base, rolledBack: "1.0.0" }, upstreamDigest: "sha256:bbb" }),
    ).toBe("rolled-back");
  });
  it("reports update-available when digests differ", () => {
    expect(computeStatus({ container: base, upstreamDigest: "sha256:bbb" })).toBe("update-available");
  });
  it("reports up-to-date when digests match", () => {
    expect(computeStatus({ container: base, upstreamDigest: "sha256:aaa" })).toBe("up-to-date");
  });
});

describe("shouldAutoUpdate", () => {
  it("updates when a newer digest is available and not rolled back", () => {
    expect(shouldAutoUpdate(base, "sha256:bbb")).toBe(true);
  });
  it("never updates a rolled-back container", () => {
    expect(shouldAutoUpdate({ ...base, rolledBack: "1.0.0" }, "sha256:bbb")).toBe(false);
  });
  it("does not update when already current", () => {
    expect(shouldAutoUpdate(base, "sha256:aaa")).toBe(false);
  });
});
