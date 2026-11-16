import { describe, expect, test } from "bun:test";
import { ago, checksLine, PeekCache, peekKey, peekResult, peekState, PR_URL_SOURCE, prLink, reviewLabel, shortLabel, type PeekResult } from "./prPeek";

const CANON = "https://github.com/acme-co/my.repo_1/pull/42";

describe("prLink", () => {
  test("a PR link, with a tab, anchor or query, is that PR", () => {
    for (const raw of [CANON, `${CANON}/`, `${CANON}/files`, `${CANON}/commits/0a1b2c3`, `${CANON}#issuecomment-1`, `${CANON}?w=1`, `${CANON}/files?diff=split#r9`]) {
      expect(prLink(raw)).toEqual({ url: CANON, repo: "acme-co/my.repo_1", number: 42 });
    }
  });

  test("anything else is not", () => {
    for (const raw of [
      "",
      "--help",
      "http://github.com/a/b/pull/1",
      "https://github.com.evil.example/a/b/pull/1",
      "https://github.com/a/b/issues/1",
      "https://github.com/a/b/pull/",
      "https://github.com/a/b/pull/0",
      "https://github.com/a/b/pull/012",
      "https://github.com/a/b/pull/1234567890",
      "https://github.com/-a/b/pull/1",
      "https://github.com/a/../pull/1",
      "https://github.com/a/b c/pull/1",
      "https://github.com/a/b/pull/1/files evil",
      "javascript:alert(1)//https://github.com/a/b/pull/1",
      "src/lib.rs",
    ]) {
      expect(prLink(raw)).toBeNull();
    }
  });

  test("a bare URL in text stops before the sentence's punctuation", () => {
    const find = (text: string) => text.match(new RegExp(PR_URL_SOURCE, "g")) ?? [];
    expect(find(`Opened ${CANON}.`)).toEqual([CANON]);
    expect(find(`(see ${CANON}/files), then ${CANON}#r1!`)).toEqual([`${CANON}/files`, `${CANON}#r1`]);
    expect(find("issue https://github.com/a/b/issues/3 and https://github.com/a/b/pull/0")).toEqual([]);
    expect(find("https://github.com/a/b/pull/1234567890")).toEqual([]);
  });

  test("its short label is GitHub's", () => {
    expect(shortLabel(prLink(`${CANON}/files`)!)).toBe("acme-co/my.repo_1#42");
  });
});

describe("card wording", () => {
  test("state", () => {
    expect(peekState({ state: "OPEN", isDraft: false })).toEqual({ label: "Open", tone: "open" });
    expect(peekState({ state: "OPEN", isDraft: true })).toEqual({ label: "Draft", tone: "draft" });
    expect(peekState({ state: "MERGED", isDraft: false })).toEqual({ label: "Merged", tone: "merged" });
    expect(peekState({ state: "CLOSED", isDraft: true })).toEqual({ label: "Closed", tone: "closed" });
  });

  test("review decision", () => {
    expect(reviewLabel("CHANGES_REQUESTED")).toBe("Changes requested");
    expect(reviewLabel(null)).toBeNull();
    expect(reviewLabel("SOMETHING_NEW")).toBeNull();
  });

  test("checks", () => {
    const c = (passed: number, failed: number, running: number) => checksLine({ passed, failed, running, failing: [] });
    expect(c(0, 0, 0)).toEqual({ text: "No checks", tone: "none" });
    expect(c(1, 1, 1)).toEqual({ text: "1 of 3 checks failed", tone: "failed" });
    expect(c(3, 0, 2)).toEqual({ text: "2 of 5 checks running", tone: "running" });
    expect(c(4, 0, 0)).toEqual({ text: "All 4 checks passed", tone: "passed" });
    expect(c(1, 0, 0)).toEqual({ text: "1 check passed", tone: "passed" });
    expect(c(0, 2, 0)).toEqual({ text: "All 2 checks failed", tone: "failed" });
  });

  test("updated ago", () => {
    const now = Date.parse("2026-11-16T12:00:00Z");
    const at = (ms: number) => new Date(now - ms).toISOString();
    expect(ago(at(20_000), now)).toBe("just now");
    expect(ago(at(5 * 60_000), now)).toBe("5 min ago");
    expect(ago(at(3 * 3600_000), now)).toBe("3 h ago");
    expect(ago(at(30 * 3600_000), now)).toBe("1 day ago");
    expect(ago(at(5 * 86400_000), now)).toBe("5 days ago");
    expect(ago(at(65 * 86400_000), now)).toBe("2 months ago");
    expect(ago(at(800 * 86400_000), now)).toBe("2 years ago");
    expect(ago(null, now)).toBeNull();
    expect(ago("not a date", now)).toBeNull();
  });

  test("a reply, a refusal and an older host", () => {
    const pr = { number: 1 } as any;
    expect(peekResult({ pr })).toEqual({ pr });
    expect(peekResult({ error: "gh is not logged in" })).toEqual({ error: "gh is not logged in" });
    expect(peekResult({ error: "unknown op `pr.peek`" })).toEqual({ error: "this session's host runs an older Switchyard" });
    expect(peekResult({ error: "yardd did not answer in time." })).toEqual({ error: "yardd did not answer in time" });
    expect(peekResult(null)).toEqual({ error: "no answer" });
  });
});

describe("PeekCache", () => {
  const clock = () => {
    let t = 1_000;
    return { now: () => t, add: (ms: number) => (t += ms) };
  };

  test("asks once while an answer is on its way, and keeps it for a minute", async () => {
    const c = clock();
    const cache = new PeekCache(60_000, 10_000, c.now);
    let asked = 0;
    let answer!: (r: PeekResult) => void;
    const load = () => {
      asked++;
      return new Promise<PeekResult>((r) => (answer = r));
    };
    const a = cache.get("k", load);
    const b = cache.get("k", load);
    expect(asked).toBe(1);
    expect(cache.settled("k")).toBeUndefined();
    answer({ pr: { number: 7 } as any });
    expect(await a).toEqual(await b);
    expect(cache.settled("k")).toEqual({ pr: { number: 7 } as any });
    c.add(59_000);
    await cache.get("k", load);
    expect(asked).toBe(1);
    c.add(2_000);
    expect(cache.settled("k")).toBeUndefined();
    cache.get("k", load);
    expect(asked).toBe(2);
  });

  test("a failure is asked again after 10 s, and a thrown load is a failure", async () => {
    const c = clock();
    const cache = new PeekCache(60_000, 10_000, c.now);
    let asked = 0;
    const load = async (): Promise<PeekResult> => {
      asked++;
      throw new Error("socket closed");
    };
    expect(await cache.get("k", load)).toEqual({ error: "socket closed" });
    await cache.get("k", load);
    expect(asked).toBe(1);
    c.add(10_001);
    await cache.get("k", load);
    expect(asked).toBe(2);
  });

  test("keys are per host", () => {
    expect(peekKey("s1", CANON)).toBe(`local\n${CANON}`);
    expect(peekKey("h1~s1", CANON)).toBe(`h1\n${CANON}`);
  });
});
