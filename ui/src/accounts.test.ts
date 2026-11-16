import { describe, expect, test } from "bun:test";
import { accountChoices, accountLabel, accountName, accountOf, usageForAccount, usageForPicks } from "./accounts";
import type { AccountEntry } from "./protocol";
import { initial, loginKey, reduce, accountsOn, type State } from "./store";

const server = (state: State, msg: any) => reduce(state, { t: "server", msg });
const work: AccountEntry = { id: "a1", engine: "claude", name: "Work" };
const other: AccountEntry = { id: "a2", engine: "codex", name: "Company" };

describe("account helpers", () => {
  test("a session without an account runs on Default", () => {
    expect(accountOf(undefined)).toBe("default");
    expect(accountOf({})).toBe("default");
    expect(accountOf({ account: "a1" })).toBe("a1");
  });

  test("choices are Default first, then the engine's own accounts", () => {
    expect(accountChoices([work, other], "claude")).toEqual([
      { id: "default", name: "Default" },
      { id: "a1", name: "Work" },
    ]);
    expect(accountChoices([work, other], "codex").map((a) => a.name)).toEqual(["Default", "Company"]);
    expect(accountChoices(undefined, "claude")).toEqual([{ id: "default", name: "Default" }]);
  });

  test("names fall back to Default, then to the id of a removed account", () => {
    expect(accountName([work], "claude", "a1")).toBe("Work");
    expect(accountName([work], "claude", "default")).toBe("Default");
    expect(accountName([work], "claude", "gone")).toBe("gone");
  });

  test("a session names its account only where there is a choice", () => {
    expect(accountLabel([], { engine: "claude", account: "default" })).toBeNull();
    expect(accountLabel([work], { engine: "codex", account: "default" })).toBeNull();
    expect(accountLabel([work], { engine: "claude", account: "default" })).toBe("Default");
    expect(accountLabel([work], { engine: "claude", account: "a1" })).toBe("Work");
    expect(accountLabel([], { engine: "claude", account: "a1" })).toBe("a1");
  });

  test("usage is read per account", () => {
    const usage = {
      claude: { fiveHour: 0.47, sevenDay: 0.17 },
      accounts: { a1: { fiveHour: 0.91, sevenDay: 0.3 } },
    } as any;
    expect(usageForAccount(usage, "claude", "default").claude?.fiveHour).toBe(0.47);
    expect(usageForAccount(usage, "claude", "a1").claude?.fiveHour).toBe(0.91);
    expect(usageForAccount(usage, "claude", "a9").claude).toBeUndefined();
    // Per engine, for the picker: the picked account's limits, Default's elsewhere.
    const both = { ...usage, codex: { primary: { usedPercent: 12, windowDurationMins: 300 } } } as any;
    expect(usageForPicks(both, { claude: "a1" }).claude?.fiveHour).toBe(0.91);
    expect(usageForPicks(both, { claude: "a1" }).codex?.primary?.usedPercent).toBe(12);
    expect(usageForPicks(both, {}).claude?.fiveHour).toBe(0.47);
  });
});

describe("accounts in the store", () => {
  test("a snapshot and a host snapshot keep each host's accounts apart", () => {
    let s = server(initial, { op: "snapshot", sessions: [], models: {}, usage: {}, host: null, home: "/h", accounts: [work] });
    s = server(s, { op: "host.snapshot", hostId: "h1", sessions: [], models: {}, usage: {}, host: null, home: "/r", accounts: [other] });
    expect(accountsOn(s, "local")).toEqual([work]);
    expect(accountsOn(s, "h1")).toEqual([other]);
    expect(accountsOn(s, "h2")).toEqual([]);
  });

  test("an accounts message replaces one host's list", () => {
    let s = server(initial, { op: "accounts", accounts: [work] });
    s = server(s, { op: "accounts", hostId: "h1", accounts: [other] });
    s = server(s, { op: "accounts", accounts: [] });
    expect(accountsOn(s, "local")).toEqual([]);
    expect(accountsOn(s, "h1")).toEqual([other]);
  });

  test("engine status keeps its per-account states", () => {
    const s = server(initial, {
      op: "engines",
      engines: { claude: { installed: true, loggedIn: true }, codex: { installed: true, loggedIn: false } },
      accounts: { a1: { installed: true, loggedIn: false } },
    });
    expect(s.engines.local.claude.loggedIn).toBe(true);
    expect(s.engines.local.accounts?.a1.loggedIn).toBe(false);
  });

  test("a login for an account does not overwrite Default's", () => {
    let s = server(initial, { op: "login", engine: "claude", state: "url", url: "https://x/default" });
    s = server(s, { op: "login", engine: "claude", account: "a1", state: "url", url: "https://x/work" });
    expect(s.logins[loginKey("local", "claude")].url).toBe("https://x/default");
    expect(s.logins[loginKey("local", "claude", "a1")].url).toBe("https://x/work");
    expect(loginKey("local", "claude", "default")).toBe(loginKey("local", "claude"));
  });
});
