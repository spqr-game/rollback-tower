import { describe, expect, it, vi } from "vitest";
import { buildCreateOptions, recreateWithImage } from "@/lib/docker/recreate";
import { ROLLED_BACK_LABEL } from "@/lib/docker/labels";

const inspectInfo = {
  Id: "old",
  Name: "/web",
  Config: {
    Image: "nginx:latest",
    Env: ["A=1"],
    Labels: { "rollback-tower.enable": "true" },
    Cmd: ["nginx"],
  },
  HostConfig: { RestartPolicy: { Name: "always" }, Binds: ["/data:/data"] },
  NetworkSettings: { Networks: { bridge: {} } },
} as unknown as import("dockerode").ContainerInspectInfo;

describe("buildCreateOptions", () => {
  it("carries config forward, swaps image, applies label overrides", () => {
    const opts = buildCreateOptions(inspectInfo, "nginx:1.0.0", {
      [ROLLED_BACK_LABEL]: "1.0.0",
    });
    expect(opts.Image).toBe("nginx:1.0.0");
    expect(opts.name).toBe("web");
    expect(opts.Env).toEqual(["A=1"]);
    expect(opts.Labels?.[ROLLED_BACK_LABEL]).toBe("1.0.0");
    expect(opts.Labels?.["rollback-tower.enable"]).toBe("true");
    expect(opts.HostConfig?.Binds).toEqual(["/data:/data"]);
  });

  it("deletes a label when the override value is null", () => {
    const opts = buildCreateOptions(
      { ...inspectInfo, Config: { ...inspectInfo.Config, Labels: { [ROLLED_BACK_LABEL]: "x" } } } as never,
      "nginx:latest",
      { [ROLLED_BACK_LABEL]: null },
    );
    expect(opts.Labels?.[ROLLED_BACK_LABEL]).toBeUndefined();
  });
});

describe("recreateWithImage", () => {
  it("pulls, replaces, and starts a new container", async () => {
    const oldContainer = {
      inspect: vi.fn(async () => inspectInfo),
      stop: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const newContainer = { id: "new", start: vi.fn(async () => undefined) };
    const docker = {
      getContainer: vi.fn(() => oldContainer),
      pull: vi.fn((_img: string, cb: (err: null, stream: object) => void) => cb(null, {})),
      modem: { followProgress: vi.fn((_s: object, done: (err: null) => void) => done(null)) },
      createContainer: vi.fn(async () => newContainer),
    } as unknown as import("dockerode");

    const id = await recreateWithImage({
      docker,
      containerId: "old",
      image: "nginx:1.0.0",
      labelOverrides: {},
    });
    expect(id).toBe("new");
    expect(oldContainer.stop).toHaveBeenCalled();
    expect(oldContainer.remove).toHaveBeenCalled();
    expect(newContainer.start).toHaveBeenCalled();
  });
});
