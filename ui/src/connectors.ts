// Words and order for the Connectors page: which MCP servers each engine
// account has, the ones that need the user first.
import type { McpServer } from "./protocol";

const SOURCE: Record<string, string> = {
  claudeai: "claude.ai",
  plugin: "Plugin",
  user: "Your config",
  local: "This folder only",
  project: "Project .mcp.json",
  dynamic: "Added by an app",
  managed: "Managed",
  enterprise: "Managed",
  agent: "Agent",
  config: "config.toml",
  chatgpt: "ChatGPT app",
};

/** "claude.ai Datadog" -> Datadog via claude.ai; "plugin:engineering:datadog"
 *  -> datadog via the engineering plugin. */
export function displayName(s: Pick<McpServer, "name" | "source">): { name: string; via: string } {
  const ai = /^claude\.ai (.+)$/.exec(s.name);
  if (ai) return { name: ai[1], via: "claude.ai" };
  const plugin = /^plugin:([^:]+):(.+)$/.exec(s.name);
  if (plugin) return { name: plugin[2], via: `${plugin[1]} plugin` };
  return { name: s.name, via: SOURCE[s.source] ?? s.source };
}

export const STATUS_LABEL: Record<string, string> = {
  connected: "Connected",
  "needs-auth": "Needs sign-in",
  failed: "Not working",
  pending: "Connecting",
  disabled: "Off",
};

const RANK: Record<string, number> = { "needs-auth": 0, failed: 1, pending: 2, connected: 3, disabled: 4 };

/** Needs sign-in, then broken, then the rest; by name within each. */
export function sortServers(list: McpServer[]): McpServer[] {
  return [...list].sort(
    (a, b) => (RANK[a.status] ?? 2) - (RANK[b.status] ?? 2) || displayName(a).name.localeCompare(displayName(b).name, undefined, { sensitivity: "base" }),
  );
}

/** "12 connected · 2 need sign-in · 1 not working". */
export function summary(list: McpServer[]): string {
  const n = (status: string) => list.filter((s) => s.status === status).length;
  const parts = [`${n("connected")} connected`];
  if (n("needs-auth")) parts.push(`${n("needs-auth")} need${n("needs-auth") === 1 ? "s" : ""} sign-in`);
  if (n("failed")) parts.push(`${n("failed")} not working`);
  if (n("pending")) parts.push(`${n("pending")} connecting`);
  return parts.join(" · ");
}

/** What the user can do about a server: sign in, retry, or nothing. */
export function actionFor(s: McpServer): "connect" | "open" | "retry" | null {
  if (s.status === "needs-auth") return s.app ? (s.installUrl ? "open" : null) : "connect";
  if (s.status === "failed") return "retry";
  return null;
}

/** The error a server reports, without the transport type noise Codex adds. */
export function shortError(e: string | undefined): string {
  if (!e) return "";
  const cleaned = e.replace(/Transport \[[^\]]*\]/g, "Transport").replace(/\s+/g, " ").trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 219)}…` : cleaned;
}
