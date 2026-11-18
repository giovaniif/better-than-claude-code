// Plan usage, as meters. Each engine reports its limits in its own shape
// (see Usage in protocol.ts); this turns them into one list of meters so the
// picker and the sidebar strip draw them the same way.
import type { AccountEntry, Engine, Usage } from "./protocol";

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

/** The engines report usage only while they run, so a figure can outlive its
 *  window. Once the reset time has passed nothing has been used since (that
 *  would have come with a newer reset time), so the window is empty again. */
const meter = (key: string, label: string, percent: number, resetsAt: number | null, now?: number): Meter => {
  if (resetsAt != null && now != null && resetsAt <= now) return { key, label, percent: 0, resetsAt: null, level: "ok" };
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

/** An engine's meters, the 5-hour window first, then the week, then per-model
 *  weeks. With `now`, windows whose reset time has passed read as empty. */
export function metersFor(engine: Engine, usage: Usage, now?: number): Meter[] {
  if (engine === "codex") {
    const c = usage.codex;
    const out: Meter[] = [];
    if (c?.primary) out.push(meter("primary", windowLabel(c.primary.windowDurationMins, "5-hour"), c.primary.usedPercent, toMs(c.primary.resetsAt), now));
    if (c?.secondary) out.push(meter("secondary", windowLabel(c.secondary.windowDurationMins, "Week"), c.secondary.usedPercent, toMs(c.secondary.resetsAt), now));
    return out;
  }
  // Only Claude and Codex report plan limits.
  if (engine !== "claude") return [];
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
    if (w && w.utilization != null) out.push(meter(key, label, w.utilization * 100, toMs(w.resetsAt), now));
  };
  add("five_hour", "5-hour");
  add("seven_day", "Week");
  for (const key of Object.keys(windows).sort()) {
    const m = key.match(/^seven_day_(.+)$/);
    if (m && !NOT_A_LIMIT.has(key)) add(key, `Week · ${capitalize(m[1])}`);
  }
  return out;
}

/** One row group of the sidebar strip: an engine under one account, as one host reported it. */
export interface StripGroup {
  engine: Engine;
  /** The account's name; null for Default. */
  account: string | null;
  host: string;
  /** In the shape `metersFor(engine, usage)` reads. */
  usage: Usage;
  /** False for an added account no host has reported limits for yet: it is
   *  listed anyway, so every account is in the strip. */
  reported: boolean;
}

/** A host the sidebar shows, with what it knows about the plan limits. */
export interface UsageSource {
  host: string;
  usage: Usage;
  accounts: AccountEntry[];
}

/** How recent a report is: its windows' reset times, shortest window first,
 *  then how much is used. */
function freshness(engine: Engine, usage: Usage): { resets: (number | null)[]; used: number } {
  if (engine === "codex") {
    const c = usage.codex;
    return { resets: [toMs(c?.primary?.resetsAt), toMs(c?.secondary?.resetsAt)], used: (c?.primary?.usedPercent ?? 0) + (c?.secondary?.usedPercent ?? 0) };
  }
  const w = usage.claude?.windows ?? {};
  return {
    resets: [toMs(w.five_hour?.resetsAt), toMs(w.seven_day?.resetsAt)],
    used: (w.five_hour?.utilization ?? 0) + (w.seven_day?.utilization ?? 0),
  };
}

/** Whether report `a` came after `b`, as far as the reports tell: the same
 *  subscription's next window resets later, and inside one window use only
 *  grows. With no reset times to compare it cannot tell, and says no. */
function newer(engine: Engine, a: Usage, b: Usage): boolean {
  const fa = freshness(engine, a);
  const fb = freshness(engine, b);
  let known = false;
  for (let i = 0; i < fa.resets.length; i++) {
    const x = fa.resets[i];
    const y = fb.resets[i];
    if (x == null || y == null) continue;
    known = true;
    if (x !== y) return x > y;
  }
  return known && fa.used > fb.used;
}

/** What the sidebar strip shows: each engine and account once (an account is
 *  matched across hosts by name, since each host gives it its own id), from
 *  the shown host that reported it last, else the first one listed. A login
 *  is the same subscription on every machine, so one host's figures stand for
 *  all. Engines in the order given, Default first, then accounts as they appear. */
export function stripGroups(sources: UsageSource[], engines: Engine[]): StripGroup[] {
  // ACP engines have no plan-limit reports, even when they have added accounts.
  engines = engines.filter((engine) => engine === "claude" || engine === "codex");
  const found = new Map<string, StripGroup>();
  const offer = (key: string, group: StripGroup) => {
    if (metersFor(group.engine, group.usage).length === 0) return;
    group.reported = true;
    const had = found.get(key);
    if (!had || newer(group.engine, group.usage, had.usage)) found.set(key, group);
  };
  for (const { host, usage, accounts } of sources) {
    for (const engine of engines) {
      offer(`${engine}\0`, { engine, account: null, host, usage: { [engine]: (usage as Record<string, unknown>)[engine] } as Usage, reported: false });
      for (const a of accounts) {
        if (a.engine !== engine) continue;
        offer(`${engine}\0${a.name.toLowerCase()}`, { engine, account: a.name, host, usage: { [engine]: usage.accounts?.[a.id] } as Usage, reported: false });
      }
    }
  }
  // Every added account is listed, reported or not, and so is Default next
  // to them: with two accounts, the one missing must not look like the only one.
  for (const { host, accounts } of sources) {
    for (const a of accounts) {
      if (!engines.includes(a.engine)) continue;
      const key = `${a.engine}\0${a.name.toLowerCase()}`;
      if (!found.has(key)) found.set(key, { engine: a.engine, account: a.name, host, usage: {} as Usage, reported: false });
      if (!found.has(`${a.engine}\0`)) found.set(`${a.engine}\0`, { engine: a.engine, account: null, host, usage: {} as Usage, reported: false });
    }
  }
  const all = [...found.values()];
  return engines.flatMap((engine) => {
    const mine = all.filter((g) => g.engine === engine);
    return [...mine.filter((g) => g.account === null), ...mine.filter((g) => g.account !== null)];
  });
}
