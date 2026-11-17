import { expect, test } from "bun:test";
import { folderBusy, reviewPrompt } from "./PrPane";
import type { SessionMeta } from "./protocol";

test("a review names the base yardd found, with or without a PR to read", () => {
  expect(reviewPrompt({ none: true, branch: "feature", defaultBranch: "main" })).toContain("`git diff main...HEAD`");
  expect(reviewPrompt({ error: "gh is not logged in", repo: true, defaultBranch: "origin/main" })).toContain(
    "`git diff origin/main...HEAD`",
  );
});

test("a repository with no known base gets no guessed ref", () => {
  for (const pr of [
    { none: true as const, branch: "feature", defaultBranch: null },
    { error: "gh is not logged in", repo: true, defaultBranch: null },
    { error: "gh is not logged in", repo: true },
  ]) {
    const prompt = reviewPrompt(pr);
    expect(prompt).not.toContain("origin/HEAD");
    expect(prompt).toContain("Find the default branch");
  }
});

const meta = (over: Partial<SessionMeta>): SessionMeta =>
  ({ id: "s1", title: "TEST-fix", engine: "codex", cwd: "/w/app", host: "local", status: "idle", ...over }) as SessionMeta;

test("the review waits while a session works in the folder, as yardd allows one there", () => {
  const me = meta({});
  for (const status of ["running", "needs_approval", "queued"] as const) {
    expect(folderBusy({ s1: { ...me, status } }, me)?.title).toBe("TEST-fix");
    const other = meta({ id: "s2", title: "TEST-other", cwd: "/w/app/", status });
    expect(folderBusy({ s1: me, s2: other }, me)?.title).toBe("TEST-other");
  }
  expect(folderBusy({ s1: me }, me)).toBeUndefined();
  expect(folderBusy({ s1: me, s2: meta({ id: "s2", status: "error" }) }, me)).toBeUndefined();
  // Another folder, or the same path on another host, is no obstacle.
  expect(folderBusy({ s1: me, s2: meta({ id: "s2", cwd: "/w/app-2", status: "running" }) }, me)).toBeUndefined();
  expect(folderBusy({ s1: me, s2: meta({ id: "s2", host: "box", status: "running" }) }, me)).toBeUndefined();
});
