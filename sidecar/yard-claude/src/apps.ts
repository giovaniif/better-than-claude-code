// MCP Apps in a Claude session: when an MCP tool that declares a widget
// (`_meta.ui.resourceUri`) returns, read the widget through the CLI's own
// connection to that server and hand it to yardd with the call's input and
// result. Later calls the widget makes (a "load more" button) come back
// through `call`, limited to its own server.
import { MAX_WIDGET_HTML, toolName, uiResource, visibility, widgetResource, widgetResult, type WidgetResource } from "./mcp";

interface ToolInfo {
  server: string;
  tool: string;
  uri: string | null;
  readOnly: boolean;
  visibility: string[];
}

/** What `tool_completed` carries for a widget; yardd stores it and keeps
 *  only an id in the event log. */
export interface WidgetPayload extends WidgetResource {
  server: string;
  tool: string;
  uri: string;
  input: unknown;
  result: unknown;
}

const READ_TIMEOUT_MS = 8000;
/** A tool name not seen before triggers at most one status refresh this often. */
const REFRESH_EVERY_MS = 3000;

function timeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

export function createApps(q: { mcpServerStatus(): Promise<any[]>; readMcpResource(server: string, uri: string): Promise<any>; request?: (r: object) => Promise<any> }) {
  let tools = new Map<string, ToolInfo>();
  let refreshedAt = 0;
  const resources = new Map<string, Promise<WidgetResource | null>>();
  const calls = new Map<string, { name: string; input: unknown }>();

  async function refresh() {
    refreshedAt = Date.now();
    const next = new Map<string, ToolInfo>();
    for (const s of await q.mcpServerStatus()) {
      if (typeof s?.name !== "string" || !Array.isArray(s.tools)) continue;
      for (const t of s.tools) {
        if (typeof t?.name !== "string") continue;
        next.set(toolName(s.name, t.name), {
          server: s.name,
          tool: t.name,
          uri: uiResource(t._meta),
          readOnly: t.annotations?.readOnly === true || t.annotations?.readOnlyHint === true,
          visibility: visibility(t._meta),
        });
      }
    }
    tools = next;
  }

  async function lookup(name: string): Promise<ToolInfo | null> {
    if (!tools.has(name) && Date.now() - refreshedAt > REFRESH_EVERY_MS) await refresh().catch(() => {});
    return tools.get(name) ?? null;
  }

  function read(server: string, uri: string): Promise<WidgetResource | null> {
    const key = `${server}\n${uri}`;
    let p = resources.get(key);
    if (!p) {
      p = q.readMcpResource(server, uri).then(
        (r) => widgetResource(r?.contents),
        () => null,
      );
      // A failed read is tried again next time.
      p.then((r) => {
        if (!r) resources.delete(key);
      });
      resources.set(key, p);
    }
    return p;
  }

  return {
    /** A tool_use block: remember MCP calls until their result. */
    started(block: { id: string; name: string; input: unknown }) {
      if (typeof block?.name === "string" && block.name.startsWith("mcp__")) calls.set(block.id, { name: block.name, input: block.input ?? {} });
    },

    /** The widget for a tool_result, or null when the tool has none. */
    async completed(block: any, toolUseResult: unknown): Promise<WidgetPayload | null> {
      const call = calls.get(block?.tool_use_id);
      calls.delete(block?.tool_use_id);
      if (!call || block?.is_error) return null;
      const info = await lookup(call.name);
      if (!info?.uri) return null;
      const res = await timeout(read(info.server, info.uri), READ_TIMEOUT_MS);
      if (!res || res.html.length > MAX_WIDGET_HTML) return null;
      return { ...res, server: info.server, tool: info.tool, uri: info.uri, input: call.input, result: widgetResult(block, toolUseResult) };
    },

    /** A call a widget makes. Only tools of its own server that are offered
     *  to widgets; anything not read-only goes through Claude Code's
     *  permission check, which asks in the thread like a model's call. */
    async call(server: string, tool: string, args: unknown): Promise<unknown> {
      const name = toolName(server, tool);
      const info = await lookup(name);
      if (!info || info.server !== server) throw new Error(`${server} has no tool ${tool}`);
      if (!info.visibility.includes("app")) throw new Error(`${tool} is not offered to widgets`);
      if (!q.request) throw new Error("this Claude Code cannot run a widget's tool calls");
      const r = await q.request({
        subtype: "mcp_call",
        tool: name,
        arguments: args && typeof args === "object" ? args : {},
        result_not_for_model: true,
        check_permissions: !info.readOnly,
      });
      return r?.response ?? r;
    },
  };
}
