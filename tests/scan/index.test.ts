import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  watched: [] as Array<{
    id: string;
    name: string;
    image: string;
    currentDigest: string | null;
    labels: Record<string, string>;
    rolledBack: string | null;
  }>,
  resolveDigest: vi.fn(async (_repo: string, _ref: string): Promise<string> => "sha256:x"),
  recreateWithImage: vi.fn(
    async (_args: {
      docker: object;
      containerId: string;
      image: string;
      labelOverrides: Record<string, string | null>;
    }): Promise<string> => "new-id",
  ),
  inspectImpl: (id: string): { Id: string } => ({ Id: id }),
}));

vi.mock("@/lib/config", () => ({
  loadConfig: () => ({
    maxTags: 50,
    dockerConfigPath: "/nonexistent-docker-config",
    pollIntervalMs: 0,
    adminPassword: null,
    webhookToken: null,
    sessionSecret: null,
  }),
}));
vi.mock("@/lib/docker/client", () => ({
  getDocker: () => ({ getContainer: (id: string) => ({ inspect: async () => mocks.inspectImpl(id) }) }),
}));
vi.mock("@/lib/docker/watch", () => ({
  listWatched: async () => mocks.watched.map((w) => ({ Id: w.id })),
  toWatched: (info: { Id: string }) => mocks.watched.find((w) => w.id === info.Id)!,
}));
vi.mock("@/lib/registry/client", () => ({
  RegistryClient: class {
    resolveDigest = mocks.resolveDigest;
    listTags = vi.fn();
    getCreated = vi.fn();
  },
}));
vi.mock("@/lib/registry", () => ({
  listRollbackTargets: vi.fn(async () => ({ targets: [], truncated: false })),
}));
vi.mock("@/lib/docker/recreate", () => ({ recreateWithImage: mocks.recreateWithImage }));

describe("scan orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inspectImpl = (id: string) => ({ Id: id });
  });

  it("isolates a per-container failure from the rest of the sweep", async () => {
    mocks.watched = [
      { id: "a", name: "a", image: "repo/a:latest", currentDigest: "sha256:a", labels: {}, rolledBack: null },
      { id: "b", name: "b", image: "repo/b:latest", currentDigest: "sha256:b", labels: {}, rolledBack: null },
    ];
    mocks.resolveDigest.mockImplementation(async (repo: string) => {
      if (repo === "repo/a") {
        throw new Error("registry down");
      }
      return "sha256:b";
    });
    const { scan } = await import("@/lib/scan");
    const report = await scan();
    expect(report.containers).toHaveLength(2);
    const a = report.containers.find((c) => c.container.id === "a");
    const b = report.containers.find((c) => c.container.id === "b");
    expect(a?.status).toBe("error");
    expect(a?.error).toContain("registry down");
    expect(b?.status).toBe("up-to-date");
  });

  it("auto-updates only containers with a newer digest and no rollback", async () => {
    mocks.watched = [
      { id: "up", name: "up", image: "repo/up:latest", currentDigest: "sha256:old", labels: {}, rolledBack: null },
      { id: "pinned", name: "pinned", image: "repo/pinned:latest", currentDigest: "sha256:old", labels: {}, rolledBack: "1.0.0" },
      { id: "same", name: "same", image: "repo/same:latest", currentDigest: "sha256:same", labels: {}, rolledBack: null },
    ];
    mocks.resolveDigest.mockImplementation(async (repo: string) =>
      repo === "repo/same" ? "sha256:same" : "sha256:new",
    );
    const { scan } = await import("@/lib/scan");
    await scan();
    expect(mocks.recreateWithImage).toHaveBeenCalledTimes(1);
    expect(mocks.recreateWithImage.mock.calls[0]?.[0].containerId).toBe("up");
  });

  it("only resolves the upstream digest for containers matching the repo filter", async () => {
    mocks.watched = [
      { id: "x", name: "x", image: "repo/x:latest", currentDigest: "sha256:x", labels: {}, rolledBack: null },
      { id: "y", name: "y", image: "repo/y:latest", currentDigest: "sha256:y", labels: {}, rolledBack: null },
    ];
    mocks.resolveDigest.mockResolvedValue("sha256:x");
    const { scan } = await import("@/lib/scan");
    await scan({ repo: "repo/x" });
    expect(mocks.resolveDigest).toHaveBeenCalledTimes(1);
  });

  it("auto-updates a digest-pinned container using the tag ref, not the old digest", async () => {
    mocks.watched = [
      { id: "d", name: "d", image: "repo/d:1.0.0@sha256:old", currentDigest: "sha256:old", labels: {}, rolledBack: null },
    ];
    mocks.resolveDigest.mockResolvedValue("sha256:new");
    const { scan } = await import("@/lib/scan");
    await scan();
    expect(mocks.recreateWithImage).toHaveBeenCalledTimes(1);
    const img = mocks.recreateWithImage.mock.calls[0]?.[0].image;
    expect(img).toBe("repo/d:1.0.0");
    expect(img).not.toContain("@sha256");
  });

  it("drops a container whose inspect fails without aborting the whole scan", async () => {
    mocks.watched = [
      { id: "ok", name: "ok", image: "repo/ok:latest", currentDigest: "sha256:ok", labels: {}, rolledBack: null },
      { id: "bad", name: "bad", image: "repo/bad:latest", currentDigest: "sha256:bad", labels: {}, rolledBack: null },
    ];
    mocks.inspectImpl = (id: string) => {
      if (id === "bad") {
        throw new Error("no such container");
      }
      return { Id: id };
    };
    mocks.resolveDigest.mockResolvedValue("sha256:ok");
    const { scan } = await import("@/lib/scan");
    const report = await scan();
    expect(report.containers).toHaveLength(1);
    expect(report.containers[0]?.container.id).toBe("ok");
  });

  it("coalesces overlapping scans so a container is not recreated twice", async () => {
    mocks.watched = [
      { id: "up", name: "up", image: "repo/up:latest", currentDigest: "sha256:old", labels: {}, rolledBack: null },
    ];
    mocks.resolveDigest.mockResolvedValue("sha256:new");
    const { scan } = await import("@/lib/scan");
    const [r1, r2] = await Promise.all([scan(), scan()]);
    expect(r1).toBe(r2);
    expect(mocks.recreateWithImage).toHaveBeenCalledTimes(1);
  });
});
