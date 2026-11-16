// The Connectors page: every MCP server (claude.ai connectors, plugins,
// config files, ChatGPT apps) each engine account can use on each host, whether
// it works, and a way to sign it in. Opening the page asks yardd to list them;
// for Claude that starts Claude Code with no prompt, so it spends no usage.
import { useEffect, useState } from "react";
import { accountChoices, DEFAULT_ACCOUNT } from "./accounts";
import { actionFor, displayName, missingFromCatalog, newServerProblem, removable, shortError, sortServers, STATUS_LABEL, summary } from "./connectors";
import type { Engine, McpServer } from "./protocol";
import { accountsOn, hostName, hostOnline, mcpAuthKey, mcpKey, type Actions, type State } from "./store";
import { Cloud, ENGINE_NAME, Icon, MenuButton, PLUS } from "./App";

const REFRESH = "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5";
const ENGINES: Engine[] = ["claude", "codex"];

export function ConnectorsPage({ state, actions }: { state: State; actions: Actions }) {
  const hosts = ["local", ...state.hosts.map((h) => h.id)].filter((h) => hostOnline(state, h));
  const targets = hosts.flatMap((host) =>
    ENGINES.filter((engine) => state.engines[host]?.[engine]?.installed !== false).flatMap((engine) =>
      accountChoices(accountsOn(state, host), engine).map((a) => ({ host, engine, account: a.id, accountName: a.name })),
    ),
  );
  const key = targets.map((t) => mcpKey(t.host, t.engine, t.account)).join("|");
  const refresh = () => targets.forEach((t) => actions.mcpStatus(t.host, t.engine, t.account));
  // List again whenever the page opens or a host or account appears.
  useEffect(refresh, [key]);
  const loading = targets.some((t) => state.mcp[mcpKey(t.host, t.engine, t.account)]?.loading);

  return (
    <div className="hosts connectors">
      <header className="bar">
        <MenuButton />
        <h1>Connectors</h1>
        <span className="spacer" />
        <button className="btn" onClick={refresh} disabled={loading}>
          <Icon d={REFRESH} size={13} />
          {loading ? "Checking…" : "Check again"}
        </button>
      </header>
      <div className="scroll">
        <div className="hosts-inner">
          <p className="muted connectors-intro">
            The MCP servers each engine account has on each host: claude.ai connectors, plugins, config files and ChatGPT apps. A session can use a server once it shows
            Connected here; one that needs sign-in fails until you connect it.
          </p>
          {hosts.map((host) => (
            <section key={host} className="connectors-host" aria-label={hostName(state, host)}>
              <h2 className="connectors-host-name">
                {hostName(state, host)}
                {host !== "local" && <Cloud size={13} />}
              </h2>
              {targets
                .filter((t) => t.host === host)
                .map((t) => (
                  <AccountCard key={mcpKey(t.host, t.engine, t.account)} state={state} actions={actions} {...t} />
                ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountCard(props: { state: State; actions: Actions; host: string; engine: Engine; account: string; accountName: string }) {
  const { state, actions, host, engine, account } = props;
  const status = state.mcp[mcpKey(host, engine, account)];
  const engineState = account === DEFAULT_ACCOUNT ? state.engines[host]?.[engine] : state.engines[host]?.accounts?.[account];
  const servers = sortServers(status?.servers ?? []);
  const added = account !== DEFAULT_ACCOUNT;
  return (
    <div className="host-card connectors-card">
      <div className="connectors-card-head">
        <strong>{ENGINE_NAME[engine]}</strong>
        <span className="muted">· {props.accountName}</span>
        <span className="spacer" />
        <span className="muted small">{status?.loading && !status.servers ? "Checking…" : status?.servers ? summary(servers) : ""}</span>
      </div>
      {engineState?.loggedIn === false && <div className="muted small connectors-note">Not logged in, so its connectors cannot be listed. Log in on the Hosts page first.</div>}
      {status?.error && <div className="bad small connectors-note">{status.error}</div>}
      {added && engine === "claude" && (
        <div className="muted small connectors-note">
          An added account has its own Claude Code folder: its claude.ai connectors come with its login, but plugins and servers from your Default setup are not shared. Add the ones it needs here.
        </div>
      )}
      {status?.servers && servers.length === 0 && <div className="muted small connectors-note">No MCP servers for this account.</div>}
      {servers.length > 0 && (
        <ul className="connector-list">
          {servers.map((s) => (
            <ServerRow key={s.name} server={s} {...props} />
          ))}
        </ul>
      )}
      {status?.servers && engineState?.loggedIn !== false && <AddConnector {...props} servers={servers} />}
    </div>
  );
}

function ServerRow({ server: s, state, actions, host, engine, account }: { server: McpServer; state: State; actions: Actions; host: string; engine: Engine; account: string }) {
  const { name, via } = displayName(s);
  const auth = state.mcpAuth[mcpAuthKey(host, engine, account, s.name)];
  const action = actionFor(s);
  const signIn = () => actions.mcpAuth(host, engine, account, s.name);
  const change = state.mcpChange[mcpAuthKey(host, engine, account, s.name)];
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="connector">
      <div className="connector-row">
        <span className="connector-id">
          <span className={`dot connector-dot-${s.status}`} aria-hidden="true" />
          <span className="connector-name">{name}</span>
          <span className="muted small connector-via">{via}</span>
          {s.appTools > 0 && (
            <span className="connector-badge" title="Some of its tools come with a widget, such as a chart, shown in the thread">
              widgets
            </span>
          )}
        </span>
        <span className="connector-side">
          {s.status === "connected" && s.tools > 0 && <span className="muted small">{s.tools} {s.tools === 1 ? "tool" : "tools"}</span>}
          <span className={`connector-status connector-status-${s.status}`}>{STATUS_LABEL[s.status] ?? s.status}</span>
          {action === "connect" && !auth && (
            <button className="btn btn-small" onClick={signIn}>
              Connect
            </button>
          )}
          {action === "open" && s.installUrl && (
            <a className="btn btn-small" href={s.installUrl} target="_blank" rel="noreferrer">
              Connect on ChatGPT
            </a>
          )}
          {action === "retry" && (
            <button className="btn btn-small" onClick={() => actions.mcpReconnect(host, engine, account, s.name)}>
              Retry
            </button>
          )}
          {removable(s) &&
            (change?.state === "removing" ? (
              <span className="muted small">Removing…</span>
            ) : (
              <button
                className={`btn-text btn-small ${confirm ? "bad" : ""}`}
                onClick={() => (confirm ? actions.mcpRemove(host, engine, account, s.name) : setConfirm(true))}
                onBlur={() => setConfirm(false)}
                aria-label={confirm ? `Confirm removing ${name}` : `Remove ${name}`}
              >
                {confirm ? "Confirm" : "Remove"}
              </button>
            ))}
        </span>
      </div>
      {change?.state === "failed" && <div className="bad small connector-error">{change.error}</div>}
      {s.status === "failed" && s.error && <div className="muted small connector-error">{shortError(s.error)}</div>}
      {auth && <SignIn host={host} hostLabel={hostName(state, host)} auth={auth} onRetry={signIn} onPaste={(url) => actions.mcpCallback(host, engine, account, s.name, url)} onClose={() => actions.mcpAuthClear(host, engine, account, s.name)} />}
    </li>
  );
}

/** The page is served by the yardd on this very machine (the desktop app, or
 *  a browser on the host itself), so a sign-in redirect to localhost reaches
 *  the CLI waiting for it. Behind a proxy, "local" is a server elsewhere. */
const pageOnLoopback = () => ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);

function SignIn(props: {
  host: string;
  hostLabel: string;
  auth: State["mcpAuth"][string];
  onRetry(): void;
  onPaste(url: string): void;
  onClose(): void;
}) {
  const { auth } = props;
  const [url, setUrl] = useState("");
  if (auth.state === "starting") return <div className="connector-auth muted small">Getting the sign-in page…</div>;
  if (auth.state === "sending") return <div className="connector-auth muted small">Finishing the sign-in…</div>;
  if (auth.state === "done")
    return (
      <div className="connector-auth connector-auth-done small">
        Connected. Running sessions pick it up now.
        <button className="btn-text" onClick={props.onClose}>
          Dismiss
        </button>
      </div>
    );
  if (auth.state === "failed")
    return (
      <div className="connector-auth small">
        <span className="bad">{auth.error ?? "The sign-in failed."}</span>
        <button className="btn-text" onClick={props.onRetry}>
          Try again
        </button>
        <button className="btn-text" onClick={props.onClose}>
          Dismiss
        </button>
      </div>
    );
  return (
    <div className="connector-auth small">
      <a className="btn-primary btn-small" href={auth.url} target="_blank" rel="noreferrer">
        Open the sign-in page
      </a>
      {auth.paste ? (
        <form
          className="connector-paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) props.onPaste(url.trim());
          }}
        >
          <label className="muted" htmlFor="connector-paste">
            {props.host === "local" && pageOnLoopback()
              ? "When you approve, the page finishes by itself. If it ends on a page that does not load, paste that page's address here."
              : `When you approve, your browser ends on a page that does not load: it is on ${props.hostLabel}, not this computer. Copy that page's address and paste it here.`}
          </label>
          <div className="row">
            <input id="connector-paste" className="field" placeholder="http://localhost:…/callback?code=…" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-small" disabled={!url.trim()}>
              Finish
            </button>
          </div>
        </form>
      ) : (
        <span className="muted">Connect it on that page. This updates by itself once it is connected.</span>
      )}
      <button className="btn-text" onClick={props.onClose}>
        Cancel
      </button>
    </div>
  );
}

/** "Add connector": a catalog server (Linear first) or any https address,
 *  added to this account's own config; its sign-in opens right after. */
function AddConnector(props: { state: State; actions: Actions; host: string; engine: Engine; account: string; servers: McpServer[] }) {
  const { state, actions, host, engine, account } = props;
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const change = pending ? state.mcpChange[mcpAuthKey(host, engine, account, pending)] : undefined;
  const close = () => {
    setOpen(false);
    setOther(false);
    setName("");
    setUrl("");
    if (pending) actions.mcpChangeClear(host, engine, account, pending);
    setPending(null);
  };
  // Added: go straight to its sign-in, as Connect would.
  useEffect(() => {
    if (pending && change?.state === "done") {
      actions.mcpAuth(host, engine, account, pending);
      close();
    }
  }, [change?.state]);
  const add = (n: string, u: string) => {
    if (pending) actions.mcpChangeClear(host, engine, account, pending);
    setPending(n);
    actions.mcpAdd(host, engine, account, n, u);
  };
  const missing = missingFromCatalog(props.servers);
  const problem = other && (name || url) ? newServerProblem(name.trim(), url.trim()) : null;
  const busy = change?.state === "adding";
  if (!open)
    return (
      <button className="btn-text btn-small connector-add" onClick={() => setOpen(true)}>
        <Icon d={PLUS} size={12} />
        Add connector
      </button>
    );
  return (
    <div className="connector-auth connector-add-panel small">
      <span className="muted">Adds it to this account's own {engine === "claude" ? "Claude Code" : "Codex"} config, then opens its sign-in.</span>
      <div className="connector-catalog">
        {missing.map((c) => (
          <button key={c.id} className="btn btn-small" disabled={busy} title={c.url} onClick={() => add(c.id, c.url)}>
            {c.name}
            {c.note && <span className="muted">&nbsp;· {c.note}</span>}
          </button>
        ))}
        <button className="btn btn-small" disabled={busy} aria-expanded={other} onClick={() => setOther(!other)}>
          Other address…
        </button>
      </div>
      {other && (
        <form
          className="connector-paste"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newServerProblem(name.trim(), url.trim())) add(name.trim(), url.trim());
          }}
        >
          <div className="row">
            <input className="field connector-name-field" aria-label="Connector name" placeholder="metabase" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="field" aria-label="Connector address" placeholder="https://metabase.example.com/api/mcp" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn btn-small" disabled={busy || !name.trim() || !url.trim() || !!problem}>
              Add
            </button>
          </div>
          {problem && <span className="muted">{problem}</span>}
        </form>
      )}
      {busy && <span className="muted">Adding {pending}…</span>}
      {change?.state === "failed" && <span className="bad">{change.error}</span>}
      <button className="btn-text" onClick={close}>
        Cancel
      </button>
    </div>
  );
}
