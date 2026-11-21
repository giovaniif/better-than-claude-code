import { describe, expect, test } from "bun:test";
import { subscriptionRows, triggerMeter, type SubscriptionSource } from "./UsageMeters";

const NOW = 1_800_000_000_000;
const at = (ms: number) => Math.floor(ms / 1000);
const claude = (five: number) => ({
  windows: {
    five_hour: { utilization: five, resetsAt: at(NOW + 3_600_000) },
    seven_day: { utilization: 0.17, resetsAt: at(NOW + 3 * 86_400_000) },
  },
});
const source = (loggedIn: boolean | null, usage = claude(0.47)): SubscriptionSource => ({
  host: "local",
  usage: { claude: usage },
  accounts: [],
  engines: {
    claude: { installed: true, loggedIn },
    codex: { installed: true, loggedIn },
  },
});

describe("triggerMeter", () => {
  test("shows the fullest meter of a signed-in account", () => {
    expect(triggerMeter(subscriptionRows([source(true)], NOW))?.percent).toBe(47);
  });

  test("leaves out an account that needs sign-in, as the popover does", () => {
    // Meters outlive a lost sign-in; the popover hides them ("Sign in to see usage"),
    // so the closed trigger must not show their percent either.
    expect(triggerMeter(subscriptionRows([source(false)], NOW))).toBeUndefined();
  });

  test("a login state not read yet still shows the last report", () => {
    expect(triggerMeter(subscriptionRows([source(null)], NOW))?.percent).toBe(47);
  });
});
