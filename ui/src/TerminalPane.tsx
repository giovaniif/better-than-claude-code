import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { TermInfo } from "./protocol";
import type { Actions } from "./store";
import { appendToComposer, fenced, SELECTION_CAP } from "./compose";

// ANSI colors that stay readable on a white ground.
const THEME = {
  background: "#ffffff",
  foreground: "#1a1a1a",
  cursor: "#1a1a1a",
  cursorAccent: "#ffffff",
  selectionBackground: "#dcdcdc",
  black: "#1a1a1a",
  red: "#b42318",
  green: "#17803d",
  yellow: "#8a5a00",
  blue: "#1d4ed8",
  magenta: "#7e22ce",
  cyan: "#0e7490",
  white: "#666666",
  brightBlack: "#8a8a8a",
  brightRed: "#d92d20",
  brightGreen: "#1f9d55",
  brightYellow: "#a86a00",
  brightBlue: "#2563eb",
  brightMagenta: "#9333ea",
  brightCyan: "#0891b2",
  brightWhite: "#3a3a3a",
};

const EXITED_LINE = "\r\n\x1b[2m[shell exited, close this tab to remove it]\x1b[0m\r\n";

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const Glyph = ({ d, size = 12 }: { d: string; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const PLUS = "M12 5v14M5 12h14";
const CROSS = "M18 6 6 18M6 6l12 12";

/**
 * The session's terminals, one tab each. yardd owns the PTYs and their
 * scrollback; every tab keeps its own xterm while this pane lives, so
 * switching is instant and a reconnect only replays what was missed.
 */
export function TerminalPane(props: { sessionId: string; connected: boolean; visible: boolean; actions: Actions }) {
  const { sessionId, connected, visible, actions } = props;
  const [tabs, setTabs] = useState<TermInfo[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState("");
  // Terminal 1 starts by itself once; after that an empty list stays empty.
  const started = useRef(false);
  const dims = useRef({ cols: 80, rows: 24 });
  const shown = useRef<TermInfo[]>([]);
  shown.current = tabs ?? [];
  // After `+`, the tabs that existed then: the first `term.opened` for another
  // terminal is the new one (an attach reply is for a tab we already had).
  const awaiting = useRef<Set<string> | null>(null);
  const expectNew = () => (awaiting.current = new Set(shown.current.map((t) => t.termId)));

  useEffect(() => {
    if (!connected) return;
    const stop = actions.onTerm((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.op === "term.list") {
        const list: TermInfo[] = msg.terms ?? [];
        setTabs(list);
        if (list.length === 0 && !started.current) {
          started.current = true;
          expectNew();
          actions.post({ op: "term.open", sessionId, ...dims.current });
        }
        if (list.length > 0) started.current = true;
      } else if (msg.op === "term.listChanged") {
        actions.post({ op: "term.list", sessionId });
      } else if (msg.op === "term.opened" && awaiting.current && !awaiting.current.has(msg.termId)) {
        awaiting.current = null;
        setActive(msg.termId);
        // The list may not have caught up yet; show the tab right away.
        setTabs((list) =>
          list?.some((t) => t.termId === msg.termId) ? list : [...(list ?? []), { termId: msg.termId, title: msg.title, exited: msg.exited }],
        );
      }
    });
    actions.post({ op: "term.list", sessionId });
    return stop;
  }, [sessionId, connected]);

  // Keep a tab selected: the first one, unless the selected one is still there.
  useEffect(() => {
    if (!tabs) return;
    if (!active || !tabs.some((t) => t.termId === active)) setActive(tabs[0]?.termId ?? null);
  }, [tabs, active]);

  const newTerminal = () => {
    expectNew();
    actions.post({ op: "term.new", sessionId, ...dims.current });
  };
  const closeTerminal = (termId: string) => {
    const list = tabs ?? [];
    const i = list.findIndex((t) => t.termId === termId);
    const rest = list.filter((t) => t.termId !== termId);
    setTabs(rest);
    setActive(rest[Math.min(i, rest.length - 1)]?.termId ?? null);
    actions.post({ op: "term.close", termId });
  };
  const cut = selection.length > SELECTION_CAP;

  return (
    <div className="term-pane" style={{ display: visible ? "flex" : "none" }}>
      <div className="term-strip" role="tablist" aria-label="Terminals">
        {(tabs ?? []).map((t) => {
          const on = t.termId === active;
          return (
            <span key={t.termId} className={`term-tab ${on ? "active" : ""} ${t.exited ? "exited" : ""}`}>
              <button role="tab" aria-selected={on} title={t.exited ? "Shell exited" : undefined} onClick={() => setActive(t.termId)}>
                {t.title}
              </button>
              {on && (
                <button className="term-x" aria-label="Close terminal" title="Close terminal" onClick={() => closeTerminal(t.termId)}>
                  <Glyph d={CROSS} size={10} />
                </button>
              )}
            </span>
          );
        })}
        <button className="btn-icon" aria-label="New terminal" title="New terminal" disabled={!connected} onClick={newTerminal}>
          <Glyph d={PLUS} />
        </button>
        <span className="spacer" />
        {selection && active && (
          <button
            className="btn-text"
            title={cut ? `The selection is ${selection.length.toLocaleString()} characters; only the first ${SELECTION_CAP.toLocaleString()} are added.` : "Add the selection to your reply"}
            onClick={() => appendToComposer(sessionId, fenced(selection))}
          >
            Add to message
          </button>
        )}
      </div>
      {(tabs ?? []).map((t) => (
        <TermView
          key={t.termId}
          termId={t.termId}
          connected={connected}
          visible={visible && t.termId === active}
          actions={actions}
          onSelection={t.termId === active ? setSelection : undefined}
          onSize={(cols, rows) => (dims.current = { cols, rows })}
        />
      ))}
    </div>
  );
}

/** One terminal. Built once per tab; re-attaches after a reconnect. */
function TermView(props: {
  termId: string;
  connected: boolean;
  visible: boolean;
  actions: Actions;
  onSelection?: (text: string) => void;
  onSize(cols: number, rows: number): void;
}) {
  const { termId, connected, visible, actions } = props;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const live = useRef(props);
  live.current = props;
  // Bytes written so far, in the PTY's own numbering; -1 before the first
  // scrollback snapshot. Chunks can overlap the snapshot or arrive before it.
  const written = useRef(-1);
  const exited = useRef(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    // Output waits for the first real fit. Written at xterm's default 80
    // columns and reflowed to the pane's width afterwards, the scrollback
    // replayed after a reload came back with wrapped lines garbled and
    // output overwritten. Right after a reload the renderer has no cell size
    // yet, so the fit is retried on each frame for a while.
    let fitted = false;
    let held: (() => void)[] = [];
    let tries = 0;
    let gone = false;
    const flush = () => {
      fitted = true;
      const run = held;
      held = [];
      run.forEach((f) => f());
    };
    const refit = () => {
      if (gone) return;
      // Fitting a hidden element would size the PTY to nothing.
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      try {
        if (fit.proposeDimensions()) {
          fit.fit();
          if (!fitted) flush();
          return;
        }
      } catch {
        /* not laid out yet */
      }
      if (fitted || held.length === 0) return;
      // Better a reflowed terminal than an empty one.
      if (++tries > 120) flush();
      else requestAnimationFrame(refit);
    };
    refit();

    let early: any[] = [];
    const write = (msg: { offset: number; data: string }) => {
      const bytes = decode(msg.data);
      const end = msg.offset + bytes.length;
      if (end <= written.current) return;
      term.write(msg.offset < written.current ? bytes.subarray(written.current - msg.offset) : bytes);
      written.current = end;
    };
    const markExited = () => {
      if (exited.current) return;
      exited.current = true;
      term.write(EXITED_LINE);
    };

    const handle = (msg: any) => {
      if (msg.op === "term.opened") {
        if (written.current < 0) written.current = msg.offset;
        write(msg);
        early.forEach(write);
        early = [];
        if (msg.exited) markExited();
        else live.current.actions.post({ op: "term.resize", termId, cols: term.cols, rows: term.rows });
      } else if (msg.op === "term.data") {
        if (written.current < 0) early.push(msg);
        else write(msg);
      } else if (msg.op === "term.exit") {
        markExited();
      }
    };
    const stop = live.current.actions.onTerm((msg) => {
      if (msg.termId !== termId) return;
      if (fitted) return handle(msg);
      held.push(() => handle(msg));
      refit();
    });

    const onData = term.onData((data) => {
      if (!exited.current) live.current.actions.post({ op: "term.input", termId, data });
    });
    const onResize = term.onResize(({ cols, rows }) => {
      live.current.onSize(cols, rows);
      if (!exited.current) live.current.actions.post({ op: "term.resize", termId, cols, rows });
    });
    const onSelect = term.onSelectionChange(() => live.current.onSelection?.(term.getSelection()));
    const observer = new ResizeObserver(refit);
    observer.observe(el);

    return () => {
      gone = true;
      stop();
      onData.dispose();
      onResize.dispose();
      onSelect.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [termId]);

  // (Re)attach whenever the socket is up: the first time for the scrollback,
  // after a reconnect for what was missed. Offsets drop the overlap.
  useEffect(() => {
    const term = termRef.current;
    if (!connected || !term) return;
    actions.post({ op: "term.attach", termId, cols: term.cols, rows: term.rows });
  }, [termId, connected]);

  useEffect(() => {
    const term = termRef.current;
    if (!visible || !term) return;
    term.focus();
    props.onSelection?.(term.getSelection());
  }, [visible]);

  // The padding lives on the outer box: the fit addon measures the host's
  // border box, so padding on the host itself makes the terminal too wide.
  return (
    <div className="term" style={{ display: visible ? "flex" : "none" }}>
      <div className="term-host" ref={host} />
    </div>
  );
}
