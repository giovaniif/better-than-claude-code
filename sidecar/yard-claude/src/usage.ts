// Plan usage from the SDK's rate_limit_event, kept apart from main.ts so it
// can be tested without starting the SDK.
//
// A rate_limit_event describes ONE window (`rateLimitType`: five_hour,
// seven_day, seven_day_opus, seven_day_sonnet, ...) with `utilization` (a
// fraction) and `resetsAt` (epoch seconds). Some CLI builds instead send all
// windows at once as `unifiedWindows`. Either way the sidecar folds events into
// one picture, so the five-hour event does not wipe out what the weekly one
// said, and yardd relays it as the `claude` usage.

export interface UsageWindow {
  /** Fraction of the window used, 0 to 1. */
  utilization: number;
  /** Epoch seconds. */
  resetsAt: number | null;
}

export interface ClaudeUsage {
  status?: string;
  windows: Record<string, UsageWindow>;
}

/** Epoch seconds from a number, or from the ISO string the usage endpoint uses. */
function seconds(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return ms / 1000;
  }
  return null;
}

function windowOf(raw: any): UsageWindow | null {
  const utilization = raw?.utilization;
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return null;
  return { utilization, resetsAt: seconds(raw.resetsAt ?? raw.resets_at) };
}

/** `prev` with the windows `info` (an SDKRateLimitInfo) reports laid over it. */
export function mergeUsage(prev: ClaudeUsage | null, info: any): ClaudeUsage {
  const windows: Record<string, UsageWindow> = { ...(prev?.windows ?? {}) };
  const unified = info?.unifiedWindows;
  if (unified && typeof unified === "object") {
    for (const [name, raw] of Object.entries(unified)) {
      const w = windowOf(raw);
      if (w) windows[name] = w;
    }
  }
  if (typeof info?.rateLimitType === "string") {
    const w = windowOf(info);
    if (w) windows[info.rateLimitType] = w;
  }
  const status = typeof info?.status === "string" ? info.status : prev?.status;
  return status === undefined ? { windows } : { status, windows };
}
