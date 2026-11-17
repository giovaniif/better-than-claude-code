import { describe, expect, test } from "bun:test";
import { ENGINES, ENGINE_INSTALL, ENGINE_LABEL, ENGINE_LOGIN, ENGINE_NAME, pickerEngines, queuedHint, reviewEngine } from "./engines";
import type { ModelInfo, Models } from "./protocol";

const m = (id: string): ModelInfo => ({ id, name: id, efforts: [] });

describe("engines", () => {
  test("every engine has a name, a label, an install and a login hint", () => {
    for (const e of ENGINES) {
      expect(ENGINE_NAME[e]).toBeTruthy();
      expect(ENGINE_LABEL[e]).toBeTruthy();
      expect(ENGINE_INSTALL[e]).toBeTruthy();
      expect(ENGINE_LOGIN[e]).toBeTruthy();
    }
  });

  test("a queued message says when the agent gets it: mid-turn on Claude and Codex, next turn on OpenCode and Grok", () => {
    expect(queuedHint("claude")).toBe("the agent reads it after its current step");
    expect(queuedHint("codex")).toBe("the agent reads it after its current step");
    expect(queuedHint("opencode")).toBe("sent when the current turn ends");
    expect(queuedHint("grok")).toBe("sent when the current turn ends");
  });

  test("Claude and Codex are always offered, the session's engine first", () => {
    const none: Models = {};
    expect(pickerEngines(none)).toEqual(["claude", "codex"]);
    expect(pickerEngines(none, "codex")).toEqual(["codex", "claude"]);
  });

  test("OpenCode and Grok are offered only where their host lists models for them", () => {
    expect(pickerEngines({ grok: [m("g")] })).toEqual(["claude", "codex", "grok"]);
    expect(pickerEngines({ opencode: [m("o")], grok: [] }, "opencode")).toEqual(["opencode", "claude", "codex"]);
  });

  test("work on OpenCode or Grok is reviewed by Claude, else whoever has models", () => {
    expect(reviewEngine("opencode", { claude: [m("c")], grok: [m("g")] })).toBe("claude");
    expect(reviewEngine("grok", { opencode: [m("o")] })).toBe("opencode");
  });

  test("Claude and Codex review each other", () => {
    const both: Models = { claude: [m("c")], codex: [m("x")] };
    expect(reviewEngine("claude", both)).toBe("codex");
    expect(reviewEngine("codex", both)).toBe("claude");
    // No Codex models on the host: nobody else to ask.
    expect(reviewEngine("claude", { claude: [m("c")] })).toBeNull();
  });
});
