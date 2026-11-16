import { describe, expect, test } from "bun:test";
import { clampHeight, cspFor, frameDocument, origins, route, toolResult } from "./widget";

const env = { maxWidth: 640, touch: false, desktop: false };

describe("the frame's CSP", () => {
  test("no network unless the server declared it", () => {
    const csp = cspFor(null);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("form-action 'none'");
  });

  test("declared origins are allowed where they belong", () => {
    const csp = cspFor({ connectDomains: ["https://api.datadoghq.com", "wss://live.example.com"], resourceDomains: ["https://*.cdn.example.com"] });
    expect(csp).toContain("connect-src https://api.datadoghq.com wss://live.example.com");
    expect(csp).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob: data: https://*.cdn.example.com");
  });

  test("a declared value cannot add a directive or a wildcard", () => {
    expect(origins(["https://ok.example; script-src *", "*", "http://plain.example", "javascript:alert(1)", "https://ok.example", "HTTPS://OK.example"])).toEqual([
      "https://ok.example",
    ]);
    expect(cspFor({ connectDomains: ["https://a.example; default-src *"] })).toContain("connect-src 'none'");
    expect(origins("https://a.example")).toEqual([]);
  });
});

test("the policy comes before anything the widget wrote", () => {
  const doc = frameDocument({ html: '<!-- <head> --><!doctype html><html><head><script>x()</script>', csp: null });
  expect(doc.startsWith('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src')).toBe(true);
  expect(doc.indexOf("<script>")).toBeGreaterThan(doc.indexOf("Content-Security-Policy"));
  expect(frameDocument({ html: "", csp: { connectDomains: ['https://a.example"><script>'] } })).not.toContain("<script>");
});

describe("messages from the widget", () => {
  /** `id` null makes a notification. */
  const msg = (method: string, params?: unknown, id: number | null = 1) => (id === null ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params });

  test("initialize answers with the host and its context", () => {
    const step = route(msg("ui/initialize", { appInfo: { name: "x" }, protocolVersion: "2026-01-26" }), env, 100);
    expect(step.kind).toBe("reply");
    const r = (step as any).result;
    expect(r.protocolVersion).toBe("2026-01-26");
    expect(r.hostInfo.name).toBe("switchyard");
    expect(r.hostCapabilities.serverTools).toEqual({});
    expect(r.hostContext.containerDimensions.maxWidth).toBe(640);
  });

  test("tool calls, links, sizes", () => {
    expect(route(msg("tools/call", { name: "refresh_chart", arguments: { points: 3 } }), env, 100)).toEqual({ kind: "call", tool: "refresh_chart", args: { points: 3 } });
    expect(route(msg("tools/call", { arguments: {} }), env, 100).kind).toBe("error");
    expect(route(msg("ui/open-link", { url: "https://docs.example.com" }), env, 100)).toEqual({ kind: "open", url: "https://docs.example.com" });
    expect(route(msg("ui/open-link", { url: "javascript:alert(1)" }), env, 100).kind).toBe("error");
    expect(route(msg("ui/notifications/size-changed", { height: 99999 }, null), env, 100)).toEqual({ kind: "resize", height: 720 });
    expect(route(msg("ui/notifications/size-changed", { width: 3 }, null), env, 100)).toEqual({ kind: "resize", height: 100 });
  });

  test("what the host does not do is refused, notifications ignored, junk ignored", () => {
    expect(route(msg("ui/message", { role: "user", content: [] }), env, 100)).toMatchObject({ kind: "error", code: -32601 });
    expect(route(msg("notifications/message", { level: "info" }, null), env, 100)).toEqual({ kind: "ignore" });
    expect(route({ method: "tools/call" }, env, 100)).toEqual({ kind: "ignore" });
    expect(route("hello", env, 100)).toEqual({ kind: "ignore" });
  });
});

test("heights stay within bounds", () => {
  expect(clampHeight(10, 100)).toBe(48);
  expect(clampHeight(Number.NaN, 100)).toBe(100);
  expect(clampHeight(301.2, 100)).toBe(302);
});

test("a stored result becomes the CallToolResult the widget expects", () => {
  expect(toolResult({ content: [{ type: "text", text: "x" }], structuredContent: { a: 1 }, _meta: null })).toEqual({ content: [{ type: "text", text: "x" }], structuredContent: { a: 1 } });
  expect(toolResult(null)).toEqual({ content: [] });
});
