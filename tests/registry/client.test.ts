import { describe, expect, it, vi } from "vitest";
import { RegistryClient } from "@/lib/registry/client";

function jsonResponse(body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

describe("RegistryClient", () => {
  it("performs the bearer token handshake then lists tags", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/v2/library/nginx/tags/list") && !init?.headers) {
        return new Response("", {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="https://auth.test/token",service="reg",scope="repository:library/nginx:pull"',
          },
        });
      }
      if (url.startsWith("https://auth.test/token")) {
        return jsonResponse({ token: "TOKEN" });
      }
      return jsonResponse({ tags: ["1.0.0", "latest"] });
    });

    const client = new RegistryClient("registry-1.docker.io", { fetchImpl });
    const tags = await client.listTags("library/nginx");
    expect(tags).toEqual(["1.0.0", "latest"]);
    expect(calls.some((u) => u.startsWith("https://auth.test/token"))).toBe(true);
  });

  it("resolves a digest from the Docker-Content-Digest header", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("{}", {
        status: 200,
        headers: { "docker-content-digest": "sha256:deadbeef" },
      }),
    );
    const client = new RegistryClient("ghcr.io", { fetchImpl });
    expect(await client.resolveDigest("org/app", "1.2.3")).toBe("sha256:deadbeef");
  });

  it("sends Accept on the first request and does not double-fetch when not 401", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response("{}", { status: 200, headers: { "docker-content-digest": "sha256:x" } }),
    );
    const client = new RegistryClient("ghcr.io", { fetchImpl });
    await client.resolveDigest("org/app", "1.0.0");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = fetchImpl.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("accept")).toBe(true);
  });

  it("sends Basic auth to the token endpoint when a credential is present", async () => {
    let tokenAuth: string | null = null;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/v2/org/app/tags/list") && !init?.headers) {
        return new Response("", {
          status: 401,
          headers: {
            "www-authenticate":
              'Bearer realm="https://auth.test/token",service="reg",scope="repository:org/app:pull"',
          },
        });
      }
      if (url.startsWith("https://auth.test/token")) {
        tokenAuth = new Headers(init?.headers).get("authorization");
        return new Response(JSON.stringify({ token: "T" }), { status: 200 });
      }
      return new Response(JSON.stringify({ tags: ["1.0.0"] }), { status: 200 });
    });
    const client = new RegistryClient("registry-1.docker.io", {
      fetchImpl,
      credential: { username: "u", password: "p" },
    });
    await client.listTags("org/app");
    expect(tokenAuth).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("getCreated follows the config blob and returns its created time", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/manifests/")) {
        return new Response(JSON.stringify({ config: { digest: "sha256:cfg" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ created: "2026-02-03T00:00:00Z" }), { status: 200 });
    });
    const client = new RegistryClient("ghcr.io", { fetchImpl });
    expect(await client.getCreated("org/app", "1.0.0")).toBe("2026-02-03T00:00:00Z");
  });

  it("getCreated returns null when the manifest has no config (manifest list)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ manifests: [] }), { status: 200 }),
    );
    const client = new RegistryClient("ghcr.io", { fetchImpl });
    expect(await client.getCreated("org/app", "1.0.0")).toBeNull();
  });
});
