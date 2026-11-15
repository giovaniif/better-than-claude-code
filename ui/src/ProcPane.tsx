import { useEffect } from "react";
import { hostOf, hostOnline, type Actions, type State } from "./store";
import type { SessionMeta } from "./protocol";
import { procSummary, procTree, memText, shortCommand } from "./procs";
import { duration } from "./thread";

/** How often the list is asked for while the tab is visible. The host sampler
 *  that produces it runs every 3 s. */
const REFRESH_MS = 3000;

/** The Processes tab: what the session is running right now. */
export function ProcPane(props: { meta: SessionMeta; state: State; actions: Actions; visible: boolean }) {
  const { meta, state, actions, visible } = props;
  const rows = state.procs[meta.id];
  const connected = hostOnline(state, hostOf(meta));

  useEffect(() => {
    if (!visible || !connected) return;
    actions.loadProcs(meta.id);
    const timer = setInterval(() => actions.loadProcs(meta.id), REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, connected, meta.id]);

  if (!rows) return <div className="scroll pane-body" style={{ display: visible ? "flex" : "none" }}><div className="muted">Loading…</div></div>;
  const tree = procTree(rows);
  return (
    <div className="scroll pane-body" style={{ display: visible ? "flex" : "none" }}>
      {tree.length === 0 ? (
        <div className="muted">Nothing is running for this session.</div>
      ) : (
        <>
          <div className="muted small">{procSummary(rows)}</div>
          <table className="proc-table">
            <thead>
              <tr>
                <th>PID</th>
                <th>Command</th>
                <th className="num">CPU</th>
                <th className="num">Memory</th>
                <th className="num">Running</th>
              </tr>
            </thead>
            <tbody>
              {tree.map(({ row, depth }) => (
                <tr key={row.pid}>
                  <td className="muted">{row.pid}</td>
                  <td className="proc-cmd" title={row.cmd}>
                    <span style={{ paddingLeft: `${depth * 12}px` }}>
                      {depth === 0 && <span className="proc-tag">{row.origin}</span>}
                      <code>{shortCommand(row.cmd)}</code>
                    </span>
                  </td>
                  <td className="num">{Math.round(row.cpu)}%</td>
                  <td className="num">{memText(row.memBytes)}</td>
                  <td className="num">{duration(row.ageSecs * 1000)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
