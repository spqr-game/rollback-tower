import type { WatchedContainer } from "@/lib/docker/watch";

export type StatusKind = "up-to-date" | "update-available" | "pinned" | "error";

// `update-available` here means "the newest `latest` image differs from what's
// running" — it drives the "Update to latest" button. It is independent of the
// running tag's own auto-update (see shouldAutoUpdate), so a container on a
// pinned version tag still surfaces that a newer `latest` exists.
export function computeStatus(args: {
  container: WatchedContainer;
  latestDigest: string | null;
  error?: string;
}): StatusKind {
  if (args.error) {
    return "error";
  }
  if (args.container.pinned) {
    return "pinned";
  }
  if (args.latestDigest && args.latestDigest !== args.container.currentDigest) {
    return "update-available";
  }
  return "up-to-date";
}

export function shouldAutoUpdate(
  container: WatchedContainer,
  upstreamDigest: string | null,
): boolean {
  if (container.pinned) {
    return false;
  }
  return Boolean(upstreamDigest) && upstreamDigest !== container.currentDigest;
}
