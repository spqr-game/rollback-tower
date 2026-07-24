import { describe, expect, it, vi } from "vitest";
import { inspectWatchedContainer, toWatched, listWatched } from "@/lib/docker/watch";
import { ENABLE_LABEL, PINNED_LABEL } from "@/lib/docker/labels";

describe("toWatched", () => {
  it("extracts name, image, digest, and pinned marker", () => {
    const info = {
      Id: "abc123",
      Name: "/web",
      Image: "sha256:img",
      Config: { Image: "nginx:latest", Labels: { [PINNED_LABEL]: "1.0.0" } },
    } as unknown as import("dockerode").ContainerInspectInfo;
    const w = toWatched(info, ["nginx@sha256:running"]);
    expect(w.name).toBe("web");
    expect(w.image).toBe("nginx:latest");
    expect(w.currentDigest).toBe("sha256:running");
    expect(w.pinned).toBe("1.0.0");
  });
  it("has a null digest when there are no repo digests", () => {
    const info = {
      Id: "x",
      Name: "/x",
      Config: { Image: "local:dev", Labels: {} },
    } as unknown as import("dockerode").ContainerInspectInfo;
    expect(toWatched(info).currentDigest).toBeNull();
  });
});

describe("inspectWatchedContainer", () => {
  it("reads the digest from the image inspect, not the container inspect", async () => {
    const docker = {
      getContainer: vi.fn(() => ({
        inspect: async () => ({
          Id: "c1",
          Name: "/web",
          Image: "sha256:imgid",
          Config: { Image: "nginx:latest", Labels: {} },
        }),
      })),
      getImage: vi.fn((id: string) => ({
        inspect: async () => ({ Id: id, RepoDigests: ["nginx@sha256:running"] }),
      })),
    } as unknown as import("dockerode");
    const w = await inspectWatchedContainer(docker, "web");
    expect(w.currentDigest).toBe("sha256:running");
    expect(w.image).toBe("nginx:latest");
  });
  it("falls back to a null digest when the image inspect fails", async () => {
    const docker = {
      getContainer: vi.fn(() => ({
        inspect: async () => ({
          Id: "c1",
          Name: "/web",
          Image: "sha256:imgid",
          Config: { Image: "nginx:latest", Labels: {} },
        }),
      })),
      getImage: vi.fn(() => ({
        inspect: async () => {
          throw new Error("no such image");
        },
      })),
    } as unknown as import("dockerode");
    const w = await inspectWatchedContainer(docker, "web");
    expect(w.currentDigest).toBeNull();
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
