import { useState } from "react";
import { Icon, MenuButton } from "./App";

const SPARK = "M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z";
const SERVER = "M4 3h16v7H4ZM4 14h16v7H4ZM7 6h.01M7 17h.01";
const questions = [
  "What’s happening on my server?",
  "What changed since yesterday?",
  "Where is the API deployed?",
];
const examples = [
  {
    title: "Your server is healthy. One build is keeping it busy.",
    body: "On dev-server, the Switchyard build is using most of the CPU. Memory still has room, and all three application services are running.",
    detail:
      "The activity comes from a terminal outside a Switchyard session. The API container was restarted 24 minutes ago and its health check is passing.",
    sources: [
      "Processes · dev-server · just now",
      "Containers · api · just now",
      "Terminal activity · 3 min ago",
    ],
    evidence: [
      "cargo build -p yardd · 184% CPU\nWorking directory: ~/projects/switchyard\nParent: interactive shell",
      "api · running · healthy\nRestarted: 24 minutes ago\nPort: 8080 → 3000",
      "~/projects/switchyard\nBuild started from an interactive terminal.\nNo associated Switchyard session.",
    ],
  },
  {
    title: "Two deployments and a new branch since yesterday.",
    body: "The API was redeployed on dev-server, and the worker service picked up a configuration change. Your Switchyard repository also has a new assistant-design branch.",
    detail:
      "The deployment activity was outside Switchyard. The repository change is linked to your current worktree. No failed services appear in this sample snapshot.",
    sources: [
      "Service journal · dev-server",
      "Git · switchyard",
      "Containers · dev-server",
    ],
    evidence: [
      "api.service · restart completed\nworker.service · configuration reloaded",
      "Repository: ~/projects/switchyard\nBranch: assistant-design",
      "api · healthy\nworker · running\npostgres · healthy",
    ],
  },
  {
    title: "The API runs in a container on dev-server.",
    body: "The api container exposes port 8080 on the host and forwards it to port 3000 inside the container. Its Compose project lives at ~/services/api.",
    detail:
      "The service is healthy in this sample. Its source repository is ~/projects/api; the deployment directory and the development checkout are separate.",
    sources: ["Containers · api", "File · compose.yaml", "Repository · api"],
    evidence: [
      "Container: api\nHost: dev-server\nPorts: 8080 → 3000",
      "~/services/api/compose.yaml\nService: api\nRestart policy: unless-stopped",
      "~/projects/api\nBranch: main",
    ],
  },
];

/** An interactive design study. No host inspection or model requests are made. */
export function AssistantPage() {
  const [question, setQuestion] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [asked, setAsked] = useState("");
  const [source, setSource] = useState<number | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [scope, setScope] = useState("All hosts");
  const [notice, setNotice] = useState("");
  const example = selected === null ? null : examples[selected];
  function ask(text: string) {
    const index = questions.indexOf(text);
    if (index < 0) {
      setNotice(
        "This is a design preview. Choose an example question to explore an answer; live questions aren’t connected yet.",
      );
      return;
    }
    setSelected(index);
    setAsked(text);
    setQuestion("");
    setSource(null);
    setNotice("");
  }
  return (
    <div className="assistant-page">
      <header className="bar">
        <MenuButton />
        <Icon d={SPARK} />
        <h1>Assistant</h1>
        <span className="assistant-preview">Design preview</span>
        <span className="spacer" />
        <button
          className="btn-text"
          onClick={() => setContextOpen(!contextOpen)}
          aria-expanded={contextOpen}
        >
          Server context
        </button>
      </header>
      <div className="assistant-layout">
        <main className="assistant-conversation">
          <div className="assistant-scroll">
            <div className="assistant-content">
              {!example ? (
                <div className="assistant-welcome">
                  <div className="assistant-emblem">
                    <Icon d={SPARK} size={24} width={1.5} />
                  </div>
                  <span className="assistant-eyebrow">
                    YOUR WORK. YOUR MACHINES.
                  </span>
                  <h2>Ask across your hosts.</h2>
                  <p>
                    From a running service to something you worked on yesterday.
                    <br />{" "}A quick answer, with the context already in reach.
                  </p>
                  <div className="assistant-suggestions">
                    {questions.map((q, i) => (
                      <button className="btn-text" key={q} onClick={() => ask(q)}>
                        <span className="muted small">0{i + 1}</span>
                        <span>{q}</span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                  <div className="assistant-reach">
                    <Icon d={SERVER} /> Services, containers, repositories &
                    sessions
                  </div>
                </div>
              ) : (
                <div className="assistant-answer">
                  <div className="assistant-question">{asked}</div>
                  <div className="assistant-answer-label">
                    <Icon d={SPARK} />
                    <strong>Assistant</strong>
                    <span className="muted small">Example answer</span>
                  </div>
                  <p className="assistant-checked">
                    Checked processes, services and recent activity
                  </p>
                  <h2>{example.title}</h2>
                  <p>{example.body}</p>
                  <p>{example.detail}</p>
                  <div className="assistant-sources">
                    {example.sources.map((s, i) => (
                      <button
                        className={`btn ${source === i ? "selected" : ""}`}
                        key={s}
                        onClick={() => setSource(source === i ? null : i)}
                        aria-expanded={source === i}
                      >
                        <span className="muted">{i + 1}</span> {s}
                      </button>
                    ))}
                  </div>
                  {source !== null && (
                    <div className="assistant-evidence">
                      <div className="row">
                        <strong>Source {source + 1}</strong>
                        <span className="muted small">Sample evidence</span>
                      </div>
                      <pre>{example.evidence[source]}</pre>
                    </div>
                  )}
                  <button
                    className="btn-quiet"
                    onClick={() => {
                      setSelected(null);
                      setSource(null);
                    }}
                  >
                    ← Explore another question
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="assistant-compose-wrap">
            <form
              className="assistant-compose"
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) ask(question.trim());
              }}
            >
              <textarea
                aria-label="Ask Assistant"
                placeholder="Ask about your servers or your work…"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    if (question.trim()) ask(question.trim());
                  }
                }}
              />
              <div className="row">
                <label className="assistant-scope">
                  <Icon d={SERVER} />
                  <select
                    aria-label="Host scope"
                    value={scope}
                    onChange={(e) => {
                      setScope(e.target.value);
                      setNotice(
                        "Host selection is a preview control. Example answers use the same sample server data.",
                      );
                    }}
                  >
                    <option>All hosts</option>
                    <option>dev-server</option>
                    <option>MacBook Pro</option>
                  </select>
                </label>
                <span className="muted small">Read only</span>
                <span className="spacer" />
                <button
                  className="btn-primary"
                  type="submit"
                  aria-label="Send question"
                  disabled={!question.trim()}
                >
                  ↑
                </button>
              </div>
            </form>
            {notice && (
              <p className="assistant-notice" role="status">
                {notice}
              </p>
            )}
            <p className="assistant-disclaimer">
              Sample data · No hosts are being inspected in this preview.
            </p>
          </div>
        </main>
        <aside
          className={`assistant-context ${contextOpen ? "is-open" : ""}`}
          aria-label="Server context"
        >
          <div className="assistant-context-title">
            <h2>In reach</h2>
            <span className="assistant-preview">Sample</span>
          </div>
          <p className="muted">
            Context from your machines,
            <br />
            beyond your sessions.
          </p>
          <div className="assistant-host">
            <div className="row">
              <Icon d={SERVER} />
              <strong>dev-server</strong>
              <span className="spacer" />
              <span className="assistant-online">Online</span>
            </div>
            <span className="muted small">Linux · last checked just now</span>
            <div className="assistant-metrics">
              <div>
                <strong>
                  38<span>%</span>
                </strong>
                <span>CPU</span>
              </div>
              <div>
                <strong>
                  6.2<span> / 16 GB</span>
                </strong>
                <span>Memory</span>
              </div>
            </div>
          </div>
          <div className="assistant-host">
            <div className="row">
              <Icon d="M4 4h16v12H4ZM2 20h20" />
              <strong>MacBook Pro</strong>
              <span className="spacer" />
              <span className="assistant-online">Online</span>
            </div>
            <span className="muted small">
              This machine · last checked just now
            </span>
          </div>
          <h3>WHAT IT CAN LOOK UP</h3>
          <div className="assistant-inventory">
            {[
              ["Services & containers", "3 healthy"],
              ["Repositories & files", "8 projects"],
              ["Terminal activity", "Recent commands"],
              ["Switchyard sessions", "12 sessions"],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <span className="muted small">{value}</span>
              </div>
            ))}
          </div>
          <h3>RECENT ON DEV-SERVER</h3>
          <div className="assistant-activity">
            <span className="assistant-activity-dot" />
            <div>
              <strong>Build started</strong>
              <p>switchyard · interactive terminal</p>
              <span>3 minutes ago · outside Switchyard</span>
            </div>
          </div>
          <div className="assistant-activity">
            <span className="assistant-activity-dot" />
            <div>
              <strong>API container restarted</strong>
              <p>api · health check passing</p>
              <span>24 minutes ago</span>
            </div>
          </div>
          <div className="assistant-context-note">
            Relevant context is fetched when you ask. Answers show what was
            checked and where it came from.
          </div>
        </aside>
      </div>
    </div>
  );
}
