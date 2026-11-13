import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChangedFile, Changes, Engine, Host, Item, ModelInfo, Models, SessionMeta, Status, Usage } from "./protocol";
import { useYard, type Actions, type State } from "./store";
import { TerminalPane } from "./TerminalPane";

const ENGINE_NAME: Record<Engine, string> = { claude: "Claude", codex: "Codex" };
/** What each engine does before acting, as yardd starts it today. */
const PERMISSION_NOTE: Record<Engine, string> = {
  claude: "Asks before commands and edits",
  codex: "Sandboxed to the folder, asks to go further",
};
const STATUS_LABEL: Record<Status, string> = {
  idle: "Idle",
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

/* ---------- app shell ---------- */

export function App() {
  const { state, actions } = useYard();
  const { route } = state;
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
        {route.page === "new" && <NewSession state={state} actions={actions} />}
        {route.page === "hosts" && <Hosts host={state.host} />}
        {route.page === "session" && state.sessions[route.id] && (
          <SessionView key={route.id} meta={state.sessions[route.id]} state={state} actions={actions} />
        )}
      </div>
    </div>
  );
}

function Sidebar({ state, actions }: { state: State; actions: Actions }) {
  const sessions = Object.values(state.sessions).sort((a, b) => b.createdAt - a.createdAt);
  const { route, host } = state;
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
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-row ${route.page === "session" && route.id === s.id ? "active" : ""}`}
            onClick={() => actions.go({ page: "session", id: s.id })}
          >
            <span className={`dot dot-${s.status}`} aria-hidden="true" />
            <span className="session-text">
              <span className="session-title">{s.title}</span>
              <span className="session-sub">
                {modelName(state.models, s.engine, s.model)} · {STATUS_LABEL[s.status]}
              </span>
            </span>
          </button>
        ))}
        {sessions.length === 0 && <div className="empty">No sessions yet.</div>}
      </div>
      <div className="sidebar-bottom">
        <button className={`host-row ${route.page === "hosts" ? "active" : ""}`} onClick={() => actions.go({ page: "hosts" })}>
          <span>{host?.name ?? "This Mac"}</span>
          <span className="spacer" />
          {host && (
            <code className={hostPressure(host) ? "warn" : ""}>
              CPU {pct(host.cpu)} · Mem {pct((host.memUsed / host.memTotal) * 100)}
            </code>
          )}
        </button>
      </div>
    </nav>
  );
}

/** Load above the core count or under 10% memory left. */
const hostPressure = (h: Host) => h.load > h.cores || h.memUsed / h.memTotal > 0.9;

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

function ModelPicker(props: {
  models: Models;
  usage: Usage;
  value: Choice;
  engines: Engine[];
  onChange(next: Choice): void;
}) {
  const { models, usage, value, engines, onChange } = props;
  const [open, setOpen] = useState(false);
  const current = models[value.engine]?.find((m) => m.id === value.model);
  return (
    <div className="picker">
      <button className="btn-quiet" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{current?.name ?? value.model}</span>
        <span className="muted">{capitalize(value.effort)}</span>
        <span className="muted">
          <Icon d={CHEVRON_DOWN} size={12} />
        </span>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="popover">
            {engines.map((engine) => (
              <div key={engine} className="picker-group">
                <div className="picker-head">
                  <span>{ENGINE_NAME[engine]}</span>
                  <span>{usageText(engine, usage)}</span>
                </div>
                {models[engine].length === 0 && <div className="picker-empty">Not available</div>}
                {models[engine].map((m) => (
                  <button
                    key={m.id}
                    className={`picker-item ${engine === value.engine && m.id === value.model ? "active" : ""}`}
                    onClick={() => {
                      onChange({ engine, model: m.id, effort: effortFor(m, value.effort) });
                      setOpen(false);
                    }}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            ))}
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

function Composer(props: {
  placeholder: string;
  rows: number;
  large?: boolean;
  busy?: boolean;
  /** Keep the text after sending, for a submit that can still fail. */
  keepText?: boolean;
  onSubmit(text: string): void;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  // Start one line tall and grow with the text, up to a cap.
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);
  const submit = () => {
    const value = text.trim();
    if (!value || props.busy) return;
    props.onSubmit(value);
    if (!props.keepText) setText("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div className={`composer ${props.large ? "composer-large" : ""}`}>
      <textarea
        ref={area}
        aria-label="Message"
        rows={props.rows}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <div className="composer-row">
        {props.children}
        <span className="spacer" />
        <button className="send" aria-label="Send" disabled={!text.trim() || props.busy} onClick={submit}>
          <Icon d={ARROW_UP} width={2.5} />
        </button>
      </div>
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

function NewSession({ state, actions }: { state: State; actions: Actions }) {
  const [choice, setChoice] = useState<Choice>(() => loadChoice(state.models));
  const [cwd, setCwd] = useState(() => localStorage.getItem("yard.cwd") ?? "");
  const [worktree, setWorktree] = useState(() => localStorage.getItem("yard.worktree") === "1");
  const [branch, setBranch] = useState("");
  // From send until yardd answers. On success this page is replaced by the
  // session; on failure the task stays in the box so nothing is retyped.
  const [pending, setPending] = useState(false);
  useEffect(() => setPending(false), [state.errorCount, state.connected]);
  // Models and the home folder arrive after the first render.
  useEffect(() => {
    if (!choice.model) setChoice(loadChoice(state.models));
  }, [state.models]);
  useEffect(() => {
    if (!cwd && state.home) setCwd(state.home);
  }, [state.home]);

  const recent = useMemo(
    () => [...new Set(Object.values(state.sessions).map((s) => s.cwd))].slice(0, 8),
    [state.sessions],
  );

  const start = (text: string) => {
    const folder = cwd.trim().replace(/^~(?=\/|$)/, state.home);
    localStorage.setItem("yard.choice", JSON.stringify(choice));
    localStorage.setItem("yard.cwd", folder);
    localStorage.setItem("yard.worktree", worktree ? "1" : "0");
    setPending(true);
    actions.create({ ...choice, cwd: folder, text, worktree, branch: branch.trim() || undefined });
  };

  return (
    <div className="new">
      <div className="new-inner">
        <h1>What should we work on?</h1>
        <Composer placeholder="Describe the task" rows={1} large keepText onSubmit={start} busy={pending || !state.connected || !choice.model}>
          <ModelPicker models={state.models} usage={state.usage} value={choice} engines={["claude", "codex"]} onChange={setChoice} />
          <span className="muted small">{PERMISSION_NOTE[choice.engine]}</span>
        </Composer>
        <div className="new-options">
          <label htmlFor="cwd" className="muted">
            Folder
          </label>
          <input id="cwd" type="text" list="recent-folders" value={cwd} onChange={(e) => setCwd(e.target.value)} spellCheck={false} />
          <datalist id="recent-folders">
            {recent.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
        <div className="new-options">
          <span className="check">
            <input id="worktree" type="checkbox" checked={worktree} onChange={(e) => setWorktree(e.target.checked)} />
            <label htmlFor="worktree">New worktree</label>
          </span>
          {worktree && (
            <>
              <label htmlFor="branch" className="muted">
                Branch
              </label>
              <input
                id="branch"
                type="text"
                placeholder="Named from the task if left empty"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                spellCheck={false}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- session ---------- */

function SessionView({ meta, state, actions }: { meta: SessionMeta; state: State; actions: Actions }) {
  const thread = state.threads[meta.id];
  const items = thread?.items ?? [];
  const changes = state.changes[meta.id];
  const busy = meta.status === "running" || meta.status === "needs_approval";

  // Stick to the bottom while new items arrive, unless the user scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  // The working tree has probably changed whenever a turn ends.
  const last = useRef(meta.status);
  useEffect(() => {
    if (last.current !== "idle" && meta.status === "idle") actions.loadChanges(meta.id);
    last.current = meta.status;
  }, [meta.status]);

  const lastItem = items[items.length - 1];
  const showWorking = meta.status === "running" && !(lastItem?.kind === "assistant" && lastItem.streaming);

  return (
    <div className="session">
      <main className="thread">
        <header className="bar">
          <h1>{meta.title}</h1>
          <code className="muted">{meta.branch || changes?.branch || tilde(meta.cwd, state.home)}</code>
          <span className="spacer" />
          {busy && (
            <button className="btn-text" onClick={() => actions.interrupt(meta.id)}>
              Stop
            </button>
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
              <ItemView key={item.key} item={item} onDecide={(id, d) => actions.approve(meta.id, id, d)} />
            ))}
            {showWorking && <div className="working">Working</div>}
          </div>
        </div>
        <div className="dock">
          <Composer placeholder="Reply" rows={1} busy={busy || !state.connected} onSubmit={(text) => actions.send(meta.id, text)}>
            <ModelPicker
              models={state.models}
              usage={state.usage}
              value={{ engine: meta.engine, model: meta.model, effort: meta.effort }}
              engines={[meta.engine]}
              onChange={(c) => actions.setModel(meta.id, c.model, c.effort)}
            />
            <span className="muted small">{PERMISSION_NOTE[meta.engine]}</span>
          </Composer>
        </div>
      </main>
      <WorkPane sessionId={meta.id} changes={changes} connected={state.connected} actions={actions} />
    </div>
  );
}

function ItemView({ item, onDecide }: { item: Item; onDecide(requestId: string, decision: "allow" | "allow_always" | "deny"): void }) {
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case "user":
      return <div className="bubble">{item.text}</div>;
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
function WorkPane(props: { sessionId: string; changes: Changes | undefined; connected: boolean; actions: Actions }) {
  const { sessionId, changes, connected, actions } = props;
  const [tab, setTab] = useState<"changes" | "terminal">("changes");
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
        <span className="spacer" />
        {tab === "changes" && (
          <button className="btn-icon" aria-label="Refresh changes" onClick={() => actions.loadChanges(sessionId)}>
            <Icon d={REFRESH} />
          </button>
        )}
      </header>
      {terminalUsed && <TerminalPane sessionId={sessionId} connected={connected} visible={tab === "terminal"} actions={actions} />}
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

function Meter({ label, value, detail, warn }: { label: string; value: number; detail: string; warn?: boolean }) {
  return (
    <div className="meter">
      <div className="meter-head">
        <span>{label}</span>
        <code className={warn ? "warn" : "muted"}>{detail}</code>
      </div>
      <span className="track" aria-hidden="true">
        <span className={`fill ${warn ? "fill-warn" : ""}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </span>
    </div>
  );
}

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

function Hosts({ host }: { host: Host | null }) {
  return (
    <div className="hosts">
      <header className="bar">
        <h1>Hosts</h1>
      </header>
      <div className="scroll">
        <div className="hosts-inner">
          {!host && <div className="muted">Waiting for the first sample.</div>}
          {host && (
            <section className="host-card" aria-label={host.name}>
              <div className="host-head">
                <h2>{host.name}</h2>
                <span className={hostPressure(host) ? "warn" : "muted"}>{hostPressure(host) ? "Under pressure" : "Healthy"}</span>
              </div>
              <Meter label="CPU" value={host.cpu} detail={`${pct(host.cpu)} · load ${host.load.toFixed(1)} of ${host.cores}`} warn={host.load > host.cores} />
              <Meter
                label="Memory"
                value={(host.memUsed / host.memTotal) * 100}
                detail={`${gb(host.memUsed)} of ${gb(host.memTotal)} GB`}
                warn={host.memUsed / host.memTotal > 0.9}
              />
              <Meter
                label="Disk"
                value={host.diskTotal ? (host.diskUsed / host.diskTotal) * 100 : 0}
                detail={`${gb(host.diskUsed)} of ${gb(host.diskTotal)} GB`}
                warn={host.diskTotal > 0 && host.diskUsed / host.diskTotal > 0.9}
              />
              <Sparkline values={host.cpuHistory} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
