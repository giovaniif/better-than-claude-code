// GitHub helpers for babysitting: PR status in one object, review threads with
// their ids, reply-and-resolve, and re-requesting the reviewer bot.
// Everything goes through the user's `gh` login; every agent comment carries
// AGENT_MARK so a human's comment can be told apart from an agent's (both post
// as the same account).

import { join } from "node:path";
import { type Args, need, readJson, REPO, run, str, VERIFY } from "./common";
import { fail, Usage, type Result } from "./out";

export const AGENT_MARK = "<!-- yv:agent -->";

export function landConfig(): any {
  return readJson(join(VERIFY, "land.json"));
}

export function gh(args: string[], input?: string): string {
  const r = run(["gh", ...args], { input, env: { GH_PROMPT_DISABLED: "1", NO_COLOR: "1" } });
  if (r.code !== 0) fail("gh", `gh ${args.slice(0, 3).join(" ")} failed: ${r.err.trim().slice(0, 400)}`);
  return r.out;
}

export const ghJson = (args: string[], input?: string): any => JSON.parse(gh(args, input) || "null");

export function graphql(query: string, vars: Record<string, string | number>): any {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  const out = ghJson(args);
  if (out?.errors?.length) fail("graphql", out.errors.map((e: any) => e.message).join("; "));
  return out.data;
}

const [OWNER, NAME] = REPO.split("/");

export function prNumber(x: string | undefined): number {
  const n = Number(String(x ?? "").replace(/^#/, "").replace(/.*\/pull\//, ""));
  if (!Number.isInteger(n) || n <= 0) throw new Usage("a PR number (or URL) is required");
  return n;
}

const THREADS = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        totalCount
        nodes { id isResolved isOutdated path line
          comments(first: 30) { nodes { databaseId author { login } body url createdAt } } }
      }
    }
  }
}`;

export function threads(n: number) {
  const d = graphql(THREADS, { owner: OWNER, name: NAME, number: n });
  const t = d.repository.pullRequest.reviewThreads;
  return {
    total: t.totalCount as number,
    complete: t.totalCount <= t.nodes.length,
    nodes: t.nodes.map((x: any) => ({
      id: x.id,
      resolved: x.isResolved,
      outdated: x.isOutdated,
      path: x.path,
      line: x.line,
      comments: x.comments.nodes.map((c: any) => ({ id: c.databaseId, author: c.author?.login ?? "ghost", body: c.body, url: c.url, at: c.createdAt })),
    })),
  };
}

export const VERDICT_RE = /<!-- land:verdict v=1 sha=([0-9a-f]{7,40}) verdict=(PASS\+NOTES|PASS|FAIL|HUMAN) -->/;

export function prView(n: number): any {
  return ghJson([
    "pr",
    "view",
    String(n),
    "--repo",
    REPO,
    "--json",
    "number,title,url,state,isDraft,author,headRefOid,headRefName,baseRefName,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,reviews,comments,labels,additions,deletions,changedFiles,mergedAt,mergeCommit,closedAt,body,createdAt",
  ]);
}

export function checksSummary(rollup: any[]) {
  return rollup.map((c) => {
    const name = c.__typename === "StatusContext" ? c.context : c.name;
    const result =
      c.__typename === "StatusContext"
        ? c.state === "SUCCESS"
          ? "passed"
          : c.state === "PENDING" || c.state === "EXPECTED"
            ? "running"
            : "failed"
        : c.status !== "COMPLETED"
          ? "running"
          : ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(c.conclusion)
            ? "passed"
            : "failed";
    return { name, workflow: c.workflowName ?? null, result, url: c.detailsUrl ?? c.targetUrl ?? null };
  });
}

/** The newest verifier verdict comment, if any. */
export function latestVerdict(comments: any[]) {
  for (const c of [...comments].reverse()) {
    const m = String(c.body).match(VERDICT_RE);
    if (m) return { sha: m[1], verdict: m[2], url: c.url, at: c.createdAt };
  }
  return null;
}

/** Human comments: by the owner, without the agent marker, after the head commit. */
export function humanReplies(comments: any[], owner: string) {
  return comments
    .filter((c) => c.author?.login === owner && !String(c.body).includes(AGENT_MARK) && !VERDICT_RE.test(String(c.body)))
    .map((c) => ({ body: String(c.body).trim(), at: c.createdAt, url: c.url, merge: /^\s*merge\s*\.?\s*$/i.test(String(c.body)), no: /^\s*no\b/i.test(String(c.body)) }));
}

export function status(n: number) {
  const cfg = landConfig();
  const pr = prView(n);
  const checks = checksSummary(pr.statusCheckRollup ?? []);
  const t = threads(n);
  const head = pr.headRefOid;
  const approvedOnHead = (pr.reviews ?? []).some((r: any) => r.state === "APPROVED" && r.commit?.oid === head && r.author?.login !== pr.author?.login);
  const staleApprovals = (pr.reviews ?? []).filter((r: any) => r.state === "APPROVED" && r.commit?.oid !== head).map((r: any) => ({ by: r.author?.login, at: r.commit?.oid?.slice(0, 7) }));
  const bots: string[] = cfg.review?.bots ?? [];
  const botReviews = (pr.reviews ?? []).filter((r: any) => bots.includes(r.author?.login));
  const lastBot = botReviews[botReviews.length - 1] ?? null;
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    draft: pr.isDraft,
    head,
    branch: pr.headRefName,
    mergeable: pr.mergeable,
    mergeState: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision,
    approvedOnHead,
    staleApprovals,
    botReview: lastBot ? { by: lastBot.author?.login, state: lastBot.state, onHead: lastBot.commit?.oid === head, at: lastBot.submittedAt } : null,
    checks: {
      passed: checks.filter((c) => c.result === "passed").length,
      failed: checks.filter((c) => c.result === "failed"),
      running: checks.filter((c) => c.result === "running").map((c) => c.name),
      all: checks,
    },
    threads: { unresolved: t.nodes.filter((x: any) => !x.resolved).length, total: t.total, complete: t.complete },
    verdict: latestVerdict(pr.comments ?? []),
    humanReplies: humanReplies(pr.comments ?? [], cfg.owner),
    size: { additions: pr.additions, deletions: pr.deletions, files: pr.changedFiles },
  };
}

export async function pr(a: Args): Promise<Result> {
  const [sub, num, threadId] = a.pos;
  switch (sub) {
    case "status": {
      const s = status(prNumber(num));
      const ready = !s.draft && s.checks.failed.length === 0 && s.checks.running.length === 0 && s.threads.unresolved === 0 && s.threads.complete;
      return { ok: true, ...s, ready, hint: s.checks.failed.length ? `read the failing log: gh run view --log-failed --repo ${REPO} (from ${s.checks.failed[0].url})` : s.threads.unresolved ? "verify/yv pr threads " + s.number : ready ? `verify/yv land check ${s.number}` : undefined };
    }
    case "threads": {
      const t = threads(prNumber(num));
      const list = a.flags.all ? t.nodes : t.nodes.filter((x: any) => !x.resolved);
      return { ok: t.complete, threads: list, total: t.total, problems: t.complete ? [] : [{ code: "threads-truncated", msg: `only ${t.nodes.length} of ${t.total} threads read` }] };
    }
    case "reply": {
      if (!threadId) throw new Usage("pr reply <pr> <thread-id> --body t [--resolve]");
      const body = `${need(a, "body")}\n\n${AGENT_MARK}`;
      const d = graphql(`mutation($id: ID!, $body: String!) { addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $id, body: $body}) { comment { url } } }`, { id: threadId, body });
      let resolved = false;
      if (a.flags.resolve) {
        graphql(`mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }`, { id: threadId });
        resolved = true;
      }
      return { ok: true, url: d.addPullRequestReviewThreadReply.comment.url, resolved };
    }
    case "comment": {
      const body = `${need(a, "body")}\n\n${AGENT_MARK}`;
      const out = gh(["pr", "comment", String(prNumber(num)), "--repo", REPO, "--body-file", "-"], body);
      return { ok: true, url: out.trim() };
    }
    case "rerequest": {
      const n = prNumber(num);
      const cfg = landConfig();
      const s = status(n);
      const done: string[] = [];
      for (const bot of cfg.review?.bots ?? []) {
        if (cfg.review?.how === "comment") {
          gh(["pr", "comment", String(n), "--repo", REPO, "--body-file", "-"], `${cfg.review.comment}\n\n${AGENT_MARK}`);
        } else {
          gh(["api", "-X", "POST", `repos/${REPO}/pulls/${n}/requested_reviewers`, "-f", `reviewers[]=${bot}`]);
        }
        done.push(bot);
      }
      return { ok: true, requested: done, head: s.head, hint: done.length ? "wait 15+ minutes before poking the bot again: a new request can cancel its run" : "no review bot is configured in verify/land.json (review.bots); the verifier verdict is the review" };
    }
    default:
      throw new Usage("pr status|threads|comment|rerequest <pr> | pr reply <pr> <thread-id> --body t [--resolve]");
  }
}
