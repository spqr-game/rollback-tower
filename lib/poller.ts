export function startPoller(
  intervalMs: number,
  run: () => Promise<void>,
): NodeJS.Timeout | null {
  if (intervalMs <= 0) {
    return null;
  }
  return setInterval(() => {
    run().catch((error) => {
      console.error("scan poll failed", error);
    });
  }, intervalMs);
}
