// `yard-claude connectors <cwd>`: one Claude Code process with no prompt, kept
// by yardd per account to list MCP servers and sign them in. No message is
// ever sent, so no turn runs and no usage is spent; Claude Code still loads
// every server the account has (claude.ai connectors, plugins, user and
// project config) and dials them.
//
// stdin  (JSON lines): { id, type: "status" | "auth" | "callback" | "reconnect", server?, url? }
// stdout (JSON lines): { id, ok: true, result } | { id, ok: false, error }
//                      | { type: "auth_done", server, ok, error? }   (a sign-in finished)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";
import { summarize } from "./mcp";

const out = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");

/** Statuses settle within a few seconds; a server still dialing after this shows as pending. */
const SETTLE_MS = 15_000;
/** How long a sign-in is watched for before giving up. */
const AUTH_WAIT_MS = 10 * 60_000;

async function* never(): AsyncGenerator<never> {
  await new Promise(() => {});
}

export async function connectors(cwd: string) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key.startsWith("CLAUDE_AGENT_SDK")) continue;
    env[key] = value;
  }
  const options: Record<string, unknown> = { cwd, env };
  const claudeBin = Bun.which("claude");
  if (claudeBin) options.pathToClaudeCodeExecutable = claudeBin;
  const q: any = query({ prompt: never() as any, options: options as any });

  const status = async (): Promise<any[]> => {
    const until = Date.now() + SETTLE_MS;
    for (;;) {
      const list = await q.mcpServerStatus();
      if (!list.some((s: any) => s?.status === "pending") || Date.now() > until) return list;
      await Bun.sleep(500);
    }
  };

  // Sign-ins being watched, so a second Connect does not start a second watch.
  const watching = new Set<string>();
  const watch = (server: string, claudeai: boolean) => {
    if (watching.has(server)) return;
    watching.add(server);
    const until = Date.now() + AUTH_WAIT_MS;
    (async () => {
      while (Date.now() < until) {
        await Bun.sleep(claudeai ? 4000 : 2000);
        // A claude.ai connector is connected on claude.ai; this process only
        // notices when it dials again.
        if (claudeai) await q.reconnectMcpServer(server).catch(() => {});
        const s = (await q.mcpServerStatus().catch(() => [])).find((x: any) => x?.name === server);
        if (s?.status === "connected") return out({ type: "auth_done", server, ok: true });
        if (!s) return out({ type: "auth_done", server, ok: false, error: "The server is no longer configured." });
      }
      out({ type: "auth_done", server, ok: false, error: "Timed out waiting for the sign-in." });
    })().finally(() => watching.delete(server));
  };

  const handlers: Record<string, (msg: any) => Promise<unknown>> = {
    status: async () => summarize(await status()),
    auth: async ({ server }) => {
      const list = await q.mcpServerStatus();
      const row = list.find((s: any) => s?.name === server);
      if (!row) throw new Error(`No MCP server named ${server}`);
      const claudeai = row.config?.type === "claudeai-proxy" || row.source === "claudeai" || row.scope === "claudeai";
      const res = await q.mcpAuthenticate(server);
      if (!res?.requiresUserAction || !res.authUrl) {
        // Signed in without the user (a token that only needed a refresh).
        await q.reconnectMcpServer(server).catch(() => {});
        return { done: true };
      }
      watch(server, claudeai);
      // A claude.ai connector is connected on claude.ai and never redirects
      // back; any other server redirects to a page on the host running
      // Claude Code, which the user's browser may not reach.
      return { url: res.authUrl, paste: !!res.callbackExpected && !claudeai };
    },
    callback: async ({ server, url }) => {
      await q.mcpSubmitOAuthCallbackUrl(server, url);
      return { done: true };
    },
    reconnect: async ({ server }) => {
      await q.reconnectMcpServer(server);
      return { done: true };
    },
  };

  createInterface({ input: process.stdin }).on("line", async (line) => {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const handler = handlers[msg?.type];
    if (!handler) return out({ id: msg?.id, ok: false, error: `unknown request ${msg?.type}` });
    try {
      out({ id: msg.id, ok: true, result: await handler(msg) });
    } catch (error: any) {
      out({ id: msg.id, ok: false, error: String(error?.message ?? error).slice(0, 1000) });
    }
  });
  // yardd closed our stdin: it no longer needs us.
  process.stdin.on("end", () => process.exit(0));
  await q.initializationResult();
}
