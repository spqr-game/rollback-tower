export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { loadConfig } = await import("@/lib/config");
  const { scan } = await import("@/lib/scan");
  const { startPoller } = await import("@/lib/poller");
  const config = loadConfig(process.env);
  startPoller(config.pollIntervalMs, async () => {
    await scan();
  });
}
