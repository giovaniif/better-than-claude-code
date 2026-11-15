// What the Processes tab shows: the host sampler's list, as a tree.
import type { ProcRow } from "./protocol";

/** Parents before their children, children by pid. A process whose parent is
 *  not in the list (a session's sidecar, a shell) is a root. */
export function procTree(rows: ProcRow[]): { row: ProcRow; depth: number }[] {
  const byPid = new Map(rows.map((r) => [r.pid, r]));
  const kids = new Map<number, ProcRow[]>();
  const roots: ProcRow[] = [];
  for (const r of rows) {
    if (r.ppid !== r.pid && byPid.has(r.ppid)) kids.set(r.ppid, [...(kids.get(r.ppid) ?? []), r]);
    else roots.push(r);
  }
  const out: { row: ProcRow; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (r: ProcRow, depth: number) => {
    if (seen.has(r.pid)) return;
    seen.add(r.pid);
    out.push({ row: r, depth });
    for (const k of (kids.get(r.pid) ?? []).sort((a, b) => a.pid - b.pid)) walk(k, depth + 1);
  };
  for (const r of roots.sort((a, b) => a.pid - b.pid)) walk(r, 0);
  // A parent loop leaves its members unreached: list them rather than hide them.
  for (const r of rows) walk(r, 0);
  return out;
}

/** A command line on one line: long absolute paths cut to their last segment, then the whole cut to `max`. */
export function shortCommand(cmd: string, max = 80): string {
  const text = cmd
    .trim()
    .split(/\s+/)
    .map((word) => {
      const segments = word.split("/");
      return word.startsWith("/") && segments.length > 3 && word.length > 24 ? segments[segments.length - 1] || word : word;
    })
    .join(" ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

const MB = 1024 ** 2;

/** "340 MB", "1.6 GB". */
export function memText(bytes: number): string {
  if (bytes >= 1024 * MB) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

/** "3 processes · 12% CPU · 340 MB". */
export function procSummary(rows: ProcRow[]): string {
  if (!rows.length) return "No processes";
  const cpu = rows.reduce((sum, r) => sum + r.cpu, 0);
  const mem = rows.reduce((sum, r) => sum + r.memBytes, 0);
  return `${rows.length} ${rows.length === 1 ? "process" : "processes"} · ${Math.round(cpu)}% CPU · ${memText(mem)}`;
}
