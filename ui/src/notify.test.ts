import { describe, expect, test } from "bun:test";
import { StatusWatcher, shouldNotify, statusNotice, noticeText } from "./notify";
import type { SessionMeta } from "./protocol";

const on = { enabled: true, focused: false, openSessionId: null as string | null };

describe("statusNotice", () => {
  test("a session that now waits for an approval needs the user", () => {
    expect(statusNotice("running", "needs_approval")).toBe("approval");
  });
  test("a turn that ends is finished", () => {
    expect(statusNotice("running", "idle")).toBe("finished");
    expect(statusNotice("needs_approval", "idle")).toBe("finished");
  });
  test("a failure is reported once", () => {
    expect(statusNotice("running", "error")).toBe("failed");
    expect(statusNotice("error", "error")).toBeNull();
  });
  test("nothing else is worth interrupting for", () => {
    expect(statusNotice("idle", "running")).toBeNull();
    expect(statusNotice("queued", "running")).toBeNull();
    expect(statusNotice("idle", "idle")).toBeNull();
    expect(statusNotice("error", "idle")).toBeNull();
    expect(statusNotice("needs_approval", "needs_approval")).toBeNull();
  });
  test("a session seen for the first time is not news", () => {
    expect(statusNotice(undefined, "idle")).toBeNull();
    expect(statusNotice(undefined, "needs_approval")).toBeNull();
  });
});

describe("shouldNotify", () => {
  test("off means never", () => {
    expect(shouldNotify({ ...on, enabled: false }, "s1")).toBe(false);
  });
  test("an unfocused window always gets it, even on that session", () => {
    expect(shouldNotify({ ...on, focused: false, openSessionId: "s1" }, "s1")).toBe(true);
  });
  test("a focused window showing that session does not", () => {
    expect(shouldNotify({ ...on, focused: true, openSessionId: "s1" }, "s1")).toBe(false);
  });
  test("a focused window on another page or session does", () => {
    expect(shouldNotify({ ...on, focused: true, openSessionId: "s2" }, "s1")).toBe(true);
    expect(shouldNotify({ ...on, focused: true, openSessionId: null }, "s1")).toBe(true);
  });
  test("a note that names no session is never hidden by the open one", () => {
    expect(shouldNotify({ ...on, focused: true, openSessionId: "s1" }, null)).toBe(true);
  });
});

const meta = (id: string, status: SessionMeta["status"]): SessionMeta =>
  ({ id, title: `Task ${id}`, engine: "codex", model: "m", effort: "low", cwd: "/x", status, host: "local", createdAt: 0, updatedAt: 0 }) as SessionMeta;

describe("StatusWatcher", () => {
  test("a snapshot sets the baseline without notifying", () => {
    const w = new StatusWatcher();
    w.seed([meta("a", "running"), meta("b", "needs_approval")]);
    expect(w.change(meta("b", "needs_approval"))).toBeNull();
    expect(w.change(meta("a", "idle"))).toBe("finished");
  });
  test("each change is judged against the one before", () => {
    const w = new StatusWatcher();
    w.seed([meta("a", "idle")]);
    expect(w.change(meta("a", "running"))).toBeNull();
    expect(w.change(meta("a", "needs_approval"))).toBe("approval");
    expect(w.change(meta("a", "running"))).toBeNull();
    expect(w.change(meta("a", "error"))).toBe("failed");
  });
  test("a host reload replaces only that host's baseline", () => {
    const w = new StatusWatcher();
    w.seed([meta("a", "running")]);
    w.seed([{ ...meta("h:1", "running"), host: "h" }], "h");
    // `a` survives the reload of host h; h:1 restarts from its new snapshot.
    expect(w.change(meta("a", "idle"))).toBe("finished");
    expect(w.change({ ...meta("h:1", "running"), host: "h" })).toBeNull();
  });
  test("a failed turn ends idle but is reported as a failure", () => {
    const w = new StatusWatcher();
    w.seed([meta("a", "running")]);
    w.turnEnded("a", "failed");
    expect(w.change(meta("a", "idle"))).toBe("failed");
    // The verdict is for that turn only.
    expect(w.change(meta("a", "running"))).toBeNull();
    w.turnEnded("a", "completed");
    expect(w.change(meta("a", "idle"))).toBe("finished");
  });
  test("a turn the user stopped is not reported", () => {
    const w = new StatusWatcher();
    w.seed([meta("a", "running")]);
    w.turnEnded("a", "interrupted");
    expect(w.change(meta("a", "idle"))).toBeNull();
  });
  test("a deleted session is forgotten", () => {
    const w = new StatusWatcher();
    w.seed([meta("a", "running")]);
    w.forget("a");
    expect(w.change(meta("a", "idle"))).toBeNull();
  });
});

describe("noticeText", () => {
  test("names the session and what it needs", () => {
    expect(noticeText("approval", "Fix login").title).toBe("Fix login");
    expect(noticeText("approval", "Fix login").body).toMatch(/approval/i);
    expect(noticeText("finished", "Fix login").body).toMatch(/finished/i);
    expect(noticeText("failed", "Fix login").body).toMatch(/failed/i);
  });
  test("an untitled session still gets a title", () => {
    expect(noticeText("finished", "").title).toBe("Switchyard");
  });
});
