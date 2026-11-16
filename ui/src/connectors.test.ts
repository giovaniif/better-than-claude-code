import { expect, test } from "bun:test";
import { actionFor, displayName, shortError, sortServers, summary } from "./connectors";
import type { McpServer } from "./protocol";

const s = (name: string, status: string, extra: Partial<McpServer> = {}): McpServer => ({ name, status, source: "user", tools: 0, appTools: 0, ...extra });

test("names read as the service, with where it comes from", () => {
  expect(displayName(s("claude.ai Datadog", "connected", { source: "claudeai" }))).toEqual({ name: "Datadog", via: "claude.ai" });
  expect(displayName(s("plugin:engineering:sentry", "connected", { source: "plugin" }))).toEqual({ name: "sentry", via: "engineering plugin" });
  expect(displayName(s("posthog", "connected", { source: "config" }))).toEqual({ name: "posthog", via: "config.toml" });
  expect(displayName(s("x", "connected", { source: "something-new" }))).toEqual({ name: "x", via: "something-new" });
});

test("what needs the user comes first", () => {
  const list = [s("b", "connected"), s("metabase", "failed"), s("a", "connected"), s("Datadog", "needs-auth"), s("old", "disabled")];
  expect(sortServers(list).map((x) => x.name)).toEqual(["Datadog", "metabase", "a", "b", "old"]);
  expect(summary(list)).toBe("2 connected · 1 needs sign-in · 1 not working");
  expect(summary([s("a", "needs-auth"), s("b", "needs-auth")])).toBe("0 connected · 2 need sign-in");
});

test("each state offers what can fix it", () => {
  expect(actionFor(s("x", "needs-auth"))).toBe("connect");
  expect(actionFor(s("GitHub", "needs-auth", { app: true, installUrl: "https://chatgpt.com/apps/github" }))).toBe("open");
  expect(actionFor(s("GitHub", "needs-auth", { app: true }))).toBeNull();
  expect(actionFor(s("x", "failed"))).toBe("retry");
  expect(actionFor(s("x", "connected"))).toBeNull();
});

test("Codex's transport noise is cut from errors", () => {
  expect(shortError("MCP startup failed: Send message error Transport [a::b<c::d>] error: Auth required")).toBe("MCP startup failed: Send message error Transport error: Auth required");
  expect(shortError(undefined)).toBe("");
});
