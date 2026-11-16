// Shapes shared with yardd (crates/yardd). Keep the two in step.

export type Engine = "claude" | "codex";
export type Status = "idle" | "queued" | "running" | "needs_approval" | "error";
export type Decision = "allow" | "allow_always" | "deny";

/** Permission modes, like Claude Code's: ask first, accept edits, plan only, full access. */
export type Permission = "ask" | "acceptEdits" | "plan" | "full";

export interface SessionMeta {
  id: string;
  title: string;
  engine: Engine;
  model: string;
  effort: string;
  cwd: string;
  status: Status;
  /** `local`, or the id of the remote host it runs on. */
  host: string;
  /** Set when yardd made a worktree for the session. */
  branch?: string | null;
  repo?: string | null;
  /** The session this one was handed off from. */
  /** How much the engine may do unasked. Missing on sessions from an older yardd: `ask`. */
  permission?: Permission;
  /** `default`, or the id of an added account (see accounts.ts). Missing on sessions from an older yardd. */
  account?: string;
  parent?: string | null;
  /** Kept at the top of the sidebar. */
  pinned?: boolean;
  /** Moved into the sidebar's Archived section. */
  archived?: boolean;
  /** The sidebar group it sits in; a group exists only while a session is in it. */
  group?: string | null;
  /** The automation that started this session: a run, kept out of the sidebar. */
  automation?: string | null;
  /** When a run's first turn ended; `updatedAt` moves on any later change. */
  finishedAt?: number;
  /** When the latest turn ended (yardd's clock), and how. Missing before the first, and from an older yardd. */
  turnEndedAt?: number | null;
  lastTurn?: "completed" | "failed" | "interrupted" | null;
  /** Messages sent while a turn ran, oldest first. The next one starts when a turn completes; Stop or a failure holds them. */
  pending?: PendingMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface PendingMessage {
  id: string;
  text: string;
  attachments?: Attachment[];
  at: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  efforts: string[];
  defaultEffort?: string;
  isDefault?: boolean;
}

/** Per engine; an engine that is not installed on the host may be missing. */
export type Models = Partial<Record<Engine, ModelInfo[]>>;

export interface Host {
  id: string;
  name: string;
  cpu: number;
  cores: number;
  load: number;
  memUsed: number;
  memTotal: number;
  diskUsed: number;
  diskTotal: number;
  cpuHistory: number[];
  /** Why new sessions are being queued; null when the host has room. */
  pressure?: string | null;
  /** Sessions with live processes, by memory, largest first. */
  sessions?: SessionUsage[];
  /** Sessions waiting to start, oldest first. */
  queued?: { id: string; reason: string }[];
  limits?: { minFreeBytes: number; forced: boolean };
}

/** A remote yardd this one reaches, as listed by the `hosts` message. */
export interface HostEntry {
  id: string;
  name: string;
  kind: "ssh" | "direct";
  destination?: string;
  remotePort?: number;
  url?: string;
  status: "connecting" | "connected" | "error";
  error?: string;
  /** SSH works but no yardd answered behind the tunnel: offer to install it. */
  noDaemon?: boolean;
}

export interface SessionUsage {
  id: string;
  cpuCores: number;
  memBytes: number;
}

/** One plan window as an engine reports it. */
export interface RateWindow {
  usedPercent: number;
  windowDurationMins?: number | null;
  /** Epoch seconds. */
  resetsAt?: number | null;
}

/** What each engine says about the plan limits; see ui/src/usage.ts. */
export interface Usage {
  claude?: {
    status?: string;
    /** By the SDK's window name (five_hour, seven_day, seven_day_sonnet, ...). */
    windows?: Record<string, { utilization: number | null; resetsAt: number | null }>;
    /** Fractions, from a yardd older than `windows`. */
    fiveHour?: number | null;
    sevenDay?: number | null;
  };
  /** Codex: primary is the short window (5 hours), secondary the week. */
  codex?: { primary?: RateWindow | null; secondary?: RateWindow | null };
  /** Added accounts' limits by account id, in the same shape as their engine's above. */
  accounts?: Record<string, any>;
}

/** An added account on a host. Default is every engine's own and is not listed. */
export interface AccountEntry {
  id: string;
  engine: Engine;
  name: string;
}

export interface ChangedFile {
  path: string;
  diff?: string;
  kind?: string;
  added?: number | null;
  removed?: number | null;
  untracked?: boolean;
}

export interface Changes {
  files?: ChangedFile[];
  diff?: string;
  truncated?: boolean;
  branch?: string;
  error?: string;
}

export interface PrCheck {
  name: string;
  workflow?: string | null;
  result: "passed" | "failed" | "running" | "skipped" | "neutral";
  url?: string | null;
}

export interface PrComment {
  author: string;
  /** From GitHub, untrusted: render as text. */
  body: string;
  url?: string | null;
}

export interface PrThread {
  path: string;
  line: number | null;
  resolved: boolean;
  outdated: boolean;
  comments: PrComment[];
}

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  base: string;
  head: string;
  reviewDecision?: string | null;
  mergeable?: string | null;
  mergeState?: string | null;
  checks: PrCheck[];
  checksTruncated?: boolean;
  threads: PrThread[];
  threadsError?: string;
}

/** Reply to `git.branches { cwd, host? }`: where a new worktree can be cut from. */
export interface BranchList {
  op: "git.branches";
  cwd: string;
  /** Set when the reply came from a remote host. */
  hostId?: string;
  /** The checked-out branch, or a short commit id when detached. */
  current?: string;
  /** Local and `origin/*` branches, most recently committed first, at most 200. */
  branches?: string[];
  error?: string;
}

/** Progress of `host.install { hostId }`: one message per output line, then one with `done`.
 *  Lines starting with `@@` are for the app (`@@engine <name> ok|missing|logged-out`, `@@ok`, `@@fail`). */
export interface HostInstallMsg {
  op: "host.install";
  hostId: string;
  line?: string;
  done?: boolean;
  ok?: boolean;
}

/** One engine on one host, from `engines.status`. `loggedIn` is null when it could not be read. */
export interface EngineState {
  installed: boolean;
  loggedIn: boolean | null;
  account?: string | null;
  error?: string;
}
export type EngineStates = Partial<Record<Engine, EngineState>> & {
  /** Added accounts' states by account id. */
  accounts?: Record<string, EngineState>;
};

/** Progress of `login.start`. Codex shows a link and a code to enter there;
 *  Claude shows a link whose page gives back a code to paste into the app. */
export interface LoginState {
  state: "starting" | "code" | "url" | "checking" | "done" | "failed" | "cancelled";
  url?: string;
  code?: string;
  error?: string;
}

/** Reply to `fs.dirs { path, host? }`: the subfolders the folder picker offers. */
export interface DirList {
  op: "fs.dirs";
  path: string;
  /** Set when the reply came from a remote host. */
  hostId?: string;
  /** Sorted by name, hidden ones included, at most 2000. `git` marks a repository root. */
  dirs?: { name: string; git: boolean }[];
  error?: string;
}

/** Reply to `session.delete { removeWorktree: true }` once the session is gone. */
export interface WorktreeRemoved {
  op: "worktree.removed";
  sessionId: string;
  /** False when `git branch -d` kept a branch with unmerged commits. */
  branchDeleted: boolean;
  message: string;
}

/** One of a session's terminals, from `term.list` (oldest first). Titles are
 *  "1", "2", ... per session and not reused. A terminal whose shell exited
 *  stays listed until `term.close`. */
export interface TermInfo {
  termId: string;
  title: string;
  exited?: boolean;
}

/** Reply to `term.open`, `term.new` and `term.attach`: the scrollback from `offset`. */
export interface TermOpened {
  op: "term.opened";
  sessionId: string;
  termId: string;
  title: string;
  exited?: boolean;
  offset: number;
  /** Base64. */
  data: string;
}

/** A file attached to a prompt, saved by the yardd that runs the session
 *  (a remote host's own data dir for a remote session). */
export interface Attachment {
  id: string;
  /** Sanitized: one path component, no leading dot or dash. */
  name: string;
  /** Inline image types are checked against the bytes. */
  mime: string;
  size: number;
  /** Absolute, on the session's host. */
  path: string;
}

/** Largest file `attach.put` takes. Keep in step with `attachments::MAX_BYTES`. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Reply to `session.interrupt` (what was queued, joined) or `session.unqueue`
 *  (one message, with its `id`) when it had not reached the agent yet: the
 *  text goes back to that window's reply box. Sent only to the asking window. */
export interface QueueReturned {
  op: "queue.returned";
  sessionId: string;
  id?: string;
  text: string;
  attachments?: Attachment[];
}

/** Reply to `attach.put { ref, name, mime, data (base64), host? | sessionId? }`.
 *  The file goes to `host`, or to the host of `sessionId`, or stays here. */
export interface AttachStored {
  op: "attach.stored";
  ref: string;
  /** Set when the file went to a remote host. */
  hostId?: string;
  attachment?: Attachment;
  error?: string;
}

/** Reply to `attach.get { ref, sessionId, id }`, for a thumbnail. Only an
 *  attachment that one of the session's prompts carries can be read. */
export interface AttachData {
  op: "attach.data";
  ref?: string;
  sessionId: string;
  id: string;
  mime?: string;
  /** Base64. */
  data?: string;
  error?: string;
}

/** One process of a session, from `session.procs`: the host sampler's view,
 *  up to 3 s old. `cpu` is percent of one core. */
export interface ProcRow {
  pid: number;
  ppid: number;
  name: string;
  /** The command line, joined, at most 400 characters. */
  cmd: string;
  cpu: number;
  memBytes: number;
  ageSecs: number;
  /** `agent`: what the engine runs. `terminal`: the session's shells. */
  origin: "agent" | "terminal";
}

/** Reply to `pr.get`: the branch's PR, no PR, or why it could not be read. */
export type PrResult =
  | PullRequest
  | { none: true; branch: string; defaultBranch?: string | null }
  | { error: string };

/** Normalized session events. Both engines produce exactly these. */
export type AgentEvent =
  /** `session.create` and `session.send` take `attachments: string[]` (ids
   *  from `attach.put`) and may then have empty text; the event carries
   *  the attachments' records. */
  | { type: "user_message"; text: string; attachments?: Attachment[]; steered?: boolean; at?: number }
  /** `at` is yardd's clock in ms; older logs lack it. */
  | { type: "turn_started"; at?: number }
  | { type: "turn_completed"; status: string; at?: number }
  | { type: "assistant_delta"; itemId: string; text: string }
  | { type: "assistant_message"; itemId: string; text: string }
  /** Thinking: Claude's summarized thinking, Codex's reasoning summary. */
  | { type: "reasoning_delta"; itemId: string; text: string }
  | { type: "reasoning"; itemId: string; text: string }
  /** `agent` names the subagent an Agent call starts (Claude). `parent` is the
   *  itemId of the Agent call a subagent's own step runs under. */
  | { type: "tool_started"; itemId: string; kind: string; title: string; detail: string; agent?: string; parent?: string }
  /** `ms`: how long a subagent ran. An Agent call ends with its task, which
   *  can be after the turn that started it. */
  | { type: "tool_completed"; itemId: string; ok: boolean; output?: string | null; note?: string | null; ms?: number | null }
  | { type: "file_change"; itemId: string; files: ChangedFile[] }
  | { type: "approval_request"; requestId: string; kind: string; title: string; detail: string }
  | { type: "approval_resolved"; requestId: string; decision: Decision }
  | { type: "error"; message: string }
  /** A quiet line from yardd itself, such as a hand-off or a worktree setup. Changes no status. */
  | { type: "note"; text: string }
  /** The session is waiting for the host to have room. Carries its prompt. */
  | { type: "queued"; reason: string; text?: string; attachments?: Attachment[] };

/** A tool call. An Agent call has `agent` (the subagent's type) and, in
 *  `layout`, `steps`: the calls that ran under it, nested as deep as the
 *  subagents are. */
export interface ToolItem {
  kind: "tool";
  key: string;
  itemId: string;
  toolKind: string;
  title: string;
  detail: string;
  state: "running" | "ok" | "failed";
  output?: string | null;
  agent?: string;
  /** The itemId of the Agent call this step runs under. */
  parent?: string;
  /** How long the subagent ran. */
  ms?: number;
  steps?: ToolItem[];
}

/** What the thread renders. Built from events by `applyEvent`. */
export type Item =
  /** `steered`: sent while the agent worked and given to it mid-turn, at `at`. */
  | { kind: "user"; key: string; text: string; attachments?: Attachment[]; steered?: boolean; at?: number }
  | { kind: "assistant"; key: string; itemId: string; text: string; streaming: boolean }
  | { kind: "reasoning"; key: string; itemId: string; text: string; streaming: boolean }
  /** A turn's span, for "Worked for 1m 12s". Not drawn by itself. */
  | { kind: "turn"; key: string; start?: number; end?: number; status: string }
  | ToolItem
  | { kind: "diff"; key: string; files: ChangedFile[] }
  | {
      kind: "approval";
      key: string;
      requestId: string;
      approvalKind: string;
      title: string;
      detail: string;
      decision: Decision | null;
      /** The turn ended (Stop, a failure, a yardd restart) before anyone answered. */
      unanswered?: boolean;
      /** A decision was sent and yardd has not resolved it yet. */
      sending?: boolean;
    }
  | { kind: "error"; key: string; message: string }
  | { kind: "note"; key: string; text: string }
  | { kind: "queued"; key: string; reason: string };

/** Where an item with this engine id sits in the current turn, or -1. Ids
 *  are matched only after the last user message: an engine may reuse them
 *  across turns (older Claude sidecars restarted their counter), and a match
 *  in an earlier turn would put new text above the question it answers.
 *  A steered message goes in mid-turn, so it is not a boundary: a command
 *  that started before it still completes after it. */
function inTurn(items: Item[], match: (it: Item) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (startsTurn(items[i])) return -1;
    if (match(items[i])) return i;
  }
  return -1;
}

function startsTurn(it: Item): boolean {
  return it.kind === "user" && !it.steered;
}

function turnStart(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (startsTurn(items[i])) return i + 1;
  return 0;
}

export function applyEvent(items: Item[], ev: AgentEvent, seq: number): Item[] {
  const key = `e${seq}`;
  switch (ev.type) {
    case "user_message":
      return [
        ...items,
        {
          kind: "user",
          key,
          text: ev.text,
          ...(ev.attachments?.length ? { attachments: ev.attachments } : {}),
          ...(ev.steered ? { steered: true, at: ev.at } : {}),
        },
      ];
    case "reasoning_delta":
    case "reasoning": {
      const i = inTurn(items, (it) => it.kind === "reasoning" && it.itemId === ev.itemId);
      const streaming = ev.type === "reasoning_delta";
      if (i < 0) return ev.text ? [...items, { kind: "reasoning", key, itemId: ev.itemId, text: ev.text, streaming }] : items;
      const next = items.slice();
      const cur = next[i] as Extract<Item, { kind: "reasoning" }>;
      next[i] = { ...cur, text: streaming ? cur.text + ev.text : ev.text || cur.text, streaming };
      return next;
    }
    case "assistant_delta": {
      const i = inTurn(items, (it) => it.kind === "assistant" && it.itemId === ev.itemId);
      if (i < 0) return [...items, { kind: "assistant", key, itemId: ev.itemId, text: ev.text, streaming: true }];
      const next = items.slice();
      const cur = next[i] as Extract<Item, { kind: "assistant" }>;
      next[i] = { ...cur, text: cur.text + ev.text };
      return next;
    }
    case "assistant_message": {
      const i = inTurn(items, (it) => it.kind === "assistant" && it.itemId === ev.itemId);
      if (i < 0) return [...items, { kind: "assistant", key, itemId: ev.itemId, text: ev.text, streaming: false }];
      const next = items.slice();
      next[i] = { ...(next[i] as Extract<Item, { kind: "assistant" }>), text: ev.text, streaming: false };
      return next;
    }
    case "tool_started": {
      const tool: ToolItem = { kind: "tool", key, itemId: ev.itemId, toolKind: ev.kind, title: ev.title, detail: ev.detail, state: "running" };
      if (ev.agent) tool.agent = ev.agent;
      if (ev.parent) tool.parent = ev.parent;
      return [...items, tool];
    }
    case "tool_completed": {
      const from = turnStart(items);
      // An Agent call can end after a later prompt: its notification comes when its task does.
      return items.map((it, i) =>
        (i >= from || (it.kind === "tool" && it.agent)) && it.kind === "tool" && it.itemId === ev.itemId
          ? { ...it, state: ev.ok ? "ok" : "failed", output: ev.output ?? null, ...(ev.ms != null ? { ms: ev.ms } : {}) }
          : it,
      );
    }
    case "file_change":
      return ev.files.length ? [...items, { kind: "diff", key, files: ev.files }] : items;
    case "approval_request":
      return [
        ...items,
        { kind: "approval", key, requestId: ev.requestId, approvalKind: ev.kind, title: ev.title, detail: ev.detail, decision: null },
      ];
    case "approval_resolved": {
      const from = turnStart(items);
      return items.map((it, i) =>
        i >= from && it.kind === "approval" && it.requestId === ev.requestId ? { ...it, decision: ev.decision } : it,
      );
    }
    case "turn_started":
      return [...items, { kind: "turn", key, start: ev.at, status: "running" }];
    case "turn_completed": {
      let open = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].kind === "turn") {
          open = i;
          break;
        }
      }
      // A background subagent goes on after a completed turn, with the steps it
      // is taking. Stop or a failure ends it.
      const goesOn = new Set(
        ev.status === "completed" ? items.flatMap((it) => (it.kind === "tool" && it.agent && it.state === "running" ? [it.itemId] : [])) : [],
      );
      // Nothing else may look live once the turn is over.
      return items.map((it, i) => {
        if (i === open && it.kind === "turn") return { ...it, end: ev.at, status: ev.status };
        if ((it.kind === "assistant" || it.kind === "reasoning") && it.streaming) return { ...it, streaming: false };
        if (it.kind === "tool" && it.state === "running" && !goesOn.has(it.itemId) && !(it.parent && goesOn.has(it.parent))) {
          return { ...it, state: "failed" as const };
        }
        // Nobody chose, so it is not shown as "Denied".
        if (it.kind === "approval" && it.decision === null) return { ...it, unanswered: true };
        return it;
      });
    }
    case "error": {
      // Codex reports a failed turn twice: as an error and as the turn's end.
      const last = items[items.length - 1];
      if (last?.kind === "error" && last.message === ev.message) return items;
      return [...items, { kind: "error", key, message: ev.message }];
    }
    case "note":
      return [...items, { kind: "note", key, text: ev.text }];
    case "queued":
      return [...items, { kind: "queued", key, reason: ev.reason }];
    default:
      return items;
  }
}

/** A Claude Code session on a host, from `claude.sessions` (the Agent SDK's listSessions). */
export interface ClaudeSessionRow {
  sessionId: string;
  title: string;
  cwd?: string | null;
  gitBranch?: string | null;
  lastModified: number;
  createdAt?: number | null;
  /** Our session already holding it, if it was imported. */
  importedAs?: string | null;
}

/** The `claude.sessions` reply. `hostId` is set when it came from a remote host. */
export interface ClaudeSessionList {
  op: "claude.sessions";
  hostId?: string;
  sessions: ClaudeSessionRow[];
  error?: string;
}


/** When an automation runs, in its host's local time zone. `day` is 0 (Sunday) to 6. */
export type Schedule =
  | { kind: "interval"; every: number; unit: "minutes" | "hours" }
  | { kind: "daily"; time: string }
  | { kind: "weekly"; day: number; time: string };

export interface LastRun {
  at: number;
  outcome: "started" | "skipped" | "failed";
  sessionId?: string | null;
  /** Why it was skipped or failed. */
  reason?: string | null;
}

/** A scheduled prompt. Each host runs its own; see yardd's automations.rs. */
export interface Automation {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  engine: Engine;
  model: string;
  effort: string;
  permission: Permission;
  /** The branch runs are cut from; empty is the repository's default branch. */
  base: string;
  schedule: Schedule;
  skipWhileRunning: boolean;
  /** Skip a scheduled run while the engine's usage is above these percentages. */
  maxFiveHour: number | null;
  maxWeek: number | null;
  enabled: boolean;
  createdAt: number;
  /** Null while disabled. */
  nextRun: number | null;
  lastRun?: LastRun | null;
}
