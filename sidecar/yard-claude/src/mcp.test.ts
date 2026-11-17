import { describe, expect, test } from "bun:test";
import { createApps } from "./apps";
import { summarize, toolName, uiResource, visibility, widgetResource, widgetResult } from "./mcp";

describe("summarize", () => {
  test("one row per server, with tool and widget counts and no URL path", () => {
    const rows = summarize([
      {
        name: "claude.ai Datadog",
        status: "needs-auth",
        source: "claudeai",
        config: { type: "claudeai-proxy", url: "https://mcp-proxy.anthropic.com/v1/mcp/abc?token=secret", id: "x" },
      },
      {
        name: "chart",
        status: "connected",
        scope: "dynamic",
        tools: [{ name: "show_chart", _meta: { ui: { resourceUri: "ui://chart/view.html" } } }, { name: "plain" }],
      },
      { name: "broken", status: "failed", error: "x".repeat(900) },
    ]);
    expect(rows[0]).toEqual({ name: "claude.ai Datadog", status: "needs-auth", source: "claudeai", tools: 0, appTools: 0, origin: "https://mcp-proxy.anthropic.com" });
    expect(rows[1]).toMatchObject({ name: "chart", source: "dynamic", tools: 2, appTools: 1 });
    expect(rows[2].error!.length).toBe(500);
  });
});

test("tool names follow Claude Code's mcp__<server>__<tool>", () => {
  expect(toolName("claude.ai Figma", "get_screenshot")).toBe("mcp__claude_ai_Figma__get_screenshot");
  expect(toolName("plugin:engineering:datadog", "query")).toBe("mcp__plugin_engineering_datadog__query");
});

test("a widget is a ui:// resource, under the current or the flat key", () => {
  expect(uiResource({ ui: { resourceUri: "ui://a/b.html" } })).toBe("ui://a/b.html");
  expect(uiResource({ "ui/resourceUri": "ui://flat.html" })).toBe("ui://flat.html");
  expect(uiResource({ ui: { resourceUri: "https://evil.example/x.html" } })).toBeNull();
  expect(uiResource(undefined)).toBeNull();
  expect(visibility({ ui: { visibility: ["app"] } })).toEqual(["app"]);
  expect(visibility({})).toEqual(["model", "app"]);
});

test("widgetResource takes the HTML item and its sandbox meta", () => {
  const r = widgetResource([
    { uri: "ui://x", mimeType: "application/json", text: "{}" },
    { uri: "ui://x", mimeType: "text/html;profile=mcp-app", text: "<p>hi</p>", _meta: { ui: { csp: { connectDomains: ["https://api.example"] }, prefersBorder: false } } },
  ]);
  expect(r).toEqual({ html: "<p>hi</p>", csp: { connectDomains: ["https://api.example"] }, prefersBorder: false });
  expect(widgetResource([{ mimeType: "text/html", blob: Buffer.from("<b>b</b>").toString("base64") }])?.html).toBe("<b>b</b>");
  expect(widgetResource("nope")).toBeNull();
});

test("widgetResult prefers the server's own result over the model's text", () => {
  const block = { tool_use_id: "t", content: [{ type: "text", text: "model text" }] };
  expect(widgetResult(block, { content: [{ type: "text", text: "raw" }], structuredContent: { a: 1 } })).toEqual({
    content: [{ type: "text", text: "raw" }],
    structuredContent: { a: 1 },
  });
  // Cut for size: only the model's text is left.
  expect(widgetResult(block, "a string")).toEqual({ content: [{ type: "text", text: "model text" }] });
  expect(widgetResult({ ...block, is_error: true }, null).isError).toBe(true);
});

function fakeQuery() {
  const requests: any[] = [];
  const reads: string[] = [];
  return {
    requests,
    reads,
    q: {
      mcpServerStatus: async () => [
        {
          name: "chart",
          status: "connected",
          tools: [
            { name: "show_chart", annotations: { readOnly: true }, _meta: { ui: { resourceUri: "ui://chart/view.html" } } },
            { name: "refresh_chart", annotations: { readOnly: true }, _meta: { ui: { resourceUri: "ui://chart/view.html", visibility: ["app"] } } },
            { name: "model_only", _meta: { ui: { visibility: ["model"] } } },
            { name: "delete_everything", annotations: { destructive: true } },
          ],
        },
        { name: "other", status: "connected", tools: [{ name: "x" }] },
      ],
      readMcpResource: async (server: string, uri: string) => {
        reads.push(`${server} ${uri}`);
        return { contents: [{ uri, mimeType: "text/html;profile=mcp-app", text: "<svg/>", _meta: { ui: { prefersBorder: true } } }] };
      },
      request: async (r: any) => {
        requests.push(r);
        return { subtype: "success", response: { content: [], structuredContent: { ok: true } } };
      },
    },
  };
}

describe("apps", () => {
  test("an MCP call with a widget completes with the widget, its input and result", async () => {
    const { q, reads } = fakeQuery();
    const apps = createApps(q);
    apps.started({ id: "t1", name: "mcp__chart__show_chart", input: { metric: "p95" } });
    apps.started({ id: "t2", name: "Bash", input: { command: "ls" } });
    const app = await apps.completed({ tool_use_id: "t1", content: [] }, { content: [{ type: "text", text: "ok" }], structuredContent: { data: [1] } });
    expect(app).toMatchObject({
      server: "chart",
      tool: "show_chart",
      uri: "ui://chart/view.html",
      html: "<svg/>",
      prefersBorder: true,
      input: { metric: "p95" },
      result: { structuredContent: { data: [1] } },
    });
    expect(await apps.completed({ tool_use_id: "t2", content: "x" }, null)).toBeNull();
    // A second call reuses the resource it read.
    apps.started({ id: "t3", name: "mcp__chart__show_chart", input: {} });
    await apps.completed({ tool_use_id: "t3", content: [] }, null);
    expect(reads).toEqual(["chart ui://chart/view.html"]);
  });

  test("a failed call or a tool without a widget has none", async () => {
    const { q } = fakeQuery();
    const apps = createApps(q);
    apps.started({ id: "a", name: "mcp__chart__show_chart", input: {} });
    expect(await apps.completed({ tool_use_id: "a", is_error: true, content: "boom" }, null)).toBeNull();
    apps.started({ id: "b", name: "mcp__other__x", input: {} });
    expect(await apps.completed({ tool_use_id: "b", content: [] }, null)).toBeNull();
  });

  test("a widget calls only its server's widget tools; side effects go through the permission check", async () => {
    const { q, requests } = fakeQuery();
    const apps = createApps(q);
    expect(await apps.call("chart", "refresh_chart", { points: 12 })).toEqual({ content: [], structuredContent: { ok: true } });
    expect(requests[0]).toEqual({
      subtype: "mcp_call",
      tool: "mcp__chart__refresh_chart",
      arguments: { points: 12 },
      result_not_for_model: true,
      check_permissions: false,
    });
    await apps.call("chart", "delete_everything", {});
    expect(requests[1].check_permissions).toBe(true);
    await expect(apps.call("chart", "model_only", {})).rejects.toThrow("not offered to widgets");
    await expect(apps.call("chart", "x", {})).rejects.toThrow("chart has no tool x");
  });
});
