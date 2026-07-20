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
});
