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
