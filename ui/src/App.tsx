import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Attachment, ChangedFile, Changes, Engine, Host, HostEntry, Item, ModelInfo, Models, SessionMeta, Status, Usage } from "./protocol";
import { branchKey, homeOn, hostName, hostOf, hostOnline, modelsOn, usageOn, useYard, type Actions, type State, type UploadTarget } from "./store";
import { dragHasFiles, humanSize, isInlineImage, pastedFiles, tooLarge } from "./attach";
import { TerminalPane } from "./TerminalPane";
import { PrPane } from "./PrPane";
import { onAppend } from "./compose";

const ENGINE_NAME: Record<Engine, string> = { claude: "Claude", codex: "Codex" };
/** Permission modes, as Claude Code names them, and what each means per engine. */
const PERMISSIONS: { id: Permission; label: string; claude: string; codex: string }[] = [
  { id: "ask", label: "Ask first", claude: "Asks before commands and edits", codex: "Sandboxed to the folder, asks to go further" },
  { id: "acceptEdits", label: "Accept edits", claude: "Edits files freely, asks before commands", codex: "Edits in the folder freely, asks to go further" },
  { id: "plan", label: "Plan only", claude: "Reads and plans, changes nothing", codex: "Read-only: looks, never changes" },
  { id: "full", label: "Full access", claude: "Never asks. Runs anything", codex: "No sandbox, never asks" },
];
const STATUS_LABEL: Record<Status, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  needs_approval: "Needs approval",
  error: "Error",
};

const modelName = (models: Models, engine: Engine, id: string) =>
  models[engine]?.find((m) => m.id === id)?.name ?? id;
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(bytes > 100 * 1024 ** 3 ? 0 : 1);
const pct = (n: number) => `${Math.round(n)}%`;
const tilde = (path: string, home: string) => (home && path.startsWith(home) ? "~" + path.slice(home.length) : path);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------- icons ---------- */

const Icon = ({ d, size = 14, width = 2 }: { d: string; size?: number; width?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const PLUS = "M12 5v14M5 12h14";
const CHEVRON_RIGHT = "M9 6l6 6-6 6";
const CHEVRON_DOWN = "M6 9l6 6 6-6";
const ARROW_UP = "M12 19V5M5 12l7-7 7 7";
const REFRESH = "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5";
const CLOUD = "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z";
const PAPERCLIP = "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48";
const FILE = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8ZM14 3v5h5";
const CLOSE = "M18 6 6 18M6 6l12 12";

/** Marks something on a remote host. Labelled when it is the only sign of it. */
const Cloud = ({ size = 14, label }: { size?: number; label?: string }) =>
  label ? (
    <svg className="cloud" role="img" aria-label={label} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={CLOUD} />
    </svg>
  ) : (
    <span className="cloud">
      <Icon d={CLOUD} size={size} />
    </span>
  );

/* ---------- app shell ---------- */

export function App() {
  const { state, actions } = useYard();
  const { route } = state;
  // A file dropped beside the composer would otherwise make the page (or
  // the app's webview) navigate to it.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (dragHasFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
  return (
    <div className="app">
      <Sidebar state={state} actions={actions} />
      <div className="main">
        {!state.connected && <div className="banner">yardd is not reachable. Reconnecting.</div>}
        {state.error && (
          <div className="banner banner-error">
            <span>{state.error}</span>
            <button className="btn-text" onClick={actions.dismissError}>
              Dismiss
            </button>
          </div>
        )}
        {state.notice && !state.error && (
          <div className="banner banner-notice">
            <span>{state.notice}</span>
            <button className="btn-text" onClick={actions.dismissError}>
              Dismiss
            </button>
          </div>
        )}
        {route.page === "new" && <NewSession state={state} actions={actions} />}
        {route.page === "hosts" && <Hosts state={state} actions={actions} />}
        {route.page === "session" && state.sessions[route.id] && (
          <SessionView key={route.id} meta={state.sessions[route.id]} state={state} actions={actions} />
        )}
      </div>
    </div>
  );
}

function Sidebar({ state, actions }: { state: State; actions: Actions }) {
  const sessions = Object.values(state.sessions).sort((a, b) => b.createdAt - a.createdAt);
  const { route } = state;
  return (
    <nav className="sidebar" aria-label="Sessions">
      <div className="brand">Switchyard</div>
      <div className="sidebar-top">
        <button className={`nav-row ${route.page === "new" ? "active" : ""}`} onClick={() => actions.go({ page: "new" })}>
          <Icon d={PLUS} />
          New session
        </button>
      </div>
      <div className="session-list">
        {sessions.map((s) => {
          const host = hostOf(s);
          const online = host === "local" || hostOnline(state, host);
          return (
            <button
              key={s.id}
              className={`session-row ${route.page === "session" && route.id === s.id ? "active" : ""} ${online ? "" : "offline"}`}
              onClick={() => actions.go({ page: "session", id: s.id })}
            >
              <span className={`dot ${online ? `dot-${s.status}` : "dot-offline"}`} aria-hidden="true" />
              <span className="session-text">
                <span className="session-title">{s.title}</span>
                <span className="session-sub">
                  {modelName(modelsOn(state, host), s.engine, s.model)} · {online ? STATUS_LABEL[s.status] : "Offline"}
                </span>
              </span>
              {host !== "local" && <Cloud size={14} label={`Runs on ${hostName(state, host)}`} />}
            </button>
          );
        })}
        {sessions.length === 0 && <div className="empty">No sessions yet.</div>}
      </div>
      <div className="sidebar-bottom">
        {["local", ...state.hosts.map((h) => h.id)].map((id) => {
          const stats = state.host[id];
          const status = hostState(state, id);
          return (
            <button key={id} className="host-row" onClick={() => actions.go({ page: "hosts" })} title={HOST_STATE_LABEL[status]}>
              <span className={`dot host-dot-${status}`} aria-hidden="true" />
              <span className="host-name">{hostName(state, id)}</span>
              {id !== "local" && <Cloud size={12} />}
              <span className="spacer" />
              <span className="host-stat">
                {(status === "ok" || status === "busy") && stats
                  ? `${pct(stats.cpu)} · ${pct((stats.memUsed / stats.memTotal) * 100)}`
                  : HOST_STATE_LABEL[status]}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** yardd's own verdict (the one its queue uses) when it sends one. */
const hostPressure = (h: Host) =>
  h.pressure !== undefined ? !!h.pressure : h.load > h.cores || h.memUsed / h.memTotal > 0.9;

/* ---------- model picker ---------- */

function usageText(engine: Engine, usage: Usage): string {
  if (engine === "claude" && usage.claude) {
    const parts: string[] = [];
    if (usage.claude.fiveHour != null) parts.push(`${pct(usage.claude.fiveHour * 100)} of 5-hour window`);
    if (usage.claude.sevenDay != null) parts.push(`${pct(usage.claude.sevenDay * 100)} of week`);
    return parts.join(" · ");
  }
  if (engine === "codex" && usage.codex?.primary) {
    const p = usage.codex.primary;
    const window = p.windowDurationMins >= 10080 ? "weekly limit" : `${Math.round(p.windowDurationMins / 60)}-hour window`;
    return `${pct(p.usedPercent)} of ${window}`;
  }
  return "";
}

interface Choice {
  engine: Engine;
  model: string;
  effort: string;
}

function effortFor(model: ModelInfo | undefined, wanted: string): string {
  if (!model) return wanted;
  if (model.efforts.includes(wanted)) return wanted;
  return model.defaultEffort ?? model.efforts[0] ?? wanted;
}

/** What the engine may do without asking. Changing it mid-session applies
 *  to Claude at once and to Codex from its next turn. */
function PermissionPicker({ engine, value, onChange }: { engine: Engine; value: Permission; onChange(p: Permission): void }) {
  const [open, setOpen] = useState(false);
  const current = PERMISSIONS.find((p) => p.id === value) ?? PERMISSIONS[0];
  return (
    <div className="picker">
      <button
        className={`btn-quiet permission ${value === "full" ? "permission-full" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={current[engine]}
        onClick={() => setOpen(!open)}
      >
        <span>{current.label}</span>
        <span className="muted">
          <Icon d={CHEVRON_DOWN} size={12} />
        </span>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="popover permission-menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            {PERMISSIONS.map((p) => (
              <button
                key={p.id}
                role="menuitemradio"
                aria-checked={p.id === value}
                className={`picker-item permission-item ${p.id === value ? "active" : ""}`}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="permission-label">{p.label}</span>
                <span className="muted small">{p[engine]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ModelPicker(props: {
  models: Models;
  usage: Usage;
  value: Choice;
  engines: Engine[];
  onChange(next: Choice): void;
  /** In a session, a model of the other engine means a hand-off, never a silent switch. */
  handoff?: { blocked: boolean; onConfirm(next: Choice): void };
}) {
  const { models, usage, value, engines, onChange, handoff } = props;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Choice | null>(null);
  // The confirmation sits at the top of the list, which is usually scrolled
  // down to the model that was just clicked. Bring it into view.
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirm) popover.current?.scrollTo({ top: 0 });
  }, [confirm]);
  const current = models[value.engine]?.find((m) => m.id === value.model);
  const close = () => {
    setOpen(false);
    setConfirm(null);
  };
  return (
    <div className="picker">
      <button className="btn-quiet" aria-haspopup="true" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <span>{current?.name ?? value.model}</span>
        <span className="muted">{capitalize(value.effort)}</span>
        <span className="muted">
          <Icon d={CHEVRON_DOWN} size={12} />
        </span>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={close} />
          <div className="popover" ref={popover}>
            {confirm && handoff && (
              <div className="handoff-confirm" role="group" aria-label="Confirm hand-off">
                <div>
                  <strong>Hand off to {ENGINE_NAME[confirm.engine]}</strong>: starts a new session in this folder with a summary of this one.
                </div>
                <div className="muted small">
                  {modelName(models, confirm.engine, confirm.model)} · {capitalize(confirm.effort)}
                </div>
                <div className="row">
                  <button
                    className="btn-primary"
                    disabled={handoff.blocked}
                    onClick={() => {
                      handoff.onConfirm(confirm);
                      close();
                    }}
                  >
                    Hand off
                  </button>
                  <button className="btn-text" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {engines.map((engine) => {
              const isHandoff = !!handoff && engine !== value.engine;
              const disabled = isHandoff && handoff.blocked;
              return (
                <div key={engine} className="picker-group">
                  <div className="picker-head">
                    <span>{ENGINE_NAME[engine]}</span>
                    <span>{usageText(engine, usage)}</span>
                  </div>
                  {isHandoff && (
                    <div className="picker-note">{disabled ? "Stop the running turn to hand off." : "Picking one hands off to a new session."}</div>
                  )}
                  {models[engine].length === 0 && <div className="picker-empty">Not available</div>}
                  {models[engine].map((m) => (
                    <button
                      key={m.id}
                      disabled={disabled}
                      className={`picker-item ${engine === value.engine && m.id === value.model ? "active" : ""} ${
                        confirm?.engine === engine && confirm.model === m.id ? "active" : ""
                      }`}
                      onClick={() => {
                        const next = { engine, model: m.id, effort: effortFor(m, value.effort) };
                        if (isHandoff) {
                          setConfirm(next);
                          return;
                        }
                        onChange(next);
                        close();
                      }}
                    >
                      {m.name}
                    </button>
                  ))}
                </div>
              );
            })}
            {current && current.efforts.length > 0 && (
              <div className="picker-group">
                <div className="picker-head">
                  <span>Effort</span>
                </div>
                <div className="efforts">
                  {current.efforts.map((e) => (
                    <button key={e} className={`effort ${e === value.effort ? "active" : ""}`} onClick={() => onChange({ ...value, effort: e })}>
                      {capitalize(e)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- composer ---------- */

/** A file in the composer, uploaded as soon as it is added so sending is quick. */
interface PendingFile {
  key: string;
  file: File;
  /** Object URL for a local preview of an image. */
  preview?: string;
  state: "uploading" | "ready" | "error";
  error?: string;
}

function Composer(props: {
  placeholder: string;
  rows: number;
  large?: boolean;
  busy?: boolean;
  /** Keep the text and files after sending, for a submit that can still fail. */
  keepText?: boolean;
  /** Session whose terminal can add text here (see compose.ts). */
  appendFor?: string;
  /** Where attached files are stored: the host the prompt will run on. */
  target: UploadTarget;
  upload(file: File, target: UploadTarget): Promise<Attachment>;
  onSubmit(text: string, attachments: Attachment[]): void;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The upload under way or done for each file, and the target it went to.
  const uploads = useRef(new Map<string, { target: string; promise: Promise<Attachment> }>());
  const picker = useRef<HTMLInputElement>(null);
  const targetKey = JSON.stringify(props.target);
  // Start one line tall and grow with the text, up to a cap.
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!props.appendFor) return;
    return onAppend(props.appendFor, (added) => {
      setText((t) => (t && !t.endsWith("\n") ? t + "\n" : t) + added);
      const el = area.current;
      if (!el) return;
      el.focus();
      // After React writes the new value, put the caret at the end.
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
        el.scrollTop = el.scrollHeight;
      });
    });
  }, [props.appendFor]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const patch = (key: string, change: Partial<PendingFile>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const startUpload = (f: PendingFile) => {
    const promise = props.upload(f.file, props.target);
    const entry = { target: targetKey, promise };
    uploads.current.set(f.key, entry);
    patch(f.key, { state: "uploading", error: undefined });
    promise.then(
      // A newer upload of the same file (the host changed) owns the chip.
      () => uploads.current.get(f.key) === entry && patch(f.key, { state: "ready" }),
      (e) => uploads.current.get(f.key) === entry && patch(f.key, { state: "error", error: String(e?.message ?? e) }),
    );
    return promise;
  };

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    const added = list.map((file): PendingFile => {
      const big = tooLarge(file.size);
      return {
        key: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: !big && file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        state: big ? "error" : "uploading",
        error: big ?? undefined,
      };
    });
    setFiles((cur) => [...cur, ...added]);
    added.filter((f) => f.state !== "error").forEach(startUpload);
    area.current?.focus();
  };

  const removeFile = (key: string) => {
    uploads.current.delete(key);
    const gone = files.find((f) => f.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setFiles((list) => list.filter((f) => f.key !== key));
    // The clicked button is gone; Enter should still send.
    area.current?.focus();
  };

  // Files go to the host the prompt runs on; picking another host re-sends them.
  useEffect(() => {
    files.forEach((f) => {
      const u = uploads.current.get(f.key);
      if (u && u.target !== targetKey) startUpload(f);
    });
  }, [targetKey]);

  // Previews are freed when the composer goes away.
  const live = useRef(files);
  live.current = files;
  useEffect(() => () => live.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []);

  const failed = files.some((f) => f.state === "error");
  const canSend = (text.trim() !== "" || files.length > 0) && !failed && !props.busy && !sending;
  const submit = async () => {
    const value = text.trim();
    if (!canSend) return;
    setSending(true);
    try {
      const attachments = await Promise.all(
        files.map((f) => {
          const u = uploads.current.get(f.key);
          return u && u.target === targetKey ? u.promise : startUpload(f);
        }),
      );
      props.onSubmit(value, attachments);
      if (!props.keepText) {
        setText("");
        files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
        uploads.current.clear();
        setFiles([]);
      }
    } catch {
      // The chip that failed says why.
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div
      className={`composer ${props.large ? "composer-large" : ""} ${dragging ? "composer-drop" : ""}`}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {files.length > 0 && (
        <div className="attachments" aria-label="Attachments">
          {files.map((f) => (
            <PendingChip key={f.key} file={f} onRemove={() => removeFile(f.key)} />
          ))}
        </div>
      )}
      <textarea
        ref={area}
        aria-label="Message"
        rows={props.rows}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const pasted = pastedFiles(e.clipboardData);
          if (!pasted.length) return;
          e.preventDefault();
          addFiles(pasted);
        }}
        autoFocus
      />
      <div className="composer-row">
        <button className="btn-icon attach-btn" aria-label="Attach files" title="Attach files" onClick={() => picker.current?.click()}>
          <Icon d={PAPERCLIP} size={16} />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Attach files"
          onChange={(e) => {
            addFiles(Array.from(e.currentTarget.files ?? []));
            // Picking the same file again must fire a change.
            e.currentTarget.value = "";
          }}
        />
        {props.children}
        <span className="spacer" />
        <button className="send" aria-label="Send" disabled={!canSend} onClick={submit}>
          {sending ? <span className="send-wait" aria-label="Uploading" /> : <Icon d={ARROW_UP} width={2.5} />}
        </button>
      </div>
    </div>
  );
}

function PendingChip({ file, onRemove }: { file: PendingFile; onRemove(): void }) {
  const [broken, setBroken] = useState(false);
  const { state } = file;
  return (
    <div className={`attachment attachment-${state}`} title={file.error ?? file.file.name}>
      {file.preview && !broken ? (
        <img className="attachment-thumb" src={file.preview} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="attachment-icon">
          <Icon d={FILE} size={16} />
        </span>
      )}
      <span className="attachment-text">
        <span className="attachment-name">{file.file.name || "file"}</span>
        <span className="attachment-meta">
          {state === "error" ? file.error : state === "uploading" ? `${humanSize(file.file.size)} · uploading` : humanSize(file.file.size)}
        </span>
      </span>
      <button className="attachment-remove" aria-label={`Remove ${file.file.name}`} onClick={onRemove}>
        <Icon d={CLOSE} size={12} />
      </button>
    </div>
  );
}

/** An attachment of a sent prompt. Images load their bytes from the
 *  session's host; other files show their name, with the path on hover. */
function SentAttachment({ attachment: a, load }: { attachment: Attachment; load(a: Attachment): Promise<string> }) {
  const image = isInlineImage(a.mime);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!image) return;
    let live = true;
    load(a).then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [a.id]);
  if (image && !failed) {
    return (
      <a className="sent-image" href={url ?? undefined} target="_blank" rel="noreferrer" title={`${a.name}\n${a.path}`}>
        {url ? <img src={url} alt={a.name} /> : <span className="sent-image-wait" aria-label={`Loading ${a.name}`} />}
      </a>
    );
  }
  return (
    <div className="attachment attachment-ready" title={a.path}>
      <span className="attachment-icon">
        <Icon d={FILE} size={16} />
      </span>
      <span className="attachment-text">
        <span className="attachment-name">{a.name}</span>
        <span className="attachment-meta">{humanSize(a.size)}</span>
      </span>
    </div>
  );
}

/* ---------- new session ---------- */

function loadChoice(models: Models): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem("yard.choice") ?? "null") as Choice | null;
    if (saved && models[saved.engine]?.some((m) => m.id === saved.model)) return saved;
  } catch {
    /* fall through to the default */
  }
  const first = models.claude[0];
  return { engine: "claude", model: first?.id ?? "", effort: first?.defaultEffort ?? "medium" };
}

/** Remembered per host: the folder last used there, and recent picks. */
const cwdKey = (host: string) => (host === "local" ? "yard.cwd" : `yard.cwd.${host}`);
const recentKey = (host: string) => `yard.recent.${host}`;
function readRecent(host: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey(host)) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
function remember(host: string, folder: string) {
  localStorage.setItem(cwdKey(host), folder);
  localStorage.setItem(recentKey(host), JSON.stringify([folder, ...readRecent(host).filter((p) => p !== folder)].slice(0, 12)));
}

function NewSession({ state, actions }: { state: State; actions: Actions }) {
  // Where the session runs. A remote host can be picked only while connected.
  const [host, setHost] = useState("local");
  const target = host === "local" || state.hosts.some((h) => h.id === host && hostOnline(state, h.id)) ? host : "local";
  const models = modelsOn(state, target);
  const home = homeOn(state, target);
  const [choice, setChoice] = useState<Choice>(() => loadChoice(modelsOn(state, "local")));
  const [permission, setPermission] = useState<Permission>(() => {
    const saved = localStorage.getItem("yard.permission");
    return PERMISSIONS.some((p) => p.id === saved) ? (saved as Permission) : "ask";
  });
  const [cwd, setCwd] = useState("");
  // What the worktree is cut from; empty means the folder's current branch.
  const [base, setBase] = useState("");
  // From send until yardd answers. On success this page is replaced by the
  // session; on failure the task stays in the box so nothing is retyped.
  const [pending, setPending] = useState(false);
  useEffect(() => setPending(false), [state.errorCount, state.connected]);
  // Models and the home folder arrive after the first render, and differ per host.
  useEffect(() => {
    if (!models[choice.engine]?.some((m) => m.id === choice.model)) setChoice(loadChoice(models));
  }, [models, target]);
  useEffect(() => {
    setCwd(localStorage.getItem(cwdKey(target)) || home);
  }, [target, home]);

  // Recent picks first, then the folders of this host's sessions. A worktree
  // session counts as the repository it was cut from.
  const recent = useMemo(() => {
    const fromSessions = Object.values(state.sessions)
      .filter((s) => hostOf(s) === target)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => s.repo || s.cwd);
    return [...new Set([...readRecent(target), ...fromSessions])].slice(0, 12);
  }, [state.sessions, target]);

  // Every session in a repository gets a worktree, so the branches tell
  // whether this folder is one and what it can start from.
  const branchList = state.branches[branchKey(target, cwd)];
  useEffect(() => {
    if (!cwd || !state.connected) return;
    actions.loadBranches(cwd, target);
  }, [cwd, target, state.connected]);
  useEffect(() => setBase(""), [cwd, target]);
  const isRepo = !!branchList?.current;

  const start = (text: string, attachments: Attachment[]) => {
    if (target === "local") localStorage.setItem("yard.choice", JSON.stringify(choice));
    localStorage.setItem("yard.permission", permission);
    remember(target, cwd);
    setPending(true);
    actions.create({
      ...choice,
      permission,
      cwd,
      text,
      worktree: true,
      base: base || undefined,
      host: target === "local" ? undefined : target,
      attachments: attachments.length ? attachments.map((a) => a.id) : undefined,
    });
  };
  const uploadTarget = useMemo<UploadTarget>(() => (target === "local" ? {} : { host: target }), [target]);

  return (
    <div className="new">
      <div className="new-inner">
        <h1>What should we work on?</h1>
        <Composer
          placeholder="Describe the task"
          rows={1}
          large
          keepText
          target={uploadTarget}
          upload={actions.upload}
          onSubmit={start}
          busy={pending || !state.connected || !choice.model || !cwd}
        >
          <ModelPicker models={models} usage={usageOn(state, target)} value={choice} engines={["claude", "codex"]} onChange={setChoice} />
          <PermissionPicker engine={choice.engine} value={permission} onChange={setPermission} />
        </Composer>
        <div className="new-chips">
          <HostPicker state={state} value={target} onChange={setHost} onAddHost={() => actions.go({ page: "hosts" })} />
          <FolderPicker
            host={target}
            home={home}
            value={cwd}
            recent={recent}
            dirs={state.dirs}
            listDirs={actions.listDirs}
            onChange={setCwd}
          />
          {isRepo && (
            <BranchPicker current={branchList.current!} branches={branchList.branches ?? []} value={base} onChange={setBase} />
          )}
          <span className="spacer" />
          {cwd && branchList && (
            <span className="muted small">{isRepo ? "New worktree" : "Works in the folder itself"}</span>
          )}
        </div>
      </div>
    </div>
  );
}

const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z";
const BRANCH = "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9";
const LAPTOP = "M4 5h16v11H4ZM2 20h20";
const CHECK = "M5 12l5 5 9-11";

/** A button under the prompt box that opens a menu below it. */
function ChipMenu(props: {
  icon: ReactNode;
  label: ReactNode;
  title?: string;
  open: boolean;
  setOpen(open: boolean): void;
  wide?: boolean;
  children: ReactNode;
}) {
  const { open, setOpen } = props;
  return (
    <div className="picker">
      <button className="chip" aria-haspopup="true" aria-expanded={open} title={props.title} onClick={() => setOpen(!open)}>
        {props.icon}
        <span className="chip-label">{props.label}</span>
        <Icon d={CHEVRON_DOWN} size={12} />
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className={`popover menu ${props.wide ? "menu-wide" : ""}`} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
            {props.children}
          </div>
        </>
      )}
    </div>
  );
}

function HostPicker(props: { state: State; value: string; onChange(host: string): void; onAddHost(): void }) {
  const { state, value } = props;
  const [open, setOpen] = useState(false);
  const pick = (host: string) => {
    props.onChange(host);
    setOpen(false);
  };
  const remote = state.hosts.find((h) => h.id === value);
  return (
    <ChipMenu
      icon={remote ? <Icon d={CLOUD} /> : <Icon d={LAPTOP} />}
      label={remote ? remote.name : hostName(state, "local")}
      title="Where the session runs"
      open={open}
      setOpen={setOpen}
    >
      <button className={`picker-item menu-item ${value === "local" ? "active" : ""}`} onClick={() => pick("local")}>
        <Icon d={LAPTOP} />
        <span>{hostName(state, "local")}</span>
      </button>
      {state.hosts.map((h) => {
        const online = hostOnline(state, h.id);
        return (
          <button key={h.id} className={`picker-item menu-item ${value === h.id ? "active" : ""}`} disabled={!online} onClick={() => pick(h.id)}>
            <Icon d={CLOUD} />
            <span>{h.name}</span>
            {!online && <span className="muted small menu-aside">{h.status === "error" ? "unreachable" : h.status}</span>}
          </button>
        );
      })}
      <div className="menu-divider" />
      <button className="picker-item menu-item" onClick={props.onAddHost}>
        <Icon d={PLUS} />
        <span>Add a host…</span>
      </button>
    </ChipMenu>
  );
}

/** The desktop app's window exposes Tauri's IPC; a plain browser does not. */
const tauriInvoke = (): ((cmd: string, args: object) => Promise<unknown>) | undefined =>
  (window as any).__TAURI__?.core?.invoke;

const parentOf = (path: string) => (path.lastIndexOf("/") <= 0 ? "/" : path.slice(0, path.lastIndexOf("/")));
const joinPath = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** Recent folders, a search that browses the host's folders as a path is
 *  typed, and the Finder dialog when the session runs on this Mac. */
function FolderPicker(props: {
  host: string;
  home: string;
  value: string;
  recent: string[];
  dirs: State["dirs"];
  listDirs(path: string, host: string): void;
  onChange(path: string): void;
}) {
  const { host, home, value, recent } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setQuery(recent.length ? "" : tilde(value || home, home).replace(/\/?$/, "/"));
      setCursor(0);
    }
  }, [open]);

  // A query starting with / or ~ is a path: list the folder it ends in and
  // match the last segment against its subfolders.
  const browsing = query.startsWith("/") || query.startsWith("~");
  const expanded = query.replace(/^~(?=\/|$)/, home);
  const dir = browsing ? (expanded.endsWith("/") ? expanded.replace(/(.)\/+$/, "$1") : parentOf(expanded)) : "";
  const stem = browsing && !expanded.endsWith("/") ? baseName(expanded) : "";
  const listing = browsing ? props.dirs[branchKey(host, dir)] : undefined;
  useEffect(() => {
    if (!open || !browsing || !dir) return;
    const timer = setTimeout(() => props.listDirs(dir, host), 120);
    return () => clearTimeout(timer);
  }, [open, browsing, dir, host]);

  type Row = { path: string; name: string; detail: string; git?: boolean; browse?: boolean };
  const rows: Row[] = useMemo(() => {
    if (browsing) {
      const lower = stem.toLowerCase();
      const children = (listing?.dirs ?? [])
        .filter((d) => d.name.toLowerCase().startsWith(lower) && (lower.startsWith(".") || !d.name.startsWith(".")))
        .slice(0, 200)
        .map((d) => ({ path: joinPath(dir, d.name), name: d.name, detail: "", git: d.git, browse: true }));
      // The folder typed so far is itself a choice.
      const self = !stem && dir ? [{ path: dir, name: `Use ${tilde(dir, home)}`, detail: "" }] : [];
      return [...self, ...children];
    }
    const lower = query.toLowerCase();
    return recent
      .filter((p) => p.toLowerCase().includes(lower))
      .map((p) => ({ path: p, name: baseName(p), detail: tilde(p, home) }));
  }, [browsing, stem, listing, dir, query, recent, home]);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (path: string) => {
    props.onChange(path);
    setOpen(false);
  };
  const browseInto = (path: string) => setQuery(tilde(path, home) + "/");
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const row = rows[cursor];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (row) pick(row.path);
    } else if (e.key === "Tab" && row?.browse) {
      e.preventDefault();
      browseInto(row.path);
    }
  };
  const invoke = host === "local" ? tauriInvoke() : undefined;
  const chooseInFinder = async () => {
    setOpen(false);
    try {
      const picked = await invoke!("plugin:dialog|open", { options: { directory: true, multiple: false, defaultPath: value || home } });
      if (typeof picked === "string") props.onChange(picked);
    } catch (err) {
      console.error("folder dialog failed", err);
    }
  };

  return (
    <ChipMenu icon={<Icon d={FOLDER} />} label={value ? baseName(value) : "Choose a folder"} title={value} open={open} setOpen={setOpen} wide>
      <input
        className="menu-search"
        autoFocus
        placeholder="Search recent folders, or type a path"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
        aria-label="Folder"
      />
      <div className="menu-list" ref={list} role="listbox">
        {!browsing && rows.length > 0 && <div className="picker-head">Recent</div>}
        {rows.map((row, i) => (
          <div
            key={row.path + i}
            data-row={i}
            role="option"
            aria-selected={i === cursor}
            className={`picker-item menu-item folder-row ${i === cursor ? "cursor" : ""} ${row.path === value ? "active" : ""}`}
            onMouseEnter={() => setCursor(i)}
            onClick={() => pick(row.path)}
          >
            <Icon d={row.git ? BRANCH : FOLDER} />
            <span className="folder-name">{row.name}</span>
            {row.detail && <span className="muted small folder-detail">{row.detail}</span>}
            {row.path === value && <Icon d={CHECK} />}
            {row.browse && (
              <button
                className="btn-icon folder-open"
                aria-label={`Open ${row.name}`}
                title="Show the folders inside (Tab)"
                onClick={(e) => {
                  e.stopPropagation();
                  browseInto(row.path);
                }}
              >
                <Icon d={CHEVRON_RIGHT} size={12} />
              </button>
            )}
          </div>
        ))}
        {browsing && listing?.error && <div className="picker-empty">{listing.error}</div>}
        {browsing && !listing && <div className="picker-empty">Loading…</div>}
        {!browsing && rows.length === 0 && (
          <div className="picker-empty">{query ? "No recent folder matches. Start with / or ~ to browse." : "No recent folders yet."}</div>
        )}
      </div>
      {(!browsing || invoke) && <div className="menu-divider" />}
      {!browsing && (
        <button className="picker-item menu-item" onClick={() => browseInto(home || "/")}>
          <Icon d={FOLDER} />
          <span>Browse folders…</span>
        </button>
      )}
      {invoke && (
        <button className="picker-item menu-item" onClick={chooseInFinder}>
          <Icon d={FOLDER} />
          <span>Choose in Finder…</span>
        </button>
      )}
    </ChipMenu>
  );
}

/** What the new worktree is cut from. */
function BranchPicker(props: { current: string; branches: string[]; value: string; onChange(base: string): void }) {
  const { current, value } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const options = useMemo(() => {
    const all = [current, ...props.branches.filter((b) => b !== current)];
    const lower = query.toLowerCase();
    return all.filter((b) => b.toLowerCase().includes(lower)).slice(0, 200);
  }, [current, props.branches, query]);
  const pick = (b: string) => {
    props.onChange(b === current ? "" : b);
    setOpen(false);
  };
  const shown = value || current;
  return (
    <ChipMenu icon={<Icon d={BRANCH} />} label={shown} title="Branch the worktree starts from" open={open} setOpen={setOpen}>
      <input
        className="menu-search"
        autoFocus
        placeholder="Search branches"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && options[0] && pick(options[0])}
        spellCheck={false}
        aria-label="Base branch"
      />
      <div className="menu-list">
        {options.map((b) => (
          <button key={b} className={`picker-item menu-item ${b === shown ? "active" : ""}`} onClick={() => pick(b)}>
            <span className="folder-name">{b}</span>
            {b === current && <span className="muted small menu-aside">current</span>}
          </button>
        ))}
        {options.length === 0 && <div className="picker-empty">No branch matches.</div>}
      </div>
    </ChipMenu>
  );
}

/* ---------- session ---------- */

function SessionView({ meta, state, actions }: { meta: SessionMeta; state: State; actions: Actions }) {
  const thread = state.threads[meta.id];
  const items = thread?.items ?? [];
  const changes = state.changes[meta.id];
  const busy = meta.status === "running" || meta.status === "needs_approval";
  const host = hostOf(meta);
  const online = hostOnline(state, host);
  const models = modelsOn(state, host);

  // Stick to the bottom while new items arrive, unless the user scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  // Thumbnails arrive after their message and grow it; stay at the bottom.
  // `load` does not bubble, but it does pass ancestors while capturing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", keep, true);
    return () => el.removeEventListener("load", keep, true);
  }, []);

  // The working tree has probably changed whenever a turn ends.
  const last = useRef(meta.status);
  useEffect(() => {
    if (last.current !== "idle" && meta.status === "idle") actions.loadChanges(meta.id);
    last.current = meta.status;
  }, [meta.status]);

  const lastItem = items[items.length - 1];
  const showWorking = meta.status === "running" && !(lastItem?.kind === "assistant" && lastItem.streaming);
  // Files go to the session's own host, through the hub for a remote one.
  const uploadTarget = useMemo<UploadTarget>(() => ({ sessionId: meta.id }), [meta.id]);
  const loadAttachment = (a: Attachment) => actions.attachmentUrl(meta.id, a);

  return (
    <div className="session">
      <main className="thread">
        <header className="bar">
          <h1>{meta.title}</h1>
          <code className="muted">{meta.branch || changes?.branch || tilde(meta.cwd, homeOn(state, host))}</code>
          {host !== "local" && (
            <span className="muted small bar-host">
              <Cloud size={13} />
              {hostName(state, host)}
              {!online && " · offline"}
            </span>
          )}
          <span className="spacer" />
          {busy && online && (
            <button className="btn-text" onClick={() => actions.interrupt(meta.id)}>
              Stop
            </button>
          )}
          {online && (
            <DeleteButton
              key={meta.id}
              worktree={!!(meta.branch && meta.repo)}
              onConfirm={(removeWorktree) => actions.remove(meta.id, removeWorktree)}
            />
          )}
        </header>
        <div
          className="scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="column">
            {items.map((item) => (
              <ItemView
                key={item.key}
                item={item}
                queued={meta.status === "queued"}
                loadAttachment={loadAttachment}
                onStart={() => actions.startNow(meta.id)}
                onDecide={(id, d) => actions.approve(meta.id, id, d)}
              />
            ))}
            {showWorking && <div className="working">Working</div>}
          </div>
        </div>
        <div className="dock">
          {!online && <div className="muted small offline-note">{hostName(state, host)} is offline. This session comes back when it reconnects.</div>}
          <Composer
            placeholder={online ? "Reply" : "Offline"}
            rows={1}
            busy={busy || meta.status === "queued" || !online}
            appendFor={meta.id}
            target={uploadTarget}
            upload={actions.upload}
            onSubmit={(text, attachments) => actions.send(meta.id, text, attachments.map((a) => a.id))}
          >
            <ModelPicker
              models={models}
              usage={usageOn(state, host)}
              value={{ engine: meta.engine, model: meta.model, effort: meta.effort }}
              engines={meta.engine === "claude" ? ["claude", "codex"] : ["codex", "claude"]}
              onChange={(c) => actions.setModel(meta.id, c.model, c.effort)}
              handoff={{ blocked: busy, onConfirm: (c) => actions.handoff(meta.id, c.engine, c.model, c.effort) }}
            />
            <PermissionPicker engine={meta.engine} value={meta.permission ?? "ask"} onChange={(p) => actions.setPermission(meta.id, p)} />
          </Composer>
        </div>
      </main>
      <WorkPane sessionId={meta.id} changes={changes} connected={online} actions={actions} meta={meta} state={state} />
    </div>
  );
}

/** Deleting asks for a second click; the ask lapses after a few seconds. A
 *  session in a worktree yardd made can take its worktree with it. */
function DeleteButton({ worktree, onConfirm }: { worktree: boolean; onConfirm(removeWorktree: boolean): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), worktree ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (worktree && armed) {
    return (
      <>
        <button className="btn-text" onClick={() => onConfirm(false)}>
          Delete session
        </button>
        <button className="btn-text" onClick={() => onConfirm(true)}>
          Delete and remove worktree
        </button>
      </>
    );
  }
  return (
    <button className="btn-text" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? "Delete session?" : "Delete"}
    </button>
  );
}

/** A hand-off brief can run to hundreds of lines; fold long messages. */
const FOLD_LINES = 12;

function UserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  if (lines.length <= FOLD_LINES) return <div className="bubble">{text}</div>;
  return (
    <div className="bubble">
      {expanded ? text : lines.slice(0, FOLD_LINES).join("\n")}
      <button className="btn-text bubble-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Show less" : `Show more (${lines.length - FOLD_LINES} lines)`}
      </button>
    </div>
  );
}

function ItemView(props: {
  item: Item;
  /** The session is still waiting in the queue. */
  queued: boolean;
  loadAttachment(a: Attachment): Promise<string>;
  onStart(): void;
  onDecide(requestId: string, decision: "allow" | "allow_always" | "deny"): void;
}) {
  const { item, onDecide } = props;
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      if (!item.attachments?.length) return <UserBubble text={item.text} />;
      return (
        <div className="user-message">
          <div className="attachments attachments-sent">
            {item.attachments.map((a) => (
              <SentAttachment key={a.id} attachment={a} load={props.loadAttachment} />
            ))}
          </div>
          {item.text && <UserBubble text={item.text} />}
        </div>
      );
    case "note":
      return <div className="note">{item.text}</div>;
    case "assistant":
      return <Markdown text={item.text} />;
    case "tool": {
      const expandable = !!item.output;
      return (
        <div className="tool">
          <button className="tool-row" aria-expanded={open} disabled={!expandable} onClick={() => setOpen(!open)}>
            <span className={`tool-chevron ${open ? "open" : ""} ${expandable ? "" : "hidden"}`}>
              <Icon d={CHEVRON_RIGHT} size={12} />
            </span>
            <span>{item.title}</span>
            {item.detail && <code>{item.detail}</code>}
            {item.state === "running" && <span className="pulse" aria-label="running" />}
            {item.state === "failed" && <span className="bad">· failed</span>}
          </button>
          {open && item.output && <pre className="tool-output">{item.output}</pre>}
        </div>
      );
    }
    case "diff":
      return (
        <>
          {item.files.map((f, i) => (
            <FileDiff key={i} file={f} />
          ))}
        </>
      );
    case "approval":
      return (
        <div className="approval">
          <div className="approval-title">{item.approvalKind === "command" ? "Allow this command?" : "Allow this?"}</div>
          <code className="approval-what">{item.title}</code>
          {item.detail && <div className="muted small">{item.detail}</div>}
          {item.decision === null ? (
            <div className="row">
              <button className="btn-primary" onClick={() => onDecide(item.requestId, "allow")}>
                Allow once
              </button>
              <button className="btn" onClick={() => onDecide(item.requestId, "allow_always")}>
                Always allow
              </button>
              <button className="btn-text" onClick={() => onDecide(item.requestId, "deny")}>
                Deny
              </button>
            </div>
          ) : (
            <div className="muted small">{item.decision === "deny" ? "Denied" : item.decision === "allow_always" ? "Always allowed" : "Allowed"}</div>
          )}
        </div>
      );
    case "error":
      return <div className="error-line">{item.message}</div>;
    case "queued":
      return (
        <div className="queued-line">
          <span>{props.queued ? `Queued: ${item.reason}.` : `Was queued: ${item.reason}.`}</span>
          {props.queued && (
            <button className="btn" onClick={props.onStart}>
              Start anyway
            </button>
          )}
        </div>
      );
  }
}

/* ---------- diffs ---------- */

function DiffLines({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="diff">
      {lines.map((line, i) => {
        const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return (
          <span key={i} className={`dl ${cls}`}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

function FileDiff({ file }: { file: ChangedFile }) {
  return (
    <div className="card">
      <div className="card-head">
        <code>{file.path}</code>
      </div>
      {file.diff ? <DiffLines diff={file.diff} /> : <div className="muted small pad">No text diff.</div>}
    </div>
  );
}

/** Split `git diff` output into one body per file, without the git headers. */
function splitDiff(diff: string): { path: string; body: string }[] {
  return diff
    .split(/^diff --git /m)
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const header = lines[0] ?? "";
      const path = header.match(/ b\/(.+)$/)?.[1] ?? header;
      const start = lines.findIndex((l) => l.startsWith("@@"));
      return { path, body: start >= 0 ? lines.slice(start).join("\n") : "" };
    });
}

/** The right-hand pane: what changed, and a shell in the same folder. */
function WorkPane(props: { sessionId: string; changes: Changes | undefined; connected: boolean; actions: Actions; meta: SessionMeta; state: State }) {
  const { sessionId, changes, connected, actions } = props;
  const [tab, setTab] = useState<"changes" | "terminal" | "pr">("changes");
  const [prUsed, setPrUsed] = useState(false);
  // The shell starts the first time the tab is opened, then stays mounted.
  const [terminalUsed, setTerminalUsed] = useState(false);
  const parts = useMemo(() => splitDiff(changes?.diff ?? ""), [changes?.diff]);
  const files = changes?.files ?? [];
  return (
    <section className="pane" aria-label="Workspace">
      <header className="bar tabs">
        <button className={`tab ${tab === "changes" ? "active" : ""}`} aria-pressed={tab === "changes"} onClick={() => setTab("changes")}>
          Changes
        </button>
        <button
          className={`tab ${tab === "terminal" ? "active" : ""}`}
          aria-pressed={tab === "terminal"}
          onClick={() => {
            setTab("terminal");
            setTerminalUsed(true);
          }}
        >
          Terminal
        </button>
        <button
          className={`tab ${tab === "pr" ? "active" : ""}`}
          aria-pressed={tab === "pr"}
          onClick={() => {
            setTab("pr");
            setPrUsed(true);
          }}
        >
          Pull request
        </button>
        <span className="spacer" />
        {tab !== "terminal" && (
          <button
            className="btn-icon"
            aria-label={tab === "pr" ? "Refresh pull request" : "Refresh changes"}
            onClick={() => (tab === "pr" ? actions.loadPr(sessionId) : actions.loadChanges(sessionId))}
          >
            <Icon d={REFRESH} />
          </button>
        )}
      </header>
      {terminalUsed && <TerminalPane sessionId={sessionId} connected={connected} visible={tab === "terminal"} actions={actions} />}
      {prUsed && <PrPane meta={props.meta} state={props.state} actions={actions} visible={tab === "pr"} />}
      <div className="scroll pane-body" style={{ display: tab === "changes" ? "flex" : "none" }}>
        {changes?.error && <div className="muted">{capitalize(changes.error)}.</div>}
        {changes && !changes.error && files.length === 0 && <div className="muted">No changes in this folder.</div>}
        {files.length > 0 && (
          <div className="file-list">
            {files.map((f) => (
              <div key={f.path} className="file-row">
                <code>{f.path}</code>
                <code className="muted">{f.untracked ? "new" : `+${f.added ?? 0} −${f.removed ?? 0}`}</code>
              </div>
            ))}
          </div>
        )}
        {parts.map((p) => (
          <FileDiff key={p.path} file={{ path: p.path, diff: p.body }} />
        ))}
        {changes?.truncated && <div className="muted small">Diff cut off at 400 KB.</div>}
      </div>
    </section>
  );
}

/* ---------- markdown (rendered as elements, never as HTML) ---------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\[`?[^\]`]+`?\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    // Links are shown by their label only. Agents mostly link local files,
    // and nothing here should navigate the window away.
    const link = part.match(/^\[`?([^\]`]+)`?\]\([^)]+\)$/);
    if (link) return <code key={i}>{link[1]}</code>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```/);
  return (
    <div className="prose">
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          // Fenced code: drop the language line.
          const body = block.replace(/^[^\n]*\n/, "").replace(/\n$/, "");
          return (
            <pre key={i} className="code">
              {body}
            </pre>
          );
        }
        return block
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((para, j) => {
            const lines = para.replace(/^\n+|\n+$/g, "").split("\n");
            if (lines.every((l) => /^\s*[-*] /.test(l))) {
              return (
                <ul key={`${i}-${j}`}>
                  {lines.map((l, k) => (
                    <li key={k}>{inline(l.replace(/^\s*[-*] /, ""))}</li>
                  ))}
                </ul>
              );
            }
            if (lines.every((l) => /^\s*\d+[.)] /.test(l))) {
              return (
                <ol key={`${i}-${j}`}>
                  {lines.map((l, k) => (
                    <li key={k}>{inline(l.replace(/^\s*\d+[.)] /, ""))}</li>
                  ))}
                </ol>
              );
            }
            const heading = para.match(/^#{1,4} (.+)$/);
            if (heading) return <h3 key={`${i}-${j}`}>{inline(heading[1])}</h3>;
            return (
              <p key={`${i}-${j}`}>
                {lines.map((l, k) => (
                  <span key={k}>
                    {k > 0 && <br />}
                    {inline(l)}
                  </span>
                ))}
              </p>
            );
          });
      })}
    </div>
  );
}

/* ---------- hosts ---------- */

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="muted small">Collecting CPU history.</div>;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 300).toFixed(1)},${(35 - (Math.min(100, v) / 100) * 34).toFixed(1)}`)
    .join(" ");
  return (
    <svg role="img" aria-label="CPU over the last hour" viewBox="0 0 300 36" preserveAspectRatio="none" className="spark">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const size = (bytes: number) => (bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${gb(bytes)} GB`);
/** `8` or `0.2`, without a trailing `.0`. */
const gbLimit = (bytes: number) => String(Number((bytes / 1024 ** 3).toFixed(1)));

/** What each session's processes use, and the sessions waiting to start. */
function SessionUse({ host, sessions }: { host: Host; sessions: Record<string, SessionMeta> }) {
  const cap = host.limits?.memCapBytes ?? 0;
  const reasons = new Map((host.queued ?? []).map((q) => [q.id, q.reason]));
  const rows = (host.sessions ?? []).filter((u) => sessions[u.id]);
  const queued = Object.values(sessions)
    .filter((s) => s.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt);
  const limits = host.limits;
  return (
    <section className="usage" aria-label="Sessions">
      <h2>Sessions</h2>
      {rows.length === 0 && queued.length === 0 && <div className="muted small">No session is running anything.</div>}
      {(rows.length > 0 || queued.length > 0) && (
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th className="num">CPU</th>
              <th className="num">Memory</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const over = cap > 0 && u.memBytes > cap * 0.8;
              return (
                <tr key={u.id}>
                  <td className="usage-title">{sessions[u.id].title}</td>
                  <td className="num">{u.cpuCores.toFixed(1)} cores</td>
                  <td className={`num ${over ? "warn" : ""}`}>
                    {cap > 0 ? `${size(u.memBytes).replace(/ GB$/, "")} of ${gbLimit(cap)} GB` : size(u.memBytes)}
                  </td>
                </tr>
              );
            })}
            {queued.map((s) => (
              <tr key={s.id}>
                <td className="usage-title">{s.title}</td>
                <td className="reason" colSpan={2}>
                  Queued: {reasons.get(s.id) ?? "waiting for room"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {limits && (
        <div className="muted small">
          {limits.forced
            ? "New sessions are queued: pressure is forced on (YARD_FORCE_PRESSURE=1)."
            : `New sessions are queued while load is above ${host.cores} or less than ${gbLimit(limits.minFreeBytes)} GB of memory is free.`}{" "}
          {cap > 0 ? `A session's processes are stopped above ${gbLimit(cap)} GB.` : "No memory cap per session."}
        </div>
      )}
    </section>
  );
}

type HostState = "ok" | "busy" | "down" | "connecting";
function hostState(state: State, id: string): HostState {
  const entry = state.hosts.find((h) => h.id === id);
  if (id !== "local" && !hostOnline(state, id)) return entry?.status === "connecting" ? "connecting" : "down";
  const stats = state.host[id];
  return stats && hostPressure(stats) ? "busy" : "ok";
}
const HOST_STATE_LABEL: Record<HostState, string> = { ok: "Healthy", busy: "Under pressure", down: "Offline", connecting: "Connecting" };

/** yardd passes on what ssh or the socket said; turn the usual ones into
 *  what to do about it. The raw text stays available under Details. */
function explainHostError(entry: HostEntry): { title: string; hint?: ReactNode; install?: boolean } {
  const err = entry.error ?? "";
  const dest = entry.destination ?? "";
  const machine = dest.replace(/^.*@/, "");
  if (/Connection lost/i.test(err)) return { title: "Connection lost. Reconnecting…" };
  if (entry.kind === "ssh" && entry.noDaemon)
    return {
      title: `SSH works, but Switchyard isn't running on ${machine} yet.`,
      hint: "Install it from here: it downloads Switchyard for that machine and runs it as a service in your user account. Nothing else on the machine changes.",
      install: true,
    };
  if (entry.kind === "ssh") {
    if (/Could not resolve hostname/i.test(err))
      return { title: `Can't find ${machine}.`, hint: "Check the name. A Tailscale machine also answers to its full name, like box.tailnet.ts.net." };
    if (/Permission denied/i.test(err))
      return { title: "SSH refused the login.", hint: <>Make <code>ssh {dest}</code> work in Terminal without a password prompt (a key or Tailscale SSH), then wait for the retry.</> };
    if (/Host key verification failed/i.test(err))
      return { title: "The host key is not trusted yet.", hint: <>Run <code>ssh {dest}</code> once in Terminal and accept the key.</> };
    if (/timed out|No route to host|Network is unreachable/i.test(err) && !/os error/i.test(err))
      return { title: `Can't reach ${machine}.`, hint: "Is it on, and on the same network or tailnet?" };
  }
  return { title: err || "Not connected." };
}

function HostCard({ state, id, onRemove, onInstall }: { state: State; id: string; onRemove?(): void; onInstall?(): void }) {
  const install = state.installs[id];
  const entry = state.hosts.find((h) => h.id === id);
  const status = hostState(state, id);
  const host = status === "down" || status === "connecting" ? undefined : state.host[id];
  const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, s]) => hostOf(s) === id));
  const name = hostName(state, id);
  const where = entry ? (entry.kind === "ssh" ? entry.destination : entry.url) : "";
  const problem = entry && status === "down" ? explainHostError(entry) : null;
  return (
    <section className="host-card" aria-label={name}>
      <div className="host-head">
        <span className={`dot host-dot-${status}`} aria-hidden="true" />
        <h2>{name}</h2>
        {entry && <Cloud size={14} />}
        {where && <span className="muted small host-where">{where}</span>}
        <span className="spacer" />
        <span className={`small host-state-${status}`}>{HOST_STATE_LABEL[status]}</span>
      </div>
      {install && (install.running || !install.ok || status !== "ok") && <InstallLog install={install} machine={name} />}
      {problem && !install?.running && !install?.ok && (
        <div className="host-problem">
          <div>{problem.title}</div>
          {problem.hint && <div className="muted small">{problem.hint}</div>}
          {problem.install && onInstall && (
            <div className="row">
              <button className="btn-primary" onClick={onInstall}>
                Install Switchyard on {name}
              </button>
            </div>
          )}
          {entry?.error && problem.title !== entry.error && (
            <details className="small muted">
              <summary>Details</summary>
              <code>{entry.error}</code>
            </details>
          )}
        </div>
      )}
      {status === "connecting" && <div className="muted small">Opening the SSH tunnel…</div>}
      {host && (
        <>
          <div className="stat-grid">
            <Stat label="CPU" value={host.cpu} big={pct(host.cpu)} detail={`load ${host.load.toFixed(1)} of ${host.cores}`} warn={host.load > host.cores} />
            <Stat
              label="Memory"
              value={(host.memUsed / host.memTotal) * 100}
              big={`${gb(host.memUsed)} GB`}
              detail={`of ${gb(host.memTotal)} GB`}
              warn={host.memUsed / host.memTotal > 0.9}
            />
            <Stat
              label="Disk"
              value={host.diskTotal ? (host.diskUsed / host.diskTotal) * 100 : 0}
              big={`${gb(host.diskUsed)} GB`}
              detail={`of ${gb(host.diskTotal)} GB`}
              warn={host.diskTotal > 0 && host.diskUsed / host.diskTotal > 0.9}
            />
          </div>
          <Sparkline values={host.cpuHistory ?? []} />
          <SessionUse host={host} sessions={sessions} />
        </>
      )}
      {!host && status !== "down" && status !== "connecting" && <div className="muted small">Waiting for the first sample.</div>}
      {install?.ok && !install.running && <EngineSummary install={install} machine={name} />}
      {onRemove && <RemoveHost onConfirm={onRemove} onUpdate={entry?.kind === "ssh" && host && !install?.running ? onInstall : undefined} />}
    </section>
  );
}

/** The installer's output while it runs, and its outcome when it failed. */
function InstallLog({ install, machine }: { install: State["installs"][string]; machine: string }) {
  const lines = install.lines.filter((l) => !l.startsWith("@@"));
  const failure = install.lines.find((l) => l.startsWith("@@fail "))?.slice(7);
  return (
    <div className="host-problem">
      <div>
        {install.running ? `Installing Switchyard on ${machine}…` : install.ok ? `Installed. Connecting to ${machine}…` : `The install on ${machine} failed${failure ? `: ${failure}` : "."}`}
      </div>
      {lines.length > 0 && (
        <pre className="install-log" aria-live="polite">
          {lines.slice(-8).join("\n")}
        </pre>
      )}
    </div>
  );
}

const ENGINE_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
const ENGINE_LOGIN: Record<string, string> = { claude: "claude setup-token", codex: "codex login --device-auth" };
const ENGINE_INSTALL: Record<string, string> = { claude: "npm i -g @anthropic-ai/claude-code", codex: "npm i -g @openai/codex" };

/** What the installer found about the engines, with what to run for each that is not ready. */
function EngineSummary({ install, machine }: { install: State["installs"][string]; machine: string }) {
  const engines = install.lines
    .filter((l) => l.startsWith("@@engine "))
    .map((l) => l.split(" "))
    .map(([, name, state]) => ({ name, state }));
  const notReady = engines.filter((e) => e.state !== "ok");
  if (!engines.length) return null;
  return (
    <div className="engines">
      {engines.map((e) => (
        <div key={e.name} className="engine-row">
          <span className={`dot ${e.state === "ok" ? "host-dot-ok" : "host-dot-busy"}`} aria-hidden="true" />
          <span>{ENGINE_LABEL[e.name] ?? e.name}</span>
          <span className="muted small">{e.state === "ok" ? "ready" : e.state === "missing" ? "not installed" : "not logged in"}</span>
          {e.state !== "ok" && (
            <code className="engine-cmd">{e.state === "missing" ? ENGINE_INSTALL[e.name] : ENGINE_LOGIN[e.name]}</code>
          )}
        </div>
      ))}
      {notReady.length > 0 && <div className="muted small">Run the command on {machine} once, over SSH. Sessions with that engine work after that.</div>}
    </div>
  );
}

function Stat({ label, value, big, detail, warn }: { label: string; value: number; big: string; detail: string; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? "warn" : ""}`}>
      <span className="muted small">{label}</span>
      <span className="stat-big">{big}</span>
      <div className="bar-track" aria-hidden="true">
        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="muted small">{detail}</span>
    </div>
  );
}

/** Removing asks for a second click, like deleting a session. */
function RemoveHost({ onConfirm, onUpdate }: { onConfirm(): void; onUpdate?(): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <div className="host-foot">
      <button className="btn-text" onClick={() => (armed ? onConfirm() : setArmed(true))}>
        {armed ? "Click again to remove" : "Remove host"}
      </button>
      {armed && <span className="muted small">Its sessions keep running there.</span>}
      {onUpdate && !armed && (
        <button className="btn-text" onClick={onUpdate} title="Install the latest Switchyard there and restart it">
          Update Switchyard
        </button>
      )}
    </div>
  );
}

/** `user@box.tailnet.ts.net` → `box`. */
const nameFromDestination = (dest: string) => dest.trim().replace(/^.*@/, "").split(".")[0] ?? "";

function AddHost({ actions, errorCount, onDone }: { actions: Actions; errorCount: number; onDone(): void }) {
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("47717");
  const [more, setMore] = useState(false);
  const [direct, setDirect] = useState(false);
  const [url, setUrl] = useState("");
  const [sent, setSent] = useState(false);
  // An error from yardd keeps the form open with what was typed.
  useEffect(() => setSent(false), [errorCount]);
  useEffect(() => {
    if (sent) onDone();
  }, [sent]);
  const finalName = (name.trim() || (direct ? "" : nameFromDestination(destination))).trim();
  const ready = finalName && (direct ? url.trim() : destination.trim());
  const submit = () => {
    if (!ready) return;
    actions.addHost(
      direct
        ? { name: finalName, kind: "direct", url: url.trim() }
        : { name: finalName, kind: "ssh", destination: destination.trim(), remotePort: Number(port) || 47717 },
    );
    setSent(true);
  };
  return (
    <section className="host-card add-host" aria-label="Add host">
      <h2>Add a host</h2>
      <div className="muted small">
        Run sessions on another machine you can <code>ssh</code> into without a password. If Switchyard isn't there yet, you can install it from
        here next.
      </div>
      {!direct && (
        <input
          className="field"
          autoFocus
          type="text"
          placeholder="user@machine"
          aria-label="SSH destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          spellCheck={false}
        />
      )}
      {more && (
        <div className="form-grid">
          <label htmlFor="host-name">Name</label>
          <input id="host-name" type="text" placeholder={nameFromDestination(destination) || "devbox"} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          {direct ? (
            <>
              <label htmlFor="host-url">URL</label>
              <input id="host-url" type="text" placeholder="ws://127.0.0.1:47726/ws" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </>
          ) : (
            <>
              <label htmlFor="host-port">Remote port</label>
              <input id="host-port" type="text" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
            </>
          )}
          <span />
          <label className="check small">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
            Direct WebSocket URL, for testing
          </label>
        </div>
      )}
      <div className="row">
        <button className="btn-primary" disabled={!ready} onClick={submit}>
          Add {finalName || "host"}
        </button>
        <button className="btn-text" onClick={onDone}>
          Cancel
        </button>
        <span className="spacer" />
        {!more && (
          <button className="btn-text" onClick={() => setMore(true)}>
            Options
          </button>
        )}
      </div>
    </section>
  );
}

function Hosts({ state, actions }: { state: State; actions: Actions }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="hosts">
      <header className="bar">
        <h1>Hosts</h1>
        <span className="spacer" />
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            <Icon d={PLUS} size={13} />
            Add host
          </button>
        )}
      </header>
      <div className="scroll">
        <div className="hosts-inner">
          {adding && <AddHost actions={actions} errorCount={state.errorCount} onDone={() => setAdding(false)} />}
          <HostCard state={state} id="local" />
          {state.hosts.map((h) => (
            <HostCard
              key={h.id}
              state={state}
              id={h.id}
              onRemove={() => actions.removeHost(h.id)}
              onInstall={h.kind === "ssh" ? () => actions.installHost(h.id) : undefined}
            />
          ))}
          {state.hosts.length === 0 && !adding && (
            <button className="host-empty" onClick={() => setAdding(true)}>
              <Icon d={CLOUD} size={16} />
              <span>
                <strong>Run sessions on another machine</strong>
                <span className="muted small">A server or desktop you reach over SSH. Its sessions show up here next to this one's.</span>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
