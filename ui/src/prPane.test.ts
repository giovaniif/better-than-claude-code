import { expect, test } from "bun:test";
import { reviewPrompt } from "./PrPane";

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
