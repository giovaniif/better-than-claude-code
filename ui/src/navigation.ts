import type { HostEntry, SessionMeta } from "./protocol";
import type { Route } from "./store";
import { ENGINE_NAME } from "./engines";
import { hiddenFromSidebar } from "./automations";

export interface NavigationEntry {
  id: string;
  title: string;
  detail: string;
  group: "Sessions" | "Pages";
  route?: Route;
  action?: "import";
}

const PAGES: NavigationEntry[] = [
  { id: "new", title: "New session", detail: "Start a conversation", group: "Pages", route: { page: "new" } },
  { id: "automations", title: "Automations", detail: "Scheduled work and runs", group: "Pages", route: { page: "automations" } },
  { id: "connectors", title: "Connectors", detail: "MCP servers and connections", group: "Pages", route: { page: "connectors" } },
  { id: "settings", title: "Settings", detail: "Notifications and sidebar", group: "Pages", route: { page: "settings" } },
  { id: "hosts", title: "Hosts", detail: "Local and remote machines", group: "Pages", route: { page: "hosts" } },
  { id: "import", title: "Import", detail: "Claude Code sessions", group: "Pages", action: "import" },
];

/** Search the whole session catalog, including archived conversations and runs.
 *  The empty query lists recent sessions the sidebar shows: an hourly
 *  automation's archived runs would otherwise be all of them. */
export function navigationEntries(sessions: SessionMeta[], context: { localName: string; hosts: Pick<HostEntry, "id" | "name">[] }, query: string): NavigationEntry[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matches = (e: NavigationEntry) => words.every((word) => `${e.title} ${e.detail}`.toLowerCase().includes(word));
  const listed = words.length ? sessions : sessions.filter((s) => !s.archived && !hiddenFromSidebar(s));
  const recent = [...listed].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const rows = recent.map((s): NavigationEntry => {
    const host = s.host === "local" ? context.localName : context.hosts.find((h) => h.id === s.host)?.name ?? s.host;
    return {
      id: `session-${s.id}`, title: s.title, group: "Sessions", route: { page: "session", id: s.id },
      detail: [ENGINE_NAME[s.engine], host, s.cwd, s.branch, s.group, s.archived && "Archived", s.automation && "Automation"].filter(Boolean).join(" · "),
    };
  }).filter(matches).slice(0, words.length ? 40 : 8);
  const pages = PAGES.filter(matches);
  return words.length ? [...pages, ...rows] : [...rows, ...pages];
}

/** Keep the Mac's Ctrl-K editing shortcut and composition keys intact. */
export function navigationShortcut(e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat" | "isComposing">, mac: boolean): boolean {
  return e.key.toLowerCase() === "k" && (e.metaKey || (!mac && e.ctrlKey)) && !e.shiftKey && !e.altKey && !e.repeat && !e.isComposing;
}
