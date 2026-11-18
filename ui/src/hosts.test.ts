import { describe, expect, test } from "bun:test";
import type { AccountEntry, Host, SessionMeta } from "./protocol";
import { engineGlance, sessionGlance, stateText } from "./hosts";

const MB = 1024 ** 2;
const host = (sessions: Host["sessions"] = []): Host => ({
  id: "local",
  name: "box",
  cpu: 10,
  cores: 8,
  load: 1,
  memUsed: 0,
  memTotal: 1,
  diskUsed: 0,
  diskTotal: 1,
  cpuHistory: [],
  sessions,
});
const session = (id: string, status: SessionMeta["status"] = "idle") => ({ id, status, title: id, createdAt: 0 }) as unknown as SessionMeta;
const use = (id: string, cpuCores: number, memBytes: number) => ({ id, cpuCores, memBytes }) as NonNullable<Host["sessions"]>[number];

describe("the card's sessions line", () => {
  test("counts the sessions using the host, their cores and memory", () => {
    const g = sessionGlance(host([use("a", 0.25, 100 * MB), use("b", 1, 412 * MB)]), { a: session("a"), b: session("b") });
    expect(g).toEqual({ text: "2 sessions, 1.3 cores, 512 MB", queued: 0 });
    expect(sessionGlance(host([use("a", 0, 25 * MB)]), { a: session("a") }).text).toBe("1 session, 0.0 cores, 25 MB");
  });
  test("leaves out a session the sample lists but the UI no longer has", () => {
    expect(sessionGlance(host([use("gone", 2, 900 * MB), use("a", 0, MB)]), { a: session("a") }).text).toBe("1 session, 0.0 cores, 1 MB");
  });
  test("says when nothing runs, and counts the queue", () => {
    expect(sessionGlance(host(), {})).toEqual({ text: "No session is running anything", queued: 0 });
    expect(sessionGlance(host(), { q: session("q", "queued"), r: session("r", "queued") })).toEqual({ text: "Nothing running", queued: 2 });
  });
});

describe("the card's engine marks", () => {
  const work: AccountEntry = { id: "work", engine: "claude", name: "Work" } as AccountEntry;
  test("one per reported engine, in the page's order, ready ones without a note", () => {
    const g = engineGlance(
      { codex: { installed: true, loggedIn: true, account: "me@example.com" }, claude: { installed: true, loggedIn: true, account: "me@example.com" } },
      [],
    );
    expect(g.map((e) => [e.label, e.tone, e.note])).toEqual([
      ["Claude Code", "ok", null],
      ["Codex", "ok", null],
    ]);
    expect(g[0].title).toBe("Claude Code: logged in as me@example.com");
  });
  test("a logged-out engine says so; one not installed is quiet", () => {
    const g = engineGlance({ claude: { installed: true, loggedIn: false }, grok: { installed: false, loggedIn: false } }, []);
    expect(g.map((e) => [e.label, e.tone, e.note])).toEqual([
      ["Claude Code", "warn", "not logged in"],
      ["Grok", "off", null],
    ]);
    expect(g[1].title).toBe("Grok: not installed");
  });
  test("an added account that is logged out makes its engine amber", () => {
    const g = engineGlance({ claude: { installed: true, loggedIn: true }, accounts: { work: { installed: true, loggedIn: false } } }, [work]);
    expect(g[0]).toMatchObject({ tone: "warn", note: "1 account not logged in", title: "Claude Code: logged in (1 account not logged in)" });
    const ok = engineGlance({ claude: { installed: true, loggedIn: true }, accounts: { work: { installed: true, loggedIn: true } } }, [work]);
    expect(ok[0]).toMatchObject({ tone: "ok", note: null });
  });
  test("an unknown state is a warning, not ready", () => {
    expect(engineGlance({ codex: { installed: true, loggedIn: null } }, [])[0]).toMatchObject({ tone: "warn", note: "status unknown" });
  });
});

describe("an engine's state in words", () => {
  test("providers, account, logged out, error", () => {
    expect(stateText({ installed: true, loggedIn: true, providers: ["opencode", "fakeprov"] })).toBe("providers: opencode, fakeprov");
    expect(stateText({ installed: true, loggedIn: true, account: "a@b" })).toBe("logged in as a@b");
    expect(stateText({ installed: true, loggedIn: false })).toBe("not logged in");
    expect(stateText({ installed: false, loggedIn: false })).toBe("not installed");
    expect(stateText({ installed: true, loggedIn: null, error: "timed out" })).toBe("timed out");
  });
});
