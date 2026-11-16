// Settings: what this browser keeps for itself (notifications, which hosts
// the sidebar lists). Nothing here goes to yardd.
import { useNotifySetting } from "./notify";
import { setHostShown, useHiddenHosts } from "./sidebarHosts";
import { hostName, type Actions, type State } from "./store";
import { Cloud, MenuButton } from "./App";

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange(): void }) {
  return (
    <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={onChange}>
      <span className="switch-knob" />
    </button>
  );
}

export function SettingsPage({ state, actions }: { state: State; actions: Actions }) {
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
          <section className="host-card" aria-labelledby="settings-notifications">
            <div className="settings-row">
              <span className="settings-text">
                <h2 id="settings-notifications">Notifications</h2>
                <span className="muted small">
                  A banner when a session waits for an approval, fails, or finishes a turn of a minute or more, while you are looking elsewhere.
                </span>
              </span>
              <Switch label="Notifications" on={notify.on} onChange={() => void notify.toggle()} />
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
              <span className="muted small">The hosts listed at the foot of the sidebar, with CPU and memory. Plan usage there comes from these hosts.</span>
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
                    <Switch label={`Show ${name} in sidebar`} on={!hidden.includes(id)} onChange={() => setHostShown(id, hidden.includes(id))} />
                  </div>
                );
              })}
            </div>
            <div className="row">
              <button className="btn" onClick={() => actions.go({ page: "hosts" })}>
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
