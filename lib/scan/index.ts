import { loadConfig } from "@/lib/config";
import { readFile } from "node:fs/promises";
import { getDocker } from "@/lib/docker/client";
import { inspectWatchedContainer, listWatched, type WatchedContainer } from "@/lib/docker/watch";
import { PINNED_LABEL } from "@/lib/docker/labels";
import { recreateWithImage } from "@/lib/docker/recreate";
import { parseImageRef, formatImageRef } from "@/lib/registry/ref";
import { RegistryClient } from "@/lib/registry/client";
import {
  credentialForRegistry,
  parseDockerConfig,
  type RegistryCredential,
} from "@/lib/registry/credentials";
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

async function resolveCredential(registry: string): Promise<RegistryCredential | null> {
  const config = loadConfig(process.env);
  try {
    const file = await readFile(config.dockerConfigPath, "utf8");
    return credentialForRegistry(parseDockerConfig(file), registry, console.warn);
  } catch {
    return null;
  }
}

async function inspectWatched(): Promise<WatchedContainer[]> {
  const docker = getDocker();
  const infos = await listWatched(docker);
  const results = await Promise.all(
    infos.map(async (info): Promise<WatchedContainer | null> => {
      try {
        return await inspectWatchedContainer(docker, info.Id);
      } catch (error) {
        console.error(`failed to inspect container ${info.Id}`, error);
        return null;
      }
    }),
  );
  return results.filter((c): c is WatchedContainer => c !== null);
}

async function performScan(opts: { repo?: string } = {}): Promise<ScanReport> {
  const config = loadConfig(process.env);
  const watched = await inspectWatched();
  const containers = await Promise.all(
    watched.map(async (container): Promise<ContainerReport> => {
      let current = container;
      try {
        const ref = parseImageRef(current.image);
        if (opts.repo && ref.repository !== opts.repo) {
          return {
            container: current,
            status: computeStatus({ container: current, latestDigest: current.currentDigest }),
            upstreamDigest: current.currentDigest,
            targets: [],
            error: null,
          };
        }
        const credential = await resolveCredential(ref.registry);
        const client = new RegistryClient(ref.registry, { credential });
        // Auto-update tracks the container's own (running) tag.
        const upstreamDigest = await client.resolveDigest(ref.repository, ref.tag);
        if (shouldAutoUpdate(current, upstreamDigest)) {
          await recreateWithImage({
            docker: getDocker(),
            containerId: current.id,
            image: formatImageRef({ ...ref, digest: null }),
            labelOverrides: {},
            authconfig: credential ?? undefined,
          });
          // The recreate replaced the container; re-inspect (by the stable name)
          // so the report reflects the new digest/id rather than pre-update state.
          current = await inspectWatchedContainer(getDocker(), current.name);
        }
        // The "Update to latest" affordance compares the running digest to the
        // `latest` tag — independent of the running tag. Reuse the digest above
        // when already tracking `latest`; otherwise resolve it (best-effort).
        const latestDigest =
          ref.tag === "latest"
            ? upstreamDigest
            : await client.resolveDigest(ref.repository, "latest").catch(() => null);
        const { targets } = await listRollbackTargets(ref, client, config.maxTags, {
          tagInfo: config.tagInfo,
          warn: console.warn,
        });
        return {
          container: current,
          status: computeStatus({ container: current, latestDigest }),
          upstreamDigest,
          targets,
          error: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          container: current,
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

let scanInFlight: Promise<ScanReport> | null = null;

export async function scan(opts: { repo?: string } = {}): Promise<ScanReport> {
  if (scanInFlight) {
    return scanInFlight;
  }
  scanInFlight = performScan(opts).finally(() => {
    scanInFlight = null;
  });
  return scanInFlight;
}

// Switch the container to the given tag. The pinned label is a manual toggle
// and is intentionally left untouched here — selecting a tag just changes which
// tag runs. Identify by the (stable) name, not the id:
// recreation changes the id, so a report rendered before a recreate would
// carry a dead id. dockerode's getContainer() accepts a name or an id.
export async function applyTag(name: string, tag: string): Promise<void> {
  const docker = getDocker();
  const info = await inspectWatchedContainer(docker, name);
  const ref = parseImageRef(info.image);
  await recreateWithImage({
    docker,
    containerId: name,
    image: formatImageRef({ ...ref, tag, digest: null }),
    labelOverrides: {},
    authconfig: (await resolveCredential(ref.registry)) ?? undefined,
  });
}

// Move the container onto the `latest` tag (pulling its current image). Used by
// the "Update to latest" button, shown when the running digest differs from the
// `latest` tag's digest.
export async function updateToLatest(name: string): Promise<void> {
  const docker = getDocker();
  const info = await inspectWatchedContainer(docker, name);
  const ref = parseImageRef(info.image);
  await recreateWithImage({
    docker,
    containerId: name,
    image: formatImageRef({ ...ref, tag: "latest", digest: null }),
    labelOverrides: {},
    authconfig: (await resolveCredential(ref.registry)) ?? undefined,
  });
}

// Pin the container: freeze it at its current digest and mark it so scans skip
// auto-update. Recreating is required to change labels; we recreate at the
// exact running digest (tag@sha256:…) so the pin holds the current image.
export async function pin(name: string): Promise<void> {
  const docker = getDocker();
  const info = await inspectWatchedContainer(docker, name);
  const ref = parseImageRef(info.image);
  const tagged = formatImageRef({ ...ref, digest: null });
  const image = info.currentDigest ? `${tagged}@${info.currentDigest}` : tagged;
  await recreateWithImage({
    docker,
    containerId: name,
    image,
    labelOverrides: { [PINNED_LABEL]: info.currentDigest ?? "true" },
    authconfig: (await resolveCredential(ref.registry)) ?? undefined,
  });
}

// Unpin: clear the pinned label and resume tracking the container's tag (drop
// any digest pin), so the next scan may auto-update it again.
export async function unpin(name: string): Promise<void> {
  const docker = getDocker();
  const info = await inspectWatchedContainer(docker, name);
  const ref = parseImageRef(info.image);
  await recreateWithImage({
    docker,
    containerId: name,
    image: formatImageRef({ ...ref, digest: null }),
    labelOverrides: { [PINNED_LABEL]: null },
    authconfig: (await resolveCredential(ref.registry)) ?? undefined,
  });
}
