// MCP servers as yardd shows them: one summary row per server for the
// Connectors page, and the MCP Apps (SEP-1865) widget a tool declares, so a
// chart a connector draws can be shown in the thread.
//
// Everything a server sends is untrusted: names and errors are text to show,
// widget HTML only ever runs in the UI's sandboxed frame.

/** One server, as the Connectors page lists it. */
export interface ServerRow {
  name: string;
  /** connected | needs-auth | failed | pending | disabled */
  status: string;
  /** Where it is configured: claudeai, plugin, user, project, local, dynamic, managed, ... */
  source: string;
  tools: number;
  /** Tools that come with a widget (a chart, a form) the thread can show. */
  appTools: number;
  error?: string;
  /** Scheme and host of an HTTP server, never its path or query (tokens live there). */
  origin?: string;
}

const clip = (s: unknown, n: number) => (typeof s === "string" ? (s.length > n ? `${s.slice(0, n - 1)}…` : s) : undefined);

/** The `ui://` resource a tool's `_meta` names, current key first. */
export function uiResource(meta: unknown): string | null {
  const m = meta as Record<string, any> | null | undefined;
  const uri = m?.ui?.resourceUri ?? m?.["ui/resourceUri"];
  return typeof uri === "string" && uri.startsWith("ui://") ? uri : null;
}

/** Who may call a tool: the model, its widget, or both (the default). */
export function visibility(meta: unknown): string[] {
  const v = (meta as Record<string, any> | null | undefined)?.ui?.visibility;
  return Array.isArray(v) ? v.filter((x) => x === "model" || x === "app") : ["model", "app"];
}

function origin(config: any): string | undefined {
  if (typeof config?.url !== "string") return undefined;
  try {
    const u = new URL(config.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

export function summarize(statuses: any[]): ServerRow[] {
  return (Array.isArray(statuses) ? statuses : []).map((s) => {
    const tools = Array.isArray(s?.tools) ? s.tools : [];
    const row: ServerRow = {
      name: String(s?.name ?? "").slice(0, 200),
      status: typeof s?.status === "string" ? s.status : "failed",
      source: String(s?.source ?? s?.scope ?? "config"),
      tools: tools.length,
      appTools: tools.filter((t: any) => uiResource(t?._meta)).length,
    };
    const error = clip(s?.error, 500);
    if (error) row.error = error;
    const o = origin(s?.config);
    if (o) row.origin = o;
    return row;
  });
}

/** Claude Code's name for a server's tool: `mcp__<server>__<tool>`, with
 *  anything outside [a-zA-Z0-9_-] in the server name turned into `_`. */
export function toolName(server: string, tool: string): string {
  return `mcp__${server.replace(/[^a-zA-Z0-9_-]/g, "_")}__${tool}`;
}

/** A widget's HTML and the resource `_meta` that rules its sandbox. */
export interface WidgetResource {
  html: string;
  csp?: unknown;
  permissions?: unknown;
  prefersBorder?: boolean;
}

/** HTML larger than this is not shown: a widget is a page, not a payload. */
export const MAX_WIDGET_HTML = 4 * 1024 * 1024;

/** The first HTML item of a `resources/read` answer. */
export function widgetResource(contents: unknown): WidgetResource | null {
  if (!Array.isArray(contents)) return null;
  for (const c of contents) {
    const mime = typeof c?.mimeType === "string" ? c.mimeType : "text/html";
    if (!mime.startsWith("text/html")) continue;
    let html: string | null = null;
    if (typeof c.text === "string") html = c.text;
    else if (typeof c.blob === "string") html = Buffer.from(c.blob, "base64").toString("utf8");
    if (html === null || html.length > MAX_WIDGET_HTML) return null;
    const ui = c._meta?.ui ?? {};
    const out: WidgetResource = { html };
    if (ui.csp && typeof ui.csp === "object") out.csp = ui.csp;
    if (ui.permissions && typeof ui.permissions === "object") out.permissions = ui.permissions;
    if (typeof ui.prefersBorder === "boolean") out.prefersBorder = ui.prefersBorder;
    return out;
  }
  return null;
}

/** A tool result for a widget. Claude Code passes an MCP call's own result
 *  on as `tool_use_result`: `{ content, structuredContent?, _meta? }` in the
 *  server's shape, next to the text the model reads (checked in claude
 *  2.1.325). A result too large for that keeps only the model's text. */
export function widgetResult(block: any, toolUseResult: any): { content: unknown[]; structuredContent?: unknown; _meta?: unknown; isError?: boolean } {
  const tur = toolUseResult && typeof toolUseResult === "object" && !Array.isArray(toolUseResult) ? toolUseResult : null;
  const content = Array.isArray(tur?.content)
    ? tur.content
    : Array.isArray(block?.content)
      ? block.content
      : typeof block?.content === "string"
        ? [{ type: "text", text: block.content }]
        : [];
  const out: { content: unknown[]; structuredContent?: unknown; _meta?: unknown; isError?: boolean } = { content };
  if (tur?.structuredContent !== undefined) out.structuredContent = tur.structuredContent;
  if (tur?._meta && typeof tur._meta === "object") out._meta = tur._meta;
  if (block?.is_error) out.isError = true;
  return out;
}
