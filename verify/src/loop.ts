// `loop`: the agent loops on the live yardd. The scheduled ones (patrol,
// maintain, review) are yardd automations that `loop automations --apply`
// creates or updates, so their runs live on the Automations page. `loop run`
// starts one as an ordinary session: verify and babysit runs, and a scheduled
// loop by hand.
//
// This is the only code in verify/ that talks to the live yardd (47717). It
// reads the snapshot, creates sessions, saves the loop automations and
// archives finished loop sessions. It never deletes a session and never
// touches a session it did not start.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { cpus, homedir, loadavg } from "node:os";
import { join } from "node:path";
import { type Args, matches, nowIso, readJson, REPO, run, SHARED, sleep, str, VERIFY } from "./common";
import { loadIso } from "./iso";
import { fail, Usage, type Result } from "./out";

const KINDS = ["patrol", "maintain", "review", "verify", "babysit"] as const;
type Kind = (typeof KINDS)[number];
/** The loops yardd schedules as automations; verify and babysit are started per PR. */
const SCHEDULED = ["patrol", "maintain", "review"] as const;
// Also the automation's name: yardd titles its runs `<name> · <date>`, so
// tidy, status, log and the busy check find them by the same prefix.
const TITLE = (kind: string) => `Loop ${kind}`;
const PAUSED = () => join(SHARED, "loops", "paused");

const expand = (p: string) => p.replace(/^~(?=\/|$)/, homedir());

export function loopsConfig(): any {
  return readJson(join(VERIFY, "loops.json"));
}

interface Live {
  send(m: object): void;
  log: any[];
  close(): void;
}

async function live(url: string): Promise<{ ws: Live; snap: any }> {
  const log: any[] = [];
  const sock = new WebSocket(url);
  sock.onmessage = (e) => log.push(JSON.parse(String(e.data)));
  await new Promise<void>((res, rej) => {
    sock.onopen = () => res();
    sock.onerror = () => rej(new Error(`cannot reach the live yardd at ${url}`));
  }).catch((e) => fail("yardd-down", e.message, "systemctl --user status yardd"));
  const end = Date.now() + 10000;
  while (!log.find((m) => m.op === "snapshot")) {
    if (Date.now() > end) fail("no-snapshot", "the live yardd sent no snapshot");
    await sleep(25);
  }
  // Usage and models can follow the snapshot.
  await sleep(500);
  return { ws: { send: (m) => sock.send(JSON.stringify(m)), log, close: () => sock.close() }, snap: log.find((m) => m.op === "snapshot") };
}

function sessionsOf(ws: Live): any[] {
  const out: Record<string, any> = {};
  for (const m of ws.log) {
    if (m.op === "snapshot") for (const s of m.sessions ?? []) out[s.id] = s;
    if (m.op === "session" && m.session) out[m.session.id] = m.session;
  }
  return Object.values(out).filter((s) => s.host === "local" || !s.host);
}

function usageOf(ws: Live): any {
  let u: any = {};
  for (const m of ws.log) if (m.op === "snapshot" || m.op === "usage") u = { ...u, ...(m.usage ?? {}) };
  return u;
}

/** Why this run should not start now, or null. */
function skipReason(kind: Kind, engine: string, sessions: any[], usage: any, cfg: any, force: boolean): string | null {
  if (existsSync(PAUSED())) return `loops are paused (${PAUSED()}); verify/yv loop resume`;
  if (force) return null;
  const busy = sessions.find((s) => s.title.startsWith(TITLE(kind)) && ["running", "needs_approval", "queued"].includes(s.status) && Date.now() - s.createdAt < 3 * 3600_000);
  if (busy && kind !== "verify" && kind !== "babysit") return `a ${kind} run is still going: "${busy.title}" (${busy.status})`;
  // Verifier and babysit runs are what land PRs: the owner wants them to run
  // whatever the usage (2026-11-15). The scheduled loops keep the budget.
  if (kind === "verify" || kind === "babysit") return null;
  const per = loadavg()[0] / cpus().length;
  if (per > cfg.budget.maxLoadPerCore) return `machine busy: load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores`;
  const b = cfg.budget[engine] ?? {};
  if (engine === "codex") {
    const p = usage.codex?.primary?.usedPercent;
    const s = usage.codex?.secondary?.usedPercent;
    if (p !== undefined && p > b.primaryMax) return `Codex 5-hour usage ${p}% is above ${b.primaryMax}%`;
    if (s !== undefined && s > b.secondaryMax) return `Codex weekly usage ${s}% is above ${b.secondaryMax}%`;
  }
  if (engine === "claude") {
    // yardd refreshes Claude usage only during Claude turns: a 5-hour figure
    // whose window has already reset is stale, not a reason to skip.
    const reset = usage.claude?.resetsAt;
    const f = reset && Date.now() / 1000 > reset ? null : usage.claude?.fiveHour;
    const w = usage.claude?.sevenDay;
    if (f != null && f * 100 > b.fiveHourMax) return `Claude 5-hour usage ${(f * 100).toFixed(0)}% is above ${b.fiveHourMax}%`;
    if (w != null && w * 100 > b.sevenDayMax) return `Claude weekly usage ${(w * 100).toFixed(0)}% is above ${b.sevenDayMax}%`;
  }
  return null;
}

/** What every loop is told about how it runs. */
function unattended(started: string, budget: string): string {
  return `${started} It runs unattended in its own worktree, branched from origin/main, with full access. Nobody is watching live: never wait for an answer in this session; questions for the owner go to the PR thread or \`verify/yv notify\`.\n\n${budget} Read the clock with \`date -u\`; never estimate times.`;
}

function prompt(kind: Kind, l: any, start: Date, pr: number | null): string {
  const t = start.toISOString().slice(0, 16).replace("T", " ");
  const end = new Date(start.getTime() + l.minutes * 60000).toISOString().slice(11, 16);
  const head = `${TITLE(kind)}${pr ? ` #${pr}` : ""} ${t} UTC`;
  const common = unattended(`This session was started by \`verify/yv loop run ${kind}\`.`, `Your budget ends at ${end} UTC (${l.minutes} minutes).`);
  switch (kind) {
    case "verify":
      return `${head}\n\nYou are an independent verifier. You know only this pull request: https://github.com/${REPO}/pull/${pr}\n\nRead and follow .claude/skills/verifier/SKILL.md exactly. Do not read other sessions, other worktrees or the author's notes.\n\n${common}`;
    case "babysit":
      return `${head}\n\nBabysit https://github.com/${REPO}/pull/${pr} to ready. Read and follow .claude/skills/babysit/SKILL.md.\n\n${common}`;
    default:
      return `${head}\n\n${task(l)}\n\n${common}`;
  }
}

const task = (l: any) => `Read and follow ${l.skill} exactly. Also read CLAUDE.md and .claude/skills/verify/SKILL.md before you start.`;

/**
 * A scheduled loop's prompt. An automation's prompt is fixed, so where
 * `prompt()` writes the start and end times this tells the agent to read them.
 */
function automationPrompt(kind: Kind, l: any): string {
  const started = `This session is a run of the Switchyard automation "${TITLE(kind)}" (schedule and settings: verify/loops.json, installed by \`verify/yv loop automations --apply\`).`;
  const budget = `Your budget is ${l.minutes} minutes from the start of this run: run \`date -u\` first and note the start time and the end time (start plus ${l.minutes} minutes).`;
  return `${task(l)}\n\n${unattended(started, budget)}`;
}

/** The fields `automation.save` gets for one scheduled loop. */
function automationSpec(kind: Kind, cfg: any, checkout: string, model: string): Record<string, unknown> {
  const l = cfg.loops[kind];
  if (!l?.schedule) fail("no-schedule", `verify/loops.json gives the ${kind} loop no schedule`);
  const b = cfg.budget[l.engine] ?? {};
  const [five, week] = l.engine === "codex" ? [b.primaryMax, b.secondaryMax] : [b.fiveHourMax, b.sevenDayMax];
  return {
    name: TITLE(kind),
    prompt: automationPrompt(kind, l),
    cwd: checkout,
    engine: l.engine,
    model,
    effort: l.effort,
    permission: "full",
    base: "main",
    schedule: l.schedule,
    skipWhileRunning: true,
    maxFiveHour: five ?? null,
    maxWeek: week ?? null,
  };
}

/** The keys of `want` whose value differs in `have`. */
function changed(want: Record<string, unknown>, have: any): string[] {
  // yardd writes a schedule's keys in its own order.
  const canon = (v: unknown): string =>
    v && typeof v === "object" && !Array.isArray(v)
      ? `{${Object.keys(v).sort().map((k) => `${k}:${canon((v as any)[k])}`).join(",")}}`
      : JSON.stringify(v ?? null);
  return Object.keys(want).filter((k) => canon(want[k]) !== canon(have?.[k]));
}

/** Archives finished loop sessions beyond the newest few, and frees their build output. */
function tidy(ws: Live, sessions: any[], keep: number): { archived: string[]; pruned: string[] } {
  const archived: string[] = [];
  const pruned: string[] = [];
  for (const kind of KINDS) {
    const done = sessions
      .filter((s) => s.title.startsWith(TITLE(kind)) && s.status === "idle" && !s.pinned)
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const s of done.slice(keep)) {
      if (!s.archived) {
        ws.send({ op: "session.update", sessionId: s.id, archived: true });
        archived.push(s.title);
      }
    }
    for (const s of done) {
      // A finished run's target/ is gigabytes; its source stays for reading.
      const idleFor = Date.now() - (s.updatedAt ?? s.createdAt);
      const target = join(s.cwd ?? "", "target");
      if (idleFor > 2 * 3600_000 && s.cwd?.includes("/wt/") && existsSync(join(target, "CACHEDIR.TAG"))) {
        rmSync(target, { recursive: true, force: true });
        pruned.push(target);
      }
    }
  }
  return { archived, pruned };
}

async function runLoop(a: Args): Promise<Result> {
  const kind = a.pos[1] as Kind;
  if (!KINDS.includes(kind)) throw new Usage(`loop run ${KINDS.join("|")} [--pr N]`);
  const pr = str(a, "pr") ? Number(str(a, "pr")) : null;
  if ((kind === "verify" || kind === "babysit") && !pr) throw new Usage(`loop run ${kind} needs --pr N`);
  const cfg = loopsConfig();
  const l = { ...cfg.loops[kind] };
  for (const k of ["engine", "model", "effort"]) if (str(a, k)) l[k] = str(a, k);
  const checkout = expand(str(a, "checkout") ?? cfg.checkout);
  if (!existsSync(join(checkout, ".git"))) fail("no-checkout", `${checkout} is not a checkout`, "verify/loops/install.sh sets it up");

  const { ws, snap } = await live(cfg.yardUrl);
  try {
    const sessions = sessionsOf(ws);
    const usage = usageOf(ws);
    const tidied = a.flags["dry-run"] ? { archived: [], pruned: [] } : tidy(ws, sessions, cfg.keepFinishedSessions ?? 0);
    // A logged-out engine cannot run a loop: fall back when the config allows it.
    let engines: any = null;
    {
      const from = ws.log.length;
      ws.send({ op: "engines.status" });
      const end = Date.now() + 15000;
      while (!engines && Date.now() < end) {
        engines = ws.log.slice(from).find((m) => m.op === "engines")?.engines ?? null;
        await sleep(100);
      }
    }
    let fellBack: string | null = null;
    if (engines && engines[l.engine]?.loggedIn === false && !str(a, "engine")) {
      const fb = cfg.fallback;
      if (fb && engines[fb.engine]?.loggedIn) {
        fellBack = `${l.engine} is logged out on this host; using ${fb.engine}`;
        l.engine = fb.engine;
        l.model = fb.model ?? "default";
        l.effort = fb.effort ?? l.effort;
      } else {
        const why = `${l.engine} is logged out on this host${fb ? ` and the fallback ${fb.engine} is not logged in either` : ""}; log in from Switchyard's Hosts page`;
        mkdirSync(join(SHARED, "loops"), { recursive: true });
        writeFileSync(join(SHARED, "loops", `${kind}.last.json`), JSON.stringify({ at: nowIso(), failed: why }, null, 2));
        fail("engine-logged-out", why, "Hosts → Log in, or `codex login --device-auth` on the server");
      }
    }
    const budget = fellBack ? { ...cfg, budget: { ...cfg.budget, [l.engine]: cfg.fallback.budget ?? cfg.budget[l.engine] } } : cfg;
    const why = skipReason(kind, l.engine, sessions, usage, budget, !!a.flags.force);
    const record = (entry: object) => {
      mkdirSync(join(SHARED, "loops"), { recursive: true });
      writeFileSync(join(SHARED, "loops", `${kind}.last.json`), JSON.stringify({ at: nowIso(), ...entry }, null, 2));
    };
    if (why) {
      record({ skipped: why, fellBack });
      return { ok: true, skipped: why, fellBack, tidied };
    }
    const models = snap.models?.[l.engine] ?? [];
    const model = l.model === "default" ? (models.find((m: any) => m.isDefault) ?? models[0])?.id : l.model;
    if (!model) fail("no-model", `the live yardd lists no ${l.engine} models`);
    const start = new Date();
    const text = prompt(kind, l, start, pr);
    const create = { op: "session.create", engine: l.engine, model, effort: l.effort, cwd: checkout, worktree: true, base: "origin/main", permission: "full", text };
    if (a.flags["dry-run"]) return { ok: true, dryRun: true, would: create, fellBack, usage, tidied };
    const from = ws.log.length;
    ws.send(create);
    const end = Date.now() + 60000;
    let reply: any = null;
    while (!reply && Date.now() < end) {
      reply = ws.log.slice(from).find((m) => m.op === "created" || (m.op === "error" && m.for === "session.create"));
      await sleep(50);
    }
    if (!reply) fail("timeout", "the live yardd did not answer session.create within 60 s");
    if (reply.op === "error") fail("create-failed", reply.message);
    await sleep(300);
    record({ started: reply.sessionId, model, effort: l.effort, engine: l.engine, pr, fellBack });
    return { ok: true, started: { sessionId: reply.sessionId, kind, engine: l.engine, model, effort: l.effort, pr }, fellBack, tidied };
  } finally {
    ws.close();
  }
}

const TIMER = (kind: string) => `switchyard-loop-${kind}.timer`;

/** The old systemd timer of a scheduled loop: `enabled`, `disabled`, `not-found`… */
function timerState(kind: string): { timer: string; enabled: string; active: string } {
  const q = (verb: string) => run(["systemctl", "--user", verb, TIMER(kind)]).out.trim() || "unknown";
  return { timer: TIMER(kind), enabled: q("is-enabled"), active: q("is-active") };
}

/**
 * Creates or updates the scheduled loops as automations on a yardd (the live
 * one by default), found by name so a second run edits instead of adding.
 * An existing automation keeps its Enabled switch: the owner may have turned
 * one off on the page. Applied to the live yardd, it also turns off the old
 * systemd timers that started the same loops.
 */
async function installAutomations(a: Args): Promise<Result> {
  const cfg = loopsConfig();
  const iso = str(a, "iso");
  const url = iso ? `ws://127.0.0.1:${loadIso(iso).port}/ws` : cfg.yardUrl;
  const checkout = expand(str(a, "checkout") ?? cfg.checkout);
  if (!existsSync(join(checkout, ".git"))) fail("no-checkout", `${checkout} is not a checkout`, "verify/loops/install.sh sets it up");
  const { ws, snap } = await live(url);
  try {
    const request = async (msg: { op: string }, want: string, ms = 15000): Promise<any> => {
      const ref = `yv-${Math.random().toString(36).slice(2)}`;
      const from = ws.log.length;
      ws.send({ ...msg, ref });
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = ws.log.slice(from).find((x) => x.ref === ref && (x.op === want || x.op === "error"));
        if (m?.op === "error") fail("automation-error", `${msg.op}: ${m.message}`);
        if (m) return m;
        await sleep(50);
      }
      return fail("timeout", `the yardd at ${url} did not answer ${msg.op} within ${ms / 1000} s`);
    };
    const list: any[] = (await request({ op: "automation.list" }, "automations")).automations ?? [];
    const plan = SCHEDULED.map((kind) => {
      const l = cfg.loops[kind];
      const models = snap.models?.[l.engine] ?? [];
      const model = l.model === "default" ? (models.find((m: any) => m.isDefault) ?? models[0])?.id : l.model;
      if (!model) fail("no-model", `the yardd lists no ${l.engine} models`);
      const spec = automationSpec(kind, cfg, checkout, model);
      const same = list.filter((x) => x.name === spec.name);
      if (same.length > 1) fail("duplicate-automations", `${same.length} automations are named "${spec.name}": ${same.map((x) => x.id).join(", ")}`, "delete the extras on the Automations page");
      const have = same[0];
      return { kind, spec, have, changes: have ? changed(spec, have) : [] };
    });
    const show = (x: any) => ({
      id: x.id,
      name: x.name,
      enabled: x.enabled,
      schedule: x.schedule,
      nextRun: x.nextRun ? new Date(x.nextRun).toISOString() : null,
      lastRun: x.lastRun ?? null,
    });
    // Only the live yardd's loops had timers; an isolated one leaves them alone.
    const touchTimers = !iso;
    if (!a.flags.apply) {
      return {
        ok: true,
        dryRun: true,
        url,
        plan: plan.map((p) => ({ kind: p.kind, action: !p.have ? "create" : p.changes.length ? "update" : "unchanged", id: p.have?.id ?? null, changes: p.changes })),
        timers: touchTimers ? SCHEDULED.map(timerState) : "left alone (--iso)",
        hint: "add --apply to save them",
      };
    }
    const saved: any[] = [];
    for (const p of plan) {
      if (p.have && !p.changes.length) {
        saved.push({ ...show(p.have), action: "unchanged" });
        continue;
      }
      const automation = p.have ? { id: p.have.id, ...p.spec } : { ...p.spec, enabled: true };
      const r = await request({ op: "automation.save", automation } as { op: string }, "automation.saved");
      saved.push({ ...show(r.automation), action: p.have ? "updated" : "created", changes: p.changes });
    }
    const timers = touchTimers
      ? SCHEDULED.map((kind) => {
          const before = timerState(kind);
          if (before.enabled === "not-found") return before;
          const off = run(["systemctl", "--user", "disable", "--now", TIMER(kind)]);
          return { ...timerState(kind), was: before.enabled, ...(off.code ? { error: (off.err || off.out).trim() } : {}) };
        })
      : "left alone (--iso)";
    const stuck = Array.isArray(timers) ? timers.filter((t: any) => t.error) : [];
    if (stuck.length) fail("timers", `could not turn off ${stuck.map((t: any) => t.timer).join(", ")}`, "systemctl --user disable --now <timer>", { automations: saved, timers });
    return { ok: true, url, automations: saved, timers };
  } finally {
    ws.close();
  }
}

async function status(): Promise<Result> {
  const cfg = loopsConfig();
  const { ws, snap } = await live(cfg.yardUrl);
  try {
    const sessions = sessionsOf(ws)
      .filter((s) => s.title.startsWith("Loop "))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((s) => ({ id: s.id, title: s.title, status: s.status, archived: !!s.archived, branch: s.branch, cwd: s.cwd }));
    const dir = join(SHARED, "loops");
    const last = existsSync(dir) ? Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".last.json")).map((f) => [f.replace(".last.json", ""), readJson(join(dir, f))])) : {};
    // The scheduled loops' state lives in yardd, on their automations.
    const names: string[] = SCHEDULED.map(TITLE);
    const automations = (snap.automations ?? [])
      .filter((x: any) => names.includes(x.name))
      .map((x: any) => ({ id: x.id, name: x.name, enabled: x.enabled, nextRun: x.nextRun ? new Date(x.nextRun).toISOString() : null, lastRun: x.lastRun ?? null }));
    return { ok: true, paused: existsSync(PAUSED()), usage: usageOf(ws), automations, sessions, last };
  } finally {
    ws.close();
  }
}

/** Read-only: a loop session's recent events, summarised. */
async function logOf(a: Args): Promise<Result> {
  const sid = a.pos[1];
  if (!sid) throw new Usage("loop log <sessionId> [--last n]");
  const cfg = loopsConfig();
  const { ws } = await live(cfg.yardUrl);
  try {
    const s = sessionsOf(ws).find((x) => x.id === sid);
    if (!s || !s.title.startsWith("Loop ")) fail("not-a-loop", `${sid} is not a loop session`);
    const from = ws.log.length;
    ws.send({ op: "session.open", sessionId: sid });
    const end = Date.now() + 10000;
    let h: any = null;
    while (!h && Date.now() < end) {
      h = ws.log.slice(from).find((m) => m.op === "history" && m.sessionId === sid);
      await sleep(50);
    }
    if (!h) fail("timeout", "no history");
    const lines = (h.events as any[])
      .map((e) => {
        if (e.type === "assistant_message") return { t: "say", text: String(e.text).slice(0, 1500) };
        if (e.type === "tool_started") return { t: "tool", text: String(e.title ?? e.detail ?? "").slice(0, 300) };
        if (e.type === "error") return { t: "error", text: String(e.message ?? e.text).slice(0, 500) };
        if (e.type === "turn_completed") return { t: "turn", text: e.status };
        return null;
      })
      .filter(Boolean);
    return { ok: true, session: { id: s.id, title: s.title, status: s.status, branch: s.branch }, events: lines.slice(-Number(str(a, "last", "30"))) };
  } finally {
    ws.close();
  }
}

/** Archives every finished loop session now (a timer runs this every few minutes). */
async function tidyNow(): Promise<Result> {
  const cfg = loopsConfig();
  const { ws } = await live(cfg.yardUrl);
  try {
    const t = tidy(ws, sessionsOf(ws), cfg.keepFinishedSessions ?? 0);
    // Let the session.update ops leave before the socket closes.
    await sleep(500);
    return { ok: true, ...t };
  } finally {
    ws.close();
  }
}

export async function loop(a: Args): Promise<Result> {
  const sub = a.pos[0];
  if (sub === "tidy") return tidyNow();
  if (sub === "log") return logOf(a);
  if (sub === "run") return runLoop(a);
  if (sub === "status") return status();
  if (sub === "automations") return installAutomations(a);
  if (sub === "pause") {
    mkdirSync(join(SHARED, "loops"), { recursive: true });
    writeFileSync(PAUSED(), nowIso());
    return { ok: true, paused: true };
  }
  if (sub === "resume") {
    if (existsSync(PAUSED())) unlinkSync(PAUSED());
    return { ok: true, paused: false };
  }
  throw new Usage("loop run <kind> [--pr N] [--engine e --model m --effort x] [--dry-run] [--force] | loop automations [--apply] [--iso n] [--checkout dir] | loop status | loop log <sessionId> [--last n] | loop tidy | loop pause | loop resume");
}

export const _test = { skipReason, prompt, automationPrompt, automationSpec, changed, matches, statSync };
