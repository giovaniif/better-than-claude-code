// Subagents (the Agent tool), as yardd's events. The SDK streams a subagent's
// own messages with `parent_tool_use_id` set to the Agent call's id, and
// brackets the run with system `task_started` / `task_notification`
// messages. Checked on a real Haiku turn (2026-11-15):
//  - Agent runs in the background by default: its tool_result arrives at
//    once and only says "launched"; the report comes in the notification,
//    possibly after the turn that started it has ended.
//  - A foreground one gets its notification before its tool_result, whose
//    text wraps the report in framing.
// So the notification ends the Agent call either way, and its tool_result is
// ignored (`holds`).
import { resultText, short, toolStarted } from "./tools";

type Event = Record<string, unknown>;

export function createSubagents(cwd: string) {
  /** Agent calls a task runs, by tool_use id. */
  const held = new Set<string>();
  /** What each subagent last said: the report, in full. */
  const said = new Map<string, string>();

  return {
    /** A message from inside a subagent. Its steps nest under the Agent call;
     *  its thinking, text and edits' diffs stay out of the thread. */
    child(m: any): Event[] {
      const parent = m.parent_tool_use_id as string;
      const content = m.message?.content;
      if (!Array.isArray(content)) return [];
      const events: Event[] = [];
      for (const block of content) {
        if (m.type === "assistant" && block?.type === "tool_use") events.push(toolStarted(block, cwd, parent));
        else if (m.type === "assistant" && block?.type === "text") said.set(parent, String(block.text ?? ""));
        else if (m.type === "user" && block?.type === "tool_result") {
          events.push({ type: "tool_completed", itemId: block.tool_use_id, ok: !block.is_error, output: short(resultText(block.content), 4000) });
        }
      }
      return events;
    },

    /** `task_started` and `task_notification`. */
    task(m: any): Event[] {
      const id = m.tool_use_id as string | undefined;
      if (!id) return [];
      if (m.subtype === "task_started") {
        if (m.task_type === "local_agent") held.add(id);
        return [];
      }
      if (m.subtype !== "task_notification" || !held.has(id)) return [];
      const output = said.get(id) || String(m.summary ?? "");
      said.delete(id);
      const event: Event = { type: "tool_completed", itemId: id, ok: m.status === "completed", output: short(output, 4000) };
      if (typeof m.usage?.duration_ms === "number") event.ms = m.usage.duration_ms;
      return [event];
    },

    /** The call's own tool_result is not its end. */
    holds(toolUseId: string): boolean {
      return held.has(toolUseId);
    },
  };
}
