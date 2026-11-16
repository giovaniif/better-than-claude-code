import { describe, expect, test } from "bun:test";
import type { ProcRow } from "./protocol";
import { procSummary, procTree, shortCommand } from "./procs";

const row = (pid: number, ppid: number, cmd: string, extra: Partial<ProcRow> = {}): ProcRow => ({
  pid,
  ppid,
  name: cmd.split(" ")[0],
  cmd,
  cpu: 0,
  memBytes: 0,
  ageSecs: 1,
  origin: "agent",
  ...extra,
});

describe("procTree", () => {
  test("parents come before their children, children by pid, with their depth", () => {
    const rows = [row(30, 20, "sleep 30"), row(20, 10, "claude"), row(10, 1, "bun main.ts"), row(25, 20, "bash -c ls")];
    expect(procTree(rows).map((r) => [r.row.pid, r.depth])).toEqual([
      [10, 0],
      [20, 1],
      [25, 2],
      [30, 2],
    ]);
  });

  test("a process whose parent is not listed is a root; separate trees follow each other", () => {
    const rows = [row(50, 9, "zsh", { origin: "terminal" }), row(10, 1, "bun main.ts"), row(11, 10, "claude")];
    expect(procTree(rows).map((r) => [r.row.pid, r.depth])).toEqual([
      [10, 0],
      [11, 1],
      [50, 0],
    ]);
  });

  test("a parent loop cannot hang it", () => {
    expect(procTree([row(1, 2, "a"), row(2, 1, "b")]).length).toBe(2);
  });
});

describe("shortCommand", () => {
  test("long absolute paths shrink to their last segment, the rest stays", () => {
    expect(shortCommand("/home/giovani/.bun/bin/bun run /home/giovani/code/app/sidecar/main.ts --flag")).toBe("bun run main.ts --flag");
    expect(shortCommand("sleep 30")).toBe("sleep 30");
    expect(shortCommand("ls /tmp")).toBe("ls /tmp");
  });

  test("whitespace collapses and a long line is cut with an ellipsis", () => {
    expect(shortCommand("a   b\n c")).toBe("a b c");
    const long = shortCommand(`node ${"x".repeat(200)}`, 40);
    expect(long.length).toBe(40);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("procSummary", () => {
  test("counts processes and adds up CPU and memory", () => {
    const rows = [row(1, 0, "a", { cpu: 50, memBytes: 100 * 1024 ** 2 }), row(2, 1, "b", { cpu: 25, memBytes: 1.5 * 1024 ** 3 })];
    expect(procSummary(rows)).toBe("2 processes · 75% CPU · 1.6 GB");
    expect(procSummary([rows[0]])).toBe("1 process · 50% CPU · 100 MB");
    expect(procSummary([])).toBe("No processes");
  });
});
