# Rollback Tower — Design

**Date:** 2026-07-20
**Status:** Approved (pending spec review)

## Summary

Rollback Tower is a stateless, single-host Next.js (App Router, TypeScript) web app
that watches Docker containers opted-in via a label, auto-updates them when their
image changes upstream (Watchtower-style), and lets an operator roll back or switch a
container to any tag published in that image's registry.

It keeps **no database**. All state is derived live, on each request or scan, from two
sources:

1. The **Docker daemon**, via a mounted `/var/run/docker.sock`.
2. Each image's **registry**, using credentials from a read-only mounted
   `~/.docker/config.json`.

The pinned state and watch opt-in both live as **labels on the containers
themselves**, so there is no app-owned persistence to manage or back up.

## Goals

- Watch only containers explicitly opted in via label.
- Show, in a web UI: what image/tag is live per container, its short digest, whether an
  update is available, and whether it is pinned.
- Auto-update watched containers when their running tag changes upstream, **unless**
  the container is pinned.
- Let an operator apply a specific tag (forward update or rollback) from the registry's
  tag list, and resume auto-updates for a pinned container.
- Trigger scans three ways: periodic in-process poll, inbound webhook, manual button.

## Non-goals (v1)

- Multi-host / remote Docker daemons, Swarm, or Kubernetes.
- Multi-user accounts or role-based access.
- An app-owned history/audit database of past digests.
- Cloud-registry-specific auth flows (ECR/GCR/ACR) beyond what a standard
  `docker login` writes into `config.json`.
- Rollback to an **untagged** prior digest (only registry tags are offered as targets;
  a `latest`-only repo will therefore show a single target — accepted tradeoff).

## Architecture

- Next.js App Router, TypeScript, `output: 'standalone'`.
- Runs as a container **on the host it manages**.
- A single `scan()` function is the core; it is invoked by three triggers:
  - **Poller** — started from `instrumentation.ts` on server boot (`setInterval`).
  - **Webhook** — `POST /api/webhook`, shared-secret token required.
  - **Manual** — `POST /api/scan`, from a "Scan now" button in the UI.

### Module layout

```
app/
  page.tsx                # dashboard (server component)
  login/page.tsx          # only meaningful when ADMIN_PASSWORD is set
  api/
    scan/route.ts         # POST: manual scan (auth-gated)
    webhook/route.ts      # POST: token-gated scan trigger
    containers/[id]/apply/route.ts    # POST { tag }: apply/rollback (auth-gated)
    containers/[id]/resume/route.ts   # POST: clear pinned label (auth-gated)
lib/
  docker/                 # dockerode wrapper: discover, inspect, recreate, labels
  registry/               # image-ref parse, docker config creds, v2 API client
  scan/                   # scan(), applyTag(), updateToLatest(), pin(), unpin()
  auth/                   # password session + webhook token verification
  config.ts               # env parsing/validation
instrumentation.ts        # boots the poller
middleware.ts             # password gate for UI + mutating API routes
```

Each `lib/*` module has a single responsibility, a small typed interface, and is unit
testable with the Docker socket and network `fetch` mocked.

## Docker integration (`lib/docker`)

- Client: **`dockerode`** over the mounted unix socket.
- **Discovery:** list containers filtered by label `rollback-tower.enable=true`.
- **Live version:** from container `inspect` — image reference and `RepoDigests`
  (the digest currently running).
- **Recreate** (shared by update and rollback), mirroring Watchtower:
  1. `inspect` running container → capture config: env, mounts/volumes, exposed +
     published ports, networks (with aliases), restart policy, labels, cmd, entrypoint,
     other host config.
  2. `pull` the target image ref (a tag, or `repo@sha256:…`).
  3. Stop + remove old container.
  4. Create new container from captured config with the target image; re-attach all
     networks; start it.
  5. On failure, best-effort restore of the previous container so a failed update/
     rollback does not leave the service down.
- **Managed labels:**
  - `rollback-tower.enable=true` — opt in (set by the user, not the app).
  - `rollback-tower.pinned=<digest>` — a manual toggle (set via the **Pin** button or by
    hand, cleared via **Unpin**); the app never sets it on tag apply. Presence freezes the
    container at its current digest and exempts it from auto-update.

## Registry integration (`lib/registry`)

- **Image-ref parsing** into `{ registry, repository, tag }`, applying Docker's default
  rules (implicit `docker.io` / `library/` namespace, default tag `latest`).
- **Credentials:** read `~/.docker/config.json` (path overridable via `DOCKER_CONFIG`).
  - Baseline: `auths[registry].auth` (base64 `user:pass`).
  - `credsStore` / `credHelpers`: documented edge case. v1 logs a clear warning and
    falls back to anonymous access for that registry if no direct credential exists.
    (Shelling out to credential helper binaries is out of scope for v1.)
- **Registry HTTP API v2 client**, bearer/basic auth flow:
  - `GET /v2/<repo>/tags/list` — enumerate tags.
  - `GET /v2/<repo>/manifests/<ref>` with appropriate `Accept` headers (incl. manifest
    lists / OCI indexes) — resolve tag → digest.
  - Fetch the config blob to read image `created` time.
- **Update available** = digest the running tag resolves to upstream ≠ running digest.
- **Rollback targets** = the repo's tags, each resolved to digest + created time, sorted
  semver-aware where possible, otherwise by created time (newest first).
  - **Performance:** resolving created-time is one request per tag. v1 caps to the most
    recent `MAX_TAGS` tags and logs when the list is truncated, so the list is never
    silently incomplete.

## Scan / update / rollback logic (`lib/scan`)

- `scan(opts?)`: for each watched container →
  1. resolve the running tag's current upstream digest;
  2. if it differs from the running digest **and** the container is not pinned
     → pull + recreate (auto-update);
  3. otherwise report status only.
  - Containers are processed with bounded concurrency; each is isolated so one failure
    does not abort the sweep. Errors are captured per-container for the UI.
  - Optional `repo` filter (used by webhook payloads) restricts the sweep.
- `applyTag(containerId, tag)`: pull the target, recreate onto that tag. Does **not**
  touch the pinned label — selecting a tag just changes which tag runs.
- `updateToLatest(containerId)`: recreate onto the `latest` tag. Backs the "Update to
  latest" button, shown when the running digest differs from `latest`.
- `pin(containerId)` / `unpin(containerId)`: set/clear the `pinned` label (recreating to
  change labels). Pin freezes the current digest; unpin resumes tracking the tag.

## Auth (`lib/auth`, `middleware.ts`)

- **UI + mutating API:** if `ADMIN_PASSWORD` is set, `/login` accepts the password and
  issues an httpOnly, signed session cookie; `middleware.ts` protects all UI routes and
  mutating API routes. If `ADMIN_PASSWORD` is unset, the app is open (assumes an external
  proxy/VPN provides access control).
- **Webhook:** `/api/webhook` is exempt from the password gate but **always** requires a
  token matching `WEBHOOK_TOKEN` (`?token=` query or header), compared in constant time.
  If `WEBHOOK_TOKEN` is unset, the route returns `503 Disabled` rather than running open.

## Web UI

- **Single dashboard** (`/`), server component reading live state:
  - Per watched container: name, image, current tag + short digest, status badge
    (`up-to-date` / `update available` / `pinned` / `error`), last-scan time.
  - Row expand → available tags each with an **Apply** button; a **Pin**/**Unpin**
    toggle; an **Update to latest** button when the running digest differs from `latest`.
  - Header **Scan now** button.
- Mutations go through the route handlers above; the view revalidates after each action.
- Minimal, clean styling; no heavy design system in v1.

## Configuration (env)

| Var | Meaning | Default |
| --- | --- | --- |
| `POLL_INTERVAL` | Poll cadence (e.g. `300s`); `0` disables polling | `300s` |
| `ADMIN_PASSWORD` | If set, required to use UI/mutating API | unset (open) |
| `WEBHOOK_TOKEN` | Required for `/api/webhook`; unset → webhook 503 | unset |
| `MAX_TAGS` | Cap on rollback-target tags resolved per repo | `50` |
| `DOCKER_CONFIG` | Path to docker config dir/file | `~/.docker/config.json` |
| `SESSION_SECRET` | Signing secret for the session cookie (when password set) | required if `ADMIN_PASSWORD` set |

## Deployment

- `Dockerfile` producing a standalone image.
- `docker-compose.yml` example mounting, read-only:
  - `/var/run/docker.sock:/var/run/docker.sock:ro`
  - `~/.docker/config.json:/root/.docker/config.json:ro`
  - and showing the opt-in label + env vars.
- README snippet: how to label a container in, set the webhook, and put the UI behind a
  proxy when `ADMIN_PASSWORD` is unset.

## Testing (Vitest)

Unit tests, no live Docker or registry:

- Image-ref parsing (defaults, private registry, digest refs).
- Registry auth: reading `config.json` `auths`, v2 bearer token flow, anonymous
  fallback, truncation logging.
- Digest comparison / "update available" logic.
- Scan decision logic: auto-update vs skip-because-pinned, per-repo filter.
- Recreate logic against a mocked Docker API (config capture → create args), including
  the failure-restore path.
- Auth: password session issue/verify, webhook constant-time token check, 503 when
  token unset.

`dockerode` and `fetch` are mocked. Lint, typecheck, tests, and build must all pass
before any commit (project rule).

## Open risks / tradeoffs

- **Recreate fidelity:** faithfully reproducing container config is the highest-risk
  area; the failure-restore path mitigates a botched update leaving a service down.
- **`latest`-only repos** expose a single rollback target (accepted; see non-goals).
- **Credential helpers** are unsupported in v1 (warn + anonymous fallback).
- **Registry rate/perf:** per-tag manifest resolution is capped by `MAX_TAGS`.
- **In-process poller** assumes a single app instance (correct for single-host).
