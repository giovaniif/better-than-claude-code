import { describe, expect, test } from "bun:test";
import { applyEvent, type AgentEvent, type Item } from "./protocol";

/** Fold events in order, numbering them as yardd does. */
const fold = (events: AgentEvent[], items: Item[] = [], first = 0): Item[] =>
  events.reduce((acc, ev, i) => applyEvent(acc, ev, first + i), items);

describe("applyEvent", () => {
  test("deltas accumulate on one item, then the final message settles it", () => {
    const items = fold([
      { type: "user_message", text: "hi" },
      { type: "turn_started" },
      { type: "assistant_delta", itemId: "m1", text: "Hel" },
      { type: "assistant_delta", itemId: "m1", text: "lo" },
    ]);
    expect(items).toEqual([
      { kind: "user", key: "e0", text: "hi" },
      { kind: "assistant", key: "e2", itemId: "m1", text: "Hello", streaming: true },
    ]);

    // The final text wins over what was streamed, and the item keeps its key.
    const done = applyEvent(items, { type: "assistant_message", itemId: "m1", text: "Hello!" }, 4);
    expect(done[1]).toEqual({ kind: "assistant", key: "e2", itemId: "m1", text: "Hello!", streaming: false });
    expect(done).toHaveLength(2);
  });

  test("a final message with no deltas is its own item", () => {
    const items = fold([{ type: "assistant_message", itemId: "m9", text: "Done." }]);
    expect(items).toEqual([{ kind: "assistant", key: "e0", itemId: "m9", text: "Done.", streaming: false }]);
  });

  test("deltas of two items stay apart", () => {
    const items = fold([
      { type: "assistant_delta", itemId: "a", text: "one" },
      { type: "assistant_delta", itemId: "b", text: "two" },
      { type: "assistant_delta", itemId: "a", text: "+" },
    ]);
    expect(items.map((i) => (i.kind === "assistant" ? i.text : ""))).toEqual(["one+", "two"]);
  });

  test("does not mutate the list it was given", () => {
    const before = fold([{ type: "assistant_delta", itemId: "m", text: "a" }]);
    const snapshot = structuredClone(before);
    applyEvent(before, { type: "assistant_delta", itemId: "m", text: "b" }, 1);
    applyEvent(before, { type: "turn_completed", status: "completed" }, 1);
    expect(before).toEqual(snapshot);
  });

  test("a tool starts running and completes ok or failed", () => {
    const started = fold([
      { type: "tool_started", itemId: "t1", kind: "command", title: "Ran", detail: "ls" },
      { type: "tool_started", itemId: "t2", kind: "command", title: "Ran", detail: "false" },
    ]);
    expect(started[0]).toMatchObject({ kind: "tool", itemId: "t1", toolKind: "command", detail: "ls", state: "running" });

    const done = fold(
      [
        { type: "tool_completed", itemId: "t1", ok: true, output: "a\nb\n" },
        { type: "tool_completed", itemId: "t2", ok: false },
      ],
      started,
      2,
    );
    expect(done[0]).toMatchObject({ state: "ok", output: "a\nb\n" });
    expect(done[1]).toMatchObject({ state: "failed", output: null });
  });

  test("an approval is asked, then resolved", () => {
    const asked = fold([{ type: "approval_request", requestId: "r1", kind: "command", title: "rm x", detail: "why" }]);
    expect(asked).toEqual([
      { kind: "approval", key: "e0", requestId: "r1", approvalKind: "command", title: "rm x", detail: "why", decision: null },
    ]);
    const resolved = applyEvent(asked, { type: "approval_resolved", requestId: "r1", decision: "allow_always" }, 1);
    expect(resolved[0]).toMatchObject({ decision: "allow_always" });
    // A resolve for another request changes nothing.
    expect(applyEvent(asked, { type: "approval_resolved", requestId: "r2", decision: "deny" }, 1)).toEqual(asked);
  });

  test("turn end closes whatever is still live", () => {
    const live = fold([
      { type: "assistant_delta", itemId: "m", text: "part" },
      { type: "tool_started", itemId: "t", kind: "command", title: "Ran", detail: "sleep 9" },
      { type: "approval_request", requestId: "r", kind: "edit", title: "Apply", detail: "" },
      { type: "tool_started", itemId: "t2", kind: "command", title: "Ran", detail: "true" },
      { type: "tool_completed", itemId: "t2", ok: true },
    ]);
    const ended = applyEvent(live, { type: "turn_completed", status: "interrupted" }, 5);
    expect(ended[0]).toMatchObject({ kind: "assistant", text: "part", streaming: false });
    expect(ended[1]).toMatchObject({ kind: "tool", state: "failed" });
    expect(ended[2]).toMatchObject({ kind: "approval", decision: "deny" });
    // A tool that already finished stays ok.
    expect(ended[3]).toMatchObject({ kind: "tool", state: "ok" });
    expect(ended).toHaveLength(4);
  });

  test("file changes become a diff item, unless there are none", () => {
    const files = [{ path: "src/lib.rs", diff: "+x", kind: "update" }];
    expect(fold([{ type: "file_change", itemId: "f", files }])).toEqual([{ kind: "diff", key: "e0", files }]);
    expect(fold([{ type: "file_change", itemId: "f", files: [] }])).toEqual([]);
  });

  test("queued, note and error lines", () => {
    const items = fold([
      { type: "user_message", text: "task" },
      { type: "queued", reason: "load 9.0 is above 8 cores", text: "task" },
      { type: "note", text: "Handed off from Codex." },
      { type: "error", message: "boom" },
    ]);
    expect(items.slice(1)).toEqual([
      { kind: "queued", key: "e1", reason: "load 9.0 is above 8 cores" },
      { kind: "note", key: "e2", text: "Handed off from Codex." },
      { kind: "error", key: "e3", message: "boom" },
    ]);
  });

  test("a prompt keeps its attachments, and may have no text", () => {
    const shot = { id: "a1", name: "shot.png", mime: "image/png", size: 300, path: "/d/attachments/a1/shot.png" };
    const items = fold([
      { type: "user_message", text: "look", attachments: [shot] },
      { type: "user_message", text: "", attachments: [shot] },
      { type: "user_message", text: "plain", attachments: [] },
    ]);
    expect(items).toEqual([
      { kind: "user", key: "e0", text: "look", attachments: [shot] },
      { kind: "user", key: "e1", text: "", attachments: [shot] },
      { kind: "user", key: "e2", text: "plain" },
    ]);
  });

  test("events with no item, such as turn_started, add nothing", () => {
    expect(fold([{ type: "turn_started" }])).toEqual([]);
    expect(applyEvent([], { type: "mystery" } as unknown as AgentEvent, 0)).toEqual([]);
  });
});
