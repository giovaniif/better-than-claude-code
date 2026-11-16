import { describe, expect, test } from "bun:test";
import { appendToComposer, cleanQuote, onAppend, quoteInComposer, quoteSegments, returnToComposer, SELECTION_CAP, splitQuotes, withQuotes, type Addition } from "./compose";

describe("cleanQuote", () => {
  test("keeps a selection's lines as they are", () => {
    expect(cleanQuote("Run the migration first.\nThen restart.")).toBe("Run the migration first.\nThen restart.");
  });
  test("keeps paragraph breaks, trims the ends", () => {
    expect(cleanQuote("\n  one\n\n\n\ntwo  \n\n")).toBe("  one\n\ntwo");
  });
  test("normalises Windows line ends", () => {
    expect(cleanQuote("a\r\nb")).toBe("a\nb");
  });
  test("cuts a huge selection to the cap", () => {
    expect(cleanQuote("x".repeat(SELECTION_CAP + 500)).length).toBe(SELECTION_CAP);
  });
  test("nothing selected quotes nothing", () => {
    expect(cleanQuote("  \n ")).toBe("");
  });
});

describe("withQuotes", () => {
  test("each quote becomes a Markdown blockquote before the reply, a blank line apart", () => {
    expect(withQuotes(["Run the migration first.\nThen restart.", "Use the flag."], "Why both?")).toBe(
      "> Run the migration first.\n> Then restart.\n\n> Use the flag.\n\nWhy both?",
    );
  });
  test("a blank line inside a quote stays inside it", () => {
    expect(withQuotes(["one\n\ntwo"], "ok")).toBe("> one\n>\n> two\n\nok");
  });
  test("no quotes sends the text as typed", () => {
    expect(withQuotes([], "hi")).toBe("hi");
  });
  test("quotes alone are the whole message", () => {
    expect(withQuotes(["a", "b"], "")).toBe("> a\n\n> b");
  });
});

describe("splitQuotes", () => {
  test("takes the leading blockquotes back out as quotes", () => {
    expect(splitQuotes("> Run the migration first.\n> Then restart.\n\n> Use the flag.\n\nWhy both?")).toEqual({
      quotes: ["Run the migration first.\nThen restart.", "Use the flag."],
      text: "Why both?",
    });
  });
  test("round-trips what withQuotes sends", () => {
    const quotes = ["one\n\ntwo", "  indented", "> nested"];
    expect(splitQuotes(withQuotes(quotes, "reply\n> not a leading quote"))).toEqual({ quotes, text: "reply\n> not a leading quote" });
  });
  test("a quote with no space after > still counts", () => {
    expect(splitQuotes(">a\n>b\n\nok")).toEqual({ quotes: ["a\nb"], text: "ok" });
  });
  test("quotes alone leave no text", () => {
    expect(splitQuotes("> a\n\n> b")).toEqual({ quotes: ["a", "b"], text: "" });
  });
  test("a quote that runs straight into text stays text", () => {
    expect(splitQuotes("> a\nreply")).toEqual({ quotes: [], text: "> a\nreply" });
  });
  test("a message without quotes is all text", () => {
    expect(splitQuotes("plain\n\n> later")).toEqual({ quotes: [], text: "plain\n\n> later" });
  });
});

describe("quoteSegments", () => {
  test("splits a sent message into its quotes and its text", () => {
    expect(quoteSegments("> Run the migration first.\n> Then restart.\n\n> Use the flag.\n\nWhy both?")).toEqual([
      { quote: true, text: "Run the migration first.\nThen restart." },
      { quote: true, text: "Use the flag." },
      { quote: false, text: "Why both?" },
    ]);
  });
  test("a quote in the middle of a message", () => {
    expect(quoteSegments("About this:\n> a\n>\n> b\nand that.")).toEqual([
      { quote: false, text: "About this:" },
      { quote: true, text: "a\n\nb" },
      { quote: false, text: "and that." },
    ]);
  });
  test("plain text is one segment, untouched", () => {
    expect(quoteSegments("one\n\n  two")).toEqual([{ quote: false, text: "one\n\n  two" }]);
  });
  test("> inside a fenced block is not a quote", () => {
    const text = "Output:\n```\n$ echo \\\n> hi\n```";
    expect(quoteSegments(text)).toEqual([{ quote: false, text }]);
  });
});

describe("composer additions", () => {
  const listen = (sessionId: string) => {
    const got: Addition[] = [];
    const stop = onAppend(sessionId, (a) => got.push(a));
    return { got, stop };
  };
  test("a quoted selection arrives as a quote, not as text", () => {
    const { got, stop } = listen("s1");
    quoteInComposer("s1", "\nRun the migration first.\n");
    quoteInComposer("s1", "   ");
    stop();
    expect(got).toEqual([{ quotes: ["Run the migration first."] }]);
  });
  test("terminal text arrives as text", () => {
    const { got, stop } = listen("s2");
    appendToComposer("s2", "```\nls\n```\n");
    stop();
    expect(got).toEqual([{ text: "```\nls\n```\n" }]);
  });
  test("a message given back for editing brings its quotes back as quotes", () => {
    const { got, stop } = listen("s3");
    returnToComposer("s3", "> Use the flag.\n\nWhy?");
    stop();
    expect(got).toEqual([{ quotes: ["Use the flag."], text: "Why?" }]);
  });
  test("only the session's own composer hears it", () => {
    const { got, stop } = listen("s4");
    quoteInComposer("other", "x");
    stop();
    expect(got).toEqual([]);
  });
});
