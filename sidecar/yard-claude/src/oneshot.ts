// One-shot modes. For importing Claude Code sessions, yardd runs
//   yard-claude sessions [--limit N]   -> { sessions: SessionRow[] }, newest first
//   yard-claude messages <sessionId>   -> { session: SessionRow & { model }, events }
// and for an account's plan limits, with no turn,
//   yard-claude usage                  -> { usage: ClaudeUsage | null }
// and reads one JSON line. Sessions come from the SDK, never from parsing
// ~/.claude/projects, and use whatever account the CLI is logged in with.
import { getSessionInfo, getSessionMessages, listSessions, query } from "@anthropic-ai/claude-agent-sdk";
import { historyEvents, lastModel, sessionRow } from "./history";
import { fromUsageReport } from "./usage";

async function* never(): AsyncGenerator<never> {
  await new Promise(() => {});
}

/** The account's limits from Claude Code's usage report: a Claude Code with
 *  no prompt, so nothing is sent to a model. */
async function usage(): Promise<unknown> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key.startsWith("CLAUDE_AGENT_SDK")) continue;
    env[key] = value;
  }
  const options: Record<string, unknown> = { cwd: process.env.HOME || process.cwd(), env };
  const claudeBin = Bun.which("claude");
  if (claudeBin) options.pathToClaudeCodeExecutable = claudeBin;
  const q: any = query({ prompt: never() as any, options: options as any });
  try {
    await q.initializationResult();
    // Experimental in the SDK (0.3.323); a build without it reports no usage.
    if (typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== "function") return { usage: null };
    const report = await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    return { usage: fromUsageReport(report) };
  } finally {
    q.close?.();
  }
}

export async function oneShot(mode: string, args: string[]): Promise<unknown> {
  if (mode === "usage") return usage();
  if (mode === "sessions") {
    const i = args.indexOf("--limit");
    const limit = i >= 0 ? Number(args[i + 1]) : 200;
    // Like Claude Code's own /resume: no SDK or headless sessions (Switchyard's own included).
    const list = await listSessions({ includeProgrammatic: false, limit });
    return { sessions: list.map(sessionRow).sort((a, b) => b.lastModified - a.lastModified) };
  }
  const sessionId = args[0];
  if (!sessionId) throw new Error("messages needs a session id");
  const info = await getSessionInfo(sessionId);
  if (!info) throw new Error(`no Claude Code session ${sessionId}`);
  const row = sessionRow(info);
  const messages = await getSessionMessages(sessionId);
  return { session: { ...row, model: lastModel(messages) }, events: historyEvents(messages, row.cwd ?? process.cwd()) };
}
