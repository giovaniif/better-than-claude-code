// `assets push`: hosts PR images on an orphan branch (`verify-assets`) and
// returns commit-pinned raw URLs, so a PR body can show images without
// committing them to the PR branch. `assets check`: the PR branch adds no
// image or video outside the places that legitimately hold them.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { type Args, git, mergeBase, REPO, run, sha256File, str } from "./common";
import { fail, Usage, type Result } from "./out";

export const ASSET_BRANCH = "verify-assets";
const MEDIA = /\.(png|jpe?g|gif|webp|webm|mp4|mov)$/i;
/** Images that belong in the repository: README screenshots, app icons, favicons. */
const ALLOWED = [/^docs\/screenshots\//, /^app\/src-tauri\/icons\//, /^ui\/public\//];

function gitIn(args: string[], input?: string) {
  const r = run(["git", ...args], { input });
  if (r.code !== 0) fail("git", `git ${args.join(" ")} failed: ${r.err.trim().slice(0, 300)}`);
  return r.out.trim();
}

function push(files: string[], label: string, dryRun: boolean): Result {
  if (!files.length) throw new Usage("assets push <file>... [--label pr-123]");
  if (!/^[\w.-]+$/.test(label)) throw new Usage("--label takes letters, digits, . _ -");
  // The current tip of the asset branch, if any (fetched fresh: other worktrees push too).
  git(["fetch", "-q", "origin", `+refs/heads/${ASSET_BRANCH}:refs/remotes/origin/${ASSET_BRANCH}`]);
  const parent = git(["rev-parse", "-q", "--verify", `refs/remotes/origin/${ASSET_BRANCH}`]).out.trim() || null;

  // Build the new tree with plumbing: no checkout, nothing touches the working tree.
  const entries: Record<string, string> = {};
  if (parent) {
    for (const line of gitIn(["ls-tree", "-r", parent]).split("\n").filter(Boolean)) {
      const [meta, path] = line.split("\t");
      entries[path] = meta.split(" ")[2];
    }
  }
  const paths: Record<string, string> = {};
  for (const f of files) {
    const hash = sha256File(f).slice(0, 12);
    const path = `${label}/${hash}-${basename(f).replace(/[^\w.-]/g, "_")}`;
    entries[path] = gitIn(["hash-object", "-w", f]);
    paths[f] = path;
  }
  // mktree takes a flat list only for one level; build nested trees bottom-up.
  const tree = writeTree(entries);
  const args = ["commit-tree", tree, "-m", `assets: ${label}`];
  if (parent) args.push("-p", parent);
  const commit = gitIn(args);
  if (!dryRun) {
    const r = git(["push", "-q", "origin", `${commit}:refs/heads/${ASSET_BRANCH}`]);
    if (r.code !== 0) fail("push", `pushing ${ASSET_BRANCH} failed: ${r.err.trim().slice(0, 300)}`, "another worktree pushed at the same time: run it again");
  }
  const urls = Object.fromEntries(Object.entries(paths).map(([f, p]) => [f, `https://raw.githubusercontent.com/${REPO}/${commit}/${p}`]));
  const markdown = Object.entries(paths).map(([f, p]) => (/\.(webm|mp4|mov)$/i.test(f) ? `[${basename(f)}](${urls[f]})` : `![${basename(f)}](${urls[f]})`));
  return { ok: true, commit, branch: ASSET_BRANCH, pushed: !dryRun, urls, markdown };
}

function writeTree(entries: Record<string, string>): string {
  type Dir = { files: Record<string, string>; dirs: Record<string, Dir> };
  const root: Dir = { files: {}, dirs: {} };
  for (const [path, blob] of Object.entries(entries)) {
    const parts = path.split("/");
    let d = root;
    for (const p of parts.slice(0, -1)) d = d.dirs[p] ??= { files: {}, dirs: {} };
    d.files[parts[parts.length - 1]] = blob;
  }
  const write = (d: Dir): string => {
    const lines = [
      ...Object.entries(d.files).map(([n, b]) => `100644 blob ${b}\t${n}`),
      ...Object.entries(d.dirs).map(([n, sub]) => `040000 tree ${write(sub)}\t${n}`),
    ];
    return gitIn(["mktree"], lines.join("\n") + "\n");
  };
  return write(root);
}

export function checkMedia(changed: { status: string; path: string }[]) {
  return changed.filter((c) => c.status !== "D" && MEDIA.test(c.path) && !ALLOWED.some((r) => r.test(c.path)));
}

function check(a: Args): Result {
  const base = str(a, "base") ?? mergeBase("HEAD");
  const head = str(a, "head", "HEAD")!;
  const changed = git(["diff", "--name-status", `${base}..${head}`])
    .out.trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, ...p] = l.split("\t");
      return { status: status[0], path: p[p.length - 1] };
    });
  const bad = checkMedia(changed);
  return {
    ok: bad.length === 0,
    base,
    media: bad,
    problems: bad.map((b) => ({ code: "committed-media", msg: `${b.path} is committed to the PR branch`, hint: "git rm it, push it with `verify/yv assets push`, and link the URL in the PR body" })),
  };
}

export function assets(a: Args): Result {
  const [sub, ...files] = a.pos;
  if (sub === "push") return push(files, str(a, "label", "misc")!, !!a.flags["dry-run"]);
  if (sub === "check") return check(a);
  throw new Usage("assets push <file>... [--label pr-123] [--dry-run] | assets check [--base ref]");
}

export const _test = { writeTree, readFileSync };
