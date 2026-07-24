import { describe, expect, it } from "vitest";
import { computeStatus, shouldAutoUpdate } from "@/lib/scan/status";
import type { WatchedContainer } from "@/lib/docker/watch";

const base: WatchedContainer = {
  id: "c",
  name: "web",
  image: "nginx:latest",
  currentDigest: "sha256:aaa",
  labels: {},
  pinned: null,
};

describe("computeStatus", () => {
  it("reports error when an error is present", () => {
    expect(computeStatus({ container: base, latestDigest: null, error: "x" })).toBe("error");
  });
  it("reports pinned regardless of the latest digest", () => {
    expect(
      computeStatus({ container: { ...base, pinned: "1.0.0" }, latestDigest: "sha256:bbb" }),
    ).toBe("pinned");
  });
  it("reports update-available when the running digest differs from latest", () => {
    expect(computeStatus({ container: base, latestDigest: "sha256:bbb" })).toBe("update-available");
  });
  it("reports up-to-date when the running digest matches latest", () => {
    expect(computeStatus({ container: base, latestDigest: "sha256:aaa" })).toBe("up-to-date");
  });
});

describe("shouldAutoUpdate", () => {
  it("updates when a newer digest is available and not pinned", () => {
    expect(shouldAutoUpdate(base, "sha256:bbb")).toBe(true);
  });
  it("never updates a pinned container", () => {
    expect(shouldAutoUpdate({ ...base, pinned: "1.0.0" }, "sha256:bbb")).toBe(false);
  });
  it("does not update when already current", () => {
    expect(shouldAutoUpdate(base, "sha256:aaa")).toBe(false);
  });
});
