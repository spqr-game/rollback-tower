import { loadConfig } from "@/lib/config";
import { readFile } from "node:fs/promises";
import { getDocker } from "@/lib/docker/client";
import { listWatched, toWatched, type WatchedContainer } from "@/lib/docker/watch";
import { ROLLED_BACK_LABEL } from "@/lib/docker/labels";
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

async function clientForRegistry(registry: string): Promise<RegistryClient> {
  const config = loadConfig(process.env);
  let credential: RegistryCredential | null = null;
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
      try {
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
