// Paths, flags, git and small helpers shared by every command.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fail, Usage } from "./out";

/** The checkout this CLI lives in. Each worktree verifies its own code. */
export const ROOT = resolve(import.meta.dir, "../..");
export const VERIFY = join(ROOT, "verify");
/** Per-checkout state: isolated daemons, evidence, shots. Gitignored. */
export const STATE = join(ROOT, ".verify");
/** State shared by every checkout on this machine: the land ledger, loop locks. */
export const SHARED = process.env.YV_SHARED_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "switchyard-verify");
export const LIVE_PORT = 47717;
/** The isolated environment commands use unless told otherwise (`map run` sets it per area). */
export const DEFAULT_ISO = process.env.YV_ISO || "default";
export const REPO = process.env.YV_REPO || "giovaniif/switchyard";

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson<T = any>(path: string, fallback?: T): T {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    fail("missing-file", `${path} does not exist`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
export const sha256File = (path: string) => sha256(readFileSync(path));

export interface Args {
  pos: string[];
  flags: Record<string, string | true>;
}

/** `--flag value`, `--flag=value`, and boolean flags named in `bools`. */
export function parseArgs(argv: string[], bools: string[] = []): Args {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const name = a.slice(2);
      if (bools.includes(name)) {
        flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next === undefined) throw new Usage(`--${name} needs a value`);
      flags[name] = next;
      i++;
      continue;
    }
    pos.push(a);
  }
  return { pos, flags };
}

export const str = (a: Args, name: string, fallback?: string): string | undefined => {
  const v = a.flags[name];
  if (v === undefined || v === true) return fallback;
  return v;
};

export const need = (a: Args, name: string): string => {
  const v = str(a, name);
  if (!v) throw new Usage(`--${name} is required`);
  return v;
};

export interface Run {
  code: number;
  out: string;
  err: string;
}

/** Runs a command to completion and captures both streams. Never throws on a non-zero exit. */
export function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeoutMs?: number } = {}): Run {
  if (!Bun.which(cmd[0], { PATH: opts.env?.PATH ?? process.env.PATH }) && !cmd[0].includes("/")) return { code: 127, out: "", err: `${cmd[0]}: not found` };
  const p = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env } as Record<string, string>,
    stdin: opts.input !== undefined ? Buffer.from(opts.input) : "ignore",
    timeout: opts.timeoutMs,
  });
  return { code: p.exitCode ?? 1, out: p.stdout.toString(), err: p.stderr.toString() };
}

export function git(args: string[], cwd = ROOT): Run {
  return run(["git", ...args], { cwd });
}

export function gitOut(args: string[], cwd = ROOT): string {
  const r = git(args, cwd);
  if (r.code !== 0) fail("git", `git ${args.join(" ")} failed: ${r.err.trim()}`);
  return r.out.trim();
}

/** What goes into the yardd and UI builds: a change elsewhere needs no rebuild. */
export const BUILD_PATHS = ["crates", "ui", "sidecar", "Cargo.toml", "Cargo.lock", "scripts/remote-install.sh"];

/**
 * HEAD, and whether the tree differs from it (ignoring our own state).
 * With `paths`, only those paths count.
 */
export function headState(cwd = ROOT, paths: string[] = ["."]): { sha: string; short: string; dirty: boolean; diffHash: string | null } {
  const sha = gitOut(["rev-parse", "HEAD"], cwd);
  const status = git(["status", "--porcelain", "--untracked-files=all", "--", ...paths, ":(exclude).verify"], cwd).out.trim();
  const dirty = status.length > 0;
  const diffHash = dirty ? sha256(git(["diff", "HEAD", "--", ...paths], cwd).out + status).slice(0, 16) : null;
  return { sha, short: sha.slice(0, 7), dirty, diffHash };
}

/** The merge-base with main, preferring origin/main. */
export function mergeBase(head = "HEAD", cwd = ROOT): string {
  for (const main of ["origin/main", "main"]) {
    const r = git(["merge-base", main, head], cwd);
    if (r.code === 0) return r.out.trim();
  }
  return fail("no-merge-base", "cannot find a merge-base with main", "git fetch origin main");
}

/** A free loopback port away from the live yardd and LocalStack. */
export async function freePort(): Promise<number> {
  for (;;) {
    const srv = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = srv.port;
    srv.stop(true);
    if (port !== LIVE_PORT && !(port >= 4510 && port <= 4559)) return port;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const nowIso = () => new Date().toISOString();

/**
 * A tiny path language for picking values out of JSON:
 * `sessions.0.id`, `sessions[title*=greeting].id`, `event.type`, `hosts[status=connected].id`.
 */
export function pick(value: any, path: string): any {
  let cur = value;
  const parts = path.match(/[^.[\]]+|\[[^\]]*\]/g) ?? [];
  for (const part of parts) {
    if (cur === undefined || cur === null) return undefined;
    if (part.startsWith("[")) {
      const m = part.slice(1, -1).match(/^([\w.]+)(\*=|=|\^=)(.*)$/);
      if (!m) return undefined;
      const [, key, opr, want] = m;
      const list = Array.isArray(cur) ? cur : Object.values(cur);
      cur = list.find((el: any) => {
        const got = String(pick(el, key) ?? "");
        return opr === "=" ? got === want : opr === "^=" ? got.startsWith(want) : got.includes(want);
      });
    } else {
      cur = cur[part];
    }
  }
  return cur;
}

/** Does `got` contain everything in `want`? Arrays in `want` must each match some element. */
export function matches(got: any, want: any): boolean {
  if (want === null || typeof want !== "object") {
    if (typeof want === "string" && want.startsWith("~")) return typeof got === "string" && got.includes(want.slice(1));
    return got === want;
  }
  if (got === null || typeof got !== "object") return false;
  if (Array.isArray(want)) return Array.isArray(got) && want.every((w) => got.some((g: any) => matches(g, w)));
  return Object.entries(want).every(([k, v]) => matches(got[k], v));
}

export function parseJsonArg(text: string, what: string): any {
  try {
    return JSON.parse(text);
  } catch (e: any) {
    throw new Usage(`${what} is not valid JSON: ${e.message}`);
  }
}
