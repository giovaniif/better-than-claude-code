// Words for automations: schedules, next and last run, and which sessions are runs.
import type { LastRun, Schedule, SessionMeta } from "./protocol";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN = 60_000;
const HOUR = 60 * MIN;

export function describeSchedule(s: Schedule): string {
  switch (s.kind) {
    case "interval": {
      const unit = s.unit === "hours" ? "hour" : "minute";
      return s.every === 1 ? `Every ${unit}` : `Every ${s.every} ${unit}s`;
    }
    case "daily":
      return `Daily at ${s.time}`;
    case "weekly":
      return `${DAYS[s.day] ?? "?"}s at ${s.time}`;
  }
}

/** Why a schedule cannot be saved, or null. */
export function scheduleProblem(s: Schedule): string | null {
  const badTime = (t: string) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  switch (s.kind) {
    case "interval":
      return Number.isInteger(s.every) && s.every >= 1 ? null : "The interval must be at least 1.";
    case "daily":
      return badTime(s.time) ? "Enter a time as HH:MM." : null;
    case "weekly":
      if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) return "Pick a day of the week.";
      return badTime(s.time) ? "Enter a time as HH:MM." : null;
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** When the next run is due, relative when close and by day and time when not. */
export function describeNext(next: number | null | undefined, enabled: boolean, now: number): string {
  if (!enabled || next == null) return "off";
  const diff = next - now;
  if (diff < 0) return "due now";
  if (diff < MIN) return "in under a minute";
  if (diff < 6 * HOUR) {
    const mins = Math.floor(diff / MIN);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `in ${m} min`;
    return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
  }
  const when = new Date(next);
  const days = Math.round((dayStart(when) - dayStart(new Date(now))) / (24 * HOUR));
  if (days === 0) return `today ${clock(when)}`;
  if (days === 1) return `tomorrow ${clock(when)}`;
  if (days < 7) return `${DAYS[when.getDay()].slice(0, 3)} ${clock(when)}`;
  return `${when.getDate()} ${MONTHS[when.getMonth()]} ${clock(when)}`;
}

function ago(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)} h ago`;
  return `${Math.floor(diff / (24 * HOUR))} d ago`;
}

export function describeLast(last: LastRun | null | undefined, now: number): string {
  if (!last) return "never";
  return last.outcome === "started" ? ago(last.at, now) : `${last.outcome} ${ago(last.at, now)}`;
}

/** An automation's runs on its host, newest first. Session ids on a remote host carry its prefix, so match on `host` too. */
export function runsOf(sessions: Record<string, SessionMeta>, host: string, automation: string): SessionMeta[] {
  return Object.values(sessions)
    .filter((s) => s.automation === automation && (s.host || "local") === host)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Runs live on the Automations page; pinning one brings it back to the list. */
export const hiddenFromSidebar = (s: SessionMeta): boolean => !!s.automation && !s.pinned;
