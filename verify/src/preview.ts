// `yv preview`: a PR's (or a branch's) build, running on scripted engines with
// demo sessions, reachable from the owner's other devices over Tailscale.
// The checkout is a worktree under .verify/previews, and the app is that
// checkout's own `yv iso up`, so a branch older than this command previews
// the way its own verification saw it. The daemon stays on loopback; a small
// forwarder (forward.ts) listens on the tailnet IP only, never the LAN.
import { spawn } from "node:child_process";
import { existsSync, openSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { type Args, ensureDir, git, readJson, REPO, run, sleep, STATE, VERIFY, writeJson } from "./common";
import { ghJson } from "./gh";
import { notify } from "./notify";
import { fail, Usage, type Result } from "./out";

const DIR = join(STATE, "previews");
const ISO = "preview";

export interface Preview {
  slug: string;
  target: string;
  title: string | null;
  sha: string;
  url: string;
  host: string;
  port: number;
  isoPort: number;
  isoPid: number;
  forwardPid: number;
  worktree: string;
  startedAt: string;
}

/** `75`, `#75`, a PR URL, `main` or a branch name → what to check out and how to name it. */
export function parseTarget(t: string): { pr: number | null; ref: string | null; slug: string } {
  const m = t.match(/^#?(\d+)$/) ?? t.match(/\/pull\/(\d+)/);
  if (m) return { pr: Number(m[1]), ref: null, slug: `pr-${m[1]}` };
  if (!/^[\w./-]+$/.test(t) || t.includes("..")) throw new Usage(`not a PR number or branch: ${t}`);
  return { pr: null, ref: t, slug: `ref-${t.replace(/[^\w-]+/g, "-")}` };
}

/**
 * The same PR gets the same port while it is free, so a bookmark or a tab
 * left open keeps working across re-previews. Stays clear of LocalStack
 * (4510-4559) and the live yardd (47717).
 */
export function preferredPort(slug: string): number {
  const pr = slug.match(/^pr-(\d+)$/);
  if (pr) return 48000 + (Number(pr[1]) % 1000);
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 49000 + (h % 1000);
}

/** This machine on the tailnet: its MagicDNS name and IPv4 address. */
function tailnet(): { name: string; ip: string } {
  const r = run(["tailscale", "status", "--json"]);
  if (r.code !== 0) fail("no-tailscale", "tailscale is not running here", "a preview is only reachable over Tailscale; `tailscale status`");
  const self = JSON.parse(r.out).Self ?? {};
  const ip = (self.TailscaleIPs ?? []).find((a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const name = String(self.DNSName ?? "").replace(/\.$/, "");
  if (!ip || !name) fail("no-tailscale", "tailscale reports no IPv4 address or MagicDNS name for this machine");
  return { name, ip };
}

function portFree(host: string, port: number): Promise<boolean> {
  return new Promise((done) => {
    const s = createServer();
    s.once("error", () => done(false));
    s.listen(port, host, () => s.close(() => done(true)));
  });
}

async function pickPort(host: string, slug: string): Promise<number> {
  const want = preferredPort(slug);
  if (await portFree(host, want)) return want;
  for (let i = 0; i < 50; i++) {
    const p = 49000 + Math.floor(Math.random() * 1000);
    if (await portFree(host, p)) return p;
  }
  return fail("no-port", `no free port on ${host} between 48000 and 49999`);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const recordFile = (slug: string) => join(DIR, `${slug}.json`);

function records(): Preview[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Preview>(join(DIR, f)));
}

/** Runs the preview checkout's own yv, as if typed in that worktree. */
function yvIn(worktree: string, args: string[]): any {
  const r = run([join(worktree, "verify/yv"), ...args], {
    cwd: worktree,
    env: { CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? "4" },
    timeoutMs: 20 * 60_000,
  });
  try {
    return JSON.parse(r.out);
  } catch {
    return { ok: false, problems: [{ code: "yv-output", msg: (r.err || r.out).trim().slice(-1500) }] };
  }
}

async function stop(p: Preview): Promise<string[]> {
  const notes: string[] = [];
  if (alive(p.forwardPid)) process.kill(p.forwardPid, "SIGTERM");
  if (existsSync(p.worktree)) {
    const down = yvIn(p.worktree, ["iso", "down", "--name", ISO]);
    if (!down.ok && alive(p.isoPid)) notes.push(`iso down: ${JSON.stringify(down.problems ?? down).slice(0, 300)}`);
    const rm = git(["worktree", "remove", "--force", p.worktree]);
    if (rm.code !== 0) notes.push(`worktree remove: ${rm.err.trim()}`);
  } else if (alive(p.isoPid)) {
    // The worktree is gone but the daemon is not: stop its process group.
    try {
      process.kill(-p.isoPid, "SIGTERM");
    } catch {}
  }
  rmSync(recordFile(p.slug), { force: true });
  rmSync(join(DIR, `${p.slug}.forward.log`), { force: true });
  return notes;
}

export async function previewUp(a: Args): Promise<Result> {
  const t = a.pos[0];
  if (!t) throw new Usage("preview <pr|branch> [--notify] | preview ls | preview down <pr|branch> | preview down --all");
  const { pr, ref, slug } = parseTarget(t);
  const net = tailnet();

  // Fetch what to show. refs/pull/N/head exists for open, merged and closed PRs alike.
  let sha: string;
  let title: string | null = null;
  if (pr !== null) {
    const v = ghJson(["pr", "view", String(pr), "--repo", REPO, "--json", "headRefOid,title"]) as { headRefOid: string; title: string };
    title = v.title;
    const f = git(["fetch", "-q", "origin", `+refs/pull/${pr}/head:refs/yv-preview/${slug}`]);
    if (f.code !== 0) fail("fetch", `could not fetch PR #${pr}: ${f.err.trim()}`);
    sha = v.headRefOid;
  } else {
    const f = git(["fetch", "-q", "origin", `+refs/heads/${ref}:refs/yv-preview/${slug}`]);
    if (f.code !== 0) fail("fetch", `could not fetch branch ${ref}: ${f.err.trim()}`);
    sha = git(["rev-parse", `refs/yv-preview/${slug}`]).out.trim();
  }

  // A second preview of the same target replaces the first (a PR got new commits).
  const old = existsSync(recordFile(slug)) ? readJson<Preview>(recordFile(slug)) : null;
  if (old) await stop(old);

  ensureDir(DIR);
  const worktree = join(DIR, slug);
  if (existsSync(worktree)) git(["worktree", "remove", "--force", worktree]);
  git(["worktree", "prune"]);
  const add = git(["worktree", "add", "-q", "--detach", worktree, sha]);
  if (add.code !== 0) fail("worktree", `could not check out ${sha.slice(0, 7)}: ${add.err.trim()}`);
  for (const d of ["ui", "sidecar/yard-claude", "verify"]) {
    if (!existsSync(join(worktree, d, "node_modules"))) run(["bun", "install", "--silent"], { cwd: join(worktree, d) });
  }

  const port = await pickPort(net.ip, slug);
  const url = `http://${net.name}:${port}`;
  // The page is opened at the MagicDNS name or the bare IP; yardd refuses any other Origin.
  const up = yvIn(worktree, ["iso", "up", "--name", ISO, "--env", `YARD_ALLOW_ORIGIN=${url}`]);
  if (!up.ok) {
    git(["worktree", "remove", "--force", worktree]);
    return { ok: false, target: t, sha, problems: up.problems ?? [{ code: "iso-up", msg: "iso up failed" }] };
  }
  const seed = yvIn(worktree, ["iso", "seed", "--name", ISO]);
  const isoPort: number = up.iso.port;
  const isoPid: number = up.iso.pid;

  const log = openSync(join(DIR, `${slug}.forward.log`), "a");
  const fwd = spawn("bun", [join(VERIFY, "src/forward.ts"), net.ip, String(port), String(isoPort), String(isoPid)], { detached: true, stdio: ["ignore", log, log] });
  fwd.unref();
  let healthy = false;
  for (let i = 0; i < 50 && !healthy; i++) {
    await sleep(100);
    healthy = await fetch(`http://${net.ip}:${port}/health`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false);
  }
  const p: Preview = { slug, target: t, title, sha, url: `${url}/`, host: net.ip, port, isoPort, isoPid, forwardPid: fwd.pid!, worktree, startedAt: new Date().toISOString() };
  writeJson(recordFile(slug), p);
  if (!healthy) {
    await stop(p);
    return fail("forward", `the preview did not answer on ${net.ip}:${port}`, `see ${join(DIR, `${slug}.forward.log`)}`);
  }
  let notified: unknown = null;
  if (a.flags.notify) notified = await notify(`Preview of ${pr !== null ? `#${pr}` : ref} is up: ${p.url}`, { title: "Switchyard preview", click: p.url });
  return {
    ok: true,
    preview: p,
    seeded: !!seed.ok,
    notified,
    hint: `open ${p.url} on any of your tailnet devices; scripted engines, demo sessions, nothing real. Stop it with: verify/yv preview down ${t}`,
  };
}

export function previewLs(): Result {
  const list = records().map((p) => ({ ...p, running: alive(p.isoPid) && alive(p.forwardPid) }));
  return { ok: true, previews: list };
}

export async function previewDown(a: Args): Promise<Result> {
  if (!a.flags.all && !a.pos[0]) throw new Usage("preview down <pr|branch> | preview down --all");
  const all = records();
  const which = a.flags.all ? all : all.filter((p) => p.slug === parseTarget(a.pos[0]).slug);
  if (!which.length) return { ok: true, stopped: [], hint: "no such preview: verify/yv preview ls" };
  const stopped = [];
  for (const p of which) stopped.push({ slug: p.slug, notes: await stop(p) });
  git(["worktree", "prune"]);
  return { ok: true, stopped };
}
