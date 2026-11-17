import { describe, expect, test } from "bun:test";
import type { SessionMeta } from "./protocol";
import { navigationEntries, navigationShortcut } from "./navigation";

const session = (id: string, patch: Partial<SessionMeta> = {}): SessionMeta => ({
  id, title: id, engine: "codex", model: "m", effort: "low", cwd: "/work/app", status: "idle", host: "local", createdAt: 0, updatedAt: 0, ...patch,
});
const context = { localName: "This Mac", hosts: [{ id: "remote", name: "Dev box" }] };

describe("navigationEntries", () => {
  test("recent sessions come first, followed by every page and Import", () => {
    const entries = navigationEntries([session("old"), session("new", { updatedAt: 5 })], context, "");
    expect(entries.slice(0, 2).map((e) => e.title)).toEqual(["new", "old"]);
    expect(entries.filter((e) => e.group === "Pages").map((e) => e.title)).toEqual(["New session", "Automations", "Connectors", "Settings", "Hosts", "Import"]);
  });
  test("search includes archived sessions and runs, matching every word across metadata", () => {
    const s = session("investigation", { host: "remote", archived: true, automation: "a", branch: "fix/login", group: "Backend" });
    expect(navigationEntries([s], context, "DEV login backend")[0]?.route).toEqual({ page: "session", id: "investigation" });
    expect(navigationEntries([s], context, "login absent")).toEqual([]);
    expect(navigationEntries([s], context, "archived")[0]?.title).toBe("investigation");
  });
  test("page searches put matching destinations ahead of similarly named sessions", () => {
    const entries = navigationEntries([session("Settings work")], context, "settings");
    expect(entries[0].route).toEqual({ page: "settings" });
    expect(entries[1].route).toEqual({ page: "session", id: "Settings work" });
    expect(navigationEntries([], context, "import")[0].action).toBe("import");
  });
  test("the recent list is bounded, but search finds older sessions", () => {
    const sessions = Array.from({ length: 20 }, (_, i) => session(`session-${i}`, { updatedAt: i }));
    expect(navigationEntries(sessions, context, "").filter((e) => e.group === "Sessions")).toHaveLength(8);
    expect(navigationEntries(sessions, context, "session-0")[0].title).toBe("session-0");
  });
});

test("navigation shortcut preserves Mac Ctrl+K, modifiers, repeats and composition", () => {
  const key = { key: "k", metaKey: true, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, isComposing: false };
  expect(navigationShortcut(key, true)).toBe(true);
  expect(navigationShortcut({ ...key, metaKey: false, ctrlKey: true }, false)).toBe(true);
  expect(navigationShortcut({ ...key, metaKey: false, ctrlKey: true }, true)).toBe(false);
  for (const patch of [{ shiftKey: true }, { altKey: true }, { repeat: true }, { isComposing: true }, { key: "j" }]) {
    expect(navigationShortcut({ ...key, ...patch }, true)).toBe(false);
  }
});
