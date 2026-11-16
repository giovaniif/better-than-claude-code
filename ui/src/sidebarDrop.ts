// Dragging a session row onto a sidebar section: what the drop means, as
// the `session.update` fields to send, or null when the session is already
// where the drop would put it (then the target refuses the drop).

import type { SessionMeta } from "./protocol";
import { cleanGroupName } from "./store";

/** The drag's dataTransfer type; its value is the session id. */
export const SESSION_DRAG_TYPE = "application/x-yard-session";

export type DropTarget = { kind: "group"; name: string } | { kind: "ungrouped" } | { kind: "pinned" };

export interface SidebarUpdate {
  pinned?: boolean;
  group?: string | null;
}

/** A section is a place in the list: a group shows only unpinned members, and
 *  Sessions only unpinned ones without a group, so a drop there unpins too. */
export function dropUpdate(s: SessionMeta, target: DropTarget): SidebarUpdate | null {
  // The row menu does not move archived sessions either.
  if (s.archived) return null;
  const update: SidebarUpdate = {};
  if (target.kind === "pinned") {
    if (s.pinned) return null;
    update.pinned = true;
  } else {
    const group = target.kind === "group" ? cleanGroupName(target.name) : null;
    if (target.kind === "group" && !group) return null;
    if ((s.group ?? null) !== group) update.group = group;
    if (s.pinned) update.pinned = false;
  }
  return Object.keys(update).length ? update : null;
}

/** Whether a drag carries a session row (types are readable during dragover; data is not). */
export const dragHasSession = (dt: DataTransfer | null) => !!dt && Array.from(dt.types).includes(SESSION_DRAG_TYPE);
