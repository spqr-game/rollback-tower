import type Dockerode from "dockerode";
import { ENABLE_LABEL, PINNED_LABEL } from "./labels";

export interface WatchedContainer {
  id: string;
  name: string;
  image: string;
  currentDigest: string | null;
  labels: Record<string, string>;
  pinned: string | null;
}

export function toWatched(
  info: Dockerode.ContainerInspectInfo,
  repoDigests: string[] = [],
): WatchedContainer {
  const labels = info.Config?.Labels ?? {};
  const repoDigest = repoDigests[0] ?? null;
  const currentDigest = repoDigest ? repoDigest.slice(repoDigest.indexOf("@") + 1) : null;
  return {
    id: info.Id,
    name: info.Name.replace(/^\//, ""),
    image: info.Config?.Image ?? "",
    currentDigest,
    labels,
    pinned: labels[PINNED_LABEL] ?? null,
  };
}

// A container inspect exposes only the image *ID*, not its registry digest —
// RepoDigests lives on the image inspect. Fetch both so currentDigest reflects
// the running image's registry digest (empty for locally-built images).
export async function inspectWatchedContainer(
  docker: Pick<Dockerode, "getContainer" | "getImage">,
  ref: string,
): Promise<WatchedContainer> {
  const info = await docker.getContainer(ref).inspect();
  let repoDigests: string[] = [];
  try {
    const image = await docker.getImage(info.Image).inspect();
    repoDigests = image.RepoDigests ?? [];
  } catch {
    repoDigests = [];
  }
  return toWatched(info, repoDigests);
}

export async function listWatched(
  docker: Pick<Dockerode, "listContainers">,
): Promise<Dockerode.ContainerInfo[]> {
  return docker.listContainers({
    all: false,
    filters: { label: [`${ENABLE_LABEL}=true`] },
  });
}
