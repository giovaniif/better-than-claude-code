import { describe, expect, test } from "bun:test";
import { splitRow, tableSegments } from "./markdown";

describe("splitRow", () => {
  test("drops the outer pipes and trims cells", () => {
    expect(splitRow("| a | b |")).toEqual(["a", "b"]);
    expect(splitRow("a|b")).toEqual(["a", "b"]);
  });
  test("keeps escaped pipes and pipes in inline code", () => {
    expect(splitRow("| a \\| b | `x | y` |")).toEqual(["a | b", "`x | y`"]);
  });
  test("keeps empty cells", () => {
    expect(splitRow("| a | | c |")).toEqual(["a", "", "c"]);
  });
});

describe("tableSegments", () => {
  test("a table with alignments, short and long rows", () => {
    const segs = tableSegments(["| File | Result | Note |", "|---|:---:|--:|", "| a.ts | pass |", "| b.ts | fail | x | extra |"]);
    expect(segs).toEqual([
      {
        kind: "table",
        table: {
          header: ["File", "Result", "Note"],
          align: [null, "center", "right"],
          rows: [
            ["a.ts", "pass", ""],
            ["b.ts", "fail", "x"],
          ],
        },
      },
    ]);
  });
  test("text right before and after a table stays text", () => {
    const segs = tableSegments(["Results:", "| a | b |", "| - | - |", "| 1 | 2 |", "That is all."]);
    expect(segs.map((s) => s.kind)).toEqual(["text", "table", "text"]);
    expect(segs[0]).toEqual({ kind: "text", lines: ["Results:"] });
    expect(segs[2]).toEqual({ kind: "text", lines: ["That is all."] });
  });
  test("a pipe in prose is not a table", () => {
    expect(tableSegments(["use a | b to pipe", "then run it"])).toEqual([{ kind: "text", lines: ["use a | b to pipe", "then run it"] }]);
    expect(tableSegments(["a | b", "---"])).toEqual([{ kind: "text", lines: ["a | b", "---"] }]);
  });
  test("a delimiter row with another number of cells is not a table", () => {
    expect(tableSegments(["| a | b |", "|---|"]).every((s) => s.kind === "text")).toBe(true);
  });
  test("a header without body rows is still a table", () => {
    expect(tableSegments(["| a | b |", "|---|---|"])).toEqual([{ kind: "table", table: { header: ["a", "b"], align: [null, null], rows: [] } }]);
  });
});
