import { z } from "zod";
import type { RegistryCredential } from "./credentials";

const tokenResponseSchema = z.object({
  token: z.string().optional(),
  access_token: z.string().optional(),
});
const tagsListSchema = z.object({ tags: z.array(z.string()).nullish() });
const manifestSchema = z.object({
  config: z.object({ digest: z.string() }).optional(),
});
const imageConfigSchema = z.object({ created: z.string().optional() });

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface RegistryClientOptions {
  fetchImpl?: FetchLike;
  credential?: RegistryCredential | null;
}

const MANIFEST_ACCEPT = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

interface Challenge {
  realm: string;
  service: string | null;
  scope: string | null;
}

function parseChallenge(header: string): Challenge | null {
  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }
  const params = new Map<string, string>();
  for (const part of header.slice("bearer ".length).split(",")) {
    const eq = part.indexOf("=");
    if (eq !== -1) {
      params.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim().replace(/^"|"$/g, ""));
    }
  }
  const realm = params.get("realm");
  return realm ? { realm, service: params.get("service") ?? null, scope: params.get("scope") ?? null } : null;
}

export class RegistryClient {
  private readonly base: string;
  private readonly fetchImpl: FetchLike;
  private readonly credential: RegistryCredential | null;

  constructor(registry: string, options: RegistryClientOptions = {}) {
    this.base = `https://${registry}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.credential = options.credential ?? null;
  }

  private basicHeader(): string | null {
    if (!this.credential) {
      return null;
    }
    const raw = `${this.credential.username}:${this.credential.password}`;
    return `Basic ${Buffer.from(raw).toString("base64")}`;
  }

  private async authedFetch(path: string, accept?: string): Promise<Response> {
    const url = `${this.base}${path}`;
    const headers: Record<string, string> = {};
    if (accept) {
      headers.Accept = accept;
    }
    const first = await this.fetchImpl(url, undefined);
    if (first.status !== 401) {
      return accept ? this.fetchImpl(url, { headers }) : first;
    }
    const challenge = parseChallenge(first.headers.get("www-authenticate") ?? "");
    if (!challenge) {
      return first;
    }
    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) {
      tokenUrl.searchParams.set("service", challenge.service);
    }
    if (challenge.scope) {
      tokenUrl.searchParams.set("scope", challenge.scope);
    }
    const basic = this.basicHeader();
    const tokenResp = await this.fetchImpl(
      tokenUrl.toString(),
      basic ? { headers: { Authorization: basic } } : undefined,
    );
    const tokenBody = tokenResponseSchema.parse(await tokenResp.json());
    const token = tokenBody.token ?? tokenBody.access_token;
    if (accept) {
      headers.Accept = accept;
    }
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return this.fetchImpl(url, { headers });
  }

  async listTags(repository: string): Promise<string[]> {
    const resp = await this.authedFetch(`/v2/${repository}/tags/list`);
    if (!resp.ok) {
      throw new Error(`tags/list failed: ${resp.status}`);
    }
    const body = tagsListSchema.parse(await resp.json());
    return body.tags ?? [];
  }

  async resolveDigest(repository: string, ref: string): Promise<string> {
    const resp = await this.authedFetch(`/v2/${repository}/manifests/${ref}`, MANIFEST_ACCEPT);
    const digest = resp.headers.get("docker-content-digest");
    if (!digest) {
      throw new Error(`no digest for ${repository}:${ref} (status ${resp.status})`);
    }
    return digest;
  }

  async getCreated(repository: string, ref: string): Promise<string | null> {
    try {
      const resp = await this.authedFetch(`/v2/${repository}/manifests/${ref}`, MANIFEST_ACCEPT);
      const manifest = manifestSchema.parse(await resp.json());
      const configDigest = manifest.config?.digest;
      if (!configDigest) {
        return null;
      }
      const blob = await this.authedFetch(`/v2/${repository}/blobs/${configDigest}`);
      const config = imageConfigSchema.parse(await blob.json());
      return config.created ?? null;
    } catch {
      return null;
    }
  }
}
