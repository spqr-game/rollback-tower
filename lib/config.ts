import { readFileSync } from "node:fs";

export interface Config {
  pollIntervalMs: number;
  adminPassword: string | null;
  webhookToken: string | null;
  maxTags: number;
  tagInfo: boolean;
  dockerConfigPath: string;
  sessionSecret: string | null;
}

const FALSY = new Set(["0", "false", "off", "no"]);

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return !FALSY.has(value.trim().toLowerCase());
}

export function parseDuration(value: string): number {
  const match = /^(\d+)(s|m|h)?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration: ${value}`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "s";
  const factor = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1_000;
  return amount * factor;
}

function defaultDockerConfigPath(env: Partial<NodeJS.ProcessEnv>): string {
  if (env.DOCKER_CONFIG) {
    return env.DOCKER_CONFIG;
  }
  const home = env.HOME ?? env.USERPROFILE ?? "/root";
  return `${home}/.docker/config.json`;
}

function parseMaxTags(value: string | undefined): number {
  if (!value) {
    return 50;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
}

// Resolve a secret from either NAME_FILE (a path to a file holding the value)
// or NAME directly. The _FILE variant wins when both are set; its contents
// have trailing whitespace trimmed. A missing/unreadable _FILE throws rather
// than silently falling back, since setting it signals intent to use it. An
// empty (or whitespace-only) value resolves to null, i.e. treated as unset.
function resolveSecret(
  env: Partial<NodeJS.ProcessEnv>,
  name: string,
): string | null {
  const filePath = env[`${name}_FILE`];
  if (filePath) {
    let contents: string;
    try {
      contents = readFileSync(filePath, "utf8");
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read ${name}_FILE at ${filePath}: ${reason}`);
    }
    const trimmed = contents.trimEnd();
    return trimmed.length > 0 ? trimmed : null;
  }
  const value = env[name];
  return value ? value : null;
}

export function loadConfig(env: Partial<NodeJS.ProcessEnv>): Config {
  const adminPassword = resolveSecret(env, "ADMIN_PASSWORD");
  const sessionSecret = resolveSecret(env, "SESSION_SECRET");
  if (adminPassword && !sessionSecret) {
    throw new Error("SESSION_SECRET is required when ADMIN_PASSWORD is set");
  }
  return {
    // Unset means polling is disabled (0); startPoller treats <= 0 as off.
    pollIntervalMs: parseDuration(env.POLL_INTERVAL ?? "0"),
    adminPassword,
    webhookToken: resolveSecret(env, "WEBHOOK_TOKEN"),
    maxTags: parseMaxTags(env.MAX_TAGS),
    tagInfo: parseBool(env.TAG_INFO, true),
    dockerConfigPath: defaultDockerConfigPath(env),
    sessionSecret,
  };
}
