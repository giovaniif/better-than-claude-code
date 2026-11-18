import { useEffect, useRef, useState } from "react";
import { AnchoredPopover } from "./AnchoredPopover";
import type { EngineStates } from "./protocol";
import { formatReset, metersFor, noLimitsNote, percentText, reportsLimits, stripGroups, type Meter, type UsageSource } from "./usage";
import { ENGINES, ENGINE_NAME } from "./engines";

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

export type SubscriptionSource = UsageSource & { name?: string; engines?: EngineStates };

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
      identity: login?.account || (login?.loggedIn === false ? "Needs sign-in" : ""),
      hosts: available,
      meters: metersFor(g.engine, g.usage, now),
    };
  });
}

export function UsageStrip({ sources, onViewAll }: { sources: SubscriptionSource[]; onViewAll(): void }) {
  const now = useNow();
  const rows = subscriptionRows(sources, now);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const highest = rows.flatMap((r) => r.meters).sort((a, b) => b.percent - a.percent)[0];
  return (
    <div className="usage-dock">
      <button
        ref={anchor}
        className="btn-quiet usage-trigger"
        aria-label="Subscription usage"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">◷</span>
        <span>Usage</span>
        <span className="spacer" />
        <span className={highest?.level === "high" ? "bad" : highest?.level === "warn" ? "warn" : "muted"}>
          {highest ? `${percentText(highest.percent)} used` : "View limits"}
        </span>
        <span aria-hidden="true">›</span>
      </button>
      {open && (
        <AnchoredPopover anchor={anchor} label="Subscription usage" side="right" onClose={() => setOpen(false)}>
          <div className="popover-heading">
            <strong>Subscription usage</strong>
            <button className="btn-icon" aria-label="Close usage popover" onClick={() => setOpen(false)}>
              ×
            </button>
          </div>
          {rows.length === 0 && <p className="muted pad">No subscription limits reported yet.</p>}
          {rows.map((r) => (
            <section key={r.key} className="compact-subscription" aria-label={r.name}>
              <strong>{r.name}</strong>
              {!r.meters.length && <p className="muted small">No limits reported yet</p>}
              {r.meters.map((m) => (
                <div key={m.key} className={`compact-meter level-${m.level}`} title={formatReset(m.resetsAt, now)}>
                  <span className="muted">{m.label}</span>
                  <Bar meter={m} />
                  <span className="usage-percent">{percentText(m.percent)}</span>
                </div>
              ))}
            </section>
          ))}
          <div className="popover-footer">
            <span className="muted small">Shared across hosts</span>
            <button
              className="btn-text"
              onClick={() => {
                setOpen(false);
                onViewAll();
              }}
            >
              View all →
            </button>
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
