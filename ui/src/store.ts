import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  applyEvent,
  type AgentEvent,
  type BranchList,
  type DirList,
  type Changes,
  type Decision,
  type Engine,
  type Host,
  type HostEntry,
  type Item,
  type Models,
  type PrResult,
  type SessionMeta,
  type Usage,
  type Attachment,
} from "./protocol";
import { base64ToBlob, fileToBase64, Replies, tooLarge } from "./attach";

/** Where an upload goes: a host from the new-session page, or the host of a
 *  session from its reply box. Empty means this machine. */
export type UploadTarget = { host?: string; sessionId?: string };

/** Thumbnails already fetched, as object URLs, by session and attachment.
 *  Kept for the page's life: the bytes never change. */
const thumbs = new Map<string, Promise<string>>();

export type Route = { page: "new" } | { page: "hosts" } | { page: "session"; id: string };

interface Thread {
  /** Next sequence number we expect; -1 until history has loaded. */
  next: number;
  items: Item[];
  /** Events that arrived before the history did. */
  early: { seq: number; event: AgentEvent }[];
}

export interface State {
  connected: boolean;
  route: Route;
  sessions: Record<string, SessionMeta>;
  threads: Record<string, Thread>;
  changes: Record<string, Changes>;
  pr: Record<string, PrResult>;
  /** Remote hosts and their connection state. This Mac is not in the list. */
  hosts: HostEntry[];
  /** Per host id; `local` is this machine. */
  models: Record<string, Models>;
  usage: Record<string, Usage>;
  host: Record<string, Host>;
  home: Record<string, string>;
  /** Hosts whose connection on this socket dropped, until their next snapshot. */
  linkDown: Record<string, boolean>;
  /** Goes up whenever a host's sessions are reloaded, so open threads refetch. */
  hostEpoch: number;
  /** `git.branches` replies, by `branchKey(host, cwd)`. */
  branches: Record<string, BranchList>;
  /** `fs.dirs` replies, by `branchKey(host, path)`. */
  dirs: Record<string, DirList>;
  error: string | null;
  /** Goes up on every error, including a repeat of the same message. */
  errorCount: number;
  /** A quiet outcome worth showing once, such as a removed worktree. */
  notice: string | null;
}

type Action =
  | { t: "socket"; connected: boolean }
  | { t: "route"; route: Route }
  | { t: "dismiss" }
  | { t: "server"; msg: any };

const emptyThread = (): Thread => ({ next: -1, items: [], early: [] });

export const initial: State = {
  connected: false,
  route: { page: "new" },
  sessions: {},
  threads: {},
  changes: {},
  pr: {},
  hosts: [],
  models: {},
  usage: {},
  host: {},
  home: {},
  linkDown: {},
  hostEpoch: 0,
  branches: {},
  dirs: {},
  error: null,
  errorCount: 0,
  notice: null,
};

export function reduce(state: State, action: Action): State {
  switch (action.t) {
    case "socket":
      // A reconnect means a new yardd may be on the other end: reload threads.
      return action.connected ? { ...state, connected: true } : { ...state, connected: false, threads: {} };
    case "route":
      return { ...state, route: action.route };
    case "dismiss":
      return { ...state, error: null, notice: null };
    case "server":
      return reduceServer(state, action.msg);
  }
}

const EMPTY_MODELS: Models = { claude: [], codex: [] };
const NO_USAGE: Usage = {};

export const branchKey = (host: string, cwd: string) => `${host}\n${cwd}`;

/** The host a session runs on, `local` for this machine. */
export const hostOf = (s: SessionMeta | undefined) => s?.host || "local";
export const modelsOn = (state: State, host: string): Models => state.models[host] ?? EMPTY_MODELS;
export const usageOn = (state: State, host: string): Usage => state.usage[host] ?? NO_USAGE;
export const homeOn = (state: State, host: string): string => state.home[host] ?? "";
export const hostName = (state: State, host: string): string =>
  host === "local" ? "This Mac" : state.hosts.find((h) => h.id === host)?.name ?? host;
/** A remote host's sessions are offline while the hub cannot reach it. */
export const hostOnline = (state: State, host: string): boolean =>
  host === "local"
    ? state.connected
    : state.connected && !state.linkDown[host] && state.hosts.some((h) => h.id === host && h.status === "connected");

function without<T>(rec: Record<string, T>, drop: (key: string) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(rec).filter(([k]) => !drop(k)));
}

/** Replace one host's sessions, keeping everyone else's. */
function replaceHostSessions(state: State, host: string, list: SessionMeta[]): State {
  const gone = (id: string) => hostOf(state.sessions[id]) === host;
  const sessions = without(state.sessions, gone);
  for (const s of list) sessions[s.id] = s;
  // Events may have been missed while away: drop the threads so they reload from history.
  const threads = without(state.threads, gone);
  // The session we were looking at may be gone after a restart.
  const route =
    state.route.page === "session" && !sessions[state.route.id] ? ({ page: "new" } as Route) : state.route;
  return { ...state, sessions, threads, route, hostEpoch: state.hostEpoch + 1 };
}

function reduceServer(state: State, msg: any): State {
  switch (msg.op) {
    case "snapshot": {
      const hosts = (msg.hosts ?? []) as HostEntry[];
      const known = new Set(hosts.map((h) => h.id));
      // Remote sessions stay listed (offline) until their host snapshot comes
      // in, unless their host was removed meanwhile.
      const next = replaceHostSessions({ ...state, hosts }, "local", msg.sessions as SessionMeta[]);
      const sessions = without(next.sessions, (id) => {
        const h = hostOf(next.sessions[id]);
        return h !== "local" && !known.has(h);
      });
      const route =
        next.route.page === "session" && !sessions[next.route.id] ? ({ page: "new" } as Route) : next.route;
      return {
        ...next,
        sessions,
        route,
        linkDown: {},
        models: { ...state.models, local: msg.models ?? EMPTY_MODELS },
        usage: { ...state.usage, local: msg.usage ?? {} },
        host: msg.host ? { ...state.host, local: msg.host } : state.host,
        home: { ...state.home, local: msg.home ?? "" },
      };
    }
    case "host.snapshot": {
      const id = msg.hostId as string;
      const next = replaceHostSessions(state, id, msg.sessions as SessionMeta[]);
      return {
        ...next,
        linkDown: { ...state.linkDown, [id]: false },
        models: { ...state.models, [id]: msg.models ?? EMPTY_MODELS },
        usage: { ...state.usage, [id]: msg.usage ?? {} },
        host: msg.host ? { ...state.host, [id]: msg.host } : state.host,
        home: { ...state.home, [id]: msg.home ?? "" },
      };
    }
    case "host.down":
      return { ...state, linkDown: { ...state.linkDown, [msg.hostId]: true } };
    case "hosts": {
      const hosts = msg.hosts as HostEntry[];
      const known = new Set(["local", ...hosts.map((h) => h.id)]);
      const gone = (id: string) => !known.has(hostOf(state.sessions[id]));
      const sessions = without(state.sessions, gone);
      const route =
        state.route.page === "session" && !sessions[state.route.id] ? ({ page: "new" } as Route) : state.route;
      return {
        ...state,
        hosts,
        sessions,
        route,
        threads: without(state.threads, gone),
        host: without(state.host, (h) => !known.has(h)),
        models: without(state.models, (h) => !known.has(h)),
      };
    }
    case "session":
      return { ...state, sessions: { ...state.sessions, [msg.session.id]: msg.session } };
    case "session.deleted": {
      const id = msg.sessionId as string;
      const { [id]: _s, ...sessions } = state.sessions;
      const { [id]: _t, ...threads } = state.threads;
      const { [id]: _c, ...changes } = state.changes;
      const route = state.route.page === "session" && state.route.id === id ? ({ page: "new" } as Route) : state.route;
      return { ...state, sessions, threads, changes, route };
    }
    case "created":
      return { ...state, route: { page: "session", id: msg.sessionId } };
    case "models":
      return { ...state, models: { ...state.models, [msg.hostId ?? "local"]: msg.models } };
    case "usage":
      return { ...state, usage: { ...state.usage, [msg.hostId ?? "local"]: msg.usage } };
    case "host":
      return { ...state, host: { ...state.host, [msg.hostId ?? "local"]: msg.host } };
    case "changes":
      return { ...state, changes: { ...state.changes, [msg.sessionId]: msg.changes } };
    case "pr":
      return { ...state, pr: { ...state.pr, [msg.sessionId]: msg.pr } };
    case "error":
      return { ...state, error: msg.message, errorCount: state.errorCount + 1 };
    case "git.branches": {
      const reply = msg as BranchList;
      return { ...state, branches: { ...state.branches, [branchKey(reply.hostId ?? "local", reply.cwd)]: reply } };
    }
    case "fs.dirs": {
      const reply = msg as DirList;
      return { ...state, dirs: { ...state.dirs, [branchKey(reply.hostId ?? "local", reply.path)]: reply } };
    }
    case "worktree.removed":
      // A kept branch is the user's to deal with, so the outcome is shown.
      return { ...state, notice: msg.message };
    case "history": {
      const prev = state.threads[msg.sessionId] ?? emptyThread();
      const events = msg.events as AgentEvent[];
      let items: Item[] = [];
      events.forEach((ev, seq) => (items = applyEvent(items, ev, seq)));
      let next = events.length;
      for (const e of prev.early.sort((a, b) => a.seq - b.seq)) {
        if (e.seq !== next) continue;
        items = applyEvent(items, e.event, e.seq);
        next++;
      }
      return { ...state, threads: { ...state.threads, [msg.sessionId]: { next, items, early: [] } } };
    }
    case "event": {
      const thread = state.threads[msg.sessionId] ?? emptyThread();
      const seq = msg.seq as number;
      let updated: Thread;
      if (thread.next < 0) {
        updated = { ...thread, early: [...thread.early, { seq, event: msg.event }] };
      } else if (seq === thread.next) {
        updated = { ...thread, next: seq + 1, items: applyEvent(thread.items, msg.event, seq) };
      } else {
        return state; // already applied through history
      }
      return { ...state, threads: { ...state.threads, [msg.sessionId]: updated } };
    }
    default:
      return state;
  }
}

export interface Actions {
  go(route: Route): void;
  dismissError(): void;
  create(input: {
    engine: Engine;
    model: string;
    effort: string;
    cwd: string;
    text: string;
    /** A worktree when the folder is in a repository; otherwise it runs in place. */
    worktree: boolean;
    branch?: string;
    /** Branch or ref the worktree is cut from; the folder's HEAD when left out. */
    base?: string;
    /** A remote host id; this machine when left out. */
    host?: string;
    /** Ids from `upload` to the same host. */
    attachments?: string[];
  }): void;
  /** Raw send, for the terminal's byte stream. */
  post(msg: object): void;
  /** Terminal messages (`term.*`) skip the reducer and go to listeners. */
  onTerm(listener: (msg: any) => void): () => void;
  send(sessionId: string, text: string, attachments?: string[]): void;
  /** Store a file on the host that will run the prompt. Rejects with a
   *  message fit to show, such as the size limit or an offline host. */
  upload(file: File, target: UploadTarget): Promise<Attachment>;
  /** An object URL for an attachment of a session, for a thumbnail. */
  attachmentUrl(sessionId: string, attachment: Attachment): Promise<string>;
  setModel(sessionId: string, model: string, effort: string): void;
  /** New session on the other engine, same folder, seeded with a brief. */
  handoff(sessionId: string, engine: Engine, model: string, effort: string): void;
  interrupt(sessionId: string): void;
  approve(sessionId: string, requestId: string, decision: Decision): void;
  loadChanges(sessionId: string): void;
  /** Start a queued session even though the host is under pressure. */
  startNow(sessionId: string): void;
  /** Stops the session and removes it everywhere. Its worktree stays unless
   *  `removeWorktree`, which yardd refuses for a worktree with changes. */
  remove(sessionId: string, removeWorktree?: boolean): void;
  loadBranches(cwd: string, host: string): void;
  /** Subfolders of an absolute path on a host, for the folder picker. */
  listDirs(path: string, host: string): void;
  loadPr(sessionId: string): void;
  addHost(input: { name: string; kind: "ssh" | "direct"; destination?: string; remotePort?: number; url?: string }): void;
  removeHost(hostId: string): void;
}

function socketUrl(): string {
  const override = (import.meta as any).env?.VITE_YARD_WS as string | undefined;
  if (override) return override;
  return `ws://${location.host}/ws`;
}

export function useYard(): { state: State; actions: Actions } {
  const [state, dispatch] = useReducer(reduce, initial);
  const socket = useRef<WebSocket | null>(null);
  const opened = useRef(new Set<string>());
  const termListeners = useRef(new Set<(msg: any) => void>());
  const replies = useRef(new Replies());

  useEffect(() => {
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const ws = new WebSocket(socketUrl());
      socket.current = ws;
      ws.onopen = () => {
        opened.current.clear();
        dispatch({ t: "socket", connected: true });
      };
      ws.onmessage = (e) => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return; // ignore malformed frames
        }
        // Upload and thumbnail replies go to whoever asked, not the reducer.
        if (replies.current.take(msg)) return;
        if (typeof msg.op === "string" && msg.op.startsWith("term.")) {
          termListeners.current.forEach((listener) => listener(msg));
        } else {
          dispatch({ t: "server", msg });
        }
      };
      ws.onclose = () => {
        replies.current.failAll("The connection to yardd dropped. Try again.");
        dispatch({ t: "socket", connected: false });
        if (!stopped) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, []);

  const post = (msg: object) => {
    const ws = socket.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };

  /** Send an op with a fresh `ref` and wait for the reply that carries it. */
  const ask = async (msg: object, timeoutMs: number): Promise<any> => {
    const ws = socket.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return { error: "Not connected to yardd." };
    const ref = replies.current.ref();
    const reply = replies.current.wait(ref, timeoutMs);
    ws.send(JSON.stringify({ ...msg, ref }));
    return reply;
  };

  const upload = async (file: File, target: UploadTarget): Promise<Attachment> => {
    const big = tooLarge(file.size);
    if (big) throw new Error(big);
    const data = await fileToBase64(file);
    // A slow link to a remote host can take a while for 10 MB.
    const reply = await ask({ op: "attach.put", name: file.name, mime: file.type, data, ...target }, 5 * 60_000);
    if (reply.error || !reply.attachment) throw new Error(reply.error ?? "The upload failed.");
    return reply.attachment as Attachment;
  };

  const attachmentUrl = (sessionId: string, a: Attachment): Promise<string> => {
    const key = `${sessionId}\n${a.id}`;
    let url = thumbs.get(key);
    if (!url) {
      url = ask({ op: "attach.get", sessionId, id: a.id }, 2 * 60_000).then((reply) => {
        if (reply.error || typeof reply.data !== "string") throw new Error(reply.error ?? "No data.");
        return URL.createObjectURL(base64ToBlob(reply.data, reply.mime || a.mime));
      });
      // A failure (host offline) may succeed later, so it is not kept.
      url.catch(() => thumbs.delete(key));
      thumbs.set(key, url);
    }
    return url;
  };

  // Load a session's history the first time it is shown on this connection.
  // A host snapshot drops that host's threads, so reload whatever is gone.
  const routeId = state.route.page === "session" ? state.route.id : null;
  const routeHost = routeId ? hostOf(state.sessions[routeId]) : "local";
  const online = routeId ? hostOnline(state, routeHost) : false;
  const loaded = routeId ? !!state.threads[routeId] : false;
  useEffect(() => {
    if (routeId && !loaded) opened.current.delete(routeId);
    if (!routeId || !online || opened.current.has(routeId)) return;
    opened.current.add(routeId);
    post({ op: "session.open", sessionId: routeId });
    post({ op: "changes.get", sessionId: routeId });
  }, [routeId, online, state.hostEpoch]);

  const actions = useMemo<Actions>(
    () => ({
      go: (route) => dispatch({ t: "route", route }),
      dismissError: () => dispatch({ t: "dismiss" }),
      create: (input) => post({ op: "session.create", ...input }),
      post,
      onTerm: (listener) => {
        termListeners.current.add(listener);
        return () => termListeners.current.delete(listener);
      },
      send: (sessionId, text, attachments) =>
        post(attachments?.length ? { op: "session.send", sessionId, text, attachments } : { op: "session.send", sessionId, text }),
      upload,
      attachmentUrl,
      setModel: (sessionId, model, effort) => post({ op: "session.setModel", sessionId, model, effort }),
      handoff: (sessionId, engine, model, effort) => post({ op: "session.handoff", sessionId, engine, model, effort }),
      interrupt: (sessionId) => post({ op: "session.interrupt", sessionId }),
      approve: (sessionId, requestId, decision) => post({ op: "session.approve", sessionId, requestId, decision }),
      loadChanges: (sessionId) => post({ op: "changes.get", sessionId }),
      startNow: (sessionId) => post({ op: "session.startNow", sessionId }),
      remove: (sessionId, removeWorktree) =>
        post(removeWorktree ? { op: "session.delete", sessionId, removeWorktree: true } : { op: "session.delete", sessionId }),
      loadBranches: (cwd, host) =>
        post(host === "local" ? { op: "git.branches", cwd } : { op: "git.branches", cwd, host }),
      listDirs: (path, host) => post(host === "local" ? { op: "fs.dirs", path } : { op: "fs.dirs", path, host }),
      loadPr: (sessionId) => post({ op: "pr.get", sessionId }),
      addHost: (input) => post({ op: "host.add", ...input }),
      removeHost: (hostId) => post({ op: "host.remove", hostId }),
    }),
    [],
  );

  return { state, actions };
}
