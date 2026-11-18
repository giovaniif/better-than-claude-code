import { describe, expect, test } from "bun:test";
import { switchyScope } from "./switchy";

describe("switchyScope", () => {
  const hosts = ["local", "h-devbox"];

  test("keeps the scope picked on the page, else the saved one", () => {
    expect(switchyScope("h-devbox", "local", hosts)).toBe("h-devbox");
    expect(switchyScope(null, "h-devbox", hosts)).toBe("h-devbox");
    expect(switchyScope(null, "local", hosts)).toBe("local");
  });

  test("defaults to every host", () => {
    expect(switchyScope(null, undefined, hosts)).toBe("all");
    expect(switchyScope(null, "all", hosts)).toBe("all");
  });

  // The picker has no option for a host that was removed, so it reads "All
  // hosts" while yardd would refuse the stale id as an unknown host scope.
  test("a saved scope naming a removed host falls back to every host", () => {
    expect(switchyScope(null, "h-gone", hosts)).toBe("all");
    // Removed while the page was open, after picking it here.
    expect(switchyScope("h-gone", "local", hosts)).toBe("all");
  });
});

import { switchyStopped, switchyVoiceCue } from "./switchy";
import type { SwitchyConversation } from "./protocol";

test("Switchy voice reads completed answers and announces approvals, not streaming tokens", () => {
  const state: SwitchyConversation = {
    status: "answering",
    engine: "codex",
    model: "test",
    scope: "all",
    revision: 1,
    turns: [
      {
        id: "q1",
        question: "hi",
        answer: "**Hello**",
        engine: "codex",
        model: "test",
        at: 1,
        status: "answering",
        sources: [],
        coverage: [],
        error: null,
      },
    ],
  };
  expect(switchyVoiceCue(state)).toBeNull();
  state.turns[0].status = "completed";
  expect(switchyVoiceCue(state)?.cue).toEqual({
    kind: "answer",
    text: "Hello",
  });
  state.turns[0].status = "needs_approval";
  state.turns[0].approvals = [
    { requestId: "r1", kind: "command", title: "echo test", detail: "" },
  ];
  expect(switchyVoiceCue(state)?.cue.kind).toBe("approval");
  state.turns[0].status = "failed";
  state.turns[0].error = "Stopped by you.";
  expect(switchyVoiceCue(state)?.cue.kind).toBe("stopped");
});

test("only a turn the user stopped reads as stopped", () => {
  expect(switchyStopped({ error: "Stopped by you." })).toBe(true);
  expect(switchyStopped({ error: "fake failure: the model is unavailable" })).toBe(false);
  expect(switchyStopped({ error: null })).toBe(false);
});
