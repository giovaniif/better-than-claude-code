import { useState } from "react";
import {
  loadDefaults,
  saveDefaults,
  type DefaultTarget,
} from "./launchDefaults";
import {
  loadChoice,
  loadHost,
  validChoice,
  type Choice,
} from "./sessionDefaults";
import { pickerEngines } from "./engines";
import type { Models } from "./protocol";
// Settings: what this browser keeps for itself (notifications, which hosts
// the sidebar lists). Nothing here goes to yardd.
import { useNotifySetting } from "./notify";
import { setHostShown, useHiddenHosts } from "./sidebarHosts";
import { hostName, modelsOn, type Actions, type State } from "./store";
import {
  Cloud,
  MenuButton,
  HostPicker,
  ModelPicker,
  EffortPicker,
} from "./App";

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange(): void;
}) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
    >
      <span className="switch-knob" />
    </button>
  );
}

function DefaultPreferences({
  target,
  state,
  actions,
}: {
  target: DefaultTarget;
  state: State;
  actions: Actions;
}) {
  const [saved, setSaved] = useState(() => loadDefaults(target));
  const [host, setHost] = useState(
    () =>
      saved?.host ??
      (target === "sessions" ? loadHost() : (state.switchy?.scope ?? "all")),
  );
  const knownHost =
    host === "local" ||
    (target === "switchy" && host === "all") ||
    !state.connected ||
    state.hosts.some((h) => h.id === host);
  const selectedHost = knownHost
    ? host
    : target === "switchy"
      ? "all"
      : "local";
  const allModels = modelsOn(
    state,
    target === "switchy" ? "local" : selectedHost,
  );
  const models: Models =
    target === "switchy"
      ? { codex: allModels.codex, claude: allModels.claude }
      : allModels;
  const [chosen, setChosen] = useState<Choice>(
    () =>
      saved?.choice ??
      (target === "switchy"
        ? {
            engine: (state.switchy?.engine ?? "codex") as Choice["engine"],
            model: state.switchy?.model ?? "",
            effort: state.switchy?.effort ?? "low",
          }
        : loadChoice(models, selectedHost)),
  );
  const choice = validChoice(models, chosen);
  const available = !!models[choice.engine]?.some((m) => m.id === choice.model);
  const [notice, setNotice] = useState("");
  const changeHost = (next: string) => {
    setHost(next);
    setNotice("");
    if (target === "sessions")
      setChosen(loadChoice(modelsOn(state, next), next));
  };
  const save = () => {
    const next = { host: selectedHost, choice };
    if (!saveDefaults(target, next)) {
      setNotice("Could not save defaults in this browser.");
      return;
    }
    setSaved(next);
    setNotice("Defaults saved.");
  };
  const reset = () => {
    if (!saveDefaults(target, null)) {
      setNotice("Could not reset defaults in this browser.");
      return;
    }
    setSaved(null);
    const nextHost =
      target === "sessions" ? loadHost() : (state.switchy?.scope ?? "all");
    setHost(nextHost);
    setChosen(
      target === "sessions"
        ? loadChoice(modelsOn(state, nextHost), nextHost)
        : {
            engine: (state.switchy?.engine ?? "codex") as Choice["engine"],
            model: state.switchy?.model ?? "",
            effort: state.switchy?.effort ?? "low",
          },
    );
    setNotice("Defaults reset. Last-used selections will be used.");
  };
  return (
    <section
      className="host-card composer-large"
      aria-labelledby={`defaults-${target}`}
    >
      <div className="settings-text">
        <h2 id={`defaults-${target}`}>
          {target === "sessions" ? "New session defaults" : "Switchy defaults"}
        </h2>
        <span className="muted small">
          {target === "sessions"
            ? "Start new sessions on this host with this model. Existing sessions keep their settings."
            : "Use this model and context host when you open Switchy. Inference runs on the local host."}
        </span>
      </div>
      <div
        className="row"
        role="group"
        aria-label={`${target === "sessions" ? "New session" : "Switchy"} defaults`}
      >
        <HostPicker
          state={state}
          value={selectedHost}
          onChange={changeHost}
          onAddHost={() => actions.go({ page: "hosts" })}
          contextScope={target === "switchy"}
          allowOffline
        />
        {available && (
          <ModelPicker
            models={models}
            value={choice}
            engines={pickerEngines(models)}
            onChange={(c) => {
              setChosen(c);
              setNotice("");
            }}
          />
        )}
        {available && (
          <EffortPicker
            models={models}
            value={choice}
            onChange={(effort) => {
              setChosen({ ...choice, effort });
              setNotice("");
            }}
          />
        )}
        {!available && (
          <span className="muted small">
            Connect this host to choose a model.
          </span>
        )}
      </div>
      <div className="row">
        <button className="btn-primary" disabled={!available} onClick={save}>
          Save defaults
        </button>
        {saved && (
          <button className="btn-text" onClick={reset}>
            Use last used
          </button>
        )}
        {notice && (
          <span className="muted small" role="status">
            {notice}
          </span>
        )}
      </div>
    </section>
  );
}

export function SettingsPage({
  state,
  actions,
}: {
  state: State;
  actions: Actions;
}) {
  const notify = useNotifySetting();
  const hidden = useHiddenHosts();
  const hosts = ["local", ...state.hosts.map((h) => h.id)];
  return (
    <div className="hosts settings">
      <header className="bar">
        <MenuButton />
        <h1>Settings</h1>
      </header>
      <div className="scroll">
        <div className="hosts-inner">
          <DefaultPreferences
            target="sessions"
            state={state}
            actions={actions}
          />
          <DefaultPreferences
            target="switchy"
            state={state}
            actions={actions}
          />
          <section
            className="host-card"
            aria-labelledby="settings-notifications"
          >
            <div className="settings-row">
              <span className="settings-text">
                <h2 id="settings-notifications">Notifications</h2>
                <span className="muted small">
                  A banner when a session waits for an approval, fails, or
                  finishes a turn of a minute or more, while you are looking
                  elsewhere.
                </span>
              </span>
              <Switch
                label="Notifications"
                on={notify.on}
                onChange={() => void notify.toggle()}
              />
            </div>
            {notify.hint && (
              <div className="notify-hint" role="status">
                {notify.hint}
              </div>
            )}
          </section>
          <section className="host-card" aria-labelledby="settings-sidebar">
            <div className="settings-text">
              <h2 id="settings-sidebar">Sidebar</h2>
              <span className="muted small">
                The hosts listed at the foot of the sidebar, with CPU and
                memory. Plan usage there comes from these hosts.
              </span>
            </div>
            <div className="settings-list">
              {hosts.map((id) => {
                const name = hostName(state, id);
                return (
                  <div key={id} className="settings-row settings-host">
                    <span className="settings-host-name">
                      {name}
                      {id !== "local" && <Cloud size={12} />}
                    </span>
                    <span className="muted small">Show in sidebar</span>
                    <Switch
                      label={`Show ${name} in sidebar`}
                      on={!hidden.includes(id)}
                      onChange={() => setHostShown(id, hidden.includes(id))}
                    />
                  </div>
                );
              })}
            </div>
            <div className="row">
              <button
                className="btn"
                onClick={() => actions.go({ page: "hosts" })}
              >
                Manage hosts
              </button>
            </div>
          </section>
          <div className="muted small">Kept in this browser.</div>
        </div>
      </div>
    </div>
  );
}
