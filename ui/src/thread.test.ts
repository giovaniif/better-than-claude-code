import { describe, expect, test } from "bun:test";
import { applyEvent, type AgentEvent, type Item } from "./protocol";
import type { SessionMeta } from "./protocol";
import { duration, handoffLinks, layout, summarize, thoughtLine, type ToolItem, type WorkItem } from "./thread";

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
  test("a steered message splits its turn, and each part has its own duration", () => {
    const items = fold([
      { type: "user_message", text: "do it" },
      { type: "turn_started", at: 1_000 },
      { type: "tool_started", itemId: "a", kind: "command", title: "Ran", detail: "one" },
      { type: "tool_completed", itemId: "a", ok: true },
      { type: "user_message", text: "and this", steered: true, at: 4_000 },
      { type: "tool_started", itemId: "b", kind: "command", title: "Ran", detail: "two" },
      { type: "tool_completed", itemId: "b", ok: true },
      { type: "assistant_message", itemId: "m", text: "Done." },
      { type: "turn_completed", status: "completed", at: 9_000 },
    ]);
    const folds = layout(items, false).filter((r) => r.type === "fold") as Extract<ReturnType<typeof layout>[number], { type: "fold" }>[];
    expect(folds.map((f) => f.ms)).toEqual([3_000, 5_000]);
  });

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

describe("subagents", () => {
  const AGENT = "toolu_agent";
  const agentTurn: AgentEvent[] = [
    { type: "user_message", text: "survey it" },
    { type: "turn_started", at: 1_000 },
    { type: "tool_started", itemId: AGENT, kind: "other", title: "Agent", detail: "survey the repo", agent: "general-purpose" },
    { type: "tool_started", itemId: "c1", parent: AGENT, kind: "read", title: "Read", detail: "README.md" },
    { type: "tool_completed", itemId: "c1", ok: true, output: "# readme" },
    { type: "tool_started", itemId: "c2", parent: AGENT, kind: "command", title: "Ran", detail: "ls src" },
  ];
  const tool = (rows: ReturnType<typeof layout>, i = 0) => {
    const row = rows.find((r) => r.type === "work");
    if (row?.type !== "work") throw new Error("no work row");
    return row.entries[i] as ToolItem;
  };

  test("a subagent's steps nest under its Agent call, not in the work list", () => {
    const rows = layout(fold(agentTurn), true);
    expect(shape(rows)).toEqual(["user", "work(1,live)"]);
    const agent = tool(rows);
    expect(agent.agent).toBe("general-purpose");
    expect(agent.steps?.map((s) => [s.detail, s.state])).toEqual([
      ["README.md", "ok"],
      ["ls src", "running"],
    ]);
    expect(agent.steps?.every((s) => s.parent === AGENT)).toBe(true);
  });

  test("steps nest as deep as the subagents do", () => {
    const rows = layout(
      fold([
        ...agentTurn,
        { type: "tool_started", itemId: "inner", parent: AGENT, kind: "other", title: "Agent", detail: "dig", agent: "Explore" },
        { type: "tool_started", itemId: "deep", parent: "inner", kind: "search", title: "Searched", detail: "TODO" },
      ]),
      true,
    );
    const inner = tool(rows).steps?.find((s) => s.itemId === "inner");
    expect(inner?.steps?.map((s) => s.detail)).toEqual(["TODO"]);
  });

  test("a step whose Agent call is not in the turn stays an ordinary entry", () => {
    const rows = layout(fold([agentTurn[0], agentTurn[1], agentTurn[3]]), true);
    expect(shape(rows)).toEqual(["user", "work(1,live)"]);
    expect(tool(rows).title).toBe("Read");
  });

  test("steps do not count as work in the summary", () => {
    const rows = layout(fold([...agentTurn, { type: "tool_completed", itemId: AGENT, ok: true, output: "done", ms: 2_000 }, { type: "turn_completed", status: "completed", at: 5_000 }]), false);
    const row = rows.find((r) => r.type === "fold");
    expect(row?.type === "fold" && row.summary).toBe("1 other step");
  });

  test("an agent still running when the turn ends stays out of the fold, running", () => {
    const items = fold([
      ...agentTurn.slice(0, 5),
      { type: "assistant_message", itemId: "m", text: "Launched it." },
      { type: "turn_completed", status: "completed", at: 5_000 },
    ]);
    const rows = layout(items, false);
    expect(shape(rows)).toEqual(["user", "work(1)", "assistant"]);
    expect(tool(rows).state).toBe("running");
  });
});

describe("handoffLinks", () => {
  const meta = (id: string, extra: Partial<SessionMeta> = {}): SessionMeta =>
    ({ id, title: "T", engine: "codex", model: "m", effort: "low", cwd: "/w", status: "idle", host: "local", createdAt: 0, updatedAt: 0, ...extra }) as SessionMeta;
  const note = (key: string, text: string): Item => ({ kind: "note", key, text });

  test("the source's note links to the session it handed off to, in order", () => {
    const src = meta("s1");
    const first = meta("s2", { parent: "s1", engine: "claude", createdAt: 10 });
    const second = meta("s3", { parent: "s1", engine: "claude", createdAt: 20 });
    const items = [note("e1", "Handed off to Claude."), { kind: "user", key: "e2", text: "more" } as Item, note("e3", "Handed off to Claude.")];
    const links = handoffLinks(items, src, { s1: src, s3: second, s2: first });
    expect(links).toEqual({ e1: "s2", e3: "s3" });
  });

  test("the new session's note links back to its source", () => {
    const src = meta("h1~s1");
    const child = meta("h1~s2", { parent: "h1~s1", engine: "claude" });
    expect(handoffLinks([note("e0", "Handed off from Codex.")], child, { "h1~s1": src, "h1~s2": child })).toEqual({ e0: "h1~s1" });
  });

  test("a note that names its session links there, even after an earlier child was deleted", () => {
    const src = meta("s1");
    const second = meta("s3", { parent: "s1", engine: "claude", createdAt: 20 });
    const items = fold([
      { type: "note", text: "Handed off to Claude.", session: "s2" },
      { type: "note", text: "Handed off to Claude.", session: "s3" },
    ]);
    // s2 is gone: its note gets no link and does not take s3's.
    expect(handoffLinks(items, src, { s1: src, s3: second })).toEqual({ [items[1].key]: "s3" });
  });

  test("the new session's note links to the session it names", () => {
    const src = meta("s1");
    const child = meta("s2", { parent: "s1", engine: "claude" });
    const items = fold([{ type: "note", text: "Handed off from Codex.", session: "s1" }]);
    expect(handoffLinks(items, child, { s1: src, s2: child })).toEqual({ [items[0].key]: "s1" });
  });

  test("no link to a session that is gone, and other notes stay plain", () => {
    const child = meta("s2", { parent: "s1" });
    expect(handoffLinks([note("e0", "Handed off from Codex."), note("e1", "Something else.")], child, { s2: child })).toEqual({});
  });
});
