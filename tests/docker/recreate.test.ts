import { describe, expect, it, vi } from "vitest";
import { buildCreateOptions, recreateWithImage } from "@/lib/docker/recreate";
import { PINNED_LABEL } from "@/lib/docker/labels";

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
      [PINNED_LABEL]: "1.0.0",
    });
    expect(opts.Image).toBe("nginx:1.0.0");
    expect(opts.name).toBe("web");
    expect(opts.Env).toEqual(["A=1"]);
    expect(opts.Labels?.[PINNED_LABEL]).toBe("1.0.0");
    expect(opts.Labels?.["rollback-tower.enable"]).toBe("true");
    expect(opts.HostConfig?.Binds).toEqual(["/data:/data"]);
  });

  it("deletes a label when the override value is null", () => {
    const opts = buildCreateOptions(
      { ...inspectInfo, Config: { ...inspectInfo.Config, Labels: { [PINNED_LABEL]: "x" } } } as unknown as import("dockerode").ContainerInspectInfo,
      "nginx:latest",
      { [PINNED_LABEL]: null },
    );
    expect(opts.Labels?.[PINNED_LABEL]).toBeUndefined();
  });

  it("carries forward User, WorkingDir, and Healthcheck", () => {
    const info = {
      ...inspectInfo,
      Config: { ...inspectInfo.Config, User: "app", WorkingDir: "/srv", Healthcheck: { Test: ["CMD", "true"] } },
    } as unknown as import("dockerode").ContainerInspectInfo;
    const opts = buildCreateOptions(info, "nginx:1.0.0", {});
    expect(opts.User).toBe("app");
    expect(opts.WorkingDir).toBe("/srv");
    expect(opts.Healthcheck).toEqual({ Test: ["CMD", "true"] });
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
      pull: vi.fn((_img: string, _opts: object, cb: (err: null, stream: object) => void) => cb(null, {})),
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

  it("passes registry credentials to the daemon pull as authconfig", async () => {
    const oldContainer = {
      inspect: vi.fn(async () => inspectInfo),
      stop: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const newContainer = { id: "new", start: vi.fn(async () => undefined) };
    const pull = vi.fn(
      (_img: string, _opts: object, cb: (err: null, stream: object) => void) => cb(null, {}),
    );
    const docker = {
      getContainer: vi.fn(() => oldContainer),
      pull,
      modem: { followProgress: vi.fn((_s: object, done: (err: null) => void) => done(null)) },
      createContainer: vi.fn(async () => newContainer),
    } as unknown as import("dockerode");

    await recreateWithImage({
      docker,
      containerId: "old",
      image: "nginx:1.0.0",
      labelOverrides: {},
      authconfig: { username: "u", password: "p" },
    });
    expect(pull.mock.calls[0]?.[1]).toEqual({ authconfig: { username: "u", password: "p" } });
  });

  it("omits authconfig from the pull when no credential is given", async () => {
    const oldContainer = {
      inspect: vi.fn(async () => inspectInfo),
      stop: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const newContainer = { id: "new", start: vi.fn(async () => undefined) };
    const pull = vi.fn(
      (_img: string, _opts: object, cb: (err: null, stream: object) => void) => cb(null, {}),
    );
    const docker = {
      getContainer: vi.fn(() => oldContainer),
      pull,
      modem: { followProgress: vi.fn((_s: object, done: (err: null) => void) => done(null)) },
      createContainer: vi.fn(async () => newContainer),
    } as unknown as import("dockerode");

    await recreateWithImage({ docker, containerId: "old", image: "nginx:1.0.0", labelOverrides: {} });
    expect(pull.mock.calls[0]?.[1]).toEqual({});
  });

  it("restores the previous container and rethrows the ORIGINAL error when create fails", async () => {
    const originalError = new Error("create failed");
    const oldContainer = {
      inspect: vi.fn(async () => inspectInfo),
      stop: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const restored = { id: "restored", start: vi.fn(async () => undefined) };
    const createContainer = vi.fn().mockRejectedValueOnce(originalError).mockResolvedValueOnce(restored);
    const docker = {
      getContainer: vi.fn(() => oldContainer),
      pull: vi.fn((_img: string, _opts: object, cb: (err: null, stream: object) => void) => cb(null, {})),
      modem: { followProgress: vi.fn((_s: object, done: (err: null) => void) => done(null)) },
      createContainer,
    } as unknown as import("dockerode");
    await expect(
      recreateWithImage({ docker, containerId: "old", image: "nginx:bad", labelOverrides: {} }),
    ).rejects.toBe(originalError);
    expect(createContainer).toHaveBeenCalledTimes(2);
    expect(restored.start).toHaveBeenCalled();
  });

  it("still rethrows the original error when the restore itself also fails", async () => {
    const originalError = new Error("create failed");
    const oldContainer = {
      inspect: vi.fn(async () => inspectInfo),
      stop: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
    };
    const createContainer = vi
      .fn()
      .mockRejectedValueOnce(originalError)
      .mockRejectedValueOnce(new Error("restore failed"));
    const docker = {
      getContainer: vi.fn(() => oldContainer),
      pull: vi.fn((_img: string, _opts: object, cb: (err: null, stream: object) => void) => cb(null, {})),
      modem: { followProgress: vi.fn((_s: object, done: (err: null) => void) => done(null)) },
      createContainer,
    } as unknown as import("dockerode");
    await expect(
      recreateWithImage({ docker, containerId: "old", image: "nginx:bad", labelOverrides: {} }),
    ).rejects.toBe(originalError);
  });
});
