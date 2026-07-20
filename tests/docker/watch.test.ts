import { describe, expect, it, vi } from "vitest";
import { toWatched, listWatched } from "@/lib/docker/watch";
import { ENABLE_LABEL, ROLLED_BACK_LABEL } from "@/lib/docker/labels";

describe("toWatched", () => {
  it("extracts name, image, digest, and rolled-back marker", () => {
    const info = {
      Id: "abc123",
      Name: "/web",
      Image: "sha256:img",
      Config: { Image: "nginx:latest", Labels: { [ROLLED_BACK_LABEL]: "1.0.0" } },
      RepoDigests: ["nginx@sha256:running"],
    } as unknown as import("dockerode").ContainerInspectInfo;
    const w = toWatched(info);
    expect(w.name).toBe("web");
    expect(w.image).toBe("nginx:latest");
    expect(w.currentDigest).toBe("sha256:running");
    expect(w.rolledBack).toBe("1.0.0");
  });
});

describe("listWatched", () => {
  it("filters by the enable label", async () => {
    const listContainers = vi.fn(async () => [{ Id: "x" }]);
    await listWatched({ listContainers } as never);
    expect(listContainers).toHaveBeenCalledWith({
      all: false,
      filters: { label: [`${ENABLE_LABEL}=true`] },
    });
  });
});
