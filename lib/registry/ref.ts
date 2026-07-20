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
