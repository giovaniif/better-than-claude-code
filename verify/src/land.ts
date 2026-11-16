// The land gate: may this PR merge without a human reading it?
//   check    every blocker and guard, as data
//   verdict  the independent verifier's PASS / PASS+NOTES / FAIL / HUMAN, as a PR comment
//   merge    re-checks, then follows the mode: off, shadow (record only), live
//   watch    after a merge: watched workflows on the merge commit; a regression opens a revert PR
//   ledger   every decision, for the weekly review
//   review   compares the gate's calls with what the human did (weekly review input)

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Args, ensureDir, git, gitOut, nowIso, REPO, ROOT, run, SHARED, str } from "./common";
import { load as loadBundle, verifyBundle } from "./evidence";
import { AGENT_MARK, gh, ghJson, landConfig, latestVerdict, prNumber, prView, checksSummary, threads } from "./gh";
import { notify } from "./notify";
import { fail, Usage, type Result } from "./out";

const LEDGER = () => join(ensureDir(SHARED), "land-ledger.jsonl");

export interface PrFile {
  filename: string;
  status: string;
  previous_filename?: string;
  patch?: string;
  additions: number;
  deletions: number;
}

export interface Blocker {
  code: string;
  msg: string;
}

/** Statements a revert cannot undo. Matched on added lines joined per file, so a statement split across lines still counts. */
const DESTRUCTIVE_SQL: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|COLUMN|INDEX|VIEW|TRIGGER)\b/i, "DROP"],
  [/\bTRUNCATE\b/i, "TRUNCATE"],
  [/\bDELETE\s+FROM\b/i, "DELETE FROM"],
  [/\bUPDATE\s+["`\w.]+\s+SET\b/i, "UPDATE … SET"],
  [/\bALTER\s+TABLE\b[\s\S]{0,200}?\b(RENAME|DROP|ALTER\s+COLUMN|TYPE)\b/i, "ALTER TABLE rename/drop/type change"],
  [/\bALTER\s+TABLE\b/i, "ALTER TABLE"],
];

/** Paths whose effects outlive a revert: releases, installers on users' machines, signing, infra. */
const IRREVERSIBLE_PATHS: [RegExp, string][] = [
  [/^Dockerfile$|^docker-compose\.ya?ml$|^\.dockerignore$/, "container image / deployment"],
  [/^scripts\/(install-host|remote-install|release)\.sh$/, "installer or release script (runs on users' machines)"],
  [/^app\/src-tauri\/tauri(\.bundle)?\.conf\.json$/, "app bundle/updater config (updater key, identifiers)"],
  [/\.plist$|entitlements/, "signing entitlements"],
  [/^\.github\/scripts\//, "signing and release scripts"],
  [/(^|\/)\.env(\.|$)|\.pem$|\.key$|\.p12$|id_(rsa|ed25519)/, "secrets or env file"],
  [/^crates\/yardd\/src\/store\.rs$/, "SQLite schema and persistence (user data)"],
];

/** Changes to the rules themselves: CI, the gate, the verification skill and its fakes, agent instructions. */
const SELF_OR_CI: [RegExp, string][] = [
  [/^\.github\//, "CI workflows"],
  [/(^|\/)CODEOWNERS$/, "CODEOWNERS"],
  [/^verify\/(?!features\/)/, "the verification CLI or the land gate"],
  [/^\.claude\/skills\//, "agent skills (verify, babysit, patrol)"],
  [/^(CLAUDE|AGENTS)\.md$/, "agent instructions"],
  [/^crates\/yardd\/tests\/fake-codex\//, "the scripted engines the map and tests trust"],
];

/** Added code that can destroy user data: worktrees, branches, files. */
const DATA_LOSS: [RegExp, string][] = [
  [/remove_dir_all|rm\s+-rf|fs::remove_file/, "deletes files"],
  [/worktree["',\s]+remove["',\s]+--force|"--force"|"-D"|branch\s+-D/, "forced git removal"],
];

/** Security boundary: binding and Origin checks (see CLAUDE.md hard rules). */
const SECURITY: [RegExp, string][] = [[/YARD_BIND|YARD_ALLOW_ORIGIN|allow_origin|Origin|0\.0\.0\.0|\bHost\b.*header/i, "bind address or Origin check"]];

const SECRET_TEXT = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bghp_[A-Za-z0-9]{30,}|\bgho_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9]{32,}|\bAKIA[0-9A-Z]{16}\b|xox[bp]-[A-Za-z0-9-]{20,}/;

/**
 * Added lines that are not test code: a test cleaning up its own temp dir is
 * not a data-loss risk. Skips files under tests/ and, in a Rust file, every
 * line after a `#[cfg(test)]` marker in the patch (test modules close a file),
 * and a hunk inside an existing `mod tests {`, which git names in the hunk
 * header, up to the first non-blank line at column 0.
 */
export function addedNonTest(filename: string, patch: string | undefined): string[] {
  if (/(^|\/)tests?\//.test(filename)) return [];
  const out: string[] = [];
  let inTests = false;
  let inTestHunk = false;
  for (const l of (patch ?? "").split("\n")) {
    if (l.startsWith("@@")) {
      inTestHunk = /^@@ [^@]*@@ +mod tests\s*\{/.test(l);
      continue;
    }
    // git heads a hunk with the last column-0 line that starts with a
    // letter, so a hunk after the module (past its `}` and some comments)
    // can still say `mod tests {`. Inside a formatted module everything is
    // indented: any non-blank column-0 line, even a comment, ends the region.
    if (inTestHunk && /^.\S/.test(l)) inTestHunk = false;
    if (inTestHunk) continue;
    if (/#\[cfg\(test\)\]/.test(l) && !l.startsWith("-")) inTests = true;
    if (l.startsWith("+") && !l.startsWith("+++") && !inTests) out.push(l.slice(1));
  }
  return out;
}

const lines = (patch: string | undefined, sign: "+" | "-") =>
  (patch ?? "")
    .split("\n")
    .filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3)))
    .map((l) => l.slice(1));

/** Scans a PR's files. Pure, so the selftest covers it. */
export function scanFiles(files: PrFile[]): { blockers: Blocker[]; category: string; touched: Record<string, number> } {
  const blockers: Blocker[] = [];
  const add = (code: string, msg: string) => blockers.push({ code, msg });
  const touched: Record<string, number> = {};
  for (const f of files) {
    const paths = [f.filename, f.previous_filename].filter(Boolean) as string[];
    const area = f.filename.split("/")[0];
    touched[area] = (touched[area] ?? 0) + f.additions + f.deletions;
    if (f.patch === undefined && f.status !== "removed" && !(f.status === "renamed" && f.additions + f.deletions === 0)) {
      // Fail closed: a file the API gave no patch for was not scanned.
      add("unscanned-file", `${f.filename}: no patch from the API (binary or too large), so it was not scanned`);
    }
    for (const p of paths) {
      for (const [re, why] of IRREVERSIBLE_PATHS) if (re.test(p)) add("irreversible", `${p}: ${why}`);
      for (const [re, why] of SELF_OR_CI) if (re.test(p)) add("self-or-ci", `${p}: ${why}`);
    }
    const plus = lines(f.patch, "+");
    const minus = lines(f.patch, "-");
    const joined = plus.join("\n");
    const code = /\.(rs|ts|tsx|js|sql|sh)$/.test(f.filename);
    if (code) for (const [re, what] of DESTRUCTIVE_SQL) if (re.test(joined)) add("destructive-sql", `${f.filename}: adds ${what}`);
    if (code && /^crates\/|^scripts\//.test(f.filename)) {
      const real = addedNonTest(f.filename, f.patch).join("\n");
      for (const [re, what] of DATA_LOSS) if (re.test(real)) add("data-loss", `${f.filename}: ${what}`);
    }
    if (/^crates\/yardd\/src\/(ws|main)\.rs$/.test(f.filename)) for (const [re, what] of SECURITY) if (re.test(joined + "\n" + minus.join("\n"))) add("security-boundary", `${f.filename}: touches the ${what}`);
    if (SECRET_TEXT.test(joined)) add("secret", `${f.filename}: an added line looks like a credential`);
    // The feature map may change, but a recipe may not quietly disappear.
    if (/^verify\/features\/.*\.md$/.test(f.filename)) {
      const gone = minus.filter((l) => l.startsWith("### ")).filter((l) => !plus.includes(l));
      if (f.status === "removed") add("recipe-removed", `${f.filename}: a whole feature-map area is deleted`);
      for (const g of gone) add("recipe-removed", `${f.filename}: recipe "${g.slice(4)}" removed or renamed`);
    }
  }
  const total = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  // A fix that also updates its feature-map recipe is still a fix of its own area.
  const code = files.filter((f) => !f.filename.startsWith("verify/features/"));
  const areas = [...new Set((code.length ? code : files).map((f) => f.filename.split("/")[0]))];
  const only = (...xs: string[]) => areas.every((a) => xs.includes(a));
  const docsOnly = files.every((f) => /\.md$/.test(f.filename) && !/^verify\//.test(f.filename) && !/^(CLAUDE|AGENTS)\.md$/.test(f.filename));
  const cfg = landConfig();
  const small = total <= (cfg.smallLines ?? 200);
  const category = docsOnly
    ? "docs"
    : only("verify") && files.every((f) => f.filename.startsWith("verify/features/"))
      ? "feature-map"
      : only("ui")
        ? `ui-fix-${small ? "small" : "large"}`
        : only("crates")
          ? `daemon-fix-${small ? "small" : "large"}`
          : only("sidecar")
            ? `sidecar-fix-${small ? "small" : "large"}`
            : `mixed-${small ? "small" : "large"}`;
  return { blockers: dedupe(blockers), category, touched };
}

/** Recipe labels a PR body lists under "## Recipes removed" (one per bullet, in backticks). */
export function recipesDeclaredRemoved(body: string): string[] {
  const m = body.match(/^##\s+Recipes removed\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return [];
  return [...m[1].matchAll(/^\s*[-*]\s+`([^`]+)`/gm)].map((x) => x[1].trim());
}

function dedupe(b: Blocker[]): Blocker[] {
  const seen = new Set<string>();
  return b.filter((x) => (seen.has(x.code + x.msg) ? false : (seen.add(x.code + x.msg), true)));
}

function prFiles(n: number): PrFile[] {
  // --paginate with --slurp gives one array of pages.
  const pages = ghJson(["api", "--paginate", "--slurp", `repos/${REPO}/pulls/${n}/files?per_page=100`]);
  return (pages as PrFile[][]).flat();
}

function requiredChecks(base: string): { names: string[] | null; source: string } {
  const r = run(["gh", "api", `repos/${REPO}/branches/${base}/protection/required_status_checks`]);
  if (r.code === 0) {
    const j = JSON.parse(r.out);
    const names = [...(j.contexts ?? []), ...(j.checks ?? []).map((c: any) => c.context)];
    if (names.length) return { names: [...new Set(names)], source: "branch protection" };
  }
  const rules = run(["gh", "api", `repos/${REPO}/rules/branches/${base}`]);
  if (rules.code === 0) {
    const names = (JSON.parse(rules.out) as any[]).filter((x) => x.type === "required_status_checks").flatMap((x) => x.parameters.required_status_checks.map((c: any) => c.context));
    if (names.length) return { names, source: "rulesets" };
  }
  const cfg = landConfig();
  if (cfg.requiredChecks?.length) return { names: cfg.requiredChecks, source: "verify/land.json" };
  return { names: null, source: "none: every check is required" };
}

/** The merge the spacing guard counts from. */
export function lastMerge(merged: { number: number; mergedAt: string }[]): { number: number; mergedAt: string } | undefined {
  return merged[0];
}

function guards(): Blocker[] {
  const cfg = landConfig().guards ?? {};
  const out: Blocker[] = [];
  for (const wf of cfg.deployWorkflows ?? []) {
    const runs = ghJson(["run", "list", "--repo", REPO, "--workflow", wf, "--limit", "5", "--json", "status,conclusion,headBranch,event,createdAt,url"]) as any[];
    const inflight = runs.find((r) => r.status !== "completed");
    if (inflight) out.push({ code: "deploy-in-flight", msg: `${wf} is running (${inflight.url})` });
    const last = runs.find((r) => r.status === "completed" && r.conclusion !== "cancelled" && r.conclusion !== "skipped");
    if (last && last.conclusion !== "success") out.push({ code: "last-deploy-failed", msg: `the last ${wf} run failed (${last.url})` });
  }
  if (cfg.minMinutesSinceLastMerge) {
    const merged = ghJson(["pr", "list", "--repo", REPO, "--state", "merged", "--limit", "1", "--json", "mergedAt,number"]) as any[];
    const latest = lastMerge(merged);
    if (latest) {
      const mins = (Date.now() - Date.parse(latest.mergedAt)) / 60000;
      if (mins < cfg.minMinutesSinceLastMerge) out.push({ code: "too-soon", msg: `#${latest.number} merged ${mins.toFixed(0)} min ago (min ${cfg.minMinutesSinceLastMerge})` });
    }
  }
  if (cfg.landingHours) {
    const { tz, from, to } = cfg.landingHours;
    const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
    if (hour < from || hour >= to) out.push({ code: "outside-landing-hours", msg: `${hour}:00 in ${tz}; landing hours are ${from}:00-${to}:00` });
  }
  return out;
}

export function check(n: number) {
  const cfg = landConfig();
  const pr = prView(n);
  const head = pr.headRefOid as string;
  const blockers: Blocker[] = [];
  const add = (code: string, msg: string) => blockers.push({ code, msg });
  if (pr.state !== "OPEN") add("not-open", `the PR is ${pr.state}`);
  if (pr.isDraft) add("draft", "the PR is a draft");

  const verdict = latestVerdict(pr.comments ?? []);
  if (!verdict) add("no-verdict", "no verifier verdict yet: run the verifier pass (see .claude/skills/verifier)");
  else if (!head.startsWith(verdict.sha)) add("stale-verdict", `the verdict is for ${verdict.sha.slice(0, 7)}, the head is ${head.slice(0, 7)}`);
  else if (verdict.verdict === "FAIL") add("verdict-fail", `the verifier said FAIL (${verdict.url})`);
  else if (verdict.verdict === "HUMAN") add("verdict-human", `the verifier asked for a human (${verdict.url})`);

  const checks = checksSummary(pr.statusCheckRollup ?? []);
  const req = requiredChecks(pr.baseRefName);
  const relevant = req.names ? checks.filter((c) => req.names!.includes(c.name)) : checks;
  for (const name of req.names ?? []) if (!checks.some((c) => c.name === name)) add("check-missing", `required check ${name} has not reported`);
  for (const c of relevant) {
    if (c.result === "failed") add("check-failed", `${c.name} failed (${c.url})`);
    if (c.result === "running") add("check-pending", `${c.name} is still running`);
  }
  if (!req.names) for (const c of checks) if (c.result === "failed" && !relevant.includes(c)) add("check-failed", `${c.name} failed`);

  const approvedOnHead = (pr.reviews ?? []).some((r: any) => r.state === "APPROVED" && r.commit?.oid === head && r.author?.login !== pr.author?.login);
  const changesRequested = (pr.reviews ?? []).some((r: any) => r.state === "CHANGES_REQUESTED" && r.commit?.oid === head);
  const verdictApproves = cfg.approval?.verdictCounts && verdict && head.startsWith(verdict.sha) && verdict.verdict.startsWith("PASS");
  if (changesRequested) add("changes-requested", "a review requests changes on the current head");
  if (!approvedOnHead && !verdictApproves) add("not-approved", "no approval on the current head");

  try {
    const t = threads(n);
    if (!t.complete) add("threads-unknown", `only ${t.nodes.length} of ${t.total} review threads could be read`);
    const open = t.nodes.filter((x: any) => !x.resolved).length;
    if (open) add("open-threads", `${open} unresolved review thread(s)`);
  } catch (e: any) {
    add("threads-unknown", `review threads could not be read: ${e.message}`);
  }

  if (pr.mergeStateStatus !== "CLEAN") add("not-clean", `merge state is ${pr.mergeStateStatus}${pr.mergeable === "CONFLICTING" ? " (conflicts)" : ""}`);

  const files = prFiles(n);
  const scan = scanFiles(files);
  // A recipe may go when the PR says so: listed by name under "## Recipes
  // removed", with the reason, where the verifier reads it too.
  const declared = recipesDeclaredRemoved(String(pr.body ?? ""));
  blockers.push(...scan.blockers.filter((b) => b.code !== "recipe-removed" || !declared.some((r) => b.msg.includes(`"${r}"`))));

  const skillAtBase = git(["cat-file", "-e", `origin/${pr.baseRefName}:.claude/skills/verify/SKILL.md`]).code === 0 || existsSync(join(ROOT, ".claude/skills/verify/SKILL.md"));
  if (!skillAtBase) add("no-verification-skill", "this repository has no verification skill");

  const g = guards();
  return {
    pr: n,
    title: pr.title,
    url: pr.url,
    head,
    mode: cfg.mode,
    category: scan.category,
    size: { additions: pr.additions, deletions: pr.deletions, files: files.length },
    requiredChecks: req,
    verdict,
    landable: blockers.length === 0,
    blockers: dedupe(blockers),
    guards: g,
    canMergeNow: blockers.length === 0 && g.length === 0,
  };
}

function ledger(entry: Record<string, unknown>) {
  appendFileSync(LEDGER(), JSON.stringify({ at: nowIso(), ...entry }) + "\n");
}

export function readLedger(): any[] {
  if (!existsSync(LEDGER())) return [];
  return readFileSync(LEDGER(), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const VERDICTS = ["PASS", "PASS+NOTES", "FAIL", "HUMAN"];

function postVerdict(n: number, a: Args): Result {
  const v = str(a, "verdict");
  if (!v || !VERDICTS.includes(v)) throw new Usage(`--verdict ${VERDICTS.join("|")}`);
  const notes = str(a, "notes", "")!;
  const pr = prView(n);
  const head = pr.headRefOid as string;
  const bundleDir = str(a, "bundle");
  let bundleNote = "";
  if (v.startsWith("PASS")) {
    // PASS needs evidence that verifies at this very head, checked here, not taken on trust.
    if (!bundleDir) fail("pass-needs-bundle", "PASS needs --bundle <evidence dir> that verifies at the PR head");
    const b = loadBundle(bundleDir!);
    if (b.head !== head) fail("bundle-wrong-head", `the bundle is for ${b.head.slice(0, 7)}, the PR head is ${head.slice(0, 7)}`);
    const local = gitOut(["rev-parse", "HEAD"]);
    const checks = verifyBundle(bundleDir!, b, local);
    const bad = checks.filter((c) => !c.ok);
    if (bad.length) fail("bundle-fails", `the evidence does not verify: ${bad.map((c) => `${c.rule}: ${c.msg}`).join("; ")}`, "give FAIL or HUMAN, or ask the author for the missing proof");
    bundleNote = `\n\nEvidence: ${checks.length} rules pass for \`${head.slice(0, 7)}\` (${b.proofs.length} proofs).`;
  }
  if (!notes && v !== "PASS") throw new Usage(`${v} needs --notes explaining it`);
  const body = `<!-- land:verdict v=1 sha=${head} verdict=${v} -->\n**Verifier verdict: ${v}** for \`${head.slice(0, 7)}\`${bundleNote}${notes ? `\n\n${notes}` : ""}\n\n${AGENT_MARK}`;
  if (a.flags["dry-run"]) return { ok: true, dryRun: true, body };
  const url = gh(["pr", "comment", String(n), "--repo", REPO, "--body-file", "-"], body).trim();
  ledger({ kind: "verdict", pr: n, head, verdict: v });
  return { ok: true, url, verdict: v, head };
}

function merge(n: number, a: Args): Result {
  const cfg = landConfig();
  const c = check(n);
  const mode = a.flags["dry-run"] ? "shadow" : cfg.mode;
  const live: string[] = cfg.liveCategories ?? [];
  const liveForCategory = live.includes("*") || live.includes(c.category);
  const entry = { kind: "decision", pr: n, head: c.head, mode, category: c.category, landable: c.landable, blockers: c.blockers.map((b) => b.code), guards: c.guards.map((g) => g.code), size: c.size };
  if (mode === "off") return { ok: true, ...c, action: "none (mode off)" };
  if (mode === "shadow" || (mode === "live" && !liveForCategory)) {
    ledger({ ...entry, action: c.landable ? "would-land" : "would-not-land", why: mode === "live" ? `category ${c.category} is not live` : "shadow mode" });
    return { ok: true, ...c, action: c.landable ? "would land (shadow: nothing merged)" : "would not land" };
  }
  if (!c.landable) {
    ledger({ ...entry, action: "blocked" });
    return { ok: false, ...c, action: "blocked", problems: c.blockers.map((b) => ({ code: b.code, msg: b.msg })) };
  }
  if (c.guards.length) {
    ledger({ ...entry, action: "waiting" });
    return { ok: true, ...c, action: "waiting on guards" };
  }
  // Pinned to the checked head: if it moved, the merge fails.
  const r = run(["gh", "api", "-X", "PUT", `repos/${REPO}/pulls/${n}/merge`, "-f", "merge_method=squash", "-f", `sha=${c.head}`]);
  if (r.code !== 0) {
    ledger({ ...entry, action: "merge-failed", error: r.err.slice(0, 300) });
    fail("merge-failed", `merge failed: ${r.err.trim().slice(0, 300)}`);
  }
  ledger({ ...entry, action: "merged", mergeSha: JSON.parse(r.out).sha });
  return { ok: true, ...c, action: "merged", merge: JSON.parse(r.out) };
}

/**
 * Whether a failed workflow run says anything about the code. GitHub fails a
 * run whose job never got a runner (macOS capacity: "not acquired by Runner"),
 * and that job ends cancelled with nothing run. Only a job that failed or timed
 * out is a regression; a run with none is re-run instead of reverted.
 */
export function regressedJobs(jobs: { name: string; conclusion: string | null }[]): string[] {
  return jobs.filter((j) => j.conclusion === "failure" || j.conclusion === "timed_out").map((j) => j.name);
}

async function watch(n: number, a: Args): Promise<Result> {
  const cfg = landConfig();
  const pr = prView(n);
  if (pr.state !== "MERGED") fail("not-merged", `#${n} is ${pr.state}`);
  const sha = pr.mergeCommit?.oid;
  const runs = (ghJson(["api", `repos/${REPO}/actions/runs?head_sha=${sha}&per_page=50`]).workflow_runs ?? []) as any[];
  const watched = runs.filter((r) => (cfg.guards?.watchWorkflows ?? []).includes(r.name));
  const bad = watched.filter((r) => r.status === "completed" && !["success", "skipped", "neutral", "cancelled"].includes(r.conclusion));
  const failed = bad.filter((r) => regressedJobs(ghJson(["api", `repos/${REPO}/actions/runs/${r.id}/jobs?per_page=100`]).jobs ?? []).length > 0);
  const rerun = bad.filter((r) => !failed.includes(r));
  if (!a.flags["dry-run"]) for (const r of rerun) run(["gh", "run", "rerun", String(r.id), "--failed", "--repo", REPO]);
  const pending = [...watched.filter((r) => r.status !== "completed"), ...rerun];
  const summary = watched.map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion, url: r.html_url, rerun: rerun.includes(r) || undefined }));
  if (!failed.length) {
    ledger({ kind: "watch", pr: n, sha, result: pending.length ? "pending" : "green", rerun: rerun.map((r) => r.name) });
    return { ok: true, pr: n, sha, result: pending.length ? "pending" : "green", runs: summary };
  }
  // A regression: revert through a PR (never through the gate), and ping the human.
  let revert: string | null = null;
  if (!a.flags["dry-run"]) {
    const branch = `revert/pr-${n}`;
    const wt = join(ROOT, ".verify", `revert-${n}`);
    run(["git", "fetch", "-q", "origin", "main"]);
    const add = run(["git", "worktree", "add", "-B", branch, wt, "origin/main"]);
    if (add.code === 0) {
      const rv = run(["git", "-C", wt, "revert", "--no-edit", sha]);
      if (rv.code === 0 && run(["git", "-C", wt, "push", "-q", "-u", "origin", branch]).code === 0) {
        revert = gh(["pr", "create", "--repo", REPO, "--head", branch, "--base", "main", "--title", `Revert "${pr.title}" (#${n})`, "--body-file", "-"], `Reverts #${n}: ${failed.map((f) => `${f.name} failed on the merge commit (${f.html_url})`).join("; ")}.\n\nOpened by \`verify/yv land watch\`. A revert never lands through the gate: a human merges it.\n\n${AGENT_MARK}`).trim();
      }
      run(["git", "worktree", "remove", "--force", wt]);
    }
    await notify(`#${n} regressed after merge: ${failed.map((f) => f.name).join(", ")} failed. ${revert ? `Revert PR: ${revert}` : "Revert PR could not be opened."}`, { title: "Switchyard: regression after merge", priority: 4 });
  }
  ledger({ kind: "watch", pr: n, sha, result: "regression", failed: failed.map((f) => f.name), revert });
  return { ok: false, pr: n, sha, result: "regression", runs: summary, revert, problems: failed.map((f) => ({ code: "regression", msg: `${f.name} failed on the merge commit`, hint: f.html_url })) };
}

/** For the weekly review: the gate's last call per PR next to what actually happened. */
function review(a: Args): Result {
  const days = Number(str(a, "days", "7"));
  const since = Date.now() - days * 86400000;
  const decisions = readLedger().filter((e) => e.kind === "decision" && Date.parse(e.at) >= since);
  const last = new Map<number, any>();
  for (const d of decisions) last.set(d.pr, d);
  const rows = [...last.values()].map((d) => {
    const pr = prView(d.pr);
    const headMoved = pr.headRefOid !== d.head;
    const reverted = (ghJson(["pr", "list", "--repo", REPO, "--state", "all", "--search", `Revert in:title "#${d.pr}"`, "--json", "number,state"]) as any[]).length > 0;
    const human = pr.state === "MERGED" ? (headMoved ? "merged-after-changes" : reverted ? "merged-then-reverted" : "merged-as-is") : pr.state === "CLOSED" ? "closed" : "open";
    const gateLands = d.action === "would-land" || d.action === "merged";
    const falseAccept = gateLands && ["closed", "merged-after-changes", "merged-then-reverted"].includes(human);
    const falseReject = !gateLands && human === "merged-as-is";
    return { pr: d.pr, category: d.category, gate: d.action, blockers: d.blockers, human, agree: !falseAccept && !falseReject, falseAccept, falseReject };
  });
  const byCategory: Record<string, { prs: number; falseAccepts: number; falseRejects: number }> = {};
  for (const r of rows) {
    const c = (byCategory[r.category] ??= { prs: 0, falseAccepts: 0, falseRejects: 0 });
    c.prs++;
    if (r.falseAccept) c.falseAccepts++;
    if (r.falseReject) c.falseRejects++;
  }
  const goLive = Object.entries(byCategory)
    .filter(([, c]) => c.falseAccepts === 0 && c.prs >= 3)
    .map(([k]) => k);
  return { ok: true, days, rows, byCategory, candidatesForLive: goLive, hint: "one false accept in a category means no-go for that category; go live per category in verify/land.json (liveCategories) only with a human's yes" };
}

/**
 * The gate's rules are main's, never a PR's: a checkout at a PR head would
 * judge that PR with its own (possibly weakened) code and settings.
 */
function requireMainGate() {
  git(["fetch", "-q", "origin", "main"]);
  const same = git(["diff", "--quiet", "origin/main", "--", "verify/src", "verify/land.json"]).code === 0;
  if (!same)
    fail(
      "gate-not-main",
      "this checkout's gate code or verify/land.json differs from origin/main",
      "run the gate from main: `git checkout --detach origin/main` here (after the verdict), or use ~/.local/share/switchyard-loops/switchyard/verify/yv",
    );
}

export async function land(a: Args): Promise<Result> {
  const [sub, num] = a.pos;
  if (["check", "merge", "watch"].includes(sub) && !process.env.YV_GATE_ANY_CHECKOUT) requireMainGate();
  switch (sub) {
    case "check": {
      const c = check(prNumber(num));
      ledger({ kind: "check", pr: c.pr, head: c.head, landable: c.landable, category: c.category, blockers: c.blockers.map((b) => b.code) });
      return { ok: true, ...c };
    }
    case "verdict":
      return postVerdict(prNumber(num), a);
    case "merge":
      return merge(prNumber(num), a);
    case "watch":
      return watch(prNumber(num), a);
    case "ledger": {
      const pr = num ? prNumber(num) : null;
      const entries = readLedger().filter((e) => pr === null || e.pr === pr);
      return { ok: true, file: LEDGER(), entries: entries.slice(-Number(str(a, "limit", "100"))) };
    }
    case "review":
      return review(a);
    default:
      throw new Usage("land check|verdict|merge|watch|ledger|review <pr>");
  }
}
