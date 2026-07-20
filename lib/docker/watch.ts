import type Dockerode from "dockerode";
import { ENABLE_LABEL, ROLLED_BACK_LABEL } from "./labels";

type InspectWithDigests = Dockerode.ContainerInspectInfo & { RepoDigests?: string[] };

export interface WatchedContainer {
  id: string;
  name: string;
  image: string;
  currentDigest: string | null;
  labels: Record<string, string>;
  rolledBack: string | null;
}

export function toWatched(info: InspectWithDigests): WatchedContainer {
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
