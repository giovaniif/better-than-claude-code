// Which hosts get a row at the foot of the sidebar (and lend it their plan
// usage). Per browser, like the sidebar's other preferences. Only the
// sidebar reads it: the Hosts page, the pickers and sessions list every host.
import { useSyncExternalStore } from "react";

export const HIDDEN_HOSTS_KEY = "yard.sidebar.hiddenHosts";

/** The saved list of hidden host ids; anything unreadable hides nothing. */
export function readHidden(raw: string | null): string[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** The hosts the sidebar lists, in their usual order. */
export const shownHosts = (all: string[], hidden: readonly string[]): string[] => all.filter((id) => !hidden.includes(id));

export function withHostShown(hidden: readonly string[], id: string, show: boolean): string[] {
  const rest = hidden.filter((h) => h !== id);
  return show ? rest : [...rest, id];
}

// One list for every component on the page, so a switch on the Settings page
// changes the sidebar at once; another tab's change arrives as `storage`.
const listeners = new Set<() => void>();
let cache: { raw: string | null; list: string[] } | null = null;

function snapshot(): string[] {
  const raw = localStorage.getItem(HIDDEN_HOSTS_KEY);
  if (!cache || cache.raw !== raw) cache = { raw, list: readHidden(raw) };
  return cache.list;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === HIDDEN_HOSTS_KEY) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

export function setHostShown(id: string, show: boolean) {
  localStorage.setItem(HIDDEN_HOSTS_KEY, JSON.stringify(withHostShown(snapshot(), id, show)));
  for (const fn of listeners) fn();
}

/** The hidden host ids, kept up to date. */
export const useHiddenHosts = (): string[] => useSyncExternalStore(subscribe, snapshot);
