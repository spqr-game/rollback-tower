import { z } from "zod";

export interface RegistryCredential {
  username: string;
  password: string;
}

const authEntrySchema = z.object({ auth: z.string().optional() });
const dockerConfigSchema = z.object({
  auths: z.record(z.string(), authEntrySchema).default({}),
  credsStore: z.string().optional(),
  credHelpers: z.record(z.string(), z.string()).optional(),
});

export type DockerConfig = z.infer<typeof dockerConfigSchema>;

const HUB_HOSTS = new Set([
  "registry-1.docker.io",
  "index.docker.io",
  "docker.io",
]);

export function parseDockerConfig(json: string): DockerConfig {
  return dockerConfigSchema.parse(JSON.parse(json));
}

function candidateKeys(registry: string): string[] {
  if (HUB_HOSTS.has(registry)) {
    return ["https://index.docker.io/v1/", "index.docker.io", "registry-1.docker.io"];
  }
  return [registry, `https://${registry}`];
}

export function credentialForRegistry(
  config: DockerConfig,
  registry: string,
  warn: (msg: string) => void = () => {},
): RegistryCredential | null {
  for (const key of candidateKeys(registry)) {
    const entry = config.auths[key];
    if (entry?.auth) {
      const decoded = Buffer.from(entry.auth, "base64").toString("utf8");
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        return { username: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
      }
    }
  }
  const helper = config.credHelpers?.[registry] ?? config.credsStore;
  if (helper) {
    warn(
      `Registry ${registry} uses credential helper "${helper}"; ` +
        "helpers are unsupported in v1, falling back to anonymous access",
    );
  }
  return null;
}
