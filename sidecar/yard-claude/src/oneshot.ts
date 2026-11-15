// One-shot modes for importing Claude Code sessions. yardd runs
//   yard-claude sessions [--limit N]   -> { sessions: SessionRow[] }, newest first
//   yard-claude messages <sessionId>   -> { session: SessionRow & { model }, events }
// and reads one JSON line. Sessions come from the SDK, never from parsing
// ~/.claude/projects, and use whatever account the CLI is logged in with.
import { getSessionInfo, getSessionMessages, listSessions } from "@anthropic-ai/claude-agent-sdk";
import { historyEvents, lastModel, sessionRow } from "./history";

export async function oneShot(mode: string, args: string[]): Promise<unknown> {
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
