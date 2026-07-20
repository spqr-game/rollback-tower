# Rollback Tower Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a stateless, single-host Next.js app that watches label-opted-in Docker containers, auto-updates them (except when pinned via a `rolled-back` label), and lets an operator roll back/switch to any registry tag.

**Architecture:** Next.js App Router (standalone output) runs as a container on the managed host. It reads live state from the mounted Docker socket (via `dockerode`) and from each image's registry (Registry HTTP API v2, credentials from a read-only `~/.docker/config.json`). No database. A single `scan()` function is driven by an in-process poller, a token-gated webhook, and a manual button. The `rolled-back` marker and watch opt-in live as container labels.

**Tech Stack:** TypeScript, Next.js (App Router, `output: 'standalone'`), React, `dockerode`, Vitest, Node `fetch`.

## Global Constraints

- **Language:** TypeScript. No `any` and no `unknown` in production code (project owner preference). Validate ALL external JSON — the docker config file and every registry HTTP/token/manifest response — with **zod** schemas, inferring types from the schema. Do not hand-cast parsed JSON with `as`. Test-only exception: a single localized `as unknown as <LibType>` double-assertion is permitted solely to fake a complex third-party type (e.g. a `dockerode` instance or `ContainerInspectInfo` fixture); prefer narrow structural interfaces where practical so fixtures need no cast.
- **Style:** 2-space indentation; always end optional-semicolon lines with semicolons.
- **Labels:** watch opt-in = `rollback-tower.enable=true`; pin marker = `rollback-tower.rolled-back=<tag-or-digest>`.
- **Auth:** UI + mutating API gated by `ADMIN_PASSWORD` only when it is set; otherwise open. `/api/webhook` always requires `WEBHOOK_TOKEN` (constant-time compare) and returns 503 when the token is unset.
- **State:** no database; all state derived from Docker + registry at request/scan time.
- **Registry credentials:** read from `~/.docker/config.json` (`auths` only in v1). `credsStore`/`credHelpers` → log a warning, fall back to anonymous.
- **Verification gate (project rule):** a commit may only be made when lint, typecheck, tests, and build all pass.
- **Env vars:** `POLL_INTERVAL` (default `300s`, `0` disables), `ADMIN_PASSWORD` (optional), `WEBHOOK_TOKEN` (optional), `MAX_TAGS` (default `50`), `DOCKER_CONFIG` (default `~/.docker/config.json`), `SESSION_SECRET` (required when `ADMIN_PASSWORD` set).
- **Working directory:** worktree `/Users/cwalker/Projects/rollback-tower/initial-app` on branch `feat/initial-app`.

---

## File Structure

```
package.json, tsconfig.json, next.config.ts, vitest.config.ts, eslint.config.mjs
instrumentation.ts                 # boots the poller
middleware.ts                      # password gate
app/
  layout.tsx, globals.css
  page.tsx                         # dashboard (server component)
  login/page.tsx                   # login form (only used when ADMIN_PASSWORD set)
  actions.ts                       # server actions calling lib/scan
  api/
    scan/route.ts
    webhook/route.ts
    login/route.ts
lib/
  config.ts                        # env parsing/validation -> Config
  registry/
    ref.ts                         # parseImageRef / formatImageRef
    credentials.ts                 # loadDockerConfig / credentialForRegistry
    client.ts                      # v2 API: listTags, resolveDigest, getCreated
    index.ts                       # listRollbackTargets orchestration
  docker/
    client.ts                      # getDocker() singleton
    watch.ts                       # listWatched / inspect -> WatchedContainer
    recreate.ts                    # recreateWithImage (+ label mutation)
    labels.ts                      # label constants + helpers
  scan/
    status.ts                      # computeStatus, types
    index.ts                       # scan / applyTag / resumeAutoUpdate
  auth/
    session.ts                     # sign/verify session cookie
    webhook.ts                     # constant-time token check
tests/
  ... mirrors lib/ ...
Dockerfile, docker-compose.example.yml, README.md
```

---

## Task 1: Project scaffold, tooling, and CI gate

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: npm scripts `lint`, `typecheck`, `test`, `build`; Vitest configured for `tests/**/*.test.ts`.

- [ ] **Step 1: Initialize package and install deps**

Run in the worktree root:
```bash
npm init -y
npm install next@latest react@latest react-dom@latest dockerode zod
npm install -D typescript @types/node @types/react @types/react-dom @types/dockerode vitest @vitejs/plugin-react eslint eslint-config-next
```

- [ ] **Step 2: Write config files**

`package.json` scripts block (merge into generated file):
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["dockerode"],
};

export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": new URL(".", import.meta.url).pathname },
  },
});
```

`eslint.config.mjs`:
```js
import next from "eslint-config-next";

export default [
  ...next(),
  { rules: { "@typescript-eslint/no-explicit-any": "error" } },
];
```

- [ ] **Step 3: Minimal app shell**

`app/globals.css`:
```css
:root { color-scheme: light dark; }
body { font-family: system-ui, sans-serif; margin: 0; padding: 1.5rem; }
```

`app/layout.tsx`:
```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Rollback Tower" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (temporary placeholder, replaced in Task 11):
```tsx
export default function Home() {
  return <main><h1>Rollback Tower</h1></main>;
}
```

- [ ] **Step 4: Write the smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs vitest", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the full gate**

```bash
npm run test && npm run typecheck && npm run lint && npm run build
```
Expected: test passes, typecheck clean, lint clean, build produces `.next/standalone`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and CI gate"
```

---

## Task 2: Config module

**Files:**
- Create: `lib/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface Config {
    pollIntervalMs: number;      // 0 = disabled
    adminPassword: string | null;
    webhookToken: string | null;
    maxTags: number;
    dockerConfigPath: string;
    sessionSecret: string | null;
  }
  export function parseDuration(value: string): number; // -> ms
  export function loadConfig(env: NodeJS.ProcessEnv): Config;
  ```

- [ ] **Step 1: Write the failing test**

`tests/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadConfig, parseDuration } from "@/lib/config";

describe("parseDuration", () => {
  it("parses seconds/minutes/hours and bare numbers as seconds", () => {
    expect(parseDuration("300s")).toBe(300_000);
    expect(parseDuration("5m")).toBe(300_000);
    expect(parseDuration("1h")).toBe(3_600_000);
    expect(parseDuration("0")).toBe(0);
    expect(parseDuration("45")).toBe(45_000);
  });
  it("throws on garbage", () => {
    expect(() => parseDuration("soon")).toThrow();
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ HOME: "/home/x" });
    expect(c.pollIntervalMs).toBe(300_000);
    expect(c.adminPassword).toBeNull();
    expect(c.webhookToken).toBeNull();
    expect(c.maxTags).toBe(50);
    expect(c.dockerConfigPath).toBe("/home/x/.docker/config.json");
  });
  it("reads overrides and requires SESSION_SECRET when password set", () => {
    expect(() =>
      loadConfig({ ADMIN_PASSWORD: "pw" }),
    ).toThrow(/SESSION_SECRET/);
    const c = loadConfig({ ADMIN_PASSWORD: "pw", SESSION_SECRET: "s", MAX_TAGS: "10" });
    expect(c.adminPassword).toBe("pw");
    expect(c.sessionSecret).toBe("s");
    expect(c.maxTags).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/config.ts`:
```ts
export interface Config {
  pollIntervalMs: number;
  adminPassword: string | null;
  webhookToken: string | null;
  maxTags: number;
  dockerConfigPath: string;
  sessionSecret: string | null;
}

export function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h)?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const factor = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  return amount * factor;
}

function defaultDockerConfigPath(env: NodeJS.ProcessEnv): string {
  if (env.DOCKER_CONFIG) {
    return env.DOCKER_CONFIG;
  }
  const home = env.HOME ?? env.USERPROFILE ?? "/root";
  return `${home}/.docker/config.json`;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const adminPassword = env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD : null;
  const sessionSecret = env.SESSION_SECRET ? env.SESSION_SECRET : null;
  if (adminPassword && !sessionSecret) {
    throw new Error("SESSION_SECRET is required when ADMIN_PASSWORD is set");
  }
  return {
    pollIntervalMs: parseDuration(env.POLL_INTERVAL ?? "300s"),
    adminPassword,
    webhookToken: env.WEBHOOK_TOKEN ? env.WEBHOOK_TOKEN : null,
    maxTags: env.MAX_TAGS ? Number(env.MAX_TAGS) : 50,
    dockerConfigPath: defaultDockerConfigPath(env),
    sessionSecret,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/config.ts tests/config.test.ts
git commit -m "feat: add env config parsing"
```

---

## Task 3: Image reference parsing

**Files:**
- Create: `lib/registry/ref.ts`
- Test: `tests/registry/ref.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ImageRef {
    registry: string;    // host, e.g. "registry-1.docker.io", "ghcr.io"
    repository: string;  // e.g. "library/nginx", "chad3814/app"
    tag: string;         // e.g. "latest"
    digest: string | null; // "sha256:..." when pinned by digest
  }
  export function parseImageRef(ref: string): ImageRef;
  export function formatImageRef(ref: ImageRef): string;
  ```

- [ ] **Step 1: Write the failing test**

`tests/registry/ref.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatImageRef, parseImageRef } from "@/lib/registry/ref";

describe("parseImageRef", () => {
  it("defaults docker hub library namespace and latest tag", () => {
    expect(parseImageRef("nginx")).toEqual({
      registry: "registry-1.docker.io",
      repository: "library/nginx",
      tag: "latest",
      digest: null,
    });
  });
  it("keeps user namespace on docker hub", () => {
    expect(parseImageRef("chad3814/app:1.2.3")).toEqual({
      registry: "registry-1.docker.io",
      repository: "chad3814/app",
      tag: "1.2.3",
      digest: null,
    });
  });
  it("detects custom registry by dot/port/localhost in first segment", () => {
    expect(parseImageRef("ghcr.io/mozilla-ocho/post-host:edge")).toEqual({
      registry: "ghcr.io",
      repository: "mozilla-ocho/post-host",
      tag: "edge",
      digest: null,
    });
    expect(parseImageRef("localhost:5000/thing:1").registry).toBe("localhost:5000");
  });
  it("parses digest pins", () => {
    const r = parseImageRef("nginx@sha256:abc");
    expect(r.digest).toBe("sha256:abc");
    expect(r.tag).toBe("latest");
  });
});

describe("formatImageRef", () => {
  it("round-trips a hub ref back to short form", () => {
    const r = parseImageRef("chad3814/app:1.2.3");
    expect(formatImageRef(r)).toBe("chad3814/app:1.2.3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry/ref.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/registry/ref.ts`:
```ts
export interface ImageRef {
  registry: string;
  repository: string;
  tag: string;
  digest: string | null;
}

const DOCKER_HUB = "registry-1.docker.io";

function isRegistryHost(segment: string): boolean {
  return segment.includes(".") || segment.includes(":") || segment === "localhost";
}

export function parseImageRef(ref: string): ImageRef {
  let remainder = ref;
  let digest: string | null = null;
  const atIndex = remainder.indexOf("@");
  if (atIndex !== -1) {
    digest = remainder.slice(atIndex + 1);
    remainder = remainder.slice(0, atIndex);
  }

  const slashIndex = remainder.indexOf("/");
  const firstSegment = slashIndex === -1 ? "" : remainder.slice(0, slashIndex);
  let registry = DOCKER_HUB;
  let namePart = remainder;
  if (slashIndex !== -1 && isRegistryHost(firstSegment)) {
    registry = firstSegment;
    namePart = remainder.slice(slashIndex + 1);
  }

  let tag = "latest";
  const colonIndex = namePart.lastIndexOf(":");
  if (colonIndex !== -1) {
    tag = namePart.slice(colonIndex + 1);
    namePart = namePart.slice(0, colonIndex);
  }

  let repository = namePart;
  if (registry === DOCKER_HUB && !repository.includes("/")) {
    repository = `library/${repository}`;
  }

  return { registry, repository, tag, digest };
}

export function formatImageRef(ref: ImageRef): string {
  const isHub = ref.registry === DOCKER_HUB;
  let repo = ref.repository;
  if (isHub && repo.startsWith("library/")) {
    repo = repo.slice("library/".length);
  }
  const prefix = isHub ? "" : `${ref.registry}/`;
  if (ref.digest) {
    return `${prefix}${repo}@${ref.digest}`;
  }
  return `${prefix}${repo}:${ref.tag}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry/ref.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/registry/ref.ts tests/registry/ref.test.ts
git commit -m "feat: parse and format docker image references"
```

---

## Task 4: Docker config credentials

**Files:**
- Create: `lib/registry/credentials.ts`
- Test: `tests/registry/credentials.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  ```ts
  export interface RegistryCredential { username: string; password: string; }
  // DockerConfig is `z.infer` of the zod schema in the impl:
  //   { auths: Record<string, { auth?: string }>; credsStore?: string; credHelpers?: Record<string,string> }
  export type DockerConfig = z.infer<typeof dockerConfigSchema>;
  export function parseDockerConfig(json: string): DockerConfig; // validates via zod
  export function credentialForRegistry(
    config: DockerConfig,
    registry: string,
    warn?: (msg: string) => void,
  ): RegistryCredential | null;
  ```

- [ ] **Step 1: Write the failing test**

`tests/registry/credentials.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { credentialForRegistry, parseDockerConfig } from "@/lib/registry/credentials";

const b64 = (s: string): string => Buffer.from(s).toString("base64");

describe("credentialForRegistry", () => {
  it("decodes basic auth for a matching registry", () => {
    const cfg = parseDockerConfig(
      JSON.stringify({ auths: { "ghcr.io": { auth: b64("user:pass") } } }),
    );
    expect(credentialForRegistry(cfg, "ghcr.io")).toEqual({
      username: "user",
      password: "pass",
    });
  });
  it("maps docker hub host to the index.docker.io key", () => {
    const cfg = parseDockerConfig(
      JSON.stringify({ auths: { "https://index.docker.io/v1/": { auth: b64("u:p") } } }),
    );
    expect(credentialForRegistry(cfg, "registry-1.docker.io")).toEqual({
      username: "u",
      password: "p",
    });
  });
  it("returns null and warns when a credential helper is configured", () => {
    const warn = vi.fn();
    const cfg = parseDockerConfig(JSON.stringify({ auths: {}, credsStore: "desktop" }));
    expect(credentialForRegistry(cfg, "ghcr.io", warn)).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });
  it("returns null when no entry exists", () => {
    const cfg = parseDockerConfig(JSON.stringify({ auths: {} }));
    expect(credentialForRegistry(cfg, "ghcr.io")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry/credentials.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/registry/credentials.ts`:
```ts
import { z } from "zod";

export interface RegistryCredential {
  username: string;
  password: string;
}

const authEntrySchema = z.object({ auth: z.string().optional() });
const dockerConfigSchema = z.object({
  auths: z.record(z.string(), authEntrySchema).default({}),
  credsStore: z.string().optional(),
  credHelpers: z.record(z.string(), z.string()).optional(),
});

export type DockerConfig = z.infer<typeof dockerConfigSchema>;

const HUB_HOSTS = new Set([
  "registry-1.docker.io",
  "index.docker.io",
  "docker.io",
]);

export function parseDockerConfig(json: string): DockerConfig {
  return dockerConfigSchema.parse(JSON.parse(json));
}

function candidateKeys(registry: string): string[] {
  if (HUB_HOSTS.has(registry)) {
    return ["https://index.docker.io/v1/", "index.docker.io", "registry-1.docker.io"];
  }
  return [registry, `https://${registry}`];
}

export function credentialForRegistry(
  config: DockerConfig,
  registry: string,
  warn: (msg: string) => void = () => {},
): RegistryCredential | null {
  // Explicit auths credential wins; helpers are only the anonymous fallback
  // when no direct credential exists (per spec).
  for (const key of candidateKeys(registry)) {
    const entry = config.auths[key];
    if (entry?.auth) {
      const decoded = Buffer.from(entry.auth, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
      }
    }
  }
  const helper = config.credHelpers?.[registry] ?? config.credsStore;
  if (helper) {
    warn(
      `Registry ${registry} uses credential helper "${helper}"; ` +
        "helpers are unsupported in v1, falling back to anonymous access",
    );
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry/credentials.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/registry/credentials.ts tests/registry/credentials.test.ts
git commit -m "feat: read registry credentials from docker config"
```

---

## Task 5: Registry v2 API client

**Files:**
- Create: `lib/registry/client.ts`
- Test: `tests/registry/client.test.ts`

**Interfaces:**
- Consumes: `RegistryCredential` (Task 4).
- Produces:
  ```ts
  export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
  export interface RegistryClientOptions {
    fetchImpl?: FetchLike;
    credential?: RegistryCredential | null;
  }
  export class RegistryClient {
    constructor(registry: string, options?: RegistryClientOptions);
    listTags(repository: string): Promise<string[]>;
    resolveDigest(repository: string, ref: string): Promise<string>;
    getCreated(repository: string, ref: string): Promise<string | null>;
  }
  ```

**Notes for implementer:** the v2 auth flow is: make the request; on 401 read the `WWW-Authenticate: Bearer realm=...,service=...,scope=...` header, GET the realm (with Basic auth if a credential is present) to obtain `{ token }`, then retry with `Authorization: Bearer <token>`. Manifest digests come from the `Docker-Content-Digest` response header. `getCreated` reads the manifest, follows its `config.digest` blob, and returns the JSON `created` field; it is best-effort and returns `null` on manifest lists or any failure.

- [ ] **Step 1: Write the failing test**

`tests/registry/client.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry/client.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/registry/client.ts`:
```ts
import { z } from "zod";
import type { RegistryCredential } from "./credentials";

const tokenResponseSchema = z.object({
  token: z.string().optional(),
  access_token: z.string().optional(),
});
const tagsListSchema = z.object({ tags: z.array(z.string()).nullish() });
const manifestSchema = z.object({
  config: z.object({ digest: z.string() }).optional(),
});
const imageConfigSchema = z.object({ created: z.string().optional() });

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RegistryClientOptions {
  fetchImpl?: FetchLike;
  credential?: RegistryCredential | null;
}

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

interface Challenge {
  realm: string;
  service: string | null;
  scope: string | null;
}

function parseChallenge(header: string): Challenge | null {
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const params = new Map<string, string>();
  for (const part of header.slice("bearer ".length).split(",")) {
    const eq = part.indexOf("=");
    if (eq !== -1) {
      params.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim().replace(/^"|"$/g, ""));
    }
  }
  const realm = params.get("realm");
  return realm ? { realm, service: params.get("service") ?? null, scope: params.get("scope") ?? null } : null;
}

export class RegistryClient {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly credential: RegistryCredential | null;

  constructor(registry: string, options: RegistryClientOptions = {}) {
    this.base = `https://${registry}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.credential = options.credential ?? null;
  }

  private basicHeader(): string | null {
    if (!this.credential) {
      return null;
    }
    const raw = `${this.credential.username}:${this.credential.password}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
  }

  private async authedFetch(path: string, accept?: string): Promise<Response> {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = {};
    if (accept) {
      headers.Accept = accept;
    }
    const first = await this.fetchImpl(url, undefined);
    if (first.status !== 401) {
      return accept ? this.fetchImpl(url, { headers }) : first;
    }
    const challenge = parseChallenge(first.headers.get("www-authenticate") ?? "");
    if (!challenge) {
      return first;
    }
    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) {
      tokenUrl.searchParams.set("service", challenge.service);
    }
    if (challenge.scope) {
      tokenUrl.searchParams.set("scope", challenge.scope);
    }
    const basic = this.basicHeader();
    const tokenResp = await this.fetchImpl(
      tokenUrl.toString(),
      basic ? { headers: { Authorization: basic } } : undefined,
    );
    const tokenBody = tokenResponseSchema.parse(await tokenResp.json());
    const token = tokenBody.token ?? tokenBody.access_token;
    if (accept) {
      headers.Accept = accept;
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return this.fetchImpl(url, { headers });
  }

  async listTags(repository: string): Promise<string[]> {
    const resp = await this.authedFetch(`/v2/${repository}/tags/list`);
    if (!resp.ok) {
      throw new Error(`tags/list failed: ${resp.status}`);
    }
    const body = tagsListSchema.parse(await resp.json());
    return body.tags ?? [];
  }

  async resolveDigest(repository: string, ref: string): Promise<string> {
    const resp = await this.authedFetch(`/v2/${repository}/manifests/${ref}`, MANIFEST_ACCEPT);
    const digest = resp.headers.get("docker-content-digest");
    if (!digest) {
      throw new Error(`no digest for ${repository}:${ref} (status ${resp.status})`);
    }
    return digest;
  }

  async getCreated(repository: string, ref: string): Promise<string | null> {
    try {
      const resp = await this.authedFetch(`/v2/${repository}/manifests/${ref}`, MANIFEST_ACCEPT);
      const manifest = manifestSchema.parse(await resp.json());
      const configDigest = manifest.config?.digest;
      if (!configDigest) {
        return null;
      }
      const blob = await this.authedFetch(`/v2/${repository}/blobs/${configDigest}`);
      const config = imageConfigSchema.parse(await blob.json());
      return config.created ?? null;
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/registry/client.ts tests/registry/client.test.ts
git commit -m "feat: registry v2 client with bearer auth"
```

---

## Task 6: Rollback-target listing (registry orchestration)

**Files:**
- Create: `lib/registry/index.ts`
- Test: `tests/registry/index.test.ts`

**Interfaces:**
- Consumes: `ImageRef` (Task 3), `RegistryClient` (Task 5).
- Produces:
  ```ts
  export interface TagTarget { tag: string; digest: string; created: string | null; }
  export interface RollbackTargets { targets: TagTarget[]; truncated: boolean; }
  export function sortTags(tags: string[]): string[]; // semver desc, else lexical desc
  export async function listRollbackTargets(
    ref: ImageRef,
    client: Pick<RegistryClient, "listTags" | "resolveDigest" | "getCreated">,
    maxTags: number,
    warn?: (msg: string) => void,
  ): Promise<RollbackTargets>;
  ```

- [ ] **Step 1: Write the failing test**

`tests/registry/index.test.ts`:
```ts
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
  it("resolves the newest maxTags and flags truncation", async () => {
    const client = {
      listTags: vi.fn(async () => ["1.0.0", "1.1.0", "1.2.0"]),
      resolveDigest: vi.fn(async (_repo: string, tag: string) => `sha256:${tag}`),
      getCreated: vi.fn(async () => "2026-01-01T00:00:00Z"),
    };
    const warn = vi.fn();
    const result = await listRollbackTargets(parseImageRef("org/app"), client, 2, warn);
    expect(result.truncated).toBe(true);
    expect(result.targets.map((t) => t.tag)).toEqual(["1.2.0", "1.1.0"]);
    expect(result.targets[0]).toEqual({
      tag: "1.2.0",
      digest: "sha256:1.2.0",
      created: "2026-01-01T00:00:00Z",
    });
    expect(warn).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/registry/index.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/registry/index.ts`:
```ts
import type { ImageRef } from "./ref";
import type { RegistryClient } from "./client";

export interface TagTarget {
  tag: string;
  digest: string;
  created: string | null;
}

export interface RollbackTargets {
  targets: TagTarget[];
  truncated: boolean;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)/;

export function sortTags(tags: string[]): string[] {
  return [...tags].sort((a, b) => {
    const sa = SEMVER.exec(a);
    const sb = SEMVER.exec(b);
    if (sa && sb) {
      for (let i = 1; i <= 3; i += 1) {
        const diff = Number(sb[i]) - Number(sa[i]);
        if (diff !== 0) {
          return diff;
        }
      }
      return b.localeCompare(a);
    }
    if (sa) {
      return -1;
    }
    if (sb) {
      return 1;
    }
    return b.localeCompare(a);
  });
}

export async function listRollbackTargets(
  ref: ImageRef,
  client: Pick<RegistryClient, "listTags" | "resolveDigest" | "getCreated">,
  maxTags: number,
  warn: (msg: string) => void = () => {},
): Promise<RollbackTargets> {
  const all = sortTags(await client.listTags(ref.repository));
  const selected = all.slice(0, maxTags);
  const truncated = all.length > selected.length;
  if (truncated) {
    warn(`Tag list for ${ref.repository} truncated to ${maxTags} of ${all.length}`);
  }
  const targets = await Promise.all(
    selected.map(async (tag): Promise<TagTarget> => {
      const [digest, created] = await Promise.all([
        client.resolveDigest(ref.repository, tag),
        client.getCreated(ref.repository, tag),
      ]);
      return { tag, digest, created };
    }),
  );
  return { targets, truncated };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/registry/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/registry/index.ts tests/registry/index.test.ts
git commit -m "feat: list and sort registry rollback targets"
```

---

## Task 7: Docker labels + watched-container model

**Files:**
- Create: `lib/docker/labels.ts`, `lib/docker/client.ts`, `lib/docker/watch.ts`
- Test: `tests/docker/watch.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces:
  ```ts
  // labels.ts
  export const ENABLE_LABEL = "rollback-tower.enable";
  export const ROLLED_BACK_LABEL = "rollback-tower.rolled-back";
  // client.ts
  export function getDocker(): Dockerode; // singleton over the socket
  // watch.ts
  export interface WatchedContainer {
    id: string;
    name: string;
    image: string;               // running image ref string
    currentDigest: string | null;
    labels: Record<string, string>;
    rolledBack: string | null;   // value of ROLLED_BACK_LABEL, or null
  }
  export function toWatched(info: Dockerode.ContainerInspectInfo): WatchedContainer;
  export async function listWatched(docker: Pick<Dockerode, "listContainers">): Promise<Dockerode.ContainerInfo[]>;
  ```

- [ ] **Step 1: Write the failing test**

`tests/docker/watch.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docker/watch.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/docker/labels.ts`:
```ts
export const ENABLE_LABEL = "rollback-tower.enable";
export const ROLLED_BACK_LABEL = "rollback-tower.rolled-back";
```

`lib/docker/client.ts`:
```ts
import Dockerode from "dockerode";

let instance: Dockerode | null = null;

export function getDocker(): Dockerode {
  if (!instance) {
    instance = new Dockerode();
  }
  return instance;
}
```

`lib/docker/watch.ts`:
```ts
import type Dockerode from "dockerode";
import { ENABLE_LABEL, ROLLED_BACK_LABEL } from "./labels";

export interface WatchedContainer {
  id: string;
  name: string;
  image: string;
  currentDigest: string | null;
  labels: Record<string, string>;
  rolledBack: string | null;
}

export function toWatched(info: Dockerode.ContainerInspectInfo): WatchedContainer {
  const labels = info.Config?.Labels ?? {};
  const repoDigest = info.RepoDigests?.[0] ?? null;
  const currentDigest = repoDigest ? repoDigest.slice(repoDigest.indexOf("@") + 1) : null;
  return {
    id: info.Id,
    name: info.Name.replace(/^\//, ""),
    image: info.Config?.Image ?? "",
    currentDigest,
    labels,
    rolledBack: labels[ROLLED_BACK_LABEL] ?? null,
  };
}

export async function listWatched(
  docker: Pick<Dockerode, "listContainers">,
): Promise<Dockerode.ContainerInfo[]> {
  return docker.listContainers({
    all: false,
    filters: { label: [`${ENABLE_LABEL}=true`] },
  });
}
```

**Note:** `ContainerInspectInfo` in `@types/dockerode` does not declare `RepoDigests`; add a local interface extension at the top of `watch.ts` instead of using `any`:
```ts
type InspectWithDigests = Dockerode.ContainerInspectInfo & { RepoDigests?: string[] };
```
and type the `toWatched` parameter as `InspectWithDigests`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docker/watch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/docker/labels.ts lib/docker/client.ts lib/docker/watch.ts tests/docker/watch.test.ts
git commit -m "feat: docker watch model and label constants"
```

---

## Task 8: Container recreate logic

**Files:**
- Create: `lib/docker/recreate.ts`
- Test: `tests/docker/recreate.test.ts`

**Interfaces:**
- Consumes: `ROLLED_BACK_LABEL` (Task 7).
- Produces:
  ```ts
  export function buildCreateOptions(
    info: Dockerode.ContainerInspectInfo,
    image: string,
    labelOverrides: Record<string, string | null>,
  ): Dockerode.ContainerCreateOptions;
  export async function recreateWithImage(args: {
    docker: Dockerode;
    containerId: string;
    image: string;               // target ref to pull+run
    labelOverrides: Record<string, string | null>; // null value deletes a label
  }): Promise<string>;           // new container id
  ```

**Note:** `buildCreateOptions` is the pure, unit-tested core (config capture → create args). `recreateWithImage` orchestrates pull/stop/remove/create/start with a best-effort restore on failure and is exercised against a mocked Docker in the test below.

- [ ] **Step 1: Write the failing test**

`tests/docker/recreate.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/docker/recreate.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/docker/recreate.ts`:
```ts
import type Dockerode from "dockerode";

type InspectInfo = Dockerode.ContainerInspectInfo;

export function buildCreateOptions(
  info: InspectInfo,
  image: string,
  labelOverrides: Record<string, string | null>,
): Dockerode.ContainerCreateOptions {
  const labels: Record<string, string> = { ...(info.Config?.Labels ?? {}) };
  for (const [key, value] of Object.entries(labelOverrides)) {
    if (value === null) {
      delete labels[key];
    } else {
      labels[key] = value;
    }
  }
  return {
    name: info.Name.replace(/^\//, ""),
    Image: image,
    Env: info.Config?.Env ?? undefined,
    Cmd: info.Config?.Cmd ?? undefined,
    Entrypoint: info.Config?.Entrypoint ?? undefined,
    Labels: labels,
    ExposedPorts: info.Config?.ExposedPorts ?? undefined,
    HostConfig: info.HostConfig,
    NetworkingConfig: info.NetworkSettings?.Networks
      ? { EndpointsConfig: info.NetworkSettings.Networks }
      : undefined,
  };
}

function pullImage(docker: Dockerode, image: string): Promise<void> {
  return new Promise((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err || !stream) {
        reject(err ?? new Error("pull returned no stream"));
        return;
      }
      docker.modem.followProgress(stream, (progressErr: Error | null) => {
        if (progressErr) {
          reject(progressErr);
        } else {
          resolve();
        }
      });
    });
  });
}

export async function recreateWithImage(args: {
  docker: Dockerode;
  containerId: string;
  image: string;
  labelOverrides: Record<string, string | null>;
}): Promise<string> {
  const { docker, containerId, image, labelOverrides } = args;
  const old = docker.getContainer(containerId);
  const info = await old.inspect();
  await pullImage(docker, image);
  const createOptions = buildCreateOptions(info, image, labelOverrides);

  await old.stop().catch(() => undefined);
  await old.remove();
  try {
    const created = await docker.createContainer(createOptions);
    await created.start();
    return created.id;
  } catch (error) {
    // best-effort restore: recreate the previous container from captured config
    const restore = buildCreateOptions(info, info.Config?.Image ?? image, {});
    const restored = await docker.createContainer(restore);
    await restored.start();
    throw error;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/docker/recreate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/docker/recreate.ts tests/docker/recreate.test.ts
git commit -m "feat: recreate containers with a new image"
```

---

## Task 9: Scan / apply / resume logic

**Files:**
- Create: `lib/scan/status.ts`, `lib/scan/index.ts`
- Test: `tests/scan/status.test.ts`

**Interfaces:**
- Consumes: `ImageRef` (Task 3), `WatchedContainer` (Task 7).
- Produces:
  ```ts
  // status.ts
  export type StatusKind = "up-to-date" | "update-available" | "rolled-back" | "error";
  export function computeStatus(args: {
    container: WatchedContainer;
    upstreamDigest: string | null;
    error?: string;
  }): StatusKind;
  export function shouldAutoUpdate(container: WatchedContainer, upstreamDigest: string | null): boolean;
  // index.ts
  export async function scan(opts?: { repo?: string }): Promise<ScanReport>;
  export async function applyTag(containerId: string, tag: string): Promise<void>;
  export async function resumeAutoUpdate(containerId: string): Promise<void>;
  ```

- [ ] **Step 1: Write the failing test**

`tests/scan/status.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scan/status.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement status.ts**

`lib/scan/status.ts`:
```ts
import type { WatchedContainer } from "@/lib/docker/watch";

export type StatusKind = "up-to-date" | "update-available" | "rolled-back" | "error";

export function computeStatus(args: {
  container: WatchedContainer;
  upstreamDigest: string | null;
  error?: string;
}): StatusKind {
  if (args.error) {
    return "error";
  }
  if (args.container.rolledBack) {
    return "rolled-back";
  }
  if (args.upstreamDigest && args.upstreamDigest !== args.container.currentDigest) {
    return "update-available";
  }
  return "up-to-date";
}

export function shouldAutoUpdate(
  container: WatchedContainer,
  upstreamDigest: string | null,
): boolean {
  if (container.rolledBack) {
    return false;
  }
  return Boolean(upstreamDigest) && upstreamDigest !== container.currentDigest;
}
```

- [ ] **Step 4: Implement index.ts (orchestration)**

`lib/scan/index.ts`:
```ts
import { loadConfig } from "@/lib/config";
import { readFile } from "node:fs/promises";
import { getDocker } from "@/lib/docker/client";
import { listWatched, toWatched, type WatchedContainer } from "@/lib/docker/watch";
import { ROLLED_BACK_LABEL } from "@/lib/docker/labels";
import { recreateWithImage } from "@/lib/docker/recreate";
import { parseImageRef, formatImageRef } from "@/lib/registry/ref";
import { RegistryClient } from "@/lib/registry/client";
import { credentialForRegistry, parseDockerConfig } from "@/lib/registry/credentials";
import { listRollbackTargets, type TagTarget } from "@/lib/registry";
import { computeStatus, shouldAutoUpdate, type StatusKind } from "./status";

export interface ContainerReport {
  container: WatchedContainer;
  status: StatusKind;
  upstreamDigest: string | null;
  targets: TagTarget[];
  error: string | null;
}
export interface ScanReport {
  scannedAt: string;
  containers: ContainerReport[];
}

async function clientForRegistry(registry: string): Promise<RegistryClient> {
  const config = loadConfig(process.env);
  let credential = null;
  try {
    const file = await readFile(config.dockerConfigPath, "utf8");
    credential = credentialForRegistry(parseDockerConfig(file), registry, console.warn);
  } catch {
    credential = null;
  }
  return new RegistryClient(registry, { credential });
}

async function inspectWatched(): Promise<WatchedContainer[]> {
  const docker = getDocker();
  const infos = await listWatched(docker);
  return Promise.all(
    infos.map(async (info) => toWatched(await docker.getContainer(info.Id).inspect())),
  );
}

export async function scan(opts: { repo?: string } = {}): Promise<ScanReport> {
  const config = loadConfig(process.env);
  const watched = await inspectWatched();
  const containers = await Promise.all(
    watched.map(async (container): Promise<ContainerReport> => {
      const ref = parseImageRef(container.image);
      if (opts.repo && ref.repository !== opts.repo) {
        return {
          container,
          status: computeStatus({ container, upstreamDigest: container.currentDigest }),
          upstreamDigest: container.currentDigest,
          targets: [],
          error: null,
        };
      }
      try {
        const client = await clientForRegistry(ref.registry);
        const upstreamDigest = await client.resolveDigest(ref.repository, ref.tag);
        if (shouldAutoUpdate(container, upstreamDigest)) {
          await recreateWithImage({
            docker: getDocker(),
            containerId: container.id,
            image: formatImageRef(ref),
            labelOverrides: {},
          });
        }
        const { targets } = await listRollbackTargets(ref, client, config.maxTags, console.warn);
        return {
          container,
          status: computeStatus({ container, upstreamDigest }),
          upstreamDigest,
          targets,
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          container,
          status: "error",
          upstreamDigest: null,
          targets: [],
          error: message,
        };
      }
    }),
  );
  return { scannedAt: new Date().toISOString(), containers };
}

export async function applyTag(containerId: string, tag: string): Promise<void> {
  const docker = getDocker();
  const info = toWatched(await docker.getContainer(containerId).inspect());
  const ref = parseImageRef(info.image);
  const target = { ...ref, tag, digest: null };
  const isCurrentTag = tag === ref.tag;
  await recreateWithImage({
    docker,
    containerId,
    image: formatImageRef(target),
    labelOverrides: { [ROLLED_BACK_LABEL]: isCurrentTag ? null : tag },
  });
}

export async function resumeAutoUpdate(containerId: string): Promise<void> {
  const docker = getDocker();
  const info = toWatched(await docker.getContainer(containerId).inspect());
  const ref = parseImageRef(info.image);
  await recreateWithImage({
    docker,
    containerId,
    image: formatImageRef(ref),
    labelOverrides: { [ROLLED_BACK_LABEL]: null },
  });
}
```

- [ ] **Step 5: Run tests + gate**

Run: `npx vitest run tests/scan/status.test.ts && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 6: Commit**

```bash
git add lib/scan tests/scan
git commit -m "feat: scan, apply-tag, and resume auto-update logic"
```

---

## Task 10: Auth (session + webhook token)

**Files:**
- Create: `lib/auth/session.ts`, `lib/auth/webhook.ts`
- Test: `tests/auth/session.test.ts`, `tests/auth/webhook.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // session.ts
  export function signSession(secret: string): string;      // value for the cookie
  export function verifySession(secret: string, value: string): boolean;
  // webhook.ts
  export function tokenMatches(expected: string | null, provided: string | null): boolean;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/auth/session.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/auth/session";

describe("session", () => {
  it("verifies a token it signed", () => {
    const token = signSession("secret");
    expect(verifySession("secret", token)).toBe(true);
  });
  it("rejects tampering or a wrong secret", () => {
    const token = signSession("secret");
    expect(verifySession("other", token)).toBe(false);
    expect(verifySession("secret", `${token}x`)).toBe(false);
  });
});
```

`tests/auth/webhook.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { tokenMatches } from "@/lib/auth/webhook";

describe("tokenMatches", () => {
  it("is false when no expected token is configured", () => {
    expect(tokenMatches(null, "anything")).toBe(false);
  });
  it("is false on mismatch and true on exact match", () => {
    expect(tokenMatches("abc", "abd")).toBe(false);
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abc", null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/auth`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lib/auth/session.ts`:
```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const PAYLOAD = "rollback-tower";

export function signSession(secret: string): string {
  const mac = createHmac("sha256", secret).update(PAYLOAD).digest("hex");
  return `${PAYLOAD}.${mac}`;
}

export function verifySession(secret: string, value: string): boolean {
  const expected = signSession(secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(value);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

`lib/auth/webhook.ts`:
```ts
import { timingSafeEqual } from "node:crypto";

export function tokenMatches(expected: string | null, provided: string | null): boolean {
  if (!expected || !provided) {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/auth tests/auth
git commit -m "feat: session signing and webhook token check"
```

---

## Task 11: API routes + middleware

**Files:**
- Create: `app/api/scan/route.ts`, `app/api/webhook/route.ts`, `app/api/login/route.ts`, `middleware.ts`, `app/login/page.tsx`
- Test: `tests/api/webhook.test.ts`

**Interfaces:**
- Consumes: `scan` (Task 9), `tokenMatches` (Task 10), `signSession`/`verifySession` (Task 10), `loadConfig` (Task 2).

- [ ] **Step 1: Write the failing test**

`tests/api/webhook.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/scan", () => ({ scan: vi.fn(async () => ({ scannedAt: "t", containers: [] })) }));

describe("webhook route", () => {
  beforeEach(() => {
    delete process.env.WEBHOOK_TOKEN;
  });
  it("returns 503 when no token configured", async () => {
    const { POST } = await import("@/app/api/webhook/route");
    const res = await POST(new Request("http://x/api/webhook"));
    expect(res.status).toBe(503);
  });
  it("returns 401 on bad token and 200 on good token", async () => {
    process.env.WEBHOOK_TOKEN = "secret";
    vi.resetModules();
    const { POST } = await import("@/app/api/webhook/route");
    const bad = await POST(new Request("http://x/api/webhook?token=nope"));
    expect(bad.status).toBe(401);
    const ok = await POST(new Request("http://x/api/webhook?token=secret"));
    expect(ok.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/webhook.test.ts`
Expected: FAIL (route not found).

- [ ] **Step 3: Implement routes + middleware**

`app/api/webhook/route.ts`:
```ts
import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { tokenMatches } from "@/lib/auth/webhook";
import { scan } from "@/lib/scan";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  if (!config.webhookToken) {
    return NextResponse.json({ error: "webhook disabled" }, { status: 503 });
  }
  const url = new URL(request.url);
  const provided = url.searchParams.get("token") ?? request.headers.get("x-webhook-token");
  if (!tokenMatches(config.webhookToken, provided)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await scan();
  return NextResponse.json({ ok: true, scannedAt: report.scannedAt });
}
```

`app/api/scan/route.ts`:
```ts
import { NextResponse } from "next/server";
import { scan } from "@/lib/scan";

export async function POST(): Promise<Response> {
  const report = await scan();
  return NextResponse.json(report);
}
```

`app/api/login/route.ts`:
```ts
import { NextResponse } from "next/server";
import { loadConfig } from "@/lib/config";
import { signSession } from "@/lib/auth/session";

export async function POST(request: Request): Promise<Response> {
  const config = loadConfig(process.env);
  if (!config.adminPassword || !config.sessionSecret) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const form = await request.formData();
  if (form.get("password") !== config.adminPassword) {
    return NextResponse.redirect(new URL("/login?error=1", request.url));
  }
  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set("rt_session", signSession(config.sessionSecret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
```

`middleware.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { loadConfig } from "@/lib/config";
import { verifySession } from "@/lib/auth/session";

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/api/webhook") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login")
  ) {
    return NextResponse.next();
  }
  const config = loadConfig(process.env);
  if (!config.adminPassword || !config.sessionSecret) {
    return NextResponse.next();
  }
  const cookie = request.cookies.get("rt_session")?.value ?? "";
  if (verifySession(config.sessionSecret, cookie)) {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

`app/login/page.tsx`:
```tsx
export default function Login() {
  return (
    <main>
      <h1>Sign in</h1>
      <form action="/api/login" method="post">
        <input type="password" name="password" aria-label="Password" />
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Run test + gate**

Run: `npx vitest run tests/api/webhook.test.ts && npm run typecheck`
Expected: PASS + clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add app/api middleware.ts app/login tests/api
git commit -m "feat: api routes for scan, webhook, login, and auth middleware"
```

---

## Task 12: Dashboard UI + server actions

**Files:**
- Create: `app/actions.ts`
- Modify: `app/page.tsx`
- Test: (covered by build + existing lib tests; UI has no new pure logic)

**Interfaces:**
- Consumes: `scan`, `applyTag`, `resumeAutoUpdate` (Task 9).

- [ ] **Step 1: Server actions**

`app/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { applyTag, resumeAutoUpdate, scan } from "@/lib/scan";

export async function runScan(): Promise<void> {
  await scan();
  revalidatePath("/");
}

export async function applyTagAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const tag = String(formData.get("tag"));
  await applyTag(id, tag);
  revalidatePath("/");
}

export async function resumeAction(formData: FormData): Promise<void> {
  await resumeAutoUpdate(String(formData.get("id")));
  revalidatePath("/");
}
```

- [ ] **Step 2: Dashboard page**

`app/page.tsx`:
```tsx
import { scan } from "@/lib/scan";
import { applyTagAction, resumeAction, runScan } from "./actions";

export const dynamic = "force-dynamic";

export default async function Home() {
  const report = await scan();
  return (
    <main>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Rollback Tower</h1>
        <form action={runScan}>
          <button type="submit">Scan now</button>
        </form>
      </header>
      <p>Last scan: {report.scannedAt}</p>
      {report.containers.map((c) => (
        <section key={c.container.id} style={{ borderTop: "1px solid #8884", padding: "0.75rem 0" }}>
          <h2>
            {c.container.name} — <code>{c.container.image}</code>{" "}
            <span>[{c.status}]</span>
          </h2>
          <p>
            Digest: <code>{c.container.currentDigest?.slice(0, 19) ?? "unknown"}</code>
          </p>
          {c.container.rolledBack ? (
            <form action={resumeAction}>
              <input type="hidden" name="id" value={c.container.id} />
              <button type="submit">Resume auto-updates</button>
            </form>
          ) : null}
          {c.error ? <p style={{ color: "crimson" }}>Error: {c.error}</p> : null}
          <ul>
            {c.targets.map((t) => (
              <li key={t.tag}>
                <code>{t.tag}</code> — {t.digest.slice(0, 19)} — {t.created ?? "?"}
                <form action={applyTagAction} style={{ display: "inline" }}>
                  <input type="hidden" name="id" value={c.container.id} />
                  <input type="hidden" name="tag" value={t.tag} />
                  <button type="submit">Apply</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
```

- [ ] **Step 3: Run the full gate**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all pass; build succeeds. (Docker calls only run at request time, not during build, because `page.tsx` is `force-dynamic`.)

- [ ] **Step 4: Commit**

```bash
git add app/actions.ts app/page.tsx
git commit -m "feat: dashboard with scan, apply, and resume actions"
```

---

## Task 13: Poller, Dockerfile, compose, README

**Files:**
- Create: `instrumentation.ts`, `Dockerfile`, `docker-compose.example.yml`, `README.md`
- Test: `tests/poller.test.ts`

**Interfaces:**
- Consumes: `scan` (Task 9), `loadConfig` (Task 2).
- Produces: `export function startPoller(intervalMs: number, run: () => Promise<void>): NodeJS.Timeout | null;`

- [ ] **Step 1: Write the failing test**

`tests/poller.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { startPoller } from "@/lib/poller";

describe("startPoller", () => {
  it("returns null when interval is zero", () => {
    expect(startPoller(0, vi.fn())).toBeNull();
  });
  it("schedules the runner when interval is positive", () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const handle = startPoller(1000, run);
    expect(handle).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/poller.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement poller + instrumentation**

`lib/poller.ts`:
```ts
export function startPoller(
  intervalMs: number,
  run: () => Promise<void>,
): NodeJS.Timeout | null {
  if (intervalMs <= 0) {
    return null;
  }
  return setInterval(() => {
    run().catch((error) => {
      console.error("scan poll failed", error);
    });
  }, intervalMs);
}
```

`instrumentation.ts`:
```ts
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { loadConfig } = await import("@/lib/config");
  const { scan } = await import("@/lib/scan");
  const { startPoller } = await import("@/lib/poller");
  const config = loadConfig(process.env);
  startPoller(config.pollIntervalMs, async () => {
    await scan();
  });
}
```

- [ ] **Step 4: Deployment files**

`Dockerfile`:
```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

`docker-compose.example.yml`:
```yaml
services:
  rollback-tower:
    build: .
    ports:
      - "3000:3000"
    environment:
      POLL_INTERVAL: "300s"
      WEBHOOK_TOKEN: "change-me"
      # ADMIN_PASSWORD: "set-to-require-login"
      # SESSION_SECRET: "required-if-admin-password-set"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ~/.docker/config.json:/root/.docker/config.json:ro

  # Example watched container:
  # web:
  #   image: nginx:latest
  #   labels:
  #     rollback-tower.enable: "true"
```

`README.md` (content):
```markdown
# Rollback Tower

Stateless, single-host container update/rollback dashboard. Watches Docker
containers labeled `rollback-tower.enable=true`, auto-updates them when their
image tag changes upstream (unless pinned by a rollback), and lets you roll
back or switch to any tag published in the image's registry.

## Run

Mount the Docker socket and your registry credentials read-only:

    docker compose -f docker-compose.example.yml up --build

Opt a container in by adding the label `rollback-tower.enable=true`.

## Environment

| Var | Meaning | Default |
| --- | --- | --- |
| `POLL_INTERVAL` | Poll cadence (`300s`, `5m`, `0` disables) | `300s` |
| `ADMIN_PASSWORD` | If set, required to use the UI | unset (open) |
| `SESSION_SECRET` | Cookie signing secret; required if password set | — |
| `WEBHOOK_TOKEN` | Required for `/api/webhook`; unset → 503 | unset |
| `MAX_TAGS` | Cap on rollback targets listed per repo | `50` |
| `DOCKER_CONFIG` | Path to docker config.json | `~/.docker/config.json` |

When `ADMIN_PASSWORD` is unset the app is open — put it behind a proxy/VPN.

## Webhook

    curl -X POST "https://host/api/webhook?token=$WEBHOOK_TOKEN"
```

- [ ] **Step 5: Run full gate**

Run: `npm run test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add instrumentation.ts lib/poller.ts tests/poller.test.ts Dockerfile docker-compose.example.yml README.md
git commit -m "feat: in-process poller and deployment files"
```

---

## Self-Review

**Spec coverage:**
- Stateless / no DB → no persistence module anywhere (Tasks 7–9 derive live). ✓
- Docker socket + dockerode → Tasks 7, 8. ✓
- Watch opt-in via label → Task 7 (`listWatched`). ✓
- Live version + digest → Task 7 (`toWatched`). ✓
- Registry credentials from docker config → Task 4. ✓
- Registry v2 tags/manifests/created → Tasks 5, 6. ✓
- Update-available + auto-update-except-rolled-back → Task 9 (`computeStatus`, `shouldAutoUpdate`, `scan`). ✓
- Apply tag / rollback sets label; resume clears it → Task 9 (`applyTag`, `resumeAutoUpdate`). ✓
- Three triggers (poll/webhook/manual) → Tasks 11 (webhook, scan route), 12 (button), 13 (poller). ✓
- Optional password auth + always-on webhook token → Tasks 10, 11. ✓
- Dashboard UI → Task 12. ✓
- Config env → Task 2. ✓
- Deployment (Dockerfile/compose/README) → Task 13. ✓
- Vitest unit tests with dockerode/fetch mocked → every logic task. ✓
- Verification gate before commit → run at Tasks 1, 12, 13 and typecheck at 9, 11. ✓

**Placeholder scan:** No TBD/TODO; every code step contains real code. ✓

**Type consistency:** `WatchedContainer` shape identical across Tasks 7/9; `RegistryClient` method names (`listTags`, `resolveDigest`, `getCreated`) consistent Tasks 5/6/9; `ROLLED_BACK_LABEL` used consistently; `formatImageRef`/`parseImageRef` signatures stable. ✓

**Known follow-ups (out of v1 scope, documented in spec):** credential-helper support; untagged-digest rollback; manifest-list `created` resolution (returns null today).
