import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  applyEvent,
  type AgentEvent,
  type Changes,
  type Decision,
  type Engine,
  type Host,
  type Item,
  type Models,
  type PrResult,
  type SessionMeta,
  type Usage,
} from "./protocol";

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
  models: Models;
  usage: Usage;
  host: Host | null;
  home: string;
  error: string | null;
  /** Goes up on every error, including a repeat of the same message. */
  errorCount: number;
}

type Action =
  | { t: "socket"; connected: boolean }
  | { t: "route"; route: Route }
  | { t: "dismiss" }
  | { t: "server"; msg: any };

const emptyThread = (): Thread => ({ next: -1, items: [], early: [] });

const initial: State = {
  connected: false,
  route: { page: "new" },
  sessions: {},
  threads: {},
  changes: {},
  pr: {},
  models: { claude: [], codex: [] },
  usage: {},
  host: null,
  home: "",
  error: null,
  errorCount: 0,
};

function reduce(state: State, action: Action): State {
  switch (action.t) {
    case "socket":
      // A reconnect means a new yardd may be on the other end: reload threads.
      return action.connected ? { ...state, connected: true } : { ...state, connected: false, threads: {} };
    case "route":
      return { ...state, route: action.route };
    case "dismiss":
      return { ...state, error: null };
    case "server":
      return reduceServer(state, action.msg);
  }
}

function reduceServer(state: State, msg: any): State {
  switch (msg.op) {
    case "snapshot": {
      const sessions: Record<string, SessionMeta> = {};
      for (const s of msg.sessions as SessionMeta[]) sessions[s.id] = s;
      // The session we were looking at may be gone after a yardd restart.
      const route =
        state.route.page === "session" && !sessions[state.route.id] ? ({ page: "new" } as Route) : state.route;
      return {
        ...state,
        sessions,
        route,
        models: msg.models ?? state.models,
        usage: msg.usage ?? {},
        host: msg.host ?? state.host,
        home: msg.home ?? "",
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
      return { ...state, models: msg.models };
    case "usage":
      return { ...state, usage: msg.usage };
    case "host":
      return { ...state, host: msg.host };
    case "changes":
      return { ...state, changes: { ...state.changes, [msg.sessionId]: msg.changes } };
    case "pr":
      return { ...state, pr: { ...state.pr, [msg.sessionId]: msg.pr } };
    case "error":
      return { ...state, error: msg.message, errorCount: state.errorCount + 1 };
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
    worktree: boolean;
    branch?: string;
  }): void;
  /** Raw send, for the terminal's byte stream. */
  post(msg: object): void;
  /** Terminal messages (`term.*`) skip the reducer and go to listeners. */
  onTerm(listener: (msg: any) => void): () => void;
  send(sessionId: string, text: string): void;
  setModel(sessionId: string, model: string, effort: string): void;
  /** New session on the other engine, same folder, seeded with a brief. */
  handoff(sessionId: string, engine: Engine, model: string, effort: string): void;
  interrupt(sessionId: string): void;
  approve(sessionId: string, requestId: string, decision: Decision): void;
  loadChanges(sessionId: string): void;
  /** Stops the session and removes it everywhere. Its worktree stays. */
  remove(sessionId: string): void;
  loadPr(sessionId: string): void;
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
        if (typeof msg.op === "string" && msg.op.startsWith("term.")) {
          termListeners.current.forEach((listener) => listener(msg));
        } else {
          dispatch({ t: "server", msg });
        }
      };
      ws.onclose = () => {
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

  // Load a session's history the first time it is shown on this connection.
  const routeId = state.route.page === "session" ? state.route.id : null;
  useEffect(() => {
    if (!routeId || !state.connected || opened.current.has(routeId)) return;
    opened.current.add(routeId);
    post({ op: "session.open", sessionId: routeId });
    post({ op: "changes.get", sessionId: routeId });
  }, [routeId, state.connected]);

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
      send: (sessionId, text) => post({ op: "session.send", sessionId, text }),
      setModel: (sessionId, model, effort) => post({ op: "session.setModel", sessionId, model, effort }),
      handoff: (sessionId, engine, model, effort) => post({ op: "session.handoff", sessionId, engine, model, effort }),
      interrupt: (sessionId) => post({ op: "session.interrupt", sessionId }),
      approve: (sessionId, requestId, decision) => post({ op: "session.approve", sessionId, requestId, decision }),
      loadChanges: (sessionId) => post({ op: "changes.get", sessionId }),
      remove: (sessionId) => post({ op: "session.delete", sessionId }),
      loadPr: (sessionId) => post({ op: "pr.get", sessionId }),
    }),
    [],
  );

  return { state, actions };
}
