import { describe, expect, it, vi } from "vitest";
import { startPoller } from "@/lib/poller";

describe("startPoller", () => {
  it("returns null when interval is zero", () => {
    expect(startPoller(0, vi.fn())).toBeNull();
  });
  it("schedules the runner when interval is positive", () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => undefined);
    const handle = startPoller(1000, run);
    expect(handle).not.toBeNull();
    vi.advanceTimersByTime(2000);
    expect(run).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
