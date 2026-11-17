import type { Engine, Models, SessionMeta } from "./protocol";
import { ENGINES } from "./engines";

export interface Choice {
  engine: Engine;
  model: string;
  effort: string;
}

export const cwdKey = (host: string) => host === "local" ? "yard.cwd" : `yard.cwd.${host}`;
const choiceKey = (host: string) => `yard.choice.${host}`;
const recentKey = (host: string) => `yard.recent.${host}`;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Browsing still works without storage. */ }
}

export const loadHost = () => read("yard.host") || "local";
export const loadFolder = (host: string) => read(cwdKey(host)) || "";

export function readRecent(host: string): string[] {
  try {
    const list = JSON.parse(read(recentKey(host)) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch { return []; }
}

/** Empty catalogs arrive before the host's snapshot: keep the saved choice
 *  until there is enough information to validate it. */
export function validChoice(models: Models, wanted: Choice): Choice {
  if (!Object.values(models).some((list) => list?.length)) return wanted;
  const engine = models[wanted.engine]?.length ? wanted.engine : ENGINES.find((e) => models[e]?.length)!;
  const model = models[engine]!.find((m) => m.id === wanted.model) ?? models[engine]![0];
  const effort = wanted.model && model.efforts.includes(wanted.effort) ? wanted.effort : model.defaultEffort ?? model.efforts[0] ?? "";
  return { engine, model: model.id, effort };
}

export function loadChoice(models: Models, host = "local"): Choice {
  for (const key of [choiceKey(host), "yard.choice"]) {
    try {
      const saved = JSON.parse(read(key) ?? "null");
      if (saved && ENGINES.includes(saved.engine) && typeof saved.model === "string" && typeof saved.effort === "string") return validChoice(models, saved);
    } catch { /* Try the older preference, then the default. */ }
  }
  return validChoice(models, { engine: "claude", model: "", effort: "medium" });
}

/** The project is the source repository, never a session's generated worktree. */
export function rememberSession(s: Pick<SessionMeta, "engine" | "model" | "effort" | "cwd"> & { host?: string; repo?: string }) {
  const host = s.host || "local";
  const folder = s.repo || s.cwd;
  const choice = JSON.stringify({ engine: s.engine, model: s.model, effort: s.effort });
  write("yard.host", host);
  write("yard.choice", choice);
  write(choiceKey(host), choice);
  write(cwdKey(host), folder);
  write(recentKey(host), JSON.stringify([folder, ...readRecent(host).filter((p) => p !== folder)].slice(0, 12)));
}
