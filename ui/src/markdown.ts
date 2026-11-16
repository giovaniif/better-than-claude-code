// Block parsing for the thread's Markdown that needs more than a regex:
// GFM tables. Agents summarise changes and test results as tables, and as
// source they read as pipe soup. The cells stay text; App.tsx renders them.

export type Align = "left" | "center" | "right" | null;

export interface MdTable {
  header: string[];
  align: Align[];
  /** Each as long as the header: short rows are padded, long ones cut. */
  rows: string[][];
}

export type MdSegment = { kind: "text"; lines: string[] } | { kind: "table"; table: MdTable };

/** A row's cells: outer pipes dropped, split on pipes that are neither
 *  escaped (`\|`) nor inside inline code. */
export function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cell += c;
    } else if (c === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
    } else cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-+:?$/;

function alignments(line: string): Align[] | null {
  if (!line.includes("-")) return null;
  const cells = splitRow(line);
  if (!cells.every((c) => DELIMITER_CELL.test(c))) return null;
  return cells.map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : null));
}

/** A paragraph's lines, with any table in them pulled out. A table is a
 *  header row with a pipe, a delimiter row with as many cells, then every
 *  following line that has a pipe. */
export function tableSegments(lines: string[]): MdSegment[] {
  const out: MdSegment[] = [];
  const text = (l: string) => {
    const last = out[out.length - 1];
    if (last?.kind === "text") last.lines.push(l);
    else out.push({ kind: "text", lines: [l] });
  };
  let i = 0;
  while (i < lines.length) {
    const header = lines[i].includes("|") ? splitRow(lines[i]) : null;
    const align = header && i + 1 < lines.length ? alignments(lines[i + 1]) : null;
    if (!header || !align || align.length !== header.length) {
      text(lines[i]);
      i++;
      continue;
    }
    const rows: string[][] = [];
    i += 2;
    while (i < lines.length && lines[i].includes("|")) {
      const cells = splitRow(lines[i]);
      rows.push(header.map((_, k) => cells[k] ?? ""));
      i++;
    }
    out.push({ kind: "table", table: { header, align, rows } });
  }
  return out;
}
