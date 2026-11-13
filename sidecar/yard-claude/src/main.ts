// yard-claude: one Claude Code session on the Agent SDK, bridged to yardd.
//
// stdin  (JSON lines): start | user | set_model | interrupt | permission
// stdout (JSON lines): { type: "event", event } | { type: "usage", usage }
//
// Events are already in yardd's normalized shape, so yardd only relays them.
// Nothing else may write to stdout.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createInterface } from "node:readline";
import { relative } from "node:path";

type Decision = "allow" | "allow_always" | "deny";

const out = (msg: unknown) => process.stdout.write(JSON.stringify(msg) + "\n");
const emit = (event: Record<string, unknown>) => out({ type: "event", event });

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

// User turns are pushed here while the query is running (streaming input).
const queue: unknown[] = [];
let wake: (() => void) | null = null;
let closed = false;
async function* input() {
  while (true) {
    while (queue.length) yield queue.shift();
    if (closed) return;
    await new Promise<void>((resolve) => (wake = resolve));
  }
}

const waiting = new Map<string, (d: Decision) => void>();
let q: any = null;
let cwd = process.cwd();

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const short = (s: unknown, n = 160) => {
  const text = typeof s === "string" ? s : JSON.stringify(s ?? "");
  return text.length > n ? text.slice(0, n) + "…" : text;
};
const rel = (p: unknown) => {
  if (typeof p !== "string") return "";
  const r = relative(cwd, p);
  return r && !r.startsWith("..") ? r : p;
};

/** A short human label for a tool call. */
function describe(name: string, toolInput: any): { kind: string; title: string; detail: string } {
  switch (name) {
    case "Bash":
      return { kind: "command", title: "Ran", detail: String(toolInput?.command ?? "") };
    case "Read":
      return { kind: "read", title: "Read", detail: rel(toolInput?.file_path) };
    case "Grep":
    case "Glob":
      return { kind: "search", title: "Searched", detail: String(toolInput?.pattern ?? "") };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { kind: "edit", title: "Edited", detail: rel(toolInput?.file_path ?? toolInput?.notebook_path) };
    case "Write":
      return { kind: "edit", title: "Wrote", detail: rel(toolInput?.file_path) };
    case "WebFetch":
      return { kind: "other", title: "Fetched", detail: String(toolInput?.url ?? "") };
    case "WebSearch":
      return { kind: "other", title: "Searched the web", detail: String(toolInput?.query ?? "") };
    case "Task":
    case "Agent":
      return { kind: "other", title: "Agent", detail: String(toolInput?.description ?? "") };
    case "TodoWrite":
      return { kind: "other", title: "Updated tasks", detail: "" };
    default:
      return { kind: "other", title: name, detail: short(toolInput, 120) };
  }
}

/** The SDK gives old and new text, not a patch. Build a readable one. */
function patchFor(name: string, toolInput: any): string | null {
  const lines = (s: unknown, sign: string) =>
    String(s ?? "")
      .split("\n")
      .slice(0, 200)
      .map((l) => sign + l)
      .join("\n");
  if (name === "Edit") return replacePatch(toolInput?.old_string, toolInput?.new_string);
  if (name === "Write") return lines(toolInput?.content, "+");
  if (name === "MultiEdit" && Array.isArray(toolInput?.edits)) {
    return toolInput.edits.map((e: any) => replacePatch(e?.old_string, e?.new_string)).join("\n");
  }
  return null;
}

/** Old text -> new text, with the unchanged lines at both ends kept as context. */
function replacePatch(oldText: unknown, newText: unknown): string {
  const a = String(oldText ?? "").split("\n");
  const b = String(newText ?? "").split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return [
    ...a.slice(Math.max(0, start - 2), start).map((l) => " " + l),
    ...a.slice(start, endA).map((l) => "-" + l),
    ...b.slice(start, endB).map((l) => "+" + l),
    ...a.slice(endA, endA + 2).map((l) => " " + l),
  ]
    .slice(0, 200)
    .join("\n");
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function run(start: { cwd: string; model: string; effort?: string }) {
  cwd = start.cwd;

  // Keep the parent session's markers out of the child Claude Code process.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_") || key.startsWith("CLAUDE_AGENT_SDK")) continue;
    env[key] = value;
  }

  const efforts = ["low", "medium", "high", "xhigh", "max"];
  const options: Record<string, unknown> = {
    cwd,
    model: start.model,
    env,
    includePartialMessages: true,
    permissionMode: "default",
    canUseTool: async (toolName: string, toolInput: any, ctx: { signal?: AbortSignal; suggestions?: unknown[] }) => {
      const requestId = nextId("claude");
      const d = describe(toolName, toolInput);
      emit({
        type: "approval_request",
        requestId,
        kind: d.kind === "command" ? "command" : EDIT_TOOLS.has(toolName) ? "edit" : "other",
        title: d.kind === "command" ? d.detail : `${d.title} ${d.detail}`.trim(),
        detail: typeof toolInput?.description === "string" ? toolInput.description : "",
      });
      const decision = await new Promise<Decision>((resolve) => {
        waiting.set(requestId, resolve);
        ctx?.signal?.addEventListener("abort", () => resolve("deny"));
      });
      waiting.delete(requestId);
      if (decision === "deny") return { behavior: "deny", message: "Denied by the user." };
      if (decision === "allow_always" && ctx?.suggestions?.length) {
        return { behavior: "allow", updatedInput: toolInput, updatedPermissions: ctx.suggestions };
      }
      return { behavior: "allow", updatedInput: toolInput };
    },
  };
  if (start.effort && efforts.includes(start.effort)) options.effort = start.effort;
  const claudeBin = Bun.which("claude");
  if (claudeBin) options.pathToClaudeCodeExecutable = claudeBin;

  q = query({ prompt: input() as any, options: options as any });

  // The id of the text block currently streaming, so deltas and the final
  // text land on the same item.
  let openText: string | null = null;

  for await (const m of q as AsyncIterable<any>) {
    // Subagent chatter stays out of the main thread.
    if (m.parent_tool_use_id) continue;

    if (m.type === "stream_event") {
      const e = m.event;
      if (e?.type === "content_block_start" && e.content_block?.type === "text") openText = nextId("text");
      if (e?.type === "content_block_delta" && e.delta?.type === "text_delta") {
        openText ??= nextId("text");
        emit({ type: "assistant_delta", itemId: openText, text: e.delta.text });
      }
      continue;
    }

    if (m.type === "assistant") {
      for (const block of m.message?.content ?? []) {
        if (block.type === "text") {
          emit({ type: "assistant_message", itemId: openText ?? nextId("text"), text: block.text });
          openText = null;
        } else if (block.type === "tool_use") {
          const d = describe(block.name, block.input);
          emit({ type: "tool_started", itemId: block.id, kind: d.kind, title: d.title, detail: d.detail });
          const patch = patchFor(block.name, block.input);
          if (patch) {
            emit({
              type: "file_change",
              itemId: `${block.id}-diff`,
              files: [{ path: d.detail, diff: patch, kind: block.name === "Write" ? "add" : "update" }],
            });
          }
        }
      }
      continue;
    }

    if (m.type === "user") {
      const content = m.message?.content;
      if (!Array.isArray(content)) continue;
      for (const block of content) {
        if (block?.type !== "tool_result") continue;
        emit({
          type: "tool_completed",
          itemId: block.tool_use_id,
          ok: !block.is_error,
          output: short(resultText(block.content), 4000),
        });
      }
      continue;
    }

    if (m.type === "rate_limit_event") {
      const info = m.rate_limit_info ?? {};
      out({
        type: "usage",
        usage: {
          status: info.status,
          fiveHour: info.unifiedWindows?.five_hour?.utilization ?? null,
          sevenDay: info.unifiedWindows?.seven_day?.utilization ?? null,
          resetsAt: info.resetsAt ?? null,
        },
      });
      continue;
    }

    if (m.type === "result") {
      openText = null;
      const ok = m.subtype === "success";
      if (!ok) emit({ type: "error", message: typeof m.result === "string" && m.result ? m.result : String(m.subtype) });
      emit({ type: "turn_completed", status: ok ? "completed" : "failed" });
    }
  }
}

createInterface({ input: process.stdin }).on("line", async (line) => {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  try {
    switch (msg.type) {
      case "start":
        run(msg).then(
          () => process.exit(0),
          (error) => {
            emit({ type: "error", message: String(error?.message ?? error) });
            emit({ type: "turn_completed", status: "failed" });
            process.exit(1);
          },
        );
        break;
      case "user":
        queue.push({
          type: "user",
          message: { role: "user", content: String(msg.text ?? "") },
          parent_tool_use_id: null,
          session_id: "",
        });
        wake?.();
        break;
      case "set_model":
        await q?.setModel(msg.model);
        break;
      case "interrupt":
        await q?.interrupt();
        break;
      case "permission":
        waiting.get(msg.requestId)?.(msg.decision as Decision);
        break;
    }
  } catch (error: any) {
    emit({ type: "error", message: String(error?.message ?? error) });
  }
}).on("close", () => {
  closed = true;
  wake?.();
});
