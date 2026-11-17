import { useEffect, useRef, useState } from "react";
import { Composer, Icon, Markdown, MenuButton, ModelPicker } from "./App";
import { hostName, type Actions, type State } from "./store";
import type { SwitchyTurn } from "./protocol";
import { switchyScope } from "./switchy";

const SPARK = "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z";
const SERVER = "M4 3h16v7H4ZM4 14h16v7H4ZM7 6h.01M7 17h.01";
const questions = [
  "What’s happening on my server?",
  "What changed since yesterday?",
  "Where is the API deployed?",
];

function Answer({ turn }: { turn: SwitchyTurn }) {
  return (
    <article className="assistant-answer">
      <div className="assistant-question">{turn.question}</div>
      <div className="assistant-answer-label">
        <Icon d={SPARK} />
        <strong>Switchy</strong>
        <span className="muted small">{turn.model}</span>
      </div>
      {turn.answer && (
        <div className="prose">
          <Markdown text={turn.answer} />
        </div>
      )}
      {turn.status === "collecting" && (
        <p className="muted" role="status">
          Checking your hosts…
        </p>
      )}
      {turn.status === "answering" && (
        <p className="muted small" role="status">
          Answering…
        </p>
      )}
      {turn.error && (
        <p className="bad" role="alert">
          {turn.error}
        </p>
      )}
      {!!turn.sources.length && (
        <details className="assistant-source-list">
          <summary>
            {turn.sources.length} sources ·{" "}
            {new Date(turn.at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </summary>
          {turn.sources.map((source) => (
            <details key={source.id} className="assistant-evidence">
              <summary>
                <span className={source.unavailable ? "warn" : ""}>
                  [{source.id}] {source.title}
                  {source.unavailable ? " · unavailable" : ""}
                </span>
              </summary>
              <span className="muted small">
                Checked {new Date(source.at).toLocaleString()}
              </span>
              <pre>{source.text}</pre>
            </details>
          ))}
          {turn.coverage.map((line, i) => (
            <p className="muted small" key={i}>
              {line}
            </p>
          ))}
        </details>
      )}
    </article>
  );
}

export function AssistantPage({
  state,
  actions,
}: {
  state: State;
  actions: Actions;
}) {
  const conversation = state.switchy;
  const [selection, setSelection] = useState<string | null>(null);
  const [chosenScope, setScope] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const sending = useRef(false);
  const choices = (["codex", "claude"] as const).flatMap((engine) =>
    (state.models.local?.[engine] ?? []).map((m) => ({
      value: `${engine}:${m.id}`,
      engine,
      model: m.id,
    })),
  );
  const preferred =
    selection ??
    (conversation ? `${conversation.engine}:${conversation.model}` : "");
  const current = choices.find((c) => c.value === preferred) ?? choices[0];
  const busy = pending || (!!conversation && conversation.status !== "idle");
  const hosts = ["local", ...state.hosts.map((h) => h.id)];
  const scope = switchyScope(chosenScope, conversation?.scope, hosts);
  const turns = conversation?.turns ?? [];
  useEffect(() => {
    if (state.connected) actions.post({ op: "switchy.get" });
  }, [state.connected, state.hostEpoch, actions]);
  useEffect(() => {
    if (nearBottom.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [conversation?.revision]);
  async function ask(text: string) {
    if (
      !text.trim() ||
      !current ||
      busy ||
      sending.current ||
      !state.connected ||
      !conversation
    )
      return false;
    sending.current = true;
    setPending(true);
    setError("");
    nearBottom.current = true;
    try {
      const reply = await actions.switchySend(
        text.trim(),
        current.engine,
        current.model,
        scope,
      );
      if (reply.error) {
        setError(reply.error);
        return false;
      }
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not send your question.",
      );
      return false;
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return (
    <div className="assistant-page">
      <header className="bar">
        <MenuButton />
        <Icon d={SPARK} />
        <h1>Switchy</h1>
        <span className="spacer" />
        <label className="assistant-scope">
          <Icon d={SERVER} />
          <select
            aria-label="Host scope"
            value={scope}
            disabled={busy}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="all">All hosts</option>
            {hosts.map((id) => (
              <option key={id} value={id}>
                {hostName(state, id)}
              </option>
            ))}
          </select>
        </label>
        {busy && (
          <button
            className="btn"
            disabled={!state.connected}
            onClick={() => actions.post({ op: "switchy.stop" })}
          >
            Stop
          </button>
        )}
        <button
          className="btn-text"
          onClick={() => setContextOpen(!contextOpen)}
          aria-expanded={contextOpen}
        >
          Context
        </button>
      </header>
      <div className="assistant-layout">
        <main className="assistant-conversation">
          <div
            className="assistant-scroll"
            ref={scroll}
            onScroll={() => {
              const el = scroll.current;
              if (el)
                nearBottom.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            }}
          >
            <div className="assistant-content">
              {state.switchyTotal > turns.length && (
                <p className="muted small">
                  Showing the latest {turns.length} exchanges. Older
                  conversation remains searchable by Switchy.
                </p>
              )}
              {!conversation ? (
                <p className="muted" role="status">
                  {state.connected ? "Loading Switchy…" : "Reconnecting…"}
                </p>
              ) : !turns.length ? (
                <div className="assistant-welcome">
                  <h2>What would you like to know?</h2>
                  <p>Ask Switchy about your servers and your work.</p>
                  <div className="assistant-suggestions">
                    {questions.map((q) => (
                      <button
                        className="btn-text"
                        key={q}
                        disabled={busy || !current || !state.connected}
                        onClick={() => void ask(q)}
                      >
                        <span>{q}</span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                turns.map((turn) => <Answer key={turn.id} turn={turn} />)
              )}
            </div>
          </div>
          <div className="assistant-compose-wrap">
            <Composer
              placeholder="Ask about your servers or your work…"
              rows={1}
              draft="switchy"
              target={{ host: "local" }}
              maxLength={8000}
              busy={busy || !current || !state.connected || !conversation}
              onSubmit={ask}
            >
              {current && (
                <ModelPicker
                  models={state.models.local ?? {}}
                  engines={["codex", "claude"]}
                  value={{
                    engine: current.engine,
                    model: current.model,
                    effort: "low",
                  }}
                  onChange={(choice) =>
                    setSelection(`${choice.engine}:${choice.model}`)
                  }
                />
              )}
            </Composer>
            {error && (
              <p className="assistant-notice bad" role="alert">
                {error}
              </p>
            )}
            <p className="assistant-disclaimer">
              Answers use selected host evidence. Expand sources to see what was
              checked.
            </p>
          </div>
        </main>
        <aside
          className={`assistant-context ${contextOpen ? "is-open" : ""}`}
          aria-label="Server context"
        >
          <div className="assistant-context-title">
            <h2>In reach</h2>
          </div>
          <p className="muted">
            Context from your machines, beyond your sessions.
          </p>
          {hosts.map((id) => {
            const online =
              id === "local"
                ? state.connected
                : state.hosts.find((h) => h.id === id)?.status === "connected";
            return (
              <div className="assistant-host" key={id}>
                <div className="row">
                  <Icon d={SERVER} />
                  <strong>{hostName(state, id)}</strong>
                  <span className="spacer" />
                  <span className={online ? "assistant-online" : "muted small"}>
                    {online ? "Online" : "Offline"}
                  </span>
                </div>
              </div>
            );
          })}
          <h3>WHAT IT CAN LOOK UP</h3>
          <div className="assistant-inventory">
            {[
              "Processes & host resources",
              "Services, containers & ports",
              "Repositories & recent commits",
              "Saved terminal activity",
              "Switchyard conversations",
            ].map((label) => (
              <div key={label}>{label}</div>
            ))}
          </div>
          <div className="assistant-context-note">
            Context is collected when you ask. Unavailable sources and offline
            hosts are identified in each answer’s sources. Shell history may not
            include open terminals.
          </div>
          <div className="assistant-context-note">
            Models run on {hostName(state, "local")} using the default account.
            Claude and Codex are supported. Host scope controls which machines
            supply context.
          </div>
        </aside>
      </div>
    </div>
  );
}
