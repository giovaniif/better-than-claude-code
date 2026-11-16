import { describe, expect, test } from "bun:test";
import type { Automation, SessionMeta } from "./protocol";
import { describeSchedule, describeNext, describeLast, runsOf, hiddenFromSidebar, scheduleProblem } from "./automations";
import { initial, reduce } from "./store";

const MIN = 60_000;
const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m).getTime(); // 16 Nov 2026 is a Monday

describe("the schedule in words", () => {
  test("intervals", () => {
    expect(describeSchedule({ kind: "interval", every: 1, unit: "minutes" })).toBe("Every minute");
    expect(describeSchedule({ kind: "interval", every: 30, unit: "minutes" })).toBe("Every 30 minutes");
    expect(describeSchedule({ kind: "interval", every: 1, unit: "hours" })).toBe("Every hour");
    expect(describeSchedule({ kind: "interval", every: 6, unit: "hours" })).toBe("Every 6 hours");
  });
  test("daily and weekly name the time, and weekly the day", () => {
    expect(describeSchedule({ kind: "daily", time: "09:30" })).toBe("Daily at 09:30");
    expect(describeSchedule({ kind: "weekly", day: 1, time: "08:00" })).toBe("Mondays at 08:00");
    expect(describeSchedule({ kind: "weekly", day: 0, time: "18:15" })).toBe("Sundays at 18:15");
  });
  test("a schedule that cannot run is explained", () => {
    expect(scheduleProblem({ kind: "interval", every: 0, unit: "minutes" })).toContain("at least 1");
    expect(scheduleProblem({ kind: "daily", time: "25:00" })).toContain("time");
    expect(scheduleProblem({ kind: "weekly", day: 9, time: "10:00" })).toContain("day");
    expect(scheduleProblem({ kind: "daily", time: "07:05" })).toBeNull();
  });
});

describe("next run", () => {
  const now = at(10, 0);
  test("soon is relative", () => {
    expect(describeNext(now + 30_000, true, now)).toBe("in under a minute");
    expect(describeNext(now + 12 * MIN, true, now)).toBe("in 12 min");
    expect(describeNext(now + 60 * MIN, true, now)).toBe("in 1 h");
    expect(describeNext(now + 125 * MIN, true, now)).toBe("in 2 h 5 min");
  });
  test("later today, tomorrow and further out say when", () => {
    expect(describeNext(at(18, 30), true, now)).toBe("today 18:30");
    expect(describeNext(at(9, 0, 17), true, now)).toBe("tomorrow 09:00");
    expect(describeNext(at(9, 0, 19), true, now)).toBe("Thu 09:00");
    expect(describeNext(at(9, 0, 30), true, now)).toBe("30 Nov 09:00");
  });
  test("a late run and a disabled automation", () => {
    expect(describeNext(now - 5 * MIN, true, now)).toBe("due now");
    expect(describeNext(null, false, now)).toBe("off");
    expect(describeNext(now + 5 * MIN, false, now)).toBe("off");
  });
});

describe("last run", () => {
  const now = at(10, 0);
  test("never, started, skipped", () => {
    expect(describeLast(undefined, now)).toBe("never");
    expect(describeLast({ at: now - 5 * MIN, outcome: "started", sessionId: "s1" }, now)).toBe("5 min ago");
    expect(describeLast({ at: now - 3 * 3600_000, outcome: "skipped", reason: "a run is still going" }, now)).toBe("skipped 3 h ago");
    expect(describeLast({ at: now - 20_000, outcome: "failed", reason: "x" }, now)).toBe("failed just now");
  });
});

const run = (id: string, automation: string | null, over: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  title: id,
  engine: "codex",
  model: "m",
  effort: "low",
  cwd: "/w",
  status: "idle",
  host: "local",
  automation,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("runs", () => {
  test("an automation's runs are newest first and stay on their host", () => {
    const sessions = {
      a: run("a", "x", { createdAt: 10 }),
      b: run("b", "x", { createdAt: 30 }),
      c: run("c", "y", { createdAt: 20 }),
      d: run("h~d", "x", { createdAt: 40, host: "h" }),
      e: run("e", null, { createdAt: 50 }),
    };
    expect(runsOf(sessions, "local", "x").map((s) => s.id)).toEqual(["b", "a"]);
    expect(runsOf(sessions, "h", "x").map((s) => s.id)).toEqual(["h~d"]);
  });
  test("runs stay out of the sidebar unless pinned", () => {
    expect(hiddenFromSidebar(run("a", "x"))).toBe(true);
    expect(hiddenFromSidebar(run("a", "x", { archived: true }))).toBe(true);
    expect(hiddenFromSidebar(run("a", "x", { pinned: true }))).toBe(false);
    expect(hiddenFromSidebar(run("a", null))).toBe(false);
  });
});

const auto = (id: string): Automation => ({
  id,
  name: id,
  prompt: "p",
  cwd: "/w",
  engine: "codex",
  model: "m",
  effort: "low",
  permission: "ask",
  base: "",
  schedule: { kind: "daily", time: "09:00" },
  skipWhileRunning: true,
  maxFiveHour: null,
  maxWeek: null,
  enabled: true,
  createdAt: 1,
  nextRun: 5,
});

describe("automations in the store", () => {
  test("each host keeps its own list", () => {
    let s = reduce(initial, { t: "server", msg: { op: "snapshot", sessions: [], automations: [auto("a")] } });
    expect(s.automations.local.map((a) => a.id)).toEqual(["a"]);
    s = reduce(s, { t: "server", msg: { op: "automations", hostId: "h", automations: [auto("b")] } });
    expect(s.automations.h.map((a) => a.id)).toEqual(["b"]);
    expect(s.automations.local.map((a) => a.id)).toEqual(["a"]);
    s = reduce(s, { t: "server", msg: { op: "automations", automations: [] } });
    expect(s.automations.local).toEqual([]);
    expect(s.automations.h).toHaveLength(1);
  });
  test("a host snapshot carries the host's list, and an old host has none", () => {
    let s = reduce(initial, { t: "server", msg: { op: "host.snapshot", hostId: "h", sessions: [], automations: [auto("b")] } });
    expect(s.automations.h).toHaveLength(1);
    s = reduce(s, { t: "server", msg: { op: "host.snapshot", hostId: "h", sessions: [] } });
    expect(s.automations.h).toEqual([]);
  });
});
