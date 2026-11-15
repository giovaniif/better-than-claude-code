import { describe, expect, test } from "bun:test";
import { quoted, SELECTION_CAP } from "./compose";

describe("quoted", () => {
  test("quotes each line of a selection, then leaves a blank line for the reply", () => {
    expect(quoted("Run the migration first.\nThen restart.")).toBe("> Run the migration first.\n> Then restart.\n\n");
  });
  test("keeps paragraph breaks inside the quote, trims the ends", () => {
    expect(quoted("\n  one\n\n\n\ntwo  \n\n")).toBe(">   one\n>\n> two\n\n");
  });
  test("normalises Windows line ends", () => {
    expect(quoted("a\r\nb")).toBe("> a\n> b\n\n");
  });
  test("cuts a huge selection to the cap", () => {
    const out = quoted("x".repeat(SELECTION_CAP + 500));
    expect(out.length).toBe(2 + SELECTION_CAP + 2);
  });
  test("nothing selected quotes nothing", () => {
    expect(quoted("  \n ")).toBe("");
  });
});
