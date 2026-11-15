// OS notifications: when a session needs the user, and how one is shown.
// The rule and the status watcher are pure so they can be tested; showing
// is the Web Notifications API in a browser and the Tauri notification
// plugin in the desktop app (WKWebView has no `Notification`).

import { useState } from "react";
import type { SessionMeta, Status } from "./protocol";

export type Notice = "approval" | "finished" | "failed";

/** What a session's change of status means for the user, if anything. A
 *  session seen for the first time (`prev` unset) is not news. */
export function statusNotice(prev: Status | undefined, next: Status): Notice | null {
  if (prev === undefined || prev === next) return null;
  if (next === "needs_approval") return "approval";
  if (next === "error") return "failed";
  if (next === "idle" && (prev === "running" || prev === "needs_approval")) return "finished";
  return null;
}

export interface Where {
  enabled: boolean;
  focused: boolean;
  /** The session shown in the window right now. */
  openSessionId: string | null;
}

/** Only when the user is not already looking at that session. A note that
 *  names no session is for the user wherever they are. */
export function shouldNotify(where: Where, sessionId: string | null): boolean {
  if (!where.enabled) return false;
  return !(sessionId !== null && where.focused && where.openSessionId === sessionId);
}

export function noticeText(kind: Notice, title: string): { title: string; body: string } {
  const body = { approval: "Waiting for your approval", finished: "Finished its turn", failed: "Failed" }[kind];
  return { title: title.trim() || "Switchyard", body };
}

/** Last known status of every session, to tell a change from a snapshot. */
export class StatusWatcher {
  private seen = new Map<string, { status: Status; host: string }>();

  /** A snapshot of one host's sessions: the new baseline, nothing to report. */
  seed(sessions: SessionMeta[], host = "local") {
    for (const [id, s] of this.seen) if (s.host === host) this.seen.delete(id);
    for (const s of sessions) this.seen.set(s.id, { status: s.status, host: s.host || "local" });
  }

  change(session: SessionMeta): Notice | null {
    const prev = this.seen.get(session.id)?.status;
    this.seen.set(session.id, { status: session.status, host: session.host || "local" });
    return statusNotice(prev, session.status);
  }

  forget(id: string) {
    this.seen.delete(id);
  }
}

export interface Note {
  title: string;
  body?: string;
  sessionId?: string;
  url?: string;
}

const KEY = "yard.notifications";
export const isEnabled = () => localStorage.getItem(KEY) === "on";

/** The desktop app's window exposes Tauri's IPC; a plain browser does not. */
const tauriInvoke = (): ((cmd: string, args?: object) => Promise<unknown>) | undefined =>
  (window as any).__TAURI__?.core?.invoke;

/** Turning them on asks for permission the first time. */
export async function enable(): Promise<"on" | "blocked" | "unsupported"> {
  const invoke = tauriInvoke();
  let granted: boolean;
  if (invoke) {
    try {
      granted = (await invoke("plugin:notification|is_permission_granted")) === true;
      if (!granted) granted = (await invoke("plugin:notification|request_permission")) === "granted";
    } catch (err) {
      console.error("notification permission failed", err);
      return "unsupported";
    }
  } else {
    if (typeof Notification === "undefined") return "unsupported";
    granted = Notification.permission === "granted" || (Notification.permission !== "denied" && (await Notification.requestPermission()) === "granted");
  }
  if (granted) localStorage.setItem(KEY, "on");
  return granted ? "on" : "blocked";
}

export const HINT = {
  blocked: "Notifications are blocked. Allow them for this site in the browser's settings.",
  unsupported: "This browser cannot show notifications.",
};

/** The sidebar switch: on or off, kept per browser. */
export function useNotifySetting() {
  const [on, setOn] = useState(isEnabled);
  const [hint, setHint] = useState<string | null>(null);
  const toggle = async () => {
    setHint(null);
    if (on) {
      localStorage.setItem(KEY, "off");
      setOn(false);
      return;
    }
    const result = await enable();
    if (result === "on") setOn(true);
    else setHint(HINT[result]);
  };
  return { on, hint, toggle };
}

/** How long after a desktop banner the window's next focus counts as a click on it. */
const CLICK_WINDOW_MS = 20_000;

/** Shows notes for the messages yardd sends. `open` takes the user to a session. */
export function createNotifier(opts: { openSessionId(): string | null; open(sessionId: string): void }) {
  const watcher = new StatusWatcher();
  const where = (): Where => ({
    enabled: isEnabled(),
    focused: document.hasFocus() && document.visibilityState === "visible",
    openSessionId: opts.openSessionId(),
  });
  const activate = (note: Note) => {
    window.focus();
    if (note.sessionId) opts.open(note.sessionId);
    else if (note.url) window.open(note.url, "_blank", "noopener,noreferrer");
  };

  // The desktop app reports a click on a banner through the plugin's
  // `actionPerformed` listener, with the `extra` we attached. Should the
  // listener not register, macOS still brings the window forward on a click,
  // so a focus just after a banner is taken for one.
  let listening: Promise<boolean> | null = null;
  const listen = () =>
    (listening ??= (async () => {
      const add = (window as any).__TAURI__?.core?.addPluginListener;
      if (!add) return false;
      try {
        await add("notification", "actionPerformed", (p: any) => {
          lastDesktop = null;
          const sessionId = p?.notification?.extra?.sessionId;
          if (typeof sessionId === "string") activate({ title: "", sessionId });
        });
        return true;
      } catch (err) {
        console.error("notification clicks are not reported", err);
        return false;
      }
    })());
  let lastDesktop: { sessionId: string; at: number } | null = null;
  window.addEventListener("focus", () => {
    const last = lastDesktop;
    lastDesktop = null;
    if (last && Date.now() - last.at < CLICK_WINDOW_MS) opts.open(last.sessionId);
  });

  const show = async (note: Note) => {
    const invoke = tauriInvoke();
    if (invoke) {
      try {
        const clicks = await listen();
        await invoke("plugin:notification|notify", { options: { title: note.title, body: note.body, extra: note.sessionId ? { sessionId: note.sessionId } : {} } });
        lastDesktop = !clicks && note.sessionId ? { sessionId: note.sessionId, at: Date.now() } : null;
      } catch (err) {
        console.error("notification failed", err);
      }
      return;
    }
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // One banner per session: a newer one replaces the older.
    const n = new Notification(note.title, { body: note.body, tag: note.sessionId ? `yard:${note.sessionId}` : undefined });
    n.onclick = () => {
      n.close();
      activate(note);
    };
  };

  return (msg: any) => {
    switch (msg.op) {
      case "snapshot":
        watcher.seed(msg.sessions ?? [], "local");
        break;
      case "host.snapshot":
        watcher.seed(msg.sessions ?? [], msg.hostId);
        break;
      case "session.deleted":
        watcher.forget(msg.sessionId);
        break;
      case "session": {
        const session = msg.session as SessionMeta;
        const kind = watcher.change(session);
        if (kind && shouldNotify(where(), session.id)) void show({ ...noticeText(kind, session.title), sessionId: session.id });
        break;
      }
      case "notify": {
        const sessionId = typeof msg.sessionId === "string" ? msg.sessionId : null;
        if (shouldNotify(where(), sessionId)) void show({ title: msg.title, body: msg.body, sessionId: sessionId ?? undefined, url: msg.url });
        break;
      }
    }
  };
}
