import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { Actions } from "./store";

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

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * The session's terminal. yardd owns the PTY and its scrollback, so this
 * component can be torn down and rebuilt (tab switch, reconnect) and pick up
 * where it left off.
 */
export function TerminalPane(props: { sessionId: string; connected: boolean; visible: boolean; actions: Actions }) {
  const { sessionId, connected, visible, actions } = props;
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!connected || !el) return;

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
    const refit = () => {
      // Fitting a hidden element would size the PTY to nothing.
      if (el.offsetWidth === 0 || el.offsetHeight === 0) return;
      try {
        fit.fit();
      } catch {
        /* not laid out yet */
      }
    };
    refit();

    let termId: string | null = null;
    let exited = false;
    // Bytes written so far, in the PTY's own numbering. Chunks can overlap the
    // scrollback snapshot or arrive before it; offsets sort that out.
    let written = 0;
    let early: any[] = [];

    const write = (msg: { offset: number; data: string }) => {
      const bytes = decode(msg.data);
      const end = msg.offset + bytes.length;
      if (end <= written) return;
      term.write(msg.offset < written ? bytes.subarray(written - msg.offset) : bytes);
      written = end;
    };
    const open = () => {
      exited = false;
      actions.post({ op: "term.open", sessionId, cols: term.cols, rows: term.rows });
    };

    const stop = actions.onTerm((msg) => {
      if (msg.op === "term.opened" && msg.sessionId === sessionId) {
        termId = msg.termId;
        written = msg.offset;
        write(msg);
        early.filter((m) => m.termId === termId).forEach(write);
        early = [];
        actions.post({ op: "term.resize", termId, cols: term.cols, rows: term.rows });
      } else if (msg.op === "term.data") {
        if (termId === null) early.push(msg);
        else if (msg.termId === termId) write(msg);
      } else if (msg.op === "term.exit" && msg.termId === termId) {
        termId = null;
        exited = true;
        term.write("\r\n\x1b[2m[shell exited, press a key to start a new one]\x1b[0m\r\n");
      }
    });

    const onData = term.onData((data) => {
      if (termId) actions.post({ op: "term.input", termId, data });
      else if (exited) open();
    });
    const onResize = term.onResize(({ cols, rows }) => {
      if (termId) actions.post({ op: "term.resize", termId, cols, rows });
    });
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    open();

    return () => {
      stop();
      onData.dispose();
      onResize.dispose();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, connected]);

  useEffect(() => {
    if (visible) termRef.current?.focus();
  }, [visible]);

  // The padding lives on the outer box: the fit addon measures the host's
  // border box, so padding on the host itself makes the terminal too wide.
  return (
    <div className="term" style={{ display: visible ? "flex" : "none" }}>
      <div className="term-host" ref={host} />
    </div>
  );
}
