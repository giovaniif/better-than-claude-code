// Plan-usage meters: a full one for the model picker (bar, percent, when it
// resets) and a compact strip for the sidebar. Both read the same Meter list.
import { Fragment, useEffect, useState } from "react";
import type { Engine, Usage } from "./protocol";
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

function UsageMeter({ engineName, meter, now }: { engineName: string; meter: Meter; now: number }) {
  const reset = formatReset(meter.resetsAt, now);
  return (
    <div
      className={`usage-meter level-${meter.level}`}
      role="meter"
      aria-label={`${engineName} ${meter.label}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(meter.percent)}
      aria-valuetext={describe(engineName, meter, now)}
    >
      <span className="usage-label">{meter.label}</span>
      <Bar meter={meter} />
      <span className="usage-percent">{percentText(meter.percent)}</span>
      {reset && <span className="usage-reset">{reset}</span>}
    </div>
  );
}

/** Every engine that has reported limits, with all its meters. For the picker's header. */
export function UsageMeters({ usage, first }: { usage: Usage; first?: Engine }) {
  const now = useNow();
  const engines = [...ENGINES].sort((a, b) => Number(b.id === first) - Number(a.id === first));
  const shown = engines.map((e) => ({ ...e, meters: metersFor(e.id, usage, now) })).filter((e) => e.meters.length > 0);
  if (shown.length === 0) return null;
  return (
    <div className="picker-usage" role="group" aria-label="Plan usage">
      {shown.map((e) => (
        <div key={e.id} className="usage-engine">
          <div className="usage-engine-name">{e.name}</div>
          {e.meters.map((m) => (
            <UsageMeter key={m.key} engineName={e.name} meter={m} now={now} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The meters worth a line in the strip: the 5-hour window and the week,
 *  plus any other window that is running high. */
const forStrip = (meters: Meter[]) => meters.filter((m, i) => i < 2 || m.level !== "ok");

/** Always visible: one line per window, no reset times (they are in the
 *  tooltip). Each engine and account once, from the hosts the sidebar shows;
 *  an added account gets a line with its name above its meters. */
export function UsageStrip({ sources }: { sources: UsageSource[] }) {
  const now = useNow();
  const shown = stripGroups(sources, ENGINES.map((e) => e.id))
    .map((g) => {
      const engine = ENGINES.find((e) => e.id === g.engine)?.name ?? g.engine;
      return { ...g, engine, name: g.account ? `${engine} (${g.account})` : engine, meters: forStrip(metersFor(g.engine, g.usage, now)) };
    })
    .filter((g) => g.meters.length > 0);
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
