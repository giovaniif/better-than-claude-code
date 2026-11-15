// `design-check`: design-system lint on the lines a change adds under ui/.
// The design system is ui/src/styles.css: colour tokens in `:root`, the
// .btn / .btn-text / .btn-icon / .btn-primary / .btn-quiet buttons, the
// <Icon d=...> glyph component, and a small font-size scale.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Args, git, mergeBase, ROOT, str } from "./common";
import { isUiPath } from "./evidence";
import type { Result } from "./out";

export interface Finding {
  rule: string;
  severity: "error" | "warn";
  file: string;
  line: number;
  text: string;
  hint: string;
}

const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const RAW_HTML = /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML/;
const BUTTON_CLASSES = ["btn", "btn-text", "btn-icon", "btn-primary", "btn-quiet", "send", "chip", "nav-row", "picker-item", "menu-item", "list-head", "host-row", "session-row", "fold-row", "effort", "tab"];

/** Font sizes already in styles.css: new ones should come from this scale. */
function fontScale(): Set<string> {
  try {
    const css = readFileSync(join(ROOT, "ui/src/styles.css"), "utf8");
    return new Set([...css.matchAll(/font-size:\s*([0-9.]+px)/g)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

interface Added {
  file: string;
  line: number;
  text: string;
  /** For CSS: are we inside the `:root { ... }` token block? */
  inRoot: boolean;
}

/** Added lines per file from a zero-context diff, with their new line numbers. */
export function addedLines(diff: string, rootBlocks: Map<string, [number, number][]> = new Map()): Added[] {
  const out: Added[] = [];
  let file = "";
  let n = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+++ ")) {
      file = l.slice(4).replace(/^b\//, "");
      continue;
    }
    const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) {
      n = Number(h[1]);
      continue;
    }
    if (l.startsWith("+") && !l.startsWith("+++")) {
      const blocks = rootBlocks.get(file) ?? [];
      out.push({ file, line: n, text: l.slice(1), inRoot: blocks.some(([s, e]) => n >= s && n <= e) });
      n++;
    } else if (!l.startsWith("-")) {
      n++;
    }
  }
  return out;
}

/** Line ranges of `:root { ... }` blocks in a CSS file at HEAD. */
function rootRanges(path: string): [number, number][] {
  let text = "";
  try {
    text = readFileSync(join(ROOT, path), "utf8");
  } catch {
    return [];
  }
  const lines = text.split("\n");
  const out: [number, number][] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*:root\s*\{/.test(lines[i])) {
      let j = i;
      while (j < lines.length && !lines[j].includes("}")) j++;
      out.push([i + 1, j + 1]);
    }
  }
  return out;
}

export function lint(added: Added[], scale: Set<string>): Finding[] {
  const f: Finding[] = [];
  const push = (a: Added, rule: string, severity: Finding["severity"], hint: string) => f.push({ rule, severity, file: a.file, line: a.line, text: a.text.trim().slice(0, 200), hint });
  for (const a of added) {
    const t = a.text;
    const isCss = a.file.endsWith(".css");
    const isTsx = /\.(tsx|ts)$/.test(a.file);
    if (t.trim().startsWith("//") || t.trim().startsWith("/*") || t.trim().startsWith("*")) continue;
    if (RAW_HTML.test(t)) push(a, "raw-html", "error", "agent output and GitHub text are untrusted: render React elements, never HTML");
    if (COLOR.test(t) && isCss && !a.inRoot && /box-shadow/.test(t)) push(a, "shadow-color", "warn", "shadows use literal rgba today; reuse an existing shadow value from styles.css");
    else if (COLOR.test(t) && !(isCss && a.inRoot) && !a.file.includes("TerminalPane")) push(a, "hardcoded-color", "error", "use a colour token from :root in styles.css (var(--ink), var(--muted), ...), or add a token there");
    if (isTsx && /style=\{\{/.test(t) && /:\s*-?\d+(\.\d+)?(px)?\s*[,}]/.test(t) && !/--[\w-]+/.test(t)) push(a, "inline-style-number", "error", "move magic numbers into a class in styles.css; inline style only for CSS variables and measured values");
    if (isTsx && /<svg\b/.test(t)) push(a, "raw-svg", "warn", "use <Icon d={PATH} /> like the rest of the UI");
    if (isTsx && /<button\b/.test(t)) {
      const cls = t.match(/className=["{`]([^"}`]*)/)?.[1] ?? "";
      if (!BUTTON_CLASSES.some((c) => cls.split(/\s+/).includes(c))) push(a, "raw-button", "warn", `give it a design-system button class: ${BUTTON_CLASSES.slice(0, 5).join(", ")}`);
    }
    if (isCss && /font-size:\s*([0-9.]+px)/.test(t)) {
      const size = t.match(/font-size:\s*([0-9.]+px)/)![1];
      if (!scale.has(size)) push(a, "font-size-off-scale", "warn", `${size} is not on the scale in styles.css (${[...scale].sort().join(", ")})`);
    }
    if (isCss && /!important/.test(t)) push(a, "important", "warn", "avoid !important; raise specificity in the matching rule");
    if (isCss && /\b(z-index):\s*\d{3,}/.test(t)) push(a, "z-index", "warn", "large z-index: check the existing layers (menus, modals) first");
  }
  return f;
}

export function designCheck(a: Args): Result {
  const base = str(a, "base") ?? mergeBase("HEAD");
  // Committed changes plus the working tree: a check before committing counts too.
  const nameStatus = git(["diff", "--name-status", "-M", base, "--", "ui"]).out.trim();
  const touched = nameStatus
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, ...paths] = l.split("\t");
      return { status: status[0], paths };
    });
  const uiFiles = touched.filter((t) => t.paths.some(isUiPath));
  const diff = git(["diff", "-U0", "-M", base, "--", "ui/src", "ui/index.html"]).out;
  const css = new Map<string, [number, number][]>();
  for (const t of uiFiles) for (const p of t.paths) if (p.endsWith(".css")) css.set(p, rootRanges(p));
  const findings = lint(addedLines(diff, css), fontScale());
  const errors = findings.filter((x) => x.severity === "error");
  return {
    ok: errors.length === 0,
    base,
    ui: uiFiles.length > 0,
    touched: uiFiles,
    findings,
    problems: errors.map((e) => ({ code: e.rule, msg: `${e.file}:${e.line}: ${e.text}`, hint: e.hint })),
    hint: uiFiles.length ? "screenshot the reference screen next to your after-shots, and cover empty, loading, error and long-text states at both viewports" : undefined,
  };
}
