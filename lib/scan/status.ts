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
