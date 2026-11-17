import { describe, expect, test } from "bun:test";
import { switchyScope } from "./switchy";

describe("switchyScope", () => {
  const hosts = ["local", "h-devbox"];

  test("keeps the scope picked on the page, else the saved one", () => {
    expect(switchyScope("h-devbox", "local", hosts)).toBe("h-devbox");
    expect(switchyScope(null, "h-devbox", hosts)).toBe("h-devbox");
    expect(switchyScope(null, "local", hosts)).toBe("local");
  });

  test("defaults to every host", () => {
    expect(switchyScope(null, undefined, hosts)).toBe("all");
    expect(switchyScope(null, "all", hosts)).toBe("all");
  });

  // The picker has no option for a host that was removed, so it reads "All
  // hosts" while yardd would refuse the stale id as an unknown host scope.
  test("a saved scope naming a removed host falls back to every host", () => {
    expect(switchyScope(null, "h-gone", hosts)).toBe("all");
    // Removed while the page was open, after picking it here.
    expect(switchyScope("h-gone", "local", hosts)).toBe("all");
  });
});
