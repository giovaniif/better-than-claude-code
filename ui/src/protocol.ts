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
  parent?: string | null;
  /** Kept at the top of the sidebar. */
  pinned?: boolean;
  /** Moved into the sidebar's Archived section. */
  archived?: boolean;
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

export type Models = Record<Engine, ModelInfo[]>;

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

export interface Usage {
  claude?: { status?: string; fiveHour: number | null; sevenDay: number | null };
  codex?: { primary?: { usedPercent: number; windowDurationMins: number } | null };
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
export type EngineStates = Record<Engine, EngineState>;

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
  | { type: "user_message"; text: string; attachments?: Attachment[] }
  /** `at` is yardd's clock in ms; older logs lack it. */
  | { type: "turn_started"; at?: number }
  | { type: "turn_completed"; status: string; at?: number }
  | { type: "assistant_delta"; itemId: string; text: string }
  | { type: "assistant_message"; itemId: string; text: string }
  /** Thinking: Claude's summarized thinking, Codex's reasoning summary. */
  | { type: "reasoning_delta"; itemId: string; text: string }
  | { type: "reasoning"; itemId: string; text: string }
  | { type: "tool_started"; itemId: string; kind: string; title: string; detail: string }
  | { type: "tool_completed"; itemId: string; ok: boolean; output?: string | null; note?: string | null }
  | { type: "file_change"; itemId: string; files: ChangedFile[] }
  | { type: "approval_request"; requestId: string; kind: string; title: string; detail: string }
  | { type: "approval_resolved"; requestId: string; decision: Decision }
  | { type: "error"; message: string }
  /** A quiet line from yardd itself, such as a hand-off or a worktree setup. Changes no status. */
  | { type: "note"; text: string }
  /** The session is waiting for the host to have room. Carries its prompt. */
  | { type: "queued"; reason: string; text?: string; attachments?: Attachment[] };

/** What the thread renders. Built from events by `applyEvent`. */
export type Item =
  | { kind: "user"; key: string; text: string; attachments?: Attachment[] }
  | { kind: "assistant"; key: string; itemId: string; text: string; streaming: boolean }
  | { kind: "reasoning"; key: string; itemId: string; text: string; streaming: boolean }
  /** A turn's span, for "Worked for 1m 12s". Not drawn by itself. */
  | { kind: "turn"; key: string; start?: number; end?: number; status: string }
  | { kind: "tool"; key: string; itemId: string; toolKind: string; title: string; detail: string; state: "running" | "ok" | "failed"; output?: string | null }
  | { kind: "diff"; key: string; files: ChangedFile[] }
  | { kind: "approval"; key: string; requestId: string; approvalKind: string; title: string; detail: string; decision: Decision | null }
  | { kind: "error"; key: string; message: string }
  | { kind: "note"; key: string; text: string }
  | { kind: "queued"; key: string; reason: string };

/** Where an item with this engine id sits in the current turn, or -1. Ids
 *  are matched only after the last user message: an engine may reuse them
 *  across turns (older Claude sidecars restarted their counter), and a match
 *  in an earlier turn would put new text above the question it answers. */
function inTurn(items: Item[], match: (it: Item) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") return -1;
    if (match(items[i])) return i;
  }
  return -1;
}

function turnStart(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === "user") return i + 1;
  return 0;
}

export function applyEvent(items: Item[], ev: AgentEvent, seq: number): Item[] {
  const key = `e${seq}`;
  switch (ev.type) {
    case "user_message":
      return [
        ...items,
        ev.attachments?.length
          ? { kind: "user", key, text: ev.text, attachments: ev.attachments }
          : { kind: "user", key, text: ev.text },
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
    case "tool_started":
      return [
        ...items,
        { kind: "tool", key, itemId: ev.itemId, toolKind: ev.kind, title: ev.title, detail: ev.detail, state: "running" },
      ];
    case "tool_completed": {
      const from = turnStart(items);
      return items.map((it, i) =>
        i >= from && it.kind === "tool" && it.itemId === ev.itemId
          ? { ...it, state: ev.ok ? "ok" : "failed", output: ev.output ?? null }
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
      // Nothing may look live once the turn is over.
      return items.map((it, i) => {
        if (i === open && it.kind === "turn") return { ...it, end: ev.at, status: ev.status };
        if ((it.kind === "assistant" || it.kind === "reasoning") && it.streaming) return { ...it, streaming: false };
        if (it.kind === "tool" && it.state === "running") return { ...it, state: "failed" as const };
        if (it.kind === "approval" && it.decision === null) return { ...it, decision: "deny" as const };
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
