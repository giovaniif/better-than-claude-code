// The host side of MCP Apps (SEP-1865, protocol 2026-01-26): a widget an MCP
// tool declares (a chart, a table, a form) runs in a sandboxed frame and talks
// to us over postMessage with JSON-RPC. This file holds the parts that need no
// DOM: the frame's CSP and document, and how each message is answered.
//
// The widget's HTML comes from a third-party server, so it is untrusted:
// - the frame has `sandbox="allow-scripts"` and no `allow-same-origin`, so it
//   gets an opaque origin: no access to this page, its storage or cookies, and
//   yardd's socket refuses its `Origin: null`;
// - the first element of its document is a CSP that allows the network only
//   to the origins the server declared (`_meta.ui.csp`), each checked to be a
//   plain origin so a declared value cannot add directives;
// - it can call tools only of its own server, through yardd, which applies the
//   engine's permission rules; links open only as http(s) in a new tab.

export const PROTOCOL_VERSION = "2026-01-26";

export interface WidgetRecord {
  server: string;
  tool: string;
  uri?: string;
  html: string;
  csp?: { connectDomains?: unknown; resourceDomains?: unknown; frameDomains?: unknown; baseUriDomains?: unknown } | null;
  permissions?: unknown;
  prefersBorder?: boolean | null;
  input?: unknown;
  result?: unknown;
}

/** `https://api.example.com`, `https://*.example.com:8443`, `wss://x.example`:
 *  a scheme and a host, nothing that could end the directive. */
const ORIGIN = /^(https|wss):\/\/(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export function origins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((o): o is string => typeof o === "string" && ORIGIN.test(o.trim())).map((o) => o.trim().toLowerCase()))].slice(0, 32);
}

/** The frame's policy: inline code and declared origins only. */
export function cspFor(csp: WidgetRecord["csp"]): string {
  const res = origins(csp?.resourceDomains);
  const connect = origins(csp?.connectDomains);
  const frames = origins(csp?.frameDomains).filter((o) => o.startsWith("https://"));
  const base = origins(csp?.baseUriDomains).filter((o) => o.startsWith("https://"));
  const list = (items: string[], fallback = "'none'") => (items.length ? items.join(" ") : fallback);
  const r = res.filter((o) => o.startsWith("https://"));
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' 'unsafe-eval' blob: data: ${r.join(" ")}`.trim(),
    `style-src 'unsafe-inline' data: ${r.join(" ")}`.trim(),
    `img-src data: blob: ${r.join(" ")}`.trim(),
    `font-src data: ${r.join(" ")}`.trim(),
    `media-src data: blob: ${r.join(" ")}`.trim(),
    `connect-src ${list(connect)}`,
    `frame-src ${list(frames)}`,
    `base-uri ${list(base)}`,
    "worker-src blob:",
    "form-action 'none'",
  ].join("; ");
}

const escAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The frame's document: our doctype and CSP first, then the widget's HTML.
 *  Nothing the widget writes can come before the policy: the parser puts the
 *  meta in <head> at once and merges or ignores the widget's own doctype,
 *  <html> and <head> tags, and keeps standards mode. */
export function frameDocument(record: Pick<WidgetRecord, "html" | "csp">): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${escAttr(cspFor(record.csp))}">${record.html}`;
}

export interface HostEnv {
  /** Width the frame has, for `containerDimensions`. */
  maxWidth: number;
  touch: boolean;
  desktop: boolean;
}

/** The MCP Apps theme variables a widget may use, from this page's own tokens
 *  (styles.css :root), so a widget matches the app. */
const THEME: Record<string, string> = {
  "--color-background-primary": "--bg",
  "--color-background-secondary": "--side",
  "--color-text-primary": "--ink",
  "--color-text-secondary": "--muted",
  "--color-border-primary": "--line",
  "--font-mono": "--mono",
};

function themeVariables(): Record<string, string> {
  const out: Record<string, string> = { "--font-sans": "Inter, system-ui, sans-serif" };
  if (typeof document === "undefined") return out;
  const css = getComputedStyle(document.documentElement);
  for (const [key, token] of Object.entries(THEME)) {
    const v = css.getPropertyValue(token).trim();
    if (v) out[key] = v;
  }
  return out;
}

export function hostContext(env: HostEnv) {
  return {
    theme: "light",
    displayMode: "inline",
    availableDisplayModes: ["inline"],
    containerDimensions: { maxWidth: Math.round(env.maxWidth), maxHeight: MAX_HEIGHT },
    locale: typeof navigator !== "undefined" ? navigator.language : "en-US",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: "switchyard",
    platform: env.desktop ? "desktop" : "web",
    deviceCapabilities: { touch: env.touch, hover: !env.touch },
    styles: { variables: themeVariables() },
  };
}

export const MIN_HEIGHT = 48;
export const MAX_HEIGHT = 720;
export const clampHeight = (h: unknown, fallback: number) =>
  typeof h === "number" && Number.isFinite(h) ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(h))) : fallback;

/** What the host does with a message from the widget. */
export type Step =
  | { kind: "reply"; result: unknown }
  | { kind: "error"; code: number; message: string }
  /** After `initialized`: send the tool's input and result. */
  | { kind: "initialized" }
  | { kind: "resize"; height: number }
  | { kind: "call"; tool: string; args: Record<string, unknown> }
  | { kind: "open"; url: string }
  | { kind: "ignore" };

export const isHttpUrl = (u: unknown): u is string => {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** Decide what a message asks for. `env` fills in the initialize answer. */
export function route(msg: any, env: HostEnv, height: number): Step {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return { kind: "ignore" };
  const p = msg.params && typeof msg.params === "object" ? msg.params : {};
  const isRequest = msg.id !== undefined && msg.id !== null;
  switch (msg.method) {
    case "ui/initialize":
      return {
        kind: "reply",
        result: {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: { name: "switchyard", version: "1" },
          hostCapabilities: { openLinks: {}, serverTools: {}, logging: {} },
          hostContext: hostContext(env),
        },
      };
    case "ui/notifications/initialized":
      return { kind: "initialized" };
    case "ui/notifications/size-changed":
      return { kind: "resize", height: clampHeight(p.height, height) };
    case "tools/call":
      if (typeof p.name !== "string" || !p.name) return { kind: "error", code: -32602, message: "tools/call needs a tool name" };
      return { kind: "call", tool: p.name, args: p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? p.arguments : {} };
    case "ui/open-link":
      if (!isHttpUrl(p.url)) return { kind: "error", code: -32602, message: "only http(s) links open" };
      return { kind: "open", url: p.url };
    case "ui/request-display-mode":
      return { kind: "reply", result: { mode: "inline" } };
    case "ping":
      return { kind: "reply", result: {} };
    default:
      // Logging and anything else the host does not do.
      return isRequest ? { kind: "error", code: -32601, message: `${msg.method} is not supported by Switchyard` } : { kind: "ignore" };
  }
}

/** The `tool-result` a widget gets: the stored result as a CallToolResult. */
export function toolResult(result: unknown): Record<string, unknown> {
  const r = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  return { content: Array.isArray(r.content) ? r.content : [], ...(r.structuredContent !== undefined && r.structuredContent !== null ? { structuredContent: r.structuredContent } : {}), ...(r.isError ? { isError: true } : {}) };
}
