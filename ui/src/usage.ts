// Plan usage, as meters. Each engine reports its limits in its own shape
// (see Usage in protocol.ts); this turns them into one list of meters so the
// picker and the sidebar strip draw them the same way.
import type { Engine, Usage } from "./protocol";

export type Level = "ok" | "warn" | "high";

export interface Meter {
  key: string;
  /** "5-hour", "Week", "Week · Sonnet". */
  label: string;
  /** 0 to 100. */
  percent: number;
  /** Epoch milliseconds, when the engine said. */
  resetsAt: number | null;
  level: Level;
}

/** Amber above 70%, red above 90%. */
export const levelOf = (percent: number): Level => (percent > 90 ? "high" : percent > 70 ? "warn" : "ok");

const clamp = (n: number) => Math.max(0, Math.min(100, n));
export const percentText = (percent: number) => `${Math.round(clamp(percent))}%`;

/** Engines send epoch seconds; a value too big to be seconds is already ms. */
const toMs = (at: number | null | undefined): number | null => {
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return at > 1e12 ? at : at * 1000;
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "resets in 2 h 10 min", or "" when the engine gave no reset time. */
export function formatReset(resetsAt: number | null, now: number): string {
  if (resetsAt == null) return "";
  const left = resetsAt - now;
  if (left <= 0) return "resets now";
  if (left < MIN) return "resets in under a minute";
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const mins = Math.floor((left % HOUR) / MIN);
  if (days > 0) return `resets in ${days} d${hours ? ` ${hours} h` : ""}`;
  if (hours > 0) return `resets in ${hours} h${mins ? ` ${mins} min` : ""}`;
  return `resets in ${mins} min`;
}

const meter = (key: string, label: string, percent: number, resetsAt: number | null): Meter => {
  const p = clamp(percent);
  return { key, label, percent: p, resetsAt, level: levelOf(p) };
};

function windowLabel(mins: number | null | undefined, fallback: string): string {
  if (!mins) return fallback;
  if (mins >= 7 * 24 * 60) return "Week";
  if (mins % 60 === 0) return `${mins / 60}-hour`;
  return `${mins} min`;
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The SDK's window names that are not a plan limit of their own. */
const NOT_A_LIMIT = new Set(["seven_day_oauth_apps", "seven_day_overage_included"]);

/** An engine's meters, the 5-hour window first, then the week, then per-model weeks. */
export function metersFor(engine: Engine, usage: Usage): Meter[] {
  if (engine === "codex") {
    const c = usage.codex;
    const out: Meter[] = [];
    if (c?.primary) out.push(meter("primary", windowLabel(c.primary.windowDurationMins, "5-hour"), c.primary.usedPercent, toMs(c.primary.resetsAt)));
    if (c?.secondary) out.push(meter("secondary", windowLabel(c.secondary.windowDurationMins, "Week"), c.secondary.usedPercent, toMs(c.secondary.resetsAt)));
    return out;
  }
  const c = usage.claude;
  if (!c) return [];
  const windows = { ...(c.windows ?? {}) };
  // An older yardd sent only the two fractions.
  if (!c.windows) {
    if (c.fiveHour != null) windows.five_hour = { utilization: c.fiveHour, resetsAt: null };
    if (c.sevenDay != null) windows.seven_day = { utilization: c.sevenDay, resetsAt: null };
  }
  const out: Meter[] = [];
  const add = (key: string, label: string) => {
    const w = windows[key];
    if (w && w.utilization != null) out.push(meter(key, label, w.utilization * 100, toMs(w.resetsAt)));
  };
  add("five_hour", "5-hour");
  add("seven_day", "Week");
  for (const key of Object.keys(windows).sort()) {
    const m = key.match(/^seven_day_(.+)$/);
    if (m && !NOT_A_LIMIT.has(key)) add(key, `Week · ${capitalize(m[1])}`);
  }
  return out;
}
