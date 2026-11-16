import { describe, expect, test } from "bun:test";
import type { SessionMeta } from "./protocol";
import { dropUpdate } from "./sidebarDrop";

const meta = (over: Partial<SessionMeta> = {}): SessionMeta => ({
  id: "s",
  title: "s",
  engine: "codex",
  model: "m",
  effort: "low",
  cwd: "/w",
  status: "idle",
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("dropUpdate", () => {
  test("an ungrouped session dropped on a group joins it", () => {
    expect(dropUpdate(meta(), { kind: "group", name: "Release" })).toEqual({ group: "Release" });
  });

  test("a session moves from one group to another", () => {
    expect(dropUpdate(meta({ group: "Release" }), { kind: "group", name: "Docs" })).toEqual({ group: "Docs" });
  });

  test("dropping on its own group sends nothing", () => {
    expect(dropUpdate(meta({ group: "Release" }), { kind: "group", name: "Release" })).toBeNull();
  });

  test("a pinned session dropped on a group is unpinned, so it shows in the group", () => {
    expect(dropUpdate(meta({ pinned: true }), { kind: "group", name: "Release" })).toEqual({ group: "Release", pinned: false });
    // Pinned and already named: the group stays, only the pin goes.
    expect(dropUpdate(meta({ pinned: true, group: "Release" }), { kind: "group", name: "Release" })).toEqual({ pinned: false });
  });

  test("dropping on Sessions takes it out of its group", () => {
    expect(dropUpdate(meta({ group: "Release" }), { kind: "ungrouped" })).toEqual({ group: null });
  });

  test("dropping a pinned session on Sessions unpins it, and ungroups it if it had a group", () => {
    expect(dropUpdate(meta({ pinned: true }), { kind: "ungrouped" })).toEqual({ pinned: false });
    expect(dropUpdate(meta({ pinned: true, group: "Release" }), { kind: "ungrouped" })).toEqual({ group: null, pinned: false });
  });

  test("an ungrouped session dropped on Sessions sends nothing", () => {
    expect(dropUpdate(meta(), { kind: "ungrouped" })).toBeNull();
    expect(dropUpdate(meta({ group: null }), { kind: "ungrouped" })).toBeNull();
  });

  test("dropping on Pinned pins it and keeps its group", () => {
    expect(dropUpdate(meta({ group: "Release" }), { kind: "pinned" })).toEqual({ pinned: true });
    expect(dropUpdate(meta({ pinned: true }), { kind: "pinned" })).toBeNull();
  });

  test("archived sessions are not moved by a drop", () => {
    expect(dropUpdate(meta({ archived: true }), { kind: "group", name: "Release" })).toBeNull();
    expect(dropUpdate(meta({ archived: true, group: "Release" }), { kind: "ungrouped" })).toBeNull();
    expect(dropUpdate(meta({ archived: true }), { kind: "pinned" })).toBeNull();
  });

  test("a group name is trimmed like the menu's; a blank one is no target", () => {
    expect(dropUpdate(meta(), { kind: "group", name: "  Release " })).toEqual({ group: "Release" });
    expect(dropUpdate(meta({ group: "Release" }), { kind: "group", name: " Release" })).toBeNull();
    expect(dropUpdate(meta(), { kind: "group", name: "   " })).toBeNull();
  });
});
