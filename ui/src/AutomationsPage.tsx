// The Automations page and its form. Each host keeps its own automations;
// this page lists them all, with the runs of each (ordinary sessions whose
// metadata names the automation, kept out of the sidebar).
import { useEffect, useMemo, useState } from "react";
import type { Automation, Engine, Permission, Schedule, SessionMeta } from "./protocol";
import { branchKey, homeOn, hostName, hostOf, hostOnline, modelsOn, usageOn, type Actions, type State } from "./store";
import { describeLast, describeNext, describeSchedule, runsOf, scheduleProblem } from "./automations";
import { duration } from "./thread";
import {
  BranchPicker,
  Cloud,
  FolderPicker,
  HostPicker,
  Icon,
  MenuButton,
  ModelPicker,
  PERMISSIONS,
  PermissionPicker,
  PIN,
  PLUS,
  STATUS_LABEL,
  effortFor,
  loadChoice,
  readRecent,
} from "./App";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHOWN_RUNS = 5;

/** The current time, refreshed so "in 12 min" does not go stale on an open page. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function RunRow({ run, state, actions }: { run: SessionMeta; state: State; actions: Actions }) {
  const live = run.status === "running" || run.status === "needs_approval" || run.status === "queued";
  // Runs saved before yardd kept `finishedAt` fall back to their last change.
  const took = Math.max(0, (run.finishedAt ?? run.updatedAt) - run.createdAt);
  return (
    <div className="automation-run-item">
      <button className="automation-run" onClick={() => actions.go({ page: "session", id: run.id })}>
        <span className={`dot dot-${run.status}`} aria-hidden="true" />
        <span className="automation-run-title">{run.title}</span>
        <span className="muted small">{STATUS_LABEL[run.status]}</span>
        <span className="muted small automation-run-time">{live ? "running" : duration(took)}</span>
      </button>
      <button
        className="btn-icon"
        aria-label={`Pin ${run.title}`}
        title={run.pinned ? "Pinned: it is in the sidebar" : "Pin: bring it back to the sidebar"}
        disabled={!!run.pinned || !hostOnline(state, hostOf(run))}
        onClick={() => actions.setPinned(run.id, true)}
      >
        <Icon d={PIN} size={14} />
      </button>
    </div>
  );
}

function AutomationCard({ state, actions, host, a, now }: { state: State; actions: Actions; host: string; a: Automation; now: number }) {
  const online = hostOnline(state, host);
  const runs = useMemo(() => runsOf(state.sessions, host, a.id), [state.sessions, host, a.id]);
  const [all, setAll] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const last = a.lastRun;
  const run = async () => {
    setStarting(true);
    setMessage(null);
    const r = await actions.runAutomation(host, a.id);
    setStarting(false);
    if (r.error) setMessage(r.error);
    else if (r.outcome !== "started") setMessage(`${r.outcome === "skipped" ? "Skipped" : "Failed"}: ${r.reason ?? ""}`);
  };
  const shown = all ? runs : runs.slice(0, SHOWN_RUNS);
  return (
    <section className="automation host-card" aria-label={a.name}>
      <div className="automation-head">
        <strong className="automation-name">{a.name}</strong>
        {host !== "local" && <Cloud size={13} label={`Runs on ${hostName(state, host)}`} />}
        <span className="spacer" />
        <button
          className="switch"
          role="switch"
          aria-checked={a.enabled}
          aria-label={`Enabled: ${a.name}`}
          disabled={!online}
          onClick={() => void actions.saveAutomation(host, { id: a.id, enabled: !a.enabled })}
        >
          <span className="switch-knob" />
        </button>
      </div>
      <div className="automation-facts muted">
        <span>{describeSchedule(a.schedule)}</span>
        <span>Next run {describeNext(a.nextRun, a.enabled, now)}</span>
        <span>Last run {describeLast(last, now)}</span>
      </div>
      {last && last.outcome !== "started" && last.reason && <div className="muted small automation-reason">{last.reason}</div>}
      {message && <div className="small automation-reason" role="status">{message}</div>}
      <div className="row">
        <button className="btn" aria-label={`Run now: ${a.name}`} disabled={!online || starting} onClick={run}>
          {starting ? "Starting" : "Run now"}
        </button>
        <button className="btn-text" aria-label={`Edit: ${a.name}`} disabled={!online} onClick={() => actions.go({ page: "automation", host, id: a.id })}>
          Edit
        </button>
      </div>
      <div className="automation-runs">
        {runs.length === 0 ? (
          <div className="muted small">No runs yet.</div>
        ) : (
          <>
            <div className="muted small">Runs, newest first</div>
            {shown.map((r) => (
              <RunRow key={r.id} run={r} state={state} actions={actions} />
            ))}
            {runs.length > SHOWN_RUNS && (
              <button className="btn-text" onClick={() => setAll(!all)}>
                {all ? "Show fewer" : `Show all ${runs.length} runs`}
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function AutomationsPage({ state, actions }: { state: State; actions: Actions }) {
  const now = useNow();
  const hosts = ["local", ...state.hosts.map((h) => h.id)];
  const all = hosts.flatMap((host) => (state.automations[host] ?? []).map((a) => ({ host, a })));
  return (
    <div className="hosts automations">
      <header className="bar">
        <MenuButton />
        <h1>Automations</h1>
        <span className="spacer" />
        <button className="btn" onClick={() => actions.go({ page: "automation", host: "local", id: "new" })}>
          <Icon d={PLUS} size={13} />
          New automation
        </button>
      </header>
      <div className="scroll">
        <div className="hosts-inner">
          {all.length === 0 && (
            <div className="host-empty">
              <span>
                <strong>No automations yet</strong>
                <span className="muted small">
                  An automation starts a session on a schedule, in its own worktree. Its runs archive themselves and are listed here instead of the sidebar.
                </span>
              </span>
            </div>
          )}
          {all.map(({ host, a }) => (
            <AutomationCard key={`${host}/${a.id}`} state={state} actions={actions} host={host} a={a} now={now} />
          ))}
        </div>
      </div>
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const percent = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export function AutomationForm({ state, actions, host: host0, id }: { state: State; actions: Actions; host: string; id: string }) {
  const existing = id === "new" ? undefined : state.automations[host0]?.find((a) => a.id === id);
  const editing = !!existing;
  const [host, setHost] = useState(host0);
  const target = host === "local" || hostOnline(state, host) ? host : "local";
  const models = modelsOn(state, target);
  const home = homeOn(state, target);
  const workspace = state.workspace[target] || home;

  const [name, setName] = useState(existing?.name ?? "");
  const [prompt, setPrompt] = useState(existing?.prompt ?? "");
  const [cwd, setCwd] = useState(existing?.cwd ?? "");
  const [choice, setChoice] = useState(() => (existing ? { engine: existing.engine, model: existing.model, effort: existing.effort } : loadChoice(modelsOn(state, host0))));
  const [permission, setPermission] = useState<Permission>(existing?.permission ?? "ask");
  const [base, setBase] = useState(existing?.base ?? "");
  const [kind, setKind] = useState<Schedule["kind"]>(existing?.schedule.kind ?? "daily");
  const [every, setEvery] = useState(String(existing?.schedule.kind === "interval" ? existing.schedule.every : 1));
  const [unit, setUnit] = useState<"minutes" | "hours">(existing?.schedule.kind === "interval" ? existing.schedule.unit : "hours");
  const [time, setTime] = useState(existing && existing.schedule.kind !== "interval" ? existing.schedule.time : "09:00");
  const [day, setDay] = useState(existing?.schedule.kind === "weekly" ? existing.schedule.day : 1);
  const [skip, setSkip] = useState(existing?.skipWhileRunning ?? true);
  const [fiveHour, setFiveHour] = useState(existing?.maxFiveHour == null ? "" : String(existing.maxFiveHour));
  const [week, setWeek] = useState(existing?.maxWeek == null ? "" : String(existing.maxWeek));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Models, the home folder and branches arrive per host, after the first render.
  useEffect(() => {
    if (models.claude.length + models.codex.length > 0 && !models[choice.engine]?.some((m) => m.id === choice.model)) setChoice(loadChoice(models));
  }, [models, target]);
  useEffect(() => {
    if (!cwd && workspace && !editing) setCwd(workspace);
  }, [workspace]);
  const branchList = state.branches[branchKey(target, cwd)];
  useEffect(() => {
    if (cwd && state.connected) actions.loadBranches(cwd, target);
  }, [cwd, target, state.connected]);
  const isRepo = !!branchList?.current;

  const recent = useMemo(() => {
    const fromSessions = Object.values(state.sessions)
      .filter((s) => hostOf(s) === target)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => s.repo || s.cwd);
    return [...new Set([...readRecent(target), ...fromSessions])].slice(0, 12);
  }, [state.sessions, target]);

  const schedule: Schedule =
    kind === "interval" ? { kind, every: Number(every), unit } : kind === "daily" ? { kind, time } : { kind, day, time };
  const problem =
    (!name.trim() && "Give it a name.") ||
    (!prompt.trim() && "Write the prompt it runs.") ||
    (!cwd && "Choose a folder.") ||
    scheduleProblem(schedule) ||
    ([fiveHour, week].some((t) => t.trim() !== "" && !(Number(t) >= 0 && Number(t) <= 100)) ? "A usage limit is a percentage from 0 to 100." : null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const r = await actions.saveAutomation(target, {
      ...(existing ? { id: existing.id } : {}),
      name,
      prompt,
      cwd,
      ...choice,
      effort: effortFor(models[choice.engine]?.find((m) => m.id === choice.model), choice.effort),
      permission,
      base,
      schedule,
      skipWhileRunning: skip,
      maxFiveHour: percent(fiveHour),
      maxWeek: percent(week),
    });
    setSaving(false);
    if (r.error) setError(r.error);
    else actions.go({ page: "automations" });
  };

  return (
    <div className="hosts automations">
      <header className="bar">
        <MenuButton />
        <h1>{editing ? "Edit automation" : "New automation"}</h1>
      </header>
      <div className="scroll">
        {/* Not a <form>: the pickers' buttons would submit it. */}
        <div className="hosts-inner automation-form">
          <div className="automation-field">
            <label htmlFor="automation-name">Name</label>
            <input id="automation-name" className="field" aria-label="Automation name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Patrol" />
          </div>
          <div className="automation-field">
            <label htmlFor="automation-prompt">Prompt</label>
            <textarea
              id="automation-prompt"
              className="field automation-prompt"
              aria-label="Prompt"
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What each run should do"
            />
          </div>
          <div className="automation-field">
            <span className="automation-label">Where and how</span>
            <div className="new-chips">
              {editing ? (
                <span className="muted small">Runs on {hostName(state, host0)}</span>
              ) : (
                <HostPicker state={state} value={target} onChange={(h) => { setHost(h); setCwd(""); setBase(""); }} onAddHost={() => actions.go({ page: "hosts" })} />
              )}
              <FolderPicker host={target} home={home} workspace={workspace} value={cwd} recent={recent} dirs={state.dirs} listDirs={actions.listDirs} onChange={(f) => { setCwd(f); setBase(""); }} />
              {isRepo && <BranchPicker current={branchList.current!} branches={branchList.branches ?? []} value={base} onChange={setBase} />}
            </div>
            <div className="automation-pickers">
              <ModelPicker models={models} usage={usageOn(state, target)} value={choice} engines={["claude", "codex"] as Engine[]} onChange={setChoice} />
              <PermissionPicker engine={choice.engine} value={permission} onChange={setPermission} />
            </div>
            <span className="muted small">
              {isRepo
                ? `Each run gets a new worktree cut from ${base || "the default branch"}, fetched first.`
                : "Not a git repository: runs work in the folder itself, one at a time."}
            </span>
          </div>
          <div className="automation-field">
            <span className="automation-label">Schedule</span>
            <div className="row automation-schedule">
              <select aria-label="Schedule type" className="field" value={kind} onChange={(e) => setKind(e.target.value as Schedule["kind"])}>
                <option value="interval">Every few minutes or hours</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              {kind === "interval" && (
                <>
                  <input aria-label="Repeat every" className="field" type="number" min={1} value={every} onChange={(e) => setEvery(e.target.value)} />
                  <select aria-label="Repeat unit" className="field" value={unit} onChange={(e) => setUnit(e.target.value as "minutes" | "hours")}>
                    <option value="minutes">minutes</option>
                    <option value="hours">hours</option>
                  </select>
                </>
              )}
              {kind === "weekly" && (
                <select aria-label="Day of the week" className="field" value={day} onChange={(e) => setDay(Number(e.target.value))}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              )}
              {kind !== "interval" && <input aria-label="Time" className="field" type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
            </div>
            <span className="muted small">
              {describeSchedule(schedule)}, in {hostName(state, target)}'s local time zone. A run missed while Switchyard was off starts once when it is back.
            </span>
          </div>
          <div className="automation-field">
            <span className="automation-label">Skip a run</span>
            <label className="check">
              <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
              While the previous run is still going
            </label>
            <div className="row automation-limits">
              <label>
                When 5-hour usage is above
                <input aria-label="5-hour usage limit percent" className="field" type="number" min={0} max={100} placeholder="no limit" value={fiveHour} onChange={(e) => setFiveHour(e.target.value)} />%
              </label>
              <label>
                When weekly usage is above
                <input aria-label="Weekly usage limit percent" className="field" type="number" min={0} max={100} placeholder="no limit" value={week} onChange={(e) => setWeek(e.target.value)} />%
              </label>
            </div>
            <span className="muted small">Applies to scheduled runs; Run now always starts one. The limits read the {choice.engine === "claude" ? "Claude" : "Codex"} plan usage.</span>
          </div>
          {(error || problem) && (
            <div className="small automation-reason" role="alert">
              {error ?? problem}
            </div>
          )}
          <div className="row">
            <button type="button" className="btn-primary" disabled={!!problem || saving || !state.connected} onClick={() => void save()}>
              {saving ? "Saving" : "Save automation"}
            </button>
            <button type="button" className="btn-text" onClick={() => actions.go({ page: "automations" })}>
              Cancel
            </button>
            <span className="spacer" />
            {editing && !confirmDelete && (
              <button type="button" className="btn-text danger" onClick={() => setConfirmDelete(true)}>
                Delete automation
              </button>
            )}
            {editing && confirmDelete && (
              <>
                <span className="muted small">Its runs stay as sessions.</span>
                <button
                  type="button"
                  className="btn danger"
                  onClick={() => {
                    actions.deleteAutomation(host0, existing!.id);
                    actions.go({ page: "automations" });
                  }}
                >
                  Confirm delete
                </button>
                <button type="button" className="btn-text" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
