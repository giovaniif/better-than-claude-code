// What a host card on the Hosts page shows at a glance: one line for the
// sessions using the host and one mark per engine. Pure, so the words are
// tested without a browser; the card itself is HostCard in App.tsx.
import type { AccountEntry, Engine, EngineState, EngineStates, Host, SessionMeta } from "./protocol";
import { ENGINES, ENGINE_LABEL } from "./engines";

export const size = (bytes: number) => (bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${(bytes / 1024 ** 3).toFixed(bytes > 100 * 1024 ** 3 ? 0 : 1)} GB`);

export interface SessionGlance {
  /** `2 sessions, 1.3 cores, 512 MB`, or that nothing is running. */
  text: string;
  /** How many sessions wait in the queue on this host. */
  queued: number;
}

/** The card's sessions line, from the host's sample and its sessions (the
 *  sample can list a session the UI no longer has; those are left out). */
export function sessionGlance(host: Host, sessions: Record<string, SessionMeta>): SessionGlance {
  const rows = (host.sessions ?? []).filter((u) => sessions[u.id]);
  const queued = Object.values(sessions).filter((s) => s.status === "queued").length;
  if (rows.length === 0) return { text: queued ? "Nothing running" : "No session is running anything", queued };
  const cores = rows.reduce((n, u) => n + u.cpuCores, 0);
  const mem = rows.reduce((n, u) => n + u.memBytes, 0);
  return { text: `${rows.length} ${rows.length === 1 ? "session" : "sessions"}, ${cores.toFixed(1)} cores, ${size(mem)}`, queued };
}

export interface EngineGlance {
  engine: Engine;
  label: string;
  /** ok: ready; warn: installed but a login is missing; off: not installed. */
  tone: "ok" | "warn" | "off";
  /** What needs doing, shown after the name; null when nothing does. */
  note: string | null;
  /** The whole state, for the tooltip. */
  title: string;
}

/** One mark per engine yardd reported, in the Hosts page's order. An added
 *  account that is logged out makes its engine amber too: the card is where
 *  the owner sees a login is missing before a session fails on it. */
export function engineGlance(engines: EngineStates, accounts: AccountEntry[]): EngineGlance[] {
  const out: EngineGlance[] = [];
  for (const engine of ENGINES) {
    const st = engines[engine];
    if (!st) continue;
    const label = ENGINE_LABEL[engine];
    if (!st.installed) {
      out.push({ engine, label, tone: "off", note: null, title: `${label}: not installed` });
      continue;
    }
    const added = accounts.filter((a) => a.engine === engine);
    const loggedOut = added.filter((a) => engines.accounts?.[a.id]?.loggedIn === false).length;
    const note =
      st.loggedIn !== true
        ? st.loggedIn === false
          ? "not logged in"
          : "status unknown"
        : loggedOut > 0
          ? `${loggedOut} ${loggedOut === 1 ? "account" : "accounts"} not logged in`
          : null;
    out.push({ engine, label, tone: note ? "warn" : "ok", note, title: `${label}: ${stateText(st)}${note && st.loggedIn === true ? ` (${note})` : ""}` });
  }
  return out;
}

/** An engine's login state in words, as the Hosts page lists it. */
export function stateText(st: EngineState): string {
  if (!st.installed) return "not installed";
  if (st.loggedIn === true && st.providers?.length) return `providers: ${st.providers.join(", ")}`;
  if (st.loggedIn === true) return st.account ? `logged in as ${st.account}` : "logged in";
  if (st.loggedIn === false) return "not logged in";
  return st.error || "status unknown";
}
