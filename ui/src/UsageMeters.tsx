import { useEffect, useRef, useState } from "react";
import { AnchoredPopover } from "./AnchoredPopover";
import type { Engine, EngineStates } from "./protocol";
import { formatReset, metersFor, noLimitsNote, percentText, reportsLimits, stripGroups, type Meter, type UsageSource } from "./usage";
import { Icon } from "./App";
import { DEFAULT_ACCOUNT } from "./accounts";
import { ENGINES, ENGINE_NAME } from "./engines";

const REFRESH = "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5";
const LIMIT_ENGINES = ENGINES.filter(reportsLimits);

function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
export const Bar = ({ meter }: { meter: Meter }) => (
  <div
    className="bar-track"
    role="progressbar"
    aria-label={`${meter.label} used`}
    aria-valuenow={Math.round(meter.percent)}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div className={`bar-fill level-${meter.level}`} style={{ width: `${meter.percent}%` }} />
  </div>
);

export type SubscriptionSource = UsageSource & { name?: string; engines?: EngineStates; online?: boolean };
export type UsageAccount = { host: string; engine: Engine; account: string };

/** Keep the existing cross-host deduplication and freshness rules. Identity
 * and host badges explain which login each report belongs to. */
function subscriptionRows(sources: SubscriptionSource[], now: number) {
  const groups = stripGroups(sources, [...LIMIT_ENGINES]);
  for (const source of sources)
    for (const engine of LIMIT_ENGINES) {
      if (source.engines?.[engine]?.installed && !groups.some((g) => g.engine === engine && g.account === null))
        groups.push({ engine, account: null, host: source.host, usage: {}, reported: false });
    }
  return groups.map((g) => {
    const available = sources.filter((s) =>
      g.account === null
        ? !!s.engines?.[g.engine]?.installed || !!(g.engine === "claude" ? s.usage.claude : s.usage.codex)
        : s.accounts.some((a) => a.engine === g.engine && a.name.toLowerCase() === g.account!.toLowerCase()),
    );
    const reportSource = sources.find((s) => s.host === g.host);
    const account =
      g.account === null ? undefined : reportSource?.accounts.find((a) => a.engine === g.engine && a.name.toLowerCase() === g.account!.toLowerCase());
    const login = account ? reportSource?.engines?.accounts?.[account.id] : reportSource?.engines?.[g.engine];
    return {
      ...g,
      key: `${g.engine}:${g.account ?? "default"}`,
      name: `${ENGINE_NAME[g.engine]} · ${g.account ?? "Default"}`,
      loggedIn: login?.loggedIn,
      identity: login?.account || (login?.loggedIn === false ? "Needs sign-in" : ""),
      hosts: available,
      meters: metersFor(g.engine, g.usage, now),
    };
  });
}

export function UsageStrip({ sources, selected, onViewAll, onManage, onRefresh, compact = false }: {
  sources: SubscriptionSource[];
  selected?: UsageAccount;
  compact?: boolean;
  onViewAll(): void;
  onManage(host: string): void;
  onRefresh(host: string, engine: Engine, account: string): Promise<{ error?: string }>;
}) {
  const now = useNow();
  const rows = subscriptionRows(sources, now);
  const selectedHost = sources.find((source) => source.host === selected?.host);
  const selectedEntry = selectedHost?.accounts.find((account) => account.id === selected?.account);
  const selectedName = selectedEntry?.name ?? "Default";
  const chosen = selectedHost && selected
    ? rows.find((row) => row.engine === selected.engine && (row.account ?? "Default").toLowerCase() === selectedName.toLowerCase())
    : undefined;
  const active = chosen ?? (selectedHost ? undefined : rows[0]);
  const others = rows.filter((row) => row !== active);
  const activeLabel = selectedHost && selected ? `${ENGINE_NAME[selected.engine]} · ${selectedName}` : active?.name;
  const activeHost = active ? sources.find((source) => source.host === active.host && source.online !== false) ?? active.hosts.find((source) => source.online !== false) : undefined;
  const activeEngine = active?.engine ?? selected?.engine;
  const accountId = active?.account == null ? DEFAULT_ACCOUNT : activeHost?.accounts.find((account) => account.engine === active.engine && account.name.toLowerCase() === active.account!.toLowerCase())?.id;
  const canRefresh = !!(activeHost && activeEngine && accountId && reportsLimits(activeEngine) && active?.loggedIn !== false);
  const [open, setOpen] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failure, setFailure] = useState("");
  const anchor = useRef<HTMLButtonElement>(null);
  const highest = rows.flatMap((r) => r.meters).sort((a, b) => b.percent - a.percent)[0];
  const close = () => { setOpen(false); setShowOthers(false); setFailure(""); };
  const refresh = async () => {
    if (!canRefresh || refreshing || !activeHost || !activeEngine || !accountId) return;
    setRefreshing(true);
    setFailure("");
    const result = await onRefresh(activeHost.host, activeEngine, accountId);
    setFailure(result.error ?? "");
    setRefreshing(false);
  };
  const manage = (host: string) => { close(); onManage(host); };
  const signIns = others.filter((row) => row.loggedIn === false).length;
  return (
    <div className={compact ? "mobile-usage" : "usage-dock"}>
      <button
        ref={anchor}
        className={`btn-quiet ${compact ? "mobile-usage-trigger" : "usage-trigger"}`}
        aria-label="Subscription usage"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => open ? close() : setOpen(true)}
      >
        {compact && highest ? (
          <><span className="usage-chip-track" aria-hidden="true"><span style={{ width: `${highest.percent}%` }} /></span><span>{percentText(highest.percent)}</span></>
        ) : (
          <>
            <span aria-hidden="true">◷</span><span>Usage</span>
            {!compact && <><span className="spacer" /><span className={highest?.level === "high" ? "bad" : highest?.level === "warn" ? "warn" : "muted"}>{highest ? `${percentText(highest.percent)} used` : "View limits"}</span><span aria-hidden="true">›</span></>}
          </>
        )}
      </button>
      {open && (
        <AnchoredPopover anchor={anchor} label="Subscription usage" side="right" variant="usage-popover" onClose={close}>
          <div className="popover-heading">
            <strong>Usage</strong>
            <span className="spacer" />
            {canRefresh && (
              <button className="btn-icon" aria-label="Refresh usage" title="Refresh usage" disabled={refreshing} onClick={refresh}>
                <Icon d={REFRESH} size={16} />
              </button>
            )}
            <button className="btn-icon" aria-label="Close usage popover" onClick={close}>×</button>
          </div>
          {activeLabel ? (
            <section className="compact-subscription usage-active" aria-label={activeLabel}>
              <div className="usage-account-line">
                <span className="account-avatar" aria-hidden="true">{activeEngine === "claude" ? "CC" : activeEngine === "codex" ? "CX" : activeEngine?.slice(0, 2).toUpperCase()}</span>
                <strong>{activeLabel}</strong>
                {active?.meters.some((meter) => meter.level !== "ok") && <span className="usage-near-limit">Near limit</span>}
              </div>
              {selectedHost?.online === false && <p className="muted small">The selected host is offline.</p>}
              {active?.loggedIn === false ? (
                <p className="muted small">
                  Needs sign-in.
                  <button className="btn-text" onClick={() => manage(active.host)}>Sign in</button>
                </p>
              ) : active?.meters.length ? active.meters.map((m) => (
                <div key={m.key} className={`compact-meter level-${m.level}`}>
                  <span>{m.label}</span><span className="usage-percent">{percentText(m.percent)}</span>
                  <Bar meter={m} />
                  <span className="muted usage-reset">{formatReset(m.resetsAt, now) || "Reset time not reported"}</span>
                </div>
              )) : <p className="muted small">{activeEngine && !reportsLimits(activeEngine) ? "This engine does not report subscription limits." : "No limits reported yet."}</p>}
            </section>
          ) : <p className="muted small">No subscription limits reported yet.</p>}
          {refreshing && <p className="muted small" role="status">Refreshing usage…</p>}
          {failure && (
            <p className="bad small" role="alert">
              {failure}
              <button className="btn-text" onClick={refresh}>Try again</button>
            </p>
          )}
          {others.length > 0 && (
            <>
              <button className="btn-quiet usage-other-toggle" aria-expanded={showOthers} onClick={() => setShowOthers(!showOthers)}>
                <span>Other accounts</span><span className="spacer" />
                <span className="muted">{signIns ? `${signIns} need sign-in` : others.length}</span>
                <span aria-hidden="true">{showOthers ? "⌃" : "⌄"}</span>
              </button>
              {showOthers && others.map((row) => (
                <section key={row.key} className="compact-subscription usage-other-account" aria-label={row.name}>
                  <strong>{row.name}</strong>
                  {row.loggedIn === false
                    ? <button className="btn-text" onClick={() => manage(row.host)}>Sign in</button>
                    : <span className="muted small">{row.meters[0] ? `${percentText(row.meters[0].percent)} of ${row.meters[0].label}` : "No limits reported yet"}</span>}
                </section>
              ))}
            </>
          )}
          <div className="popover-footer">
            <span className="muted small">Shared across hosts</span>
            <button className="btn-text" onClick={() => { close(); onViewAll(); }}>View all →</button>
          </div>
        </AnchoredPopover>
      )}
    </div>
  );
}

export function Subscriptions({ sources, onManage }: { sources: SubscriptionSource[]; onManage(): void }) {
  const now = useNow();
  const rows = subscriptionRows(sources, now);
  return (
    <div className="subscriptions">
      <div className="subscription-columns muted small" aria-hidden="true">
        <span>Account</span>
        <span>Reported limits</span>
      </div>
      {rows.map((r) => (
        <section className="subscription-row" key={r.key} aria-label={r.name}>
          <div className="subscription-identity">
            <strong>{r.name}</strong>
            {r.identity && <p className="muted small">{r.identity}</p>}
            <div className="subscription-hosts">
              {r.hosts.map((s) => (
                <span key={s.host} className="account-host-badge">
                  {s.name ?? s.host}
                </span>
              ))}
            </div>
          </div>
          {r.meters.length ? (
            <div className="subscription-meters">
              {r.meters.map((m) => (
                <div key={m.key} className={`subscription-meter level-${m.level}`}>
                  <span className="muted small">{m.label}</span>
                  <strong className="usage-percent">{percentText(m.percent)} used</strong>
                  <Bar meter={m} />
                  <span className="muted small">{formatReset(m.resetsAt, now) || "Reset time not reported"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted small">No limits reported yet</p>
          )}
        </section>
      ))}
      {!rows.length && (
        <div className="focused-empty">
          <strong>No subscription limits reported yet</strong>
          <p className="muted">Usage appears here when Claude or Codex reports it.</p>
        </div>
      )}
      <p className="muted small subscription-note">One limit per account, shared across its hosts. {noLimitsNote()}</p>
      <button className="btn-text" onClick={onManage}>
        Manage engine logins →
      </button>
    </div>
  );
}
