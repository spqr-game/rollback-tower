export interface Config {
  pollIntervalMs: number;
  adminPassword: string | null;
  webhookToken: string | null;
  maxTags: number;
  dockerConfigPath: string;
  sessionSecret: string | null;
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

export function loadConfig(env: Partial<NodeJS.ProcessEnv>): Config {
  const adminPassword = env.ADMIN_PASSWORD ? env.ADMIN_PASSWORD : null;
  const sessionSecret = env.SESSION_SECRET ? env.SESSION_SECRET : null;
  if (adminPassword && !sessionSecret) {
    throw new Error("SESSION_SECRET is required when ADMIN_PASSWORD is set");
  }
  return {
    pollIntervalMs: parseDuration(env.POLL_INTERVAL ?? "300s"),
    adminPassword,
    webhookToken: env.WEBHOOK_TOKEN ? env.WEBHOOK_TOKEN : null,
    maxTags: parseMaxTags(env.MAX_TAGS),
    dockerConfigPath: defaultDockerConfigPath(env),
    sessionSecret,
  };
}
