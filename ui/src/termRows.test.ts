import { describe, expect, test } from "bun:test";
import { joinRows, pickRows } from "./termRows";

const row = (text: string, wrapped = false) => ({ text, wrapped });

describe("joinRows", () => {
  test("wrapped rows join their line; others start a new one", () => {
    expect(joinRows([row("$ echo aaaa"), row("aaaa", true), row("aaaaaaaa")])).toBe("$ echo aaaaaaaa\naaaaaaaa");
  });
  test("trailing blank rows (the empty screen below a prompt) are dropped, inner ones kept", () => {
    expect(joinRows([row("a"), row(""), row("b"), row(""), row("   ")])).toBe("a\n\nb");
  });
  test("trailing spaces on a row are trimmed", () => {
    expect(joinRows([row("a   "), row("b ")])).toBe("a\nb");
  });
  test("nothing but blanks is empty", () => {
    expect(joinRows([row(""), row(" ")])).toBe("");
  });
});

describe("pickRows", () => {
  const buffer = { length: 10, viewportY: 4, rows: 3 };
  test("the screen is the rows in view", () => {
    expect(pickRows(buffer, { kind: "screen" })).toEqual([4, 7]);
  });
  test("the last n lines end at the buffer's end, never before its start", () => {
    expect(pickRows(buffer, { kind: "last", n: 3 })).toEqual([7, 10]);
    expect(pickRows(buffer, { kind: "last", n: 100 })).toEqual([0, 10]);
  });
});
