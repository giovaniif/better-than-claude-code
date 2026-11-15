// A Claude Code session's transcript (the SDK's getSessionMessages) as yardd
// events, so an imported session shows its history like any other. Pure: no
// SDK calls here, so it is tested without an account.
import { describe, patchFor, resultText, short } from "./tools";

type Event = Record<string, any>;

export interface SessionRow {
  sessionId: string;
  title: string;
  cwd?: string;
  gitBranch?: string;
  lastModified: number;
  createdAt?: number;
}

/** What the import dialog lists for a session. */
export function sessionRow(info: any): SessionRow {
  const title = String(info.customTitle || info.summary || info.firstPrompt || "Untitled Claude Code session")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return { sessionId: info.sessionId, title, cwd: info.cwd, gitBranch: info.gitBranch, lastModified: info.lastModified, createdAt: info.createdAt };
}

/** Prompts Claude Code writes for itself: slash commands, their output, caveats. */
const BOOKKEEPING = /^\s*(<command-|<local-command-|<system-reminder>|Caveat: The messages below|\[Request interrupted)/;

function promptText(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  if (content.some((b: any) => b?.type === "tool_result")) return null;
  const text = content
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return text || null;
}

export function historyEvents(messages: any[], cwd: string): Event[] {
  const events: Event[] = [];
  let n = 0;
  const id = (p: string) => `imp-${p}-${++n}`;
  let open = false;
  const startTurn = () => {
    if (!open) events.push({ type: "turn_started" });
    open = true;
  };
  const endTurn = () => {
    if (open) events.push({ type: "turn_completed", status: "completed" });
    open = false;
  };

  for (const m of messages) {
    // Subagent chatter stays out of the main thread, as in a live session.
    if (m?.parent_tool_use_id) continue;
    const content = m?.message?.content;
    if (m?.type === "user") {
      if (Array.isArray(content)) {
        for (const b of content) {
          if (b?.type !== "tool_result") continue;
          events.push({ type: "tool_completed", itemId: b.tool_use_id, ok: !b.is_error, output: short(resultText(b.content), 4000) });
        }
      }
      const text = promptText(content);
      if (text === null || !text.trim() || BOOKKEEPING.test(text)) continue;
      endTurn();
      events.push({ type: "user_message", text });
      startTurn();
    } else if (m?.type === "assistant" && Array.isArray(content)) {
      startTurn();
      for (const block of content) {
        if (block?.type === "thinking" && block.thinking) {
          events.push({ type: "reasoning", itemId: id("think"), text: block.thinking });
        } else if (block?.type === "text" && block.text) {
          events.push({ type: "assistant_message", itemId: id("text"), text: block.text });
        } else if (block?.type === "tool_use") {
          const d = describe(block.name, block.input, cwd);
          events.push({ type: "tool_started", itemId: block.id, kind: d.kind, title: d.title, detail: d.detail });
          const patch = patchFor(block.name, block.input);
          if (patch) events.push({ type: "file_change", itemId: `${block.id}-diff`, files: [{ path: d.detail, diff: patch, kind: block.name === "Write" ? "add" : "update" }] });
        }
      }
    }
  }
  endTurn();
  return events;
}
