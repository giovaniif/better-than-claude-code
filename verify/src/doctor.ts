// `doctor`: can this checkout be verified right now, and if not, what to run.

import { existsSync, statfsSync } from "node:fs";
import { cpus, freemem, loadavg, totalmem } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { type Args, git, LIVE_PORT, ROOT, run, VERIFY } from "./common";
import { buildFreshness, isoLs } from "./iso";
import type { Problem, Result } from "./out";

export async function doctor(a: Args): Promise<Result> {
  const problems: Problem[] = [];
  const warnings: Problem[] = [];
  const checks: Record<string, unknown> = {};

  // Tools.
  const tools: Record<string, string | null> = {};
  for (const [t, args] of [["bun", ["--version"]], ["cargo", ["--version"]], ["git", ["--version"]], ["gh", ["--version"]], ["ffmpeg", ["-version"]]] as const) {
    const r = run([t, ...args]);
    tools[t] = r.code === 0 ? r.out.split("\n")[0].trim() : null;
  }
  checks.tools = tools;
  for (const t of ["bun", "cargo", "git"]) if (!tools[t]) problems.push({ code: "missing-tool", msg: `${t} is not on PATH`, hint: process.platform === "darwin" && t === "cargo" ? "export PATH=/opt/homebrew/opt/rustup/bin:$PATH" : `install ${t}` });
  if (!tools.gh) warnings.push({ code: "missing-tool", msg: "gh is not installed: pr, land and assets need it" });
  if (!tools.ffmpeg) warnings.push({ code: "missing-tool", msg: "ffmpeg is not installed: drive --video keeps webm instead of mp4" });

  // Browser.
  const exe = chromium.executablePath();
  checks.chromium = existsSync(exe) ? exe : null;
  if (!existsSync(exe)) problems.push({ code: "no-chromium", msg: "Playwright's Chromium is not installed", hint: "cd verify && bunx playwright install chromium" });

  // Dependencies.
  for (const d of ["ui", "sidecar/yard-claude", "verify"]) {
    if (!existsSync(join(ROOT, d, "node_modules"))) problems.push({ code: "no-deps", msg: `${d}/node_modules is missing`, hint: `(cd ${d} && bun install)` });
  }

  // Build.
  const fresh = buildFreshness();
  checks.build = { fresh: fresh.fresh, why: fresh.why, stamp: fresh.stamp, head: fresh.head };
  if (!fresh.fresh) warnings.push({ code: "build-stale", msg: `build is stale: ${fresh.why.join("; ")}`, hint: "verify/yv build (iso up builds on its own)" });

  // Checkout.
  const branch = git(["branch", "--show-current"]).out.trim();
  const fetched = a.flags["no-fetch"] ? null : git(["fetch", "-q", "origin", "main"]);
  const behind = Number(git(["rev-list", "--count", "HEAD..origin/main"]).out.trim() || "0");
  const ahead = Number(git(["rev-list", "--count", "origin/main..HEAD"]).out.trim() || "0");
  checks.checkout = { branch: branch || "(detached)", behindMain: behind, aheadOfMain: ahead, dirty: fresh.head.dirty, fetched: fetched ? fetched.code === 0 : "skipped" };
  if (fetched && fetched.code !== 0) warnings.push({ code: "fetch-failed", msg: `git fetch origin main failed: ${fetched.err.trim().slice(0, 200)}` });
  if (behind > 0) warnings.push({ code: "behind-main", msg: `this checkout is ${behind} commits behind origin/main`, hint: branch === "main" ? "git pull --ff-only" : "git rebase origin/main" });
  const main = git(["worktree", "list", "--porcelain"]).out.split("\n\n")[0]?.match(/^worktree (.*)$/m)?.[1];
  if (main && main !== ROOT) {
    const mainBehind = Number(git(["rev-list", "--count", "main..origin/main"], main).out.trim() || "0");
    checks.mainCheckout = { path: main, branch: git(["branch", "--show-current"], main).out.trim(), behindOrigin: mainBehind };
    if (mainBehind > 0) warnings.push({ code: "main-behind", msg: `the main checkout's main is ${mainBehind} commits behind origin/main` });
  }

  // Machine.
  const cores = cpus().length;
  const load1 = loadavg()[0];
  const freeGb = freemem() / 2 ** 30;
  const fs = statfsSync(ROOT);
  const diskFreeGb = (fs.bavail * fs.bsize) / 2 ** 30;
  checks.machine = { cores, load1: +load1.toFixed(2), memFreeGb: +freeGb.toFixed(1), memTotalGb: +(totalmem() / 2 ** 30).toFixed(1), diskFreeGb: +diskFreeGb.toFixed(1) };
  if (load1 > cores) problems.push({ code: "overloaded", msg: `1-minute load ${load1.toFixed(1)} is above ${cores} cores`, hint: "wait, or stop your own heavy jobs (never other sessions)" });
  else if (load1 > cores * 0.7) warnings.push({ code: "busy", msg: `1-minute load ${load1.toFixed(1)} on ${cores} cores` });
  if (freeGb < 1.5) warnings.push({ code: "low-memory", msg: `${freeGb.toFixed(1)} GB free memory` });
  if (diskFreeGb < 5) problems.push({ code: "low-disk", msg: `${diskFreeGb.toFixed(1)} GB free disk`, hint: "remove stale target/ dirs in finished worktrees" });

  // Daemons.
  const live = await fetch(`http://127.0.0.1:${LIVE_PORT}/health`, { signal: AbortSignal.timeout(800) })
    .then((r) => r.text())
    .catch(() => null);
  checks.liveYardd = live ? { port: LIVE_PORT, health: live.trim(), note: "the user's daemon: never stop it, never test on it" } : null;
  checks.isos = isoLs().isos;

  // GitHub.
  if (tools.gh) {
    const auth = run(["gh", "auth", "status"]);
    checks.ghAuth = auth.code === 0;
    if (auth.code !== 0) warnings.push({ code: "gh-auth", msg: "gh is not logged in" });
  }

  // Engines (only matter for --engines real).
  checks.engines = { codex: run(["codex", "--version"]).out.trim() || null, claude: run(["claude", "--version"]).out.trim() || null };
  checks.selftest = existsSync(join(VERIFY, "src/selftest.ts"));

  return { ok: problems.length === 0, checks, problems, warnings, hint: problems[0]?.hint ?? warnings[0]?.hint };
}
