import { expect, test } from "bun:test";
import { mergeUsage } from "./usage";

test("one rate_limit_event carries one window; later events add to it", () => {
  let u = mergeUsage(null, { status: "allowed", rateLimitType: "five_hour", utilization: 0.47, resetsAt: 1_800_010_000 });
  expect(u).toEqual({ status: "allowed", windows: { five_hour: { utilization: 0.47, resetsAt: 1_800_010_000 } } });
  u = mergeUsage(u, { status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.17, resetsAt: 1_800_300_000 });
  expect(u.status).toBe("allowed_warning");
  expect(Object.keys(u.windows).sort()).toEqual(["five_hour", "seven_day"]);
  expect(u.windows.five_hour.utilization).toBe(0.47);
});

test("a newer event for the same window replaces it", () => {
  const first = mergeUsage(null, { rateLimitType: "five_hour", utilization: 0.4, resetsAt: 100 });
  const next = mergeUsage(first, { rateLimitType: "five_hour", utilization: 0.5, resetsAt: 200 });
  expect(next.windows.five_hour).toEqual({ utilization: 0.5, resetsAt: 200 });
});

test("the per-model weekly windows are kept under their own names", () => {
  const u = mergeUsage(null, { rateLimitType: "seven_day_sonnet", utilization: 0.08, resetsAt: 5 });
  expect(u.windows.seven_day_sonnet).toEqual({ utilization: 0.08, resetsAt: 5 });
});

test("unifiedWindows, when the CLI sends them, fill every window at once; reset times may be ISO strings", () => {
  const u = mergeUsage(null, {
    status: "allowed",
    unifiedWindows: {
      five_hour: { utilization: 0.3, resets_at: "2027-01-15T08:00:00Z" },
      seven_day: { utilization: 0.1, resetsAt: 1_800_300_000 },
      seven_day_opus: { utilization: null, resets_at: null },
    },
  });
  expect(u.windows.five_hour).toEqual({ utilization: 0.3, resetsAt: Date.parse("2027-01-15T08:00:00Z") / 1000 });
  expect(u.windows.seven_day).toEqual({ utilization: 0.1, resetsAt: 1_800_300_000 });
  expect(u.windows.seven_day_opus).toBeUndefined();
});

test("an event with no utilization updates the status and keeps what was known", () => {
  const known = mergeUsage(null, { rateLimitType: "five_hour", utilization: 0.6, resetsAt: 9 });
  const next = mergeUsage(known, { status: "rejected", rateLimitType: "five_hour" });
  expect(next.status).toBe("rejected");
  expect(next.windows.five_hour).toEqual({ utilization: 0.6, resetsAt: 9 });
});

test("an empty or odd event does not throw", () => {
  expect(mergeUsage(null, undefined)).toEqual({ windows: {} });
  expect(mergeUsage(null, { rateLimitType: 5, utilization: "x" })).toEqual({ windows: {} });
});
