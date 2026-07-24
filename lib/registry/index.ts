import type { ImageRef } from "./ref";
import type { RegistryClient } from "./client";

export interface TagTarget {
  tag: string;
  digest: string | null;
  created: string | null;
}

export interface RollbackTargets {
  targets: TagTarget[];
  truncated: boolean;
}

// When tag info is enabled, only the newest few tags get their digest/created
// resolved — each costs extra registry requests, so we cap it to stay well
// under registry rate limits regardless of MAX_TAGS.
const TAG_INFO_LIMIT = 5;

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

// Returns the newest rollback tags. Tag names come from a single tags/list
// call. When tagInfo is on, only the first TAG_INFO_LIMIT tags get their
// digest/created resolved (each is extra manifest/blob fetches) — this keeps a
// scan cheap enough to stay under registry rate limits regardless of maxTags.
// Remaining tags (and all tags when tagInfo is off) carry null info.
export async function listRollbackTargets(
  ref: ImageRef,
  client: Pick<RegistryClient, "listTags" | "resolveDigest" | "getCreated">,
  maxTags: number,
  options: { tagInfo?: boolean; warn?: (msg: string) => void } = {},
): Promise<RollbackTargets> {
  const { tagInfo = true, warn = () => {} } = options;
  const all = sortTags(await client.listTags(ref.repository));
  const names = all.slice(0, maxTags);
  const truncated = all.length > names.length;
  if (truncated) {
    warn(`Tag list for ${ref.repository} truncated to ${maxTags} of ${all.length}`);
  }

  const enrich = tagInfo ? names.slice(0, TAG_INFO_LIMIT) : [];
  const info = new Map<string, { digest: string | null; created: string | null }>();
  await Promise.all(
    enrich.map(async (tag) => {
      const [digest, created] = await Promise.all([
        // Best-effort: a failed digest lookup (e.g. rate limit) must not drop
        // the tag or abort the scan — it just shows without info.
        client.resolveDigest(ref.repository, tag).catch(() => null),
        client.getCreated(ref.repository, tag),
      ]);
      info.set(tag, { digest, created });
    }),
  );

  const targets = names.map((tag) => ({
    tag,
    digest: info.get(tag)?.digest ?? null,
    created: info.get(tag)?.created ?? null,
  }));
  return { targets, truncated };
}
