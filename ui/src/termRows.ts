// Terminal rows as text for the reply box. Pure, so it is tested without
// xterm: the pane reads `translateToString` and `isWrapped` per buffer row.

export interface Row {
  text: string;
  /** The row continues the line above (xterm's `isWrapped`). */
  wrapped: boolean;
}

export type RowPick = { kind: "screen" } | { kind: "last"; n: number };

/** The [start, end) buffer rows a pick covers. */
export function pickRows(buffer: { length: number; viewportY: number; rows: number }, pick: RowPick): [number, number] {
  if (pick.kind === "screen") return [buffer.viewportY, Math.min(buffer.length, buffer.viewportY + buffer.rows)];
  return [Math.max(0, buffer.length - pick.n), buffer.length];
}

/** Rows to lines: a wrapped row joins the line above. The blank screen
 *  below the prompt is dropped, so "last 100 lines" ends at the output. */
export function joinRows(rows: Row[]): string {
  const lines: string[] = [];
  for (const r of rows) {
    if (r.wrapped && lines.length) lines[lines.length - 1] += r.text;
    else lines.push(r.text);
  }
  const trimmed = lines.map((l) => l.replace(/\s+$/, ""));
  while (trimmed.length && !trimmed[trimmed.length - 1]) trimmed.pop();
  return trimmed.join("\n");
}
