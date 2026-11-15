// How a thread's items are laid out, after T3 Code's work log: tool calls and
// thinking between messages fold into one-line groups, and a finished turn
// folds all of its work into "Worked for 1m 12s" above its final answer.
import type { Item } from "./protocol";

export type WorkItem = Extract<Item, { kind: "tool" | "reasoning" }>;

export type Row =
  | { type: "item"; key: string; item: Item }
  /** Consecutive tool calls and thinking. `live` while the turn is still adding to it. */
  | { type: "work"; key: string; entries: WorkItem[]; live: boolean }
  /** Everything a finished turn did before its answer. */
  | { type: "fold"; key: string; rows: Row[]; ms: number | null; status: string; summary: string };

const isWork = (it: Item): it is WorkItem => it.kind === "tool" || it.kind === "reasoning";

/** Group runs of work items; `liveTail` marks the last run live. */
function group(items: Item[], liveTail: boolean): Row[] {
  const rows: Row[] = [];
  for (const it of items) {
    if (it.kind === "turn") continue;
    const last = rows[rows.length - 1];
    if (isWork(it)) {
      if (last?.type === "work") last.entries.push(it);
      else rows.push({ type: "work", key: it.key, entries: [it], live: false });
    } else {
      rows.push({ type: "item", key: it.key, item: it });
    }
  }
  const last = rows[rows.length - 1];
  if (liveTail && last?.type === "work") last.live = true;
  return rows;
}

export function layout(items: Item[], running: boolean): Row[] {
  const rows: Row[] = [];
  // Split at user messages; anything before the first is a prelude.
  const turns: Item[][] = [[]];
  for (const it of items) {
    if (it.kind === "user") turns.push([it]);
    else turns[turns.length - 1].push(it);
  }
  // A message given to the agent mid-turn (steered) splits its turn in two
  // here; each part is timed from its start to the next part's.
  let lastMarker: Extract<Item, { kind: "turn" }> | undefined;
  turns.forEach((turn, n) => {
    const head = turn[0]?.kind === "user" ? turn[0] : null;
    if (head) rows.push({ type: "item", key: head.key, item: head });
    const body = head ? turn.slice(1) : turn;
    const live = running && n === turns.length - 1;
    const own = body.find((it): it is Extract<Item, { kind: "turn" }> => it.kind === "turn");
    if (own) lastMarker = own;
    const steered = head?.kind === "user" && head.steered;
    const marker = own ?? (steered ? lastMarker : undefined);
    const nextHead = turns[n + 1]?.[0];
    const cut = nextHead?.kind === "user" && nextHead.steered ? nextHead.at : undefined;
    const from = own?.start ?? (steered && head?.kind === "user" ? head.at : undefined);
    const to = cut ?? marker?.end;
    if (live || !body.some(isWork)) {
      rows.push(...group(body, live));
      return;
    }
    // The answer is the last message; errors after it stay in view too.
    let answer = -1;
    for (let i = body.length - 1; i >= 0; i--) {
      if (body[i].kind === "assistant") {
        answer = i;
        break;
      }
    }
    const folded = (answer < 0 ? body : body.slice(0, answer)).filter((it) => it.kind !== "error");
    const shown = body.filter((it, i) => (answer >= 0 && i >= answer) || (it.kind === "error" && !folded.includes(it)));
    const work = folded.filter(isWork);
    const ms = from != null && to != null ? to - from : null;
    rows.push({
      type: "fold",
      key: `fold-${folded[0]?.key ?? body[0].key}`,
      rows: group(folded, false),
      ms,
      status: marker?.status ?? "completed",
      summary: summarize(work),
    });
    rows.push(...group(shown, false));
  });
  return rows;
}

const PLURAL: Record<string, [string, string, string]> = {
  read: ["Read", "file", "files"],
  edit: ["Edited", "file", "files"],
  command: ["Ran", "command", "commands"],
  search: ["Searched", "time", "times"],
};

/** "Read 3 files, ran 2 commands", from the two biggest kinds of work. */
export function summarize(entries: WorkItem[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const kind = e.kind === "reasoning" ? "think" : PLURAL[e.toolKind] ? e.toolKind : "other";
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts.entries()]
    .filter(([kind]) => kind !== "think")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([kind, n]) => {
      if (kind === "other") return `${n} other ${n === 1 ? "step" : "steps"}`;
      const [verb, one, many] = PLURAL[kind];
      return `${verb.toLowerCase()} ${n} ${n === 1 ? one : many}`;
    });
  if (!parts.length) return counts.has("think") ? "Thought" : "";
  const text = parts.join(", ");
  const failed = entries.filter((e) => e.kind === "tool" && e.state === "failed").length;
  return text[0].toUpperCase() + text.slice(1) + (failed ? ` · ${failed} failed` : "");
}

/** One line for a thought: its leading **heading**, else its first sentence. */
export function thoughtLine(text: string): string {
  const t = text.trim();
  const heading = /^\*\*(.+?)\*\*/.exec(t);
  if (heading) return heading[1].trim();
  const plain = t.replace(/[*_`#>]/g, "").replace(/\s+/g, " ");
  const sentence = /^(.{1,140}?[.!?])(\s|$)/.exec(plain);
  const line = sentence ? sentence[1] : plain;
  return line.length > 140 ? `${line.slice(0, 137)}…` : line;
}

/** "45s", "1m 12s", "2h 3m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}
