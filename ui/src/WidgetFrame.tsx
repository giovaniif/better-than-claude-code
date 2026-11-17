// A tool call's MCP Apps widget in the thread: the chart a Datadog query
// draws, a table, a form. The HTML runs in a sandboxed frame (see widget.ts for
// what it may do); this component is the host it talks to.
import { useEffect, useRef, useState } from "react";
import type { WidgetRef } from "./protocol";
import type { Actions } from "./store";
import { frameDocument, route, toolResult, type HostEnv, type WidgetRecord } from "./widget";

const START_HEIGHT = 180;

export function WidgetFrame({ sessionId, app, actions }: { sessionId: string; app: WidgetRef; actions: Actions }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  // Mounted only once near the screen: a long thread may hold many widgets.
  const [near, setNear] = useState(false);
  const [record, setRecord] = useState<WidgetRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [height, setHeight] = useState(START_HEIGHT);
  const [busy, setBusy] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let live = true;
    actions.widget(sessionId, app.id).then((r) => {
      if (!live) return;
      if (r.widget) setRecord(r.widget);
      else setError(r.error ?? "The widget did not load.");
    });
    return () => {
      live = false;
    };
  }, [near, sessionId, app.id]);

  useEffect(() => {
    if (!record) return;
    const win = () => frame.current?.contentWindow ?? null;
    // An opaque-origin frame can only be addressed with "*"; what it gets is its own data.
    const send = (msg: object) => win()?.postMessage({ jsonrpc: "2.0", ...msg }, "*");
    const env = (): HostEnv => ({
      maxWidth: box.current?.clientWidth ?? 600,
      touch: typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches,
      desktop: !!(window as any).__TAURI__,
    });
    let heightNow = START_HEIGHT;
    let calling = false;
    const onMessage = async (e: MessageEvent) => {
      // Only this widget's own frame; never another frame or window.
      if (!win() || e.source !== win()) return;
      const msg = e.data;
      const step = route(msg, env(), heightNow);
      const id = msg?.id;
      switch (step.kind) {
        case "reply":
          return send({ id, result: step.result });
        case "error":
          return id !== undefined && send({ id, error: { code: step.code, message: step.message } });
        case "initialized":
          send({ method: "ui/notifications/tool-input", params: { arguments: record.input && typeof record.input === "object" ? record.input : {} } });
          send({ method: "ui/notifications/tool-result", params: toolResult(record.result) });
          return;
        case "resize":
          heightNow = step.height;
          return setHeight(step.height);
        case "open":
          window.open(step.url, "_blank", "noopener,noreferrer");
          return send({ id, result: {} });
        case "call": {
          // One at a time: a widget cannot flood its server or the thread with approvals.
          if (calling) return send({ id, error: { code: -32000, message: "Another call from this widget is still running." } });
          calling = true;
          setBusy(true);
          setCallError(null);
          const r = await actions.widgetCall(sessionId, app.id, step.tool, step.args);
          calling = false;
          setBusy(false);
          if (r.error) {
            setCallError(r.error);
            return send({ id, error: { code: -32000, message: r.error } });
          }
          return send({ id, result: r.result ?? {} });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [record, sessionId, app.id]);

  const label = `${app.tool} · ${app.server}`;
  return (
    <div ref={box} className={`widget ${record?.prefersBorder === false ? "widget-bare" : ""}`}>
      {error ? (
        <div className="widget-note muted small">
          {label}: {error}
        </div>
      ) : record ? (
        <iframe
          ref={frame}
          title={label}
          className="widget-frame"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={frameDocument(record)}
          style={{ height }}
        />
      ) : (
        <div className="widget-note muted small" style={{ height: START_HEIGHT }}>
          Loading {label}…
        </div>
      )}
      {(busy || callError) && <div className={`widget-status small ${callError ? "bad" : "muted"}`}>{callError ?? `Running ${app.tool}…`}</div>}
    </div>
  );
}
