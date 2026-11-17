// Plan-usage meters: the strip at the foot of the sidebar, one block per
// engine account. The model picker shows none: limits are read here, per
// account, and the picker only says which account a model runs on.
import { Fragment, useEffect, useState } from "react";
import type { Engine } from "./protocol";
import { formatReset, metersFor, percentText, stripGroups, type Meter, type UsageSource } from "./usage";
import { ENGINES as ENGINE_IDS, ENGINE_NAME } from "./engines";

// An engine that reports no plan usage has no meters, so it shows nothing.
const ENGINES: { id: Engine; name: string }[] = ENGINE_IDS.map((id) => ({ id, name: ENGINE_NAME[id] }));

/** Re-renders now and then so "resets in" keeps counting down. */
function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const Bar = ({ meter }: { meter: Meter }) => (
  <div className="bar-track" aria-hidden="true">
    <div className={`bar-fill level-${meter.level}`} style={{ width: `${meter.percent}%` }} />
  </div>
);

/** What a meter says in words: for a screen reader and for the strip's tooltip. */
const describe = (engineName: string, m: Meter, now: number) =>
  [`${engineName} ${m.label}: ${percentText(m.percent)} used`, formatReset(m.resetsAt, now)].filter(Boolean).join(", ");

/** The meters worth a line in the strip: the 5-hour window and the week,
 *  plus any other window that is running high. */
const forStrip = (meters: Meter[]) => meters.filter((m, i) => i < 2 || m.level !== "ok");

/** Always visible: one line per window; when each resets is in the line's
 *  tooltip. Each engine and account once, from the hosts the sidebar shows.
 *  Where an engine has more than one account, each gets its name above its
 *  meters, Default included, and an account with nothing reported yet says
 *  so instead of being left out. */
export function UsageStrip({ sources }: { sources: UsageSource[] }) {
  const now = useNow();
  const groups = stripGroups(sources, ENGINES.map((e) => e.id));
  const several = new Set(groups.filter((g) => g.account !== null).map((g) => g.engine));
  const shown = groups
    .map((g) => {
      const engine = ENGINES.find((e) => e.id === g.engine)?.name ?? g.engine;
      const account = g.account ?? (several.has(g.engine) ? "Default" : null);
      return { ...g, engine, account, name: account ? `${engine} (${account})` : engine, meters: forStrip(metersFor(g.engine, g.usage, now)) };
    })
    .filter((g) => g.meters.length > 0 || !g.reported);
  if (shown.length === 0) return null;
  return (
    <div className="usage-strip" role="group" aria-label="Plan usage">
      {shown.map((g) => (
        <Fragment key={g.name}>
          {g.account && (
            <div className="usage-line-account">
              {g.engine} · {g.account}
            </div>
          )}
          {!g.reported && <div className="usage-line-none muted">No limits reported yet</div>}
          {g.meters.map((m, i) => (
            <div key={`${g.name}-${m.key}`} className={`usage-line level-${m.level}`} title={describe(g.name, m, now)}>
              <span className="usage-line-engine">{i === 0 && !g.account ? g.engine : ""}</span>
              <span className="usage-label">{m.label}</span>
              <Bar meter={m} />
              <span className="usage-percent">{percentText(m.percent)}</span>
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  );
}
