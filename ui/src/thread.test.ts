import { describe, expect, test } from "bun:test";
import { applyEvent, type AgentEvent, type Item } from "./protocol";
import { duration, layout, summarize, thoughtLine, type WorkItem } from "./thread";

const fold = (events: AgentEvent[]): Item[] => events.reduce((acc, ev, i) => applyEvent(acc, ev, i), [] as Item[]);
const shape = (rows: ReturnType<typeof layout>) =>
  rows.map((r) => (r.type === "item" ? r.item.kind : r.type === "work" ? `work(${r.entries.length}${r.live ? ",live" : ""})` : `fold(${r.summary})`));

const turn: AgentEvent[] = [
  { type: "user_message", text: "fix it" },
  { type: "turn_started", at: 1_000 },
  { type: "reasoning", itemId: "r", text: "**Reproducing first** then fixing" },
  { type: "tool_started", itemId: "t1", kind: "command", title: "Ran", detail: "cargo test" },
  { type: "tool_completed", itemId: "t1", ok: false },
  { type: "assistant_message", itemId: "m1", text: "It fails; looking." },
  { type: "tool_started", itemId: "t2", kind: "read", title: "Read", detail: "src/a.rs" },
  { type: "tool_completed", itemId: "t2", ok: true },
  { type: "tool_started", itemId: "t3", kind: "read", title: "Read", detail: "src/b.rs" },
  { type: "tool_completed", itemId: "t3", ok: true },
  { type: "assistant_message", itemId: "m2", text: "Fixed." },
];

describe("layout", () => {
  test("a live turn groups work between messages, the last group live", () => {
    const items = fold(turn.slice(0, 9));
    expect(shape(layout(items, true))).toEqual(["user", "work(2)", "assistant", "work(2,live)"]);
  });

  test("a finished turn folds its work above the answer, with its duration", () => {
    const items = fold([...turn, { type: "turn_completed", status: "completed", at: 73_000 }]);
    const rows = layout(items, false);
    expect(shape(rows)).toEqual(["user", "fold(Read 2 files, ran 1 command · 1 failed)", "assistant"]);
    const f = rows[1];
    expect(f.type === "fold" && f.ms).toBe(72_000);
    expect(f.type === "fold" && shape(f.rows)).toEqual(["work(2)", "assistant", "work(2)"]);
  });

  test("a turn with no tools is left alone, and errors stay in view", () => {
    const items = fold([
      { type: "user_message", text: "hi" },
      { type: "assistant_message", itemId: "m", text: "Hello" },
      { type: "user_message", text: "run it" },
      { type: "tool_started", itemId: "t", kind: "command", title: "Ran", detail: "x" },
      { type: "error", message: "boom" },
      { type: "turn_completed", status: "failed" },
    ]);
    expect(shape(layout(items, false))).toEqual(["user", "assistant", "user", "fold(Ran 1 command · 1 failed)", "error"]);
  });
});

describe("labels", () => {
  test("a thought's line is its heading or first sentence", () => {
    expect(thoughtLine("**Checking the retry loop**\n\nThe backoff…")).toBe("Checking the retry loop");
    expect(thoughtLine("The test is flaky. It depends on time.")).toBe("The test is flaky.");
  });

  test("summaries count the two biggest kinds", () => {
    const t = (toolKind: string): WorkItem => ({ kind: "tool", key: toolKind + Math.random(), itemId: "", toolKind, title: "", detail: "", state: "ok" });
    expect(summarize([t("read"), t("read"), t("read"), t("command"), t("search")])).toBe("Read 3 files, ran 1 command");
    expect(summarize([{ kind: "reasoning", key: "r", itemId: "r", text: "", streaming: false }])).toBe("Thought");
  });

  test("durations", () => {
    expect(duration(45_000)).toBe("45s");
    expect(duration(72_000)).toBe("1m 12s");
    expect(duration(7_380_000)).toBe("2h 3m");
  });
});
