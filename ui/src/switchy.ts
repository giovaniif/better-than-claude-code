import type { SwitchyConversation, SwitchyTurn } from "./protocol";
import { speakable, type Cue } from "./voice";
/** The host scope Switchy asks with: what the user picked on this page, else
 * the scope the conversation last used, else every host. A scope naming a
 * host that has since been removed falls back to every host: the picker has
 * no option for it (so it reads "All hosts") and yardd would refuse it. */
export function switchyScope(
  chosen: string | null,
  saved: string | undefined,
  hosts: string[],
): string {
  const scope = chosen ?? saved ?? "all";
  return scope === "all" || hosts.includes(scope) ? scope : "all";
}

/** yardd ends a turn the user stopped as failed with this text. Stopping is
 * not a failure, so it is shown and spoken quietly, like a stopped session turn. */
export function switchyStopped(turn: Pick<SwitchyTurn, "error">): boolean {
  return turn.error === "Stopped by you.";
}

/** Speak terminal answers and approvals once, never individual streaming deltas. */
export function switchyVoiceCue(
  conversation: SwitchyConversation | null,
): { key: string; cue: Cue } | null {
  const turn = conversation?.turns.at(-1);
  if (!turn) return null;
  const approval = turn.approvals?.find((a) => !a.decision);
  if (turn.status === "needs_approval" && approval)
    return {
      key: `${turn.id}:${approval.requestId}`,
      cue: { kind: "approval", text: `Needs your approval: ${approval.title}` },
    };
  if (turn.status === "completed")
    return {
      key: `${turn.id}:completed`,
      cue: { kind: "answer", text: speakable(turn.answer) },
    };
  if (turn.status === "failed" || turn.status === "interrupted")
    return {
      key: `${turn.id}:failed`,
      cue: {
        kind: switchyStopped(turn) ? "stopped" : "failed",
        text: turn.error ?? "The question did not finish.",
      },
    };
  return null;
}
