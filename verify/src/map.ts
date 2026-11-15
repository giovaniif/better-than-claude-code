// The feature map: verify/features/<area>.md, each with Setup, Cleanup and
// runnable Recipes. `map run` executes them and records pass, fail,
// needs-var or manual per recipe; `map status` reads the last results.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Args, ensureDir, nowIso, ROOT, STATE, str, VERIFY } from "./common";
import { fail, Usage, type Result } from "./out";

export const FEATURES = join(VERIFY, "features");
const RESULTS = join(STATE, "map");

export interface Block {
  code: string;
}

export interface Recipe {
  label: string;
  manual: string | null;
  needs: string[];
  /** Prose: what to expect and what to read back. */
  text: string;
  blocks: Block[];
  viewports: string | null;
}

export interface Area {
  name: string;
  title: string;
  setup: Block[];
  cleanup: Block[];
  recipes: Recipe[];
  gotchas: string[];
}

const fences = (text: string): Block[] => [...text.matchAll(/```(?:sh|bash|yv)\n([\s\S]*?)```/g)].map((m) => ({ code: m[1].trim() }));

/** Parses one area file. Recipes are `### label` (or `### label (manual: why)`) under `## Recipes`. */
export function parseArea(name: string, md: string): Area {
  const title = md.match(/^# (.+)$/m)?.[1]?.trim() ?? name;
  const sections = new Map<string, string>();
  const parts = md.split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    sections.set(p.slice(0, nl).trim().toLowerCase(), p.slice(nl + 1));
  }
  const recipesText = sections.get("recipes") ?? "";
  const recipes: Recipe[] = recipesText
    .split(/^### /m)
    .slice(1)
    .map((chunk) => {
      const nl = chunk.indexOf("\n");
      const head = chunk.slice(0, nl).trim();
      const body = chunk.slice(nl + 1);
      const manual = head.match(/\(manual:\s*([^)]*)\)/)?.[1]?.trim() ?? null;
      const label = head.replace(/\(manual:[^)]*\)/, "").trim();
      const needs = (body.match(/^Needs:\s*(.+)$/m)?.[1] ?? "")
        .split(/[ ,]+/)
        .filter((v) => /^[A-Z_][A-Z0-9_]*$/.test(v));
      const viewports = body.match(/^Viewports:\s*(.+)$/m)?.[1]?.trim() ?? null;
      const text = body.replace(/```[\s\S]*?```/g, "").trim();
      return { label, manual, needs, text, blocks: fences(body), viewports };
    });
  const gotchas = (sections.get("gotchas") ?? "")
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim());
  return { name, title, setup: fences(sections.get("setup") ?? ""), cleanup: fences(sections.get("cleanup") ?? ""), recipes, gotchas };
}

export function areas(): string[] {
  return existsSync(FEATURES)
    ? readdirSync(FEATURES)
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => f.slice(0, -3))
        .sort()
    : [];
}

export function loadArea(name: string): Area {
  const f = join(FEATURES, `${name}.md`);
  if (!existsSync(f)) fail("no-area", `no feature map area ${name}`, `areas: ${areas().join(", ")}`);
  return parseArea(name, readFileSync(f, "utf8"));
}

interface BlockRun {
  code: number;
  ms: number;
  tail: string;
  json: any;
}

/** Runs one fenced block with bash -e, `yv` on PATH and the area's isolated environment. */
async function runBlock(code: string, iso: string, timeoutMs: number): Promise<BlockRun> {
  const t0 = Date.now();
  // `yv` runs the CLI; `v name` prints a saved variable for plain shell commands.
  const script = `set -euo pipefail\nyv() { "${VERIFY}/yv" "$@"; }\nv() { "${VERIFY}/yv" var get "$1" | jq -er .value; }\nexport -f yv v\n${code}\n`;
  const p = Bun.spawn(["bash", "-c", script], {
    cwd: ROOT,
    env: { ...process.env, YV_ISO: iso } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const exit = await p.exited;
  clearTimeout(timer);
  // The last JSON object the block printed: the failing command's verdict.
  let json: any = null;
  const objs = out.split(/\n(?=\{\n  "command")/);
  try {
    json = JSON.parse(objs[objs.length - 1]);
  } catch {}
  const timedOut = Date.now() - t0 >= timeoutMs;
  return { code: timedOut ? 124 : exit, ms: Date.now() - t0, tail: (out + err).slice(-2500), json };
}

type Status = "pass" | "fail" | "needs-var" | "manual" | "skipped";

export async function runArea(area: Area, only: string | null, timeoutMs: number) {
  const iso = `map-${area.name}`;
  const results: { label: string; status: Status; ms?: number; why?: string; problems?: unknown; tail?: string }[] = [];
  const picked = area.recipes.filter((r) => !only || r.label === only);
  if (only && picked.length === 0) fail("no-recipe", `no recipe ${only} in ${area.name}`, `recipes: ${area.recipes.map((r) => r.label).join(", ")}`);
  let setupFailed: BlockRun | null = null;
  const runnable = picked.some((r) => !r.manual && r.needs.every((v) => process.env[v]));
  if (runnable) {
    for (const b of area.setup) {
      const r = await runBlock(b.code, iso, timeoutMs);
      if (r.code !== 0) {
        setupFailed = r;
        break;
      }
    }
  }
  for (const r of picked) {
    if (r.manual) {
      results.push({ label: r.label, status: "manual", why: r.manual });
      continue;
    }
    const missing = r.needs.filter((v) => !process.env[v]);
    if (missing.length) {
      results.push({ label: r.label, status: "needs-var", why: `set ${missing.join(", ")}` });
      continue;
    }
    if (setupFailed) {
      results.push({ label: r.label, status: "skipped", why: "Setup failed", tail: setupFailed.tail });
      continue;
    }
    let status: Status = "pass";
    let detail: BlockRun | null = null;
    let ms = 0;
    for (const b of r.blocks) {
      const run = await runBlock(b.code, iso, timeoutMs);
      ms += run.ms;
      if (run.code !== 0) {
        detail = run;
        // A variable that was never saved is a map gap, not a product bug.
        status = run.json?.problems?.some((p: any) => p.code === "needs-var") ? "needs-var" : "fail";
        break;
      }
    }
    if (r.blocks.length === 0) results.push({ label: r.label, status: "fail", why: "the recipe has no runnable block; mark it (manual: why)" });
    else results.push({ label: r.label, status, ms, ...(detail ? { problems: detail.json?.problems, tail: detail.tail } : {}) });
  }
  if (runnable) for (const b of area.cleanup) await runBlock(b.code, iso, timeoutMs);
  const counts = results.reduce((acc: Record<string, number>, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
  const record = { area: area.name, at: nowIso(), counts, setupFailed: setupFailed ? setupFailed.tail : null, results };
  ensureDir(RESULTS);
  writeFileSync(join(RESULTS, `${area.name}.json`), JSON.stringify(record, null, 2));
  return record;
}

export async function map(a: Args): Promise<Result> {
  const [sub, target] = a.pos;
  if (sub === "status") {
    const list = target ? [target] : areas();
    const rows = list.map((n) => {
      const area = loadArea(n);
      const f = join(RESULTS, `${n}.json`);
      const last = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
      return {
        area: n,
        title: area.title,
        recipes: area.recipes.map((r) => ({ label: r.label, manual: r.manual, needs: r.needs, last: last?.results.find((x: any) => x.label === r.label)?.status ?? null })),
        lastRun: last?.at ?? null,
        counts: last?.counts ?? null,
        gotchas: area.gotchas.length,
      };
    });
    return { ok: true, areas: rows };
  }
  if (sub === "run") {
    if (!target) throw new Usage("map run <area|all> [--recipe label]");
    const list = target === "all" ? areas() : [target];
    const timeoutMs = Number(str(a, "timeout", "180000"));
    const records = [];
    for (const n of list) records.push(await runArea(loadArea(n), str(a, "recipe") ?? null, timeoutMs));
    const failed = records.flatMap((r) => r.results.filter((x) => x.status === "fail" || x.status === "skipped").map((x) => `${r.area}/${x.label}`));
    return {
      ok: failed.length === 0,
      records,
      problems: failed.map((f) => ({ code: "recipe-failed", msg: f, hint: "map drift: fix the recipe to match the app; product bug: keep it failing, add a Gotcha, queue a finding" })),
    };
  }
  throw new Usage("map status [area] | map run <area|all> [--recipe label]");
}
