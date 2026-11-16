import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { AccountEntry, Attachment, PendingMessage, ChangedFile, Changes, Engine, EngineState, EngineStates, Host, HostEntry, Item, ModelInfo, Models, SessionMeta, Status, ToolItem, Usage } from "./protocol";
import { ROW_LABEL, type RowState, rowState, useSeen } from "./rowState";
import { UsageMeters, UsageStrip } from "./UsageMeters";
import { shownHosts, useHiddenHosts } from "./sidebarHosts";
import { SettingsPage } from "./SettingsPage";
import { accountChoices, accountLabel, accountName, accountOf, choiceOnEngine, usageForPicks, DEFAULT_ACCOUNT, type AccountChoice } from "./accounts";
import { accountsOn, branchKey, cleanGroupName, GROUP_NAME_MAX, sidebarLayout, homeOn, loginKey, hostName, hostOf, hostOnline, modelsOn, routeHash, usageOn, useYard, type Actions, type Route, type State, type UploadTarget } from "./store";
import { dragHasFiles, humanSize, isInlineImage, pastedFiles, tooLarge } from "./attach";
import { TerminalPane } from "./TerminalPane";
import { PrPane } from "./PrPane";
import { ProcPane } from "./ProcPane";
import { onAppend, quoteInComposer, quoteSegments, splitQuotes, withQuotes } from "./compose";
import { blockSegments, type MdTable } from "./markdown";
import { AutomationForm, AutomationsPage } from "./AutomationsPage";
import { hiddenFromSidebar } from "./automations";
import { dragHasSession, dropUpdate, SESSION_DRAG_TYPE, type DropTarget } from "./sidebarDrop";
import { duration, handoffLinks, layout, summarize, thoughtLine, type Row, type WorkItem } from "./thread";

export const ENGINE_NAME: Record<Engine, string> = { claude: "Claude", codex: "Codex" };
/** Permission modes, as Claude Code names them, and what each means per engine. */
export const PERMISSIONS: { id: Permission; label: string; claude: string; codex: string }[] = [
  { id: "ask", label: "Ask first", claude: "Asks before commands and edits", codex: "Sandboxed to the folder, asks to go further" },
  { id: "acceptEdits", label: "Accept edits", claude: "Edits files freely, asks before commands", codex: "Edits in the folder freely, asks to go further" },
  { id: "plan", label: "Plan only", claude: "Reads and plans, changes nothing", codex: "Read-only: looks, never changes" },
  { id: "full", label: "Full access", claude: "Never asks. Runs anything", codex: "No sandbox, never asks" },
];
export const STATUS_LABEL: Record<Status, string> = {
  idle: "Idle",
  queued: "Queued",
  running: "Running",
  needs_approval: "Needs approval",
  error: "Error",
};

export const modelName = (models: Models, engine: Engine, id: string) =>
  models[engine]?.find((m) => m.id === id)?.name ?? id;
const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(bytes > 100 * 1024 ** 3 ? 0 : 1);
const pct = (n: number) => `${Math.round(n)}%`;
export const tilde = (path: string, home: string) => (home && path.startsWith(home) ? "~" + path.slice(home.length) : path);
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ---------- icons ---------- */

export const Icon = ({ d, size = 14, width = 2 }: { d: string; size?: number; width?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
export const PLUS = "M12 5v14M5 12h14";
const CLOCK = "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z";
const IMPORT = "M12 3v12M7 10l5 5 5-5M5 21h14";
export const CHEVRON_RIGHT = "M9 6l6 6-6 6";
const CHEVRON_DOWN = "M6 9l6 6 6-6";
const ARROW_UP = "M12 19V5M5 12l7-7 7 7";
const REFRESH = "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5";
export const CLOUD = "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z";
const PAPERCLIP = "M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48";
const FILE = "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8ZM14 3v5h5";
const CLOSE = "M18 6 6 18M6 6l12 12";
const MORE = "M5 12h.01M12 12h.01M19 12h.01";
const REPLY = "M9 17 4 12l5-5M20 18v-2a4 4 0 0 0-4-4H4";
export const PIN = "M12 17v5M9 3h6l-1 6 4 4H6l4-4-1-6Z";
const ARCHIVE = "M3 4h18v4H3ZM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4";
const GEAR =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z";
const FOLDER_PLUS = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2ZM12 11v6M9 14h6";
const PENCIL = "M4 20h4L19 9l-4-4L4 16ZM13.5 6.5l4 4";
const TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const MENU = "M4 6h16M4 12h16M4 18h16";

/** Marks something on a remote host. Labelled when it is the only sign of it. */
export const Cloud = ({ size = 14, label }: { size?: number; label?: string }) =>
  label ? (
    <svg className="cloud" role="img" aria-label={label} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={CLOUD} />
    </svg>
  ) : (
    <span className="cloud">
      <Icon d={CLOUD} size={size} />
    </span>
  );

/* ---------- app shell ---------- */

const SIDEBAR_W = 248;
const PANE_W = 420;
/** Where the sidebar stops being a column and becomes a drawer (the same width as in styles.css). */
const NARROW = "(max-width: 700px)";

/** Whether the sessions drawer is open, and how to open it, for each page's menu button. */
const DrawerContext = createContext<{ open: boolean; show(): void }>({ open: false, show: () => {} });

export function App() {
  const { state, actions } = useYard();
  const { route } = state;
  const [sidebarW, setSidebarW] = useWidth("yard.sidebarWidth", SIDEBAR_W);
  // Below NARROW the sidebar is a drawer over the page. Picking anything in
  // it, the backdrop or Escape closes it; so does crossing the breakpoint, so
  // it never comes back open by surprise.
  const [drawer, setDrawer] = useState(false);
  useEscape(drawer, () => setDrawer(false));
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const onChange = () => setDrawer(false);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // Routes that change without a pick (an import's or a notification's session opening) close it too.
  const where = routeHash(route);
  useEffect(() => setDrawer(false), [where]);
  const drawerCtx = useMemo(() => ({ open: drawer, show: () => setDrawer(true) }), [drawer]);
  const sidebarActions = useMemo<Actions>(
    () => ({
      ...actions,
      go: (r: Route) => {
        setDrawer(false);
        actions.go(r);
      },
    }),
    [actions],
  );
  // A file dropped beside the composer would otherwise make the page (or
  // the app's webview) navigate to it.
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (dragHasFiles(e.dataTransfer)) e.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
  return (
    <DrawerContext.Provider value={drawerCtx}>
      <div className={`app ${drawer ? "drawer-open" : ""}`} style={{ "--sidebar-w": `${sidebarW}px` } as CSSProperties}>
        <Sidebar state={state} actions={sidebarActions} open={drawer} />
        {drawer && <div className="drawer-backdrop" aria-hidden="true" onClick={() => setDrawer(false)} />}
        <Resizer
          width={sidebarW}
          min={180}
          max={480}
          initial={SIDEBAR_W}
          dir={1}
          cssVar="--sidebar-w"
          label="Resize the sessions sidebar"
          onWidth={setSidebarW}
        />
        <div className="main" inert={drawer || undefined}>
          {!state.connected && <div className="banner">yardd is not reachable. Reconnecting.</div>}
          {state.error && (
            <div className="banner banner-error">
              <span>{state.error}</span>
              <button className="btn-text" onClick={actions.dismissError}>
                Dismiss
              </button>
            </div>
          )}
          {state.notice && !state.error && (
            <div className="banner banner-notice">
              <span>{state.notice}</span>
              <button className="btn-text" onClick={actions.dismissError}>
                Dismiss
              </button>
            </div>
          )}
          {route.page === "new" && (
            <>
              {/* The page has no bar of its own; narrow windows need one for the menu button. */}
              <header className="bar bar-narrow">
                <MenuButton />
                <h2>New session</h2>
              </header>
              <NewSession state={state} actions={actions} />
            </>
          )}
          {route.page === "hosts" && <Hosts state={state} actions={actions} />}
          {route.page === "settings" && <SettingsPage state={state} actions={actions} />}
          {route.page === "automations" && <AutomationsPage state={state} actions={actions} />}
          {route.page === "automation" &&
            // The form reads its automation once, on mount: after a reload it waits on the list
            // until the host's snapshot has it, instead of opening blank and saving a copy.
            (route.id === "new" || state.automations[route.host]?.some((a) => a.id === route.id) ? (
              <AutomationForm key={`${route.host}/${route.id}`} state={state} actions={actions} host={route.host} id={route.id} />
            ) : (
              <AutomationsPage state={state} actions={actions} />
            ))}
          {route.page === "session" && state.sessions[route.id] && (
            <SessionView key={route.id} meta={state.sessions[route.id]} state={state} actions={actions} />
          )}
        </div>
      </div>
    </DrawerContext.Provider>
  );
}

/** First in each page's bar on narrow windows: opens the sessions drawer.
 *  Hidden where the sidebar is a column. */
export function MenuButton() {
  const { open, show } = useContext(DrawerContext);
  return (
    <button className="btn-icon menu-button" aria-label="Open sessions" aria-controls="sidebar" aria-expanded={open} onClick={show}>
      <Icon d={MENU} size={18} />
    </button>
  );
}

/** A width the user drags, kept per browser. */
function useWidth(key: string, initial: number): [number, (w: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return saved > 0 ? saved : initial;
    } catch {
      return initial;
    }
  });
  const set = (w: number) => {
    setWidth(w);
    try {
      localStorage.setItem(key, String(Math.round(w)));
    } catch {
      /* the width just isn't remembered */
    }
  };
  return [width, set];
}

/** A drag handle on a panel's edge. `dir` is 1 when dragging right widens the
 *  panel (a left sidebar), -1 when dragging left does (a right pane).
 *  Double-click restores the default; arrow keys nudge it. */
function Resizer(props: {
  width: number;
  min: number;
  max: number;
  initial: number;
  dir: 1 | -1;
  /** The CSS variable on the handle's parent that holds the width. */
  cssVar: string;
  label: string;
  onWidth(w: number): void;
}) {
  const { width, min, max, dir, onWidth } = props;
  const clamp = (w: number) => Math.min(Math.max(w, min), Math.max(min, max));
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDragging(true);
    // While dragging only the CSS variable moves, so nothing re-renders;
    // the width is kept on release.
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = clamp(startW + dir * (ev.clientX - startX));
      el.parentElement?.style.setProperty(props.cssVar, `${w}px`);
    };
    const up = () => {
      onWidth(w);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      setDragging(false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  return (
    <div
      className={`resizer resizer-${dir === 1 ? "right" : "left"} ${dragging ? "dragging" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={() => onWidth(props.initial)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 48 : 16;
        if (e.key === "ArrowLeft") onWidth(clamp(width - dir * step));
        else if (e.key === "ArrowRight") onWidth(clamp(width + dir * step));
        else return;
        e.preventDefault();
      }}
    />
  );
}

/** A session in the sidebar, with Pin, Archive and Delete in a menu on the
 *  row (the … button, or right-click). */
/** The row's status mark. Shapes differ as well as colors, so the states
 *  read without color too; the label next to the model says it in words. */
function RowMark({ state }: { state: RowState }) {
  return (
    <span className={`mark mark-${state}`} aria-hidden="true">
      {state === "approval" && <span className="mark-bang">!</span>}
    </span>
  );
}

/** Dragging a row onto a sidebar section moves it there; the Sidebar owns the drop side. */
interface RowDrag {
  dragging: boolean;
  start(id: string): void;
  end(): void;
}

function SessionRow({ state, actions, session: s, active, groups, seenAt, drag }: { state: State; actions: Actions; session: SessionMeta; active: boolean; groups: string[]; seenAt: number; drag?: RowDrag }) {
  const host = hostOf(s);
  const online = host === "local" || hostOnline(state, host);
  const mark = rowState(s, seenAt, online);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // The menu's group pages: the list of groups, then the name field for a new one.
  const [groupPage, setGroupPage] = useState<"list" | "new" | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = () => {
    setMenu(false);
    setConfirm(false);
    setGroupPage(null);
    setNewGroup("");
    setPos(null);
  };
  useEscape(menu, close);
  // The menu lives on document.body at a fixed position. Inside the sidebar
  // the scrolling list clipped it whenever the sidebar was narrower than the
  // menu or the row sat near the list's edge. It opens under the … button,
  // flips above when there is no room below, and stays inside the window.
  useLayoutEffect(() => {
    if (!menu || !more.current || !pop.current) return;
    const at = more.current.getBoundingClientRect();
    const { width, height } = pop.current.getBoundingClientRect();
    const gap = 4;
    const edge = 8;
    const left = Math.max(edge, Math.min(at.right - width, window.innerWidth - width - edge));
    const below = at.bottom + gap;
    const above = at.top - gap - height;
    const top = below + height <= window.innerHeight - edge || above < edge ? below : above;
    setPos({ left, top: Math.max(edge, Math.min(top, window.innerHeight - height - edge)) });
  }, [menu, confirm, groupPage]);
  useEffect(() => {
    if (!menu) return;
    // pointerdown, not mousedown: the sidebar's resize handle cancels the
    // mousedown, and dragging it would strand the menu away from its row.
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    // A fixed menu would drift away from its row, so scrolling closes it.
    const scrolled = (e: Event) => !pop.current?.contains(e.target as Node) && close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  const rowAccount = accountLabel(accountsOn(state, host), s);
  const worktree = !!(s.branch && s.repo);
  const remove = (removeWorktree: boolean) => {
    close();
    actions.remove(s.id, removeWorktree);
  };
  const moveTo = (group: string | null) => {
    close();
    actions.setGroup(s.id, group);
  };
  return (
    <div
      ref={box}
      className={`session-item ${menu ? "menu-open" : ""} ${drag?.dragging ? "dragging" : ""}`}
      // Like the menu's Move to group, only for a live row on a reachable host.
      draggable={!!drag && online && !s.archived}
      onDragStart={(e) => {
        if (!drag) return;
        e.dataTransfer.setData(SESSION_DRAG_TYPE, s.id);
        e.dataTransfer.effectAllowed = "move";
        close();
        drag.start(s.id);
      }}
      onDragEnd={() => drag?.end()}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
    >
      <button
        className={`session-row ${active ? "active" : ""} ${online ? "" : "offline"} ${mark === "answered" ? "unread" : ""}`}
        onClick={() => actions.go({ page: "session", id: s.id })}
      >
        <RowMark state={mark} />
        <span className="session-text">
          <span className="session-title">{s.title}</span>
          <span className="session-sub">
            {modelName(modelsOn(state, host), s.engine, s.model)} · <span className={`row-status row-status-${mark}`}>{ROW_LABEL[mark]}</span>
            {rowAccount && <span className="row-account"> · {rowAccount}</span>}
          </span>
        </span>
        {host !== "local" && <Cloud size={14} label={`Runs on ${hostName(state, host)}`} />}
      </button>
      <button ref={more} className="btn-icon row-more" aria-label={`Actions for ${s.title}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => (menu ? close() : setMenu(true))}>
        <Icon d={MORE} size={16} />
      </button>
      {menu &&
        createPortal(
          <div ref={pop} className="row-menu" role="menu" style={pos ?? { left: 0, top: 0, visibility: "hidden" }}>
            {groupPage === "list" ? (
              <>
                <div className="row-menu-note">Move to group</div>
                {groups
                  .filter((g) => g !== s.group)
                  .map((g) => (
                    <button key={g} className="picker-item menu-item" role="menuitem" onClick={() => moveTo(g)}>
                      <Icon d={FOLDER} size={14} />
                      <span className="menu-label">{g}</span>
                    </button>
                  ))}
                <button className="picker-item menu-item" role="menuitem" onClick={() => setGroupPage("new")}>
                  <Icon d={FOLDER_PLUS} size={14} />
                  New group…
                </button>
              </>
            ) : groupPage === "new" ? (
              <form
                className="row-menu-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = cleanGroupName(newGroup);
                  if (name) moveTo(name);
                }}
              >
                <input
                  className="field"
                  autoFocus
                  aria-label="Group name"
                  placeholder="Group name"
                  maxLength={GROUP_NAME_MAX}
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                />
              </form>
            ) : !confirm ? (
              <>
                {!s.archived && (
                  <button className="picker-item menu-item" role="menuitem" disabled={!online} onClick={() => (actions.setPinned(s.id, !s.pinned), close())}>
                    <Icon d={PIN} size={14} />
                    {s.pinned ? "Unpin" : "Pin"}
                  </button>
                )}
                {!s.archived && (
                  <button className="picker-item menu-item" role="menuitem" disabled={!online} onClick={() => setGroupPage("list")}>
                    <Icon d={FOLDER} size={14} />
                    Move to group…
                  </button>
                )}
                {!s.archived && s.group && (
                  <button className="picker-item menu-item" role="menuitem" disabled={!online} onClick={() => moveTo(null)}>
                    <Icon d={CLOSE} size={14} />
                    Remove from group
                  </button>
                )}
                <button className="picker-item menu-item" role="menuitem" disabled={!online} onClick={() => (actions.setArchived(s.id, !s.archived), close())}>
                  <Icon d={ARCHIVE} size={14} />
                  {s.archived ? "Restore" : "Archive"}
                </button>
                <div className="menu-divider" />
                <button className="picker-item menu-item danger" role="menuitem" disabled={!online} onClick={() => setConfirm(true)}>
                  <Icon d={TRASH} size={14} />
                  Delete…
                </button>
              </>
            ) : (
              <>
                <div className="row-menu-note">
                  {s.status === "running" || s.status === "needs_approval" ? "It is still working; deleting stops it. " : ""}
                  This can't be undone.
                </div>
                <button className="picker-item menu-item danger" role="menuitem" onClick={() => remove(false)}>
                  {worktree ? "Delete, keep the worktree" : "Delete session"}
                </button>
                {worktree && (
                  <button className="picker-item menu-item danger" role="menuitem" onClick={() => remove(true)}>
                    Delete and remove the worktree
                  </button>
                )}
                <button className="picker-item menu-item" role="menuitem" onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** How long a drag rests on a collapsed group before it opens. */
const SPRING_OPEN_MS = 600;

/** Whether a media query matches, following changes. */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Which groups the user folded in this browser. */
const COLLAPSED_KEY = "yard.groups.collapsed";
function useCollapsedGroups(): [Set<string>, (name: string) => void] {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? "[]");
      return new Set(Array.isArray(saved) ? saved.filter((n) => typeof n === "string") : []);
    } catch {
      return new Set();
    }
  });
  const toggle = (name: string) =>
    setCollapsed((was) => {
      const next = new Set(was);
      if (!next.delete(name)) next.add(name);
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      return next;
    });
  return [collapsed, toggle];
}

/** A group's header: the name, how many sessions, a chevron; its menu renames
 *  or ungroups every session in it, archived ones included. */
function GroupHead({ name, count, open, onToggle, members, actions }: { name: string; count: number; open: boolean; onToggle(): void; members: SessionMeta[]; actions: Actions }) {
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = () => {
    setMenu(false);
    setPos(null);
  };
  useEscape(menu, close);
  // Leaving the field by Escape or Enter must not commit a second time through blur.
  const done = useRef(false);
  useLayoutEffect(() => {
    if (!menu || !more.current || !pop.current) return;
    const at = more.current.getBoundingClientRect();
    const { width, height } = pop.current.getBoundingClientRect();
    const edge = 8;
    const left = Math.max(edge, Math.min(at.right - width, window.innerWidth - width - edge));
    const below = at.bottom + 4;
    const above = at.top - 4 - height;
    const top = below + height <= window.innerHeight - edge || above < edge ? below : above;
    setPos({ left, top: Math.max(edge, Math.min(top, window.innerHeight - height - edge)) });
  }, [menu]);
  useEffect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!more.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    const scrolled = (e: Event) => !pop.current?.contains(e.target as Node) && close();
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  const rename = () => {
    if (done.current) return;
    done.current = true;
    const next = cleanGroupName(draft);
    setRenaming(false);
    if (!next || next === name) return;
    for (const s of members) actions.setGroup(s.id, next);
  };
  return (
    <div className={`group-head session-item ${menu ? "menu-open" : ""}`}>
      {renaming ? (
        <input
          className="field group-rename"
          autoFocus
          aria-label="Group name"
          maxLength={GROUP_NAME_MAX}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.preventDefault(), rename());
            else if (e.key === "Escape") (done.current = true, setRenaming(false));
          }}
        />
      ) : (
        <button className="list-head list-toggle group-toggle" aria-expanded={open} onClick={onToggle}>
          <span className={`tool-chevron ${open ? "open" : ""}`}>
            <Icon d={CHEVRON_RIGHT} size={11} />
          </span>
          <span className="group-name">{name}</span>
          <span className="muted">{count}</span>
        </button>
      )}
      {!renaming && (
        <button ref={more} className="btn-icon row-more" aria-label={`Actions for group ${name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => (menu ? close() : setMenu(true))}>
          <Icon d={MORE} size={16} />
        </button>
      )}
      {menu &&
        createPortal(
          <div ref={pop} className="row-menu" role="menu" style={pos ?? { left: 0, top: 0, visibility: "hidden" }}>
            <button
              className="picker-item menu-item"
              role="menuitem"
              onClick={() => {
                close();
                setDraft(name);
                done.current = false;
                setRenaming(true);
              }}
            >
              <Icon d={PENCIL} size={14} />
              Rename
            </button>
            <button
              className="picker-item menu-item"
              role="menuitem"
              onClick={() => {
                close();
                for (const s of members) actions.setGroup(s.id, null);
              }}
            >
              <Icon d={CLOSE} size={14} />
              Ungroup
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Sidebar({ state, actions, open }: { state: State; actions: Actions; open: boolean }) {
  // Runs of automations live on the Automations page, not in this list.
  const everything = Object.values(state.sessions);
  const all = everything.filter((s) => !hiddenFromSidebar(s));
  const { pinned, ungrouped: active, groups, archived } = sidebarLayout(all);
  // Every group a session can be moved to, including ones whose only live
  // members are pinned.
  const groupNames = [...new Set(all.filter((s) => s.group && !s.archived).map((s) => s.group as string))].sort((a, b) => a.localeCompare(b));
  const [collapsed, toggleGroup] = useCollapsedGroups();
  const { route } = state;
  // The hosts picked in Settings: their rows, and their plan usage in the strip.
  const shown = shownHosts(["local", ...state.hosts.map((h) => h.id)], useHiddenHosts());
  const narrow = useMedia(NARROW);
  // The row being dragged. The ref answers dragover at once; the state (the
  // dimmed row, the empty Sessions slot) renders a tick later, because
  // changing the page inside dragstart can cancel the drag or tint its image.
  const dragRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setOver(null);
  };
  const rowDrag = (id: string): RowDrag => ({
    dragging: dragId === id,
    start: (sid) => {
      dragRef.current = sid;
      setTimeout(() => dragRef.current === sid && setDragId(sid), 0);
    },
    end: endDrag,
  });
  // A section takes a drop only when it would change something; elsewhere the
  // cursor says no and nothing lights up.
  const dropZone = (key: string, target: DropTarget) => ({
    className: `drop-zone ${over === key ? "drop-over" : ""}`,
    onDragOver: (e: ReactDragEvent<HTMLDivElement>) => {
      if (!dragHasSession(e.dataTransfer)) return;
      const s = dragRef.current ? state.sessions[dragRef.current] : undefined;
      if (!s || !dropUpdate(s, target)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== key) setOver(key);
    },
    onDragLeave: (e: ReactDragEvent<HTMLDivElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === key ? null : o));
    },
    onDrop: (e: ReactDragEvent<HTMLDivElement>) => {
      const id = e.dataTransfer.getData(SESSION_DRAG_TYPE);
      const s = state.sessions[id];
      const update = s && dropUpdate(s, target);
      endDrag();
      if (!update) return;
      e.preventDefault();
      actions.place(id, update);
    },
  });
  // A collapsed group opens after the drag rests on it for a moment.
  const overGroup = over?.startsWith("group:") ? over.slice(6) : null;
  useEffect(() => {
    if (overGroup === null || !collapsed.has(overGroup)) return;
    const t = setTimeout(() => toggleGroup(overGroup), SPRING_OPEN_MS);
    return () => clearTimeout(t);
  }, [overGroup, collapsed]);
  const dragged = dragId ? state.sessions[dragId] : undefined;
  // Runs of automations live on the Automations page, not in this list.
  const runs = everything.filter(hiddenFromSidebar);
  const inRun = route.page === "session" && !!state.sessions[route.id]?.automation;
  const seenAt = useSeen(state.sessions, route.page === "session" ? route.id : null);
  // Opening an archived session shows the section, so its row stays in view.
  const openArchived = route.page === "session" && !!state.sessions[route.id]?.archived;
  const [showArchived, setShowArchived] = useState(openArchived);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    if (openArchived) setShowArchived(true);
  }, [openArchived]);
  // Opened as a drawer, focus moves into it, so the keyboard is where the eyes are.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    if (open) nav.current?.querySelector<HTMLElement>(".nav-row")?.focus();
  }, [open]);
  const row = (s: SessionMeta) => (
    <SessionRow
      key={s.id}
      state={state}
      actions={actions}
      session={s}
      groups={groupNames}
      active={route.page === "session" && route.id === s.id}
      seenAt={seenAt(s.id)}
      // Touch has no HTML5 drag; in the phone drawer the row menu moves sessions.
      drag={narrow ? undefined : rowDrag(s.id)}
    />
  );
  // With no ungrouped rows there is nothing to drop on to leave a group, so a slot stands in.
  const ungroupSlot = active.length === 0 && !!dragged && !!dropUpdate(dragged, { kind: "ungrouped" });
  return (
    <nav ref={nav} id="sidebar" className="sidebar" aria-label="Sessions">
      <div className="brand">Switchyard</div>
      <div className="sidebar-top">
        <button className={`nav-row ${route.page === "new" ? "active" : ""}`} onClick={() => actions.go({ page: "new" })}>
          <Icon d={PLUS} />
          New session
        </button>
        <button className={`nav-row ${route.page === "automations" || route.page === "automation" || inRun ? "active" : ""}`} onClick={() => actions.go({ page: "automations" })}>
          <Icon d={CLOCK} />
          Automations
          {runs.some((s) => s.status === "running" || s.status === "needs_approval") && <span className="dot dot-running" role="img" aria-label="A run is working" />}
        </button>
        <button className="nav-row" onClick={() => setImporting(true)}>
          <Icon d={IMPORT} />
          Import
        </button>
        {importing && <ImportDialog state={state} actions={actions} onClose={() => setImporting(false)} />}
        <button className={`nav-row ${route.page === "settings" ? "active" : ""}`} onClick={() => actions.go({ page: "settings" })}>
          <Icon d={GEAR} />
          Settings
        </button>
      </div>
      <div className="session-list">
        {pinned.length > 0 && (
          <div {...dropZone("pinned", { kind: "pinned" })}>
            <div className="list-head">Pinned</div>
            {pinned.map(row)}
          </div>
        )}
        {(active.length > 0 || ungroupSlot) && (
          <div {...dropZone("ungrouped", { kind: "ungrouped" })}>
            {pinned.length > 0 && active.length > 0 && <div className="list-head">Sessions</div>}
            {active.map(row)}
            {ungroupSlot && <div className="drop-slot">{dragged?.group ? "Drop here to remove from group" : "Drop here to unpin"}</div>}
          </div>
        )}
        {all.length === 0 && <div className="empty">No sessions yet.</div>}
        {groups.map((g) => {
          const zone = dropZone(`group:${g.name}`, { kind: "group", name: g.name });
          return (
            <div key={g.name} {...zone} className={`${zone.className} group-zone`}>
              <GroupHead
                name={g.name}
                count={g.sessions.length}
                open={!collapsed.has(g.name)}
                onToggle={() => toggleGroup(g.name)}
                members={all.filter((s) => s.group === g.name)}
                actions={actions}
              />
              {!collapsed.has(g.name) && g.sessions.map(row)}
            </div>
          );
        })}
      </div>
      {archived.length > 0 && (
        <div className="archived-dock">
          <button className="list-head list-toggle" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
            <span>Archived</span>
            <span className="muted">{archived.length}</span>
            <span className={`tool-chevron ${showArchived ? "open" : ""}`}>
              <Icon d={CHEVRON_RIGHT} size={11} />
            </span>
          </button>
          {showArchived && <div className="archived-list">{archived.map(row)}</div>}
        </div>
      )}
      <UsageStrip sources={shown.map((host) => ({ host, usage: usageOn(state, host), accounts: accountsOn(state, host) }))} />
      {shown.length > 0 && (
        <div className="sidebar-bottom">
          {shown.map((id) => {
            const stats = state.host[id];
            const status = hostState(state, id);
            return (
              <button key={id} className="host-row" onClick={() => actions.go({ page: "hosts" })} title={HOST_STATE_LABEL[status]}>
                <span className={`dot host-dot-${status}`} aria-hidden="true" />
                <span className="host-name">{hostName(state, id)}</span>
                {id !== "local" && <Cloud size={12} />}
                <span className="spacer" />
                <span className="host-stat">
                  {(status === "ok" || status === "busy") && stats
                    ? `${pct(stats.cpu)} · ${pct((stats.memUsed / stats.memTotal) * 100)}`
                    : HOST_STATE_LABEL[status]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
}

/** yardd's own verdict (the one its queue uses) when it sends one. */
const hostPressure = (h: Host) =>
  h.pressure !== undefined ? !!h.pressure : h.load > h.cores || h.memUsed / h.memTotal > 0.9;

/* ---------- model picker ---------- */

export interface Choice {
  engine: Engine;
  model: string;
  effort: string;
}

export function effortFor(model: ModelInfo | undefined, wanted: string): string {
  if (!model) return wanted;
  if (model.efforts.includes(wanted)) return wanted;
  return model.defaultEffort ?? model.efforts[0] ?? wanted;
}

/** What the engine may do without asking. Changing it mid-session applies
 *  to Claude at once and to Codex from its next turn. */
export function PermissionPicker({ engine, value, onChange }: { engine: Engine; value: Permission; onChange(p: Permission): void }) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  const current = PERMISSIONS.find((p) => p.id === value) ?? PERMISSIONS[0];
  return (
    <div className="picker">
      <button
        className={`btn-quiet permission ${value === "full" ? "permission-full" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={current[engine]}
        onClick={() => setOpen(!open)}
      >
        <span>{current.label}</span>
        <span className="muted">
          <Icon d={CHEVRON_DOWN} size={12} />
        </span>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className="popover permission-menu" role="menu">
            {PERMISSIONS.map((p) => (
              <button
                key={p.id}
                role="menuitemradio"
                aria-checked={p.id === value}
                className={`picker-item permission-item ${p.id === value ? "active" : ""}`}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              >
                <span className="permission-label">{p.label}</span>
                <span className="muted small">{p[engine]}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function ModelPicker(props: {
  models: Models;
  usage: Usage;
  value: Choice;
  engines: Engine[];
  /** The host's added accounts. An engine with any gets an account row; shown only where there is a choice. */
  accounts?: AccountEntry[];
  /** The account picked per engine; Default where missing. */
  picks?: Partial<Record<Engine, string>>;
  /** Without it the account is fixed (a session's) and only named. */
  onAccount?(engine: Engine, account: string): void;
  onChange(next: Choice): void;
  /** In a session, a model of the other engine means a hand-off, never a silent switch. */
  handoff?: { blocked: boolean; onConfirm(next: Choice): void };
}) {
  const { models, usage, value, engines, onChange, handoff, accounts, picks, onAccount } = props;
  const choicesOf = (engine: Engine): AccountChoice[] => accountChoices(accounts, engine);
  const pickOf = (engine: Engine) => picks?.[engine] ?? DEFAULT_ACCOUNT;
  const triggerAccount = choicesOf(value.engine).length > 1 ? accountName(accounts, value.engine, pickOf(value.engine)) : null;
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Choice | null>(null);
  // The engine not in use starts folded.
  const [expanded, setExpanded] = useState(false);
  const ordered = [value.engine, ...engines.filter((e) => e !== value.engine)];
  // The confirmation sits at the top of the list, which is usually scrolled
  // down to the model that was just clicked. Bring it into view.
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirm) popover.current?.scrollTo({ top: 0 });
  }, [confirm]);
  const current = models[value.engine]?.find((m) => m.id === value.model);
  const close = () => {
    setOpen(false);
    setConfirm(null);
    setExpanded(false);
  };
  useEscape(open, close);
  return (
    <div className="picker">
      <button className="btn-quiet" aria-haspopup="true" aria-expanded={open} onClick={() => (open ? close() : setOpen(true))}>
        <span>{current?.name ?? value.model}</span>
        <span className="muted">{capitalize(value.effort)}</span>
        {triggerAccount && <span className="muted picker-account">{triggerAccount}</span>}
        <span className="muted">
          <Icon d={CHEVRON_DOWN} size={12} />
        </span>
      </button>
      {open && (
        <>
          <div className="scrim" onClick={close} />
          <div className="popover model-popover" ref={popover}>
            {confirm && handoff && (
              <div className="handoff-confirm" role="group" aria-label="Confirm hand-off">
                <div>
                  <strong>Hand off to {ENGINE_NAME[confirm.engine]}</strong>: starts a new session in this folder with a summary of this one.
                </div>
                <div className="muted small">
                  {modelName(models, confirm.engine, confirm.model)} · {capitalize(confirm.effort)}
                </div>
                <div className="row">
                  <button
                    className="btn-primary"
                    disabled={handoff.blocked}
                    onClick={() => {
                      handoff.onConfirm(confirm);
                      close();
                    }}
                  >
                    Hand off
                  </button>
                  <button className="btn-text" onClick={() => setConfirm(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            <UsageMeters usage={usage} first={value.engine} />
            {ordered.map((engine) => {
              const isHandoff = !!handoff && engine !== value.engine;
              const disabled = isHandoff && handoff.blocked;
              const list = models[engine];
              // The engine in use is open; the other is one row until asked for.
              const folded = engine !== value.engine && !expanded;
              return (
                <div key={engine} className="picker-group">
                  {folded ? (
                    <button className="picker-fold" aria-expanded={false} onClick={() => setExpanded(true)}>
                      <span>
                        {ENGINE_NAME[engine]} · {list.length} {list.length === 1 ? "model" : "models"}
                        {handoff ? " · switching hands off" : ""}
                      </span>
                      <span className="muted">
                        <Icon d={CHEVRON_RIGHT} size={12} />
                      </span>
                    </button>
                  ) : (
                    <>
                      <div className="picker-head">
                        <span>{ENGINE_NAME[engine]}</span>
                      </div>
                      {choicesOf(engine).length > 1 && onAccount && !isHandoff && (
                        <div className="picker-accounts" role="group" aria-label={`${ENGINE_NAME[engine]} account`}>
                          {choicesOf(engine).map((a) => (
                            <button
                              key={a.id}
                              className={`effort ${a.id === pickOf(engine) ? "active" : ""}`}
                              aria-label={`Use account ${a.name}`}
                              aria-pressed={a.id === pickOf(engine)}
                              onClick={() => onAccount(engine, a.id)}
                            >
                              {a.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {choicesOf(engine).length > 1 && !onAccount && engine === value.engine && (
                        <div className="picker-note">Runs on the {accountName(accounts, engine, pickOf(engine))} account. It can't change mid-session.</div>
                      )}
                      {isHandoff && (
                        <div className="picker-note">{disabled ? "Stop the running turn to hand off." : "Picking one hands off to a new session."}</div>
                      )}
                      {list.length === 0 && <div className="picker-empty">Not available</div>}
                      {list.map((m) => {
                        const isCurrent = engine === value.engine && m.id === value.model;
                        return (
                          <button
                            key={m.id}
                            disabled={disabled}
                            aria-current={isCurrent ? "true" : undefined}
                            className={`picker-item picker-model ${isCurrent ? "active" : ""} ${
                              confirm?.engine === engine && confirm.model === m.id ? "active" : ""
                            }`}
                            onClick={() => {
                              const next = { engine, model: m.id, effort: effortFor(m, value.effort) };
                              if (isHandoff) {
                                setConfirm(next);
                                return;
                              }
                              onChange(next);
                              close();
                            }}
                          >
                            <span>{m.name}</span>
                            {isCurrent && <Icon d={CHECK} size={13} />}
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              );
            })}
            {current && current.efforts.length > 0 && (
              <div className="picker-group">
                <div className="picker-head">
                  <span>Effort</span>
                </div>
                <div className="efforts">
                  {current.efforts.map((e) => (
                    <button key={e} className={`effort ${e === value.effort ? "active" : ""}`} onClick={() => onChange({ ...value, effort: e })}>
                      {capitalize(e)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- composer ---------- */

/** A file in the composer, uploaded as soon as it is added so sending is quick. */
interface PendingFile {
  key: string;
  file: File;
  /** Object URL for a local preview of an image. */
  preview?: string;
  state: "uploading" | "ready" | "error";
  error?: string;
}

function Composer(props: {
  placeholder: string;
  rows: number;
  large?: boolean;
  busy?: boolean;
  /** A turn is running: sending queues the message for the agent's next step. */
  queueing?: boolean;
  /** Up arrow in an empty box: take the last queued message back to edit. True when it did. */
  onEditLastQueued?(): boolean;
  /** Keep the text and files after sending, for a submit that can still fail. */
  keepText?: boolean;
  /** Session whose terminal can add text here (see compose.ts). */
  appendFor?: string;
  /** Where attached files are stored: the host the prompt will run on. */
  target: UploadTarget;
  upload(file: File, target: UploadTarget): Promise<Attachment>;
  onSubmit(text: string, attachments: Attachment[]): void;
  children: ReactNode;
}) {
  const [text, setText] = useState("");
  // Parts of answers being replied to: cards above the text, sent as
  // blockquotes before it (compose.ts).
  const [quotes, setQuotes] = useState<{ key: string; text: string }[]>([]);
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  // The upload under way or done for each file, and the target it went to.
  const uploads = useRef(new Map<string, { target: string; promise: Promise<Attachment> }>());
  const picker = useRef<HTMLInputElement>(null);
  const targetKey = JSON.stringify(props.target);
  // Start one line tall and grow with the text, up to a cap.
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!props.appendFor) return;
    return onAppend(props.appendFor, (added) => {
      const more = added.quotes ?? [];
      if (more.length) setQuotes((q) => [...q, ...more.map((text) => ({ key: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, text }))]);
      const typed = added.text;
      if (typed) setText((t) => (t && !t.endsWith("\n") ? t + "\n" : t) + typed);
      const el = area.current;
      if (!el) return;
      el.focus();
      // After React writes the new value, put the caret at the end.
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = el.value.length;
        el.scrollTop = el.scrollHeight;
      });
    });
  }, [props.appendFor]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const patch = (key: string, change: Partial<PendingFile>) =>
    setFiles((list) => list.map((f) => (f.key === key ? { ...f, ...change } : f)));

  const startUpload = (f: PendingFile) => {
    const promise = props.upload(f.file, props.target);
    const entry = { target: targetKey, promise };
    uploads.current.set(f.key, entry);
    patch(f.key, { state: "uploading", error: undefined });
    promise.then(
      // A newer upload of the same file (the host changed) owns the chip.
      () => uploads.current.get(f.key) === entry && patch(f.key, { state: "ready" }),
      (e) => uploads.current.get(f.key) === entry && patch(f.key, { state: "error", error: String(e?.message ?? e) }),
    );
    return promise;
  };

  const addFiles = (list: File[]) => {
    if (!list.length) return;
    const added = list.map((file): PendingFile => {
      const big = tooLarge(file.size);
      return {
        key: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        file,
        preview: !big && file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
        state: big ? "error" : "uploading",
        error: big ?? undefined,
      };
    });
    setFiles((cur) => [...cur, ...added]);
    added.filter((f) => f.state !== "error").forEach(startUpload);
    area.current?.focus();
  };

  const removeFile = (key: string) => {
    uploads.current.delete(key);
    const gone = files.find((f) => f.key === key);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setFiles((list) => list.filter((f) => f.key !== key));
    // The clicked button is gone; Enter should still send.
    area.current?.focus();
  };

  // Files go to the host the prompt runs on; picking another host re-sends them.
  useEffect(() => {
    files.forEach((f) => {
      const u = uploads.current.get(f.key);
      if (u && u.target !== targetKey) startUpload(f);
    });
  }, [targetKey]);

  // Previews are freed when the composer goes away.
  const live = useRef(files);
  live.current = files;
  useEffect(() => () => live.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview)), []);

  const failed = files.some((f) => f.state === "error");
  // Quotes alone can go, like files alone: "this" with the part pointed at.
  const canSend = (text.trim() !== "" || quotes.length > 0 || files.length > 0) && !failed && !props.busy && !sending;
  const submit = async () => {
    const value = withQuotes(
      quotes.map((q) => q.text),
      text.trim(),
    );
    if (!canSend) return;
    setSending(true);
    try {
      const attachments = await Promise.all(
        files.map((f) => {
          const u = uploads.current.get(f.key);
          return u && u.target === targetKey ? u.promise : startUpload(f);
        }),
      );
      props.onSubmit(value, attachments);
      if (!props.keepText) {
        setText("");
        setQuotes([]);
        files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
        uploads.current.clear();
        setFiles([]);
      }
    } catch {
      // The chip that failed says why.
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "ArrowUp" && text === "" && props.onEditLastQueued?.()) {
      e.preventDefault();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <div
      className={`composer ${props.large ? "composer-large" : ""} ${dragging ? "composer-drop" : ""}`}
      onDragOver={(e) => {
        if (!dragHasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(e) => {
        setDragging(false);
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {files.length > 0 && (
        <div className="attachments" aria-label="Attachments">
          {files.map((f) => (
            <PendingChip key={f.key} file={f} onRemove={() => removeFile(f.key)} />
          ))}
        </div>
      )}
      {quotes.length > 0 && (
        <div className="composer-quotes" aria-label="Quoted">
          {quotes.map((q) => (
            <QuoteCard
              key={q.key}
              text={q.text}
              onRemove={() => {
                setQuotes((list) => list.filter((x) => x.key !== q.key));
                area.current?.focus();
              }}
            />
          ))}
        </div>
      )}
      <textarea
        ref={area}
        aria-label="Message"
        rows={props.rows}
        placeholder={props.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const pasted = pastedFiles(e.clipboardData);
          if (!pasted.length) return;
          e.preventDefault();
          addFiles(pasted);
        }}
        autoFocus
      />
      <div className="composer-row">
        <button className="btn-icon attach-btn" aria-label="Attach files" title="Attach files" onClick={() => picker.current?.click()}>
          <Icon d={PAPERCLIP} size={16} />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Attach files"
          onChange={(e) => {
            addFiles(Array.from(e.currentTarget.files ?? []));
            // Picking the same file again must fire a change.
            e.currentTarget.value = "";
          }}
        />
        {props.children}
        <span className="spacer" />
        <button
          className="send"
          aria-label={props.queueing ? "Add to queue" : "Send"}
          title={props.queueing ? "The agent reads it after its current step" : undefined}
          disabled={!canSend}
          onClick={submit}
        >
          {sending ? <span className="send-wait" aria-label="Uploading" /> : <Icon d={ARROW_UP} width={2.5} />}
        </button>
      </div>
    </div>
  );
}

/** A quote waiting in the reply box: two lines, More shows the rest. */
function QuoteCard({ text, onRemove }: { text: string; onRemove(): void }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = body.current;
    if (el && !open) setCut(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div className={`quote-card${open ? " open" : ""}`}>
      <div ref={body} className="quote-card-text">
        {text}
      </div>
      {(cut || open) && (
        <button className="btn-text" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
      <button className="btn-icon" aria-label="Remove quote" title="Remove quote" onClick={onRemove}>
        <Icon d={CLOSE} size={12} />
      </button>
    </div>
  );
}

function PendingChip({ file, onRemove }: { file: PendingFile; onRemove(): void }) {
  const [broken, setBroken] = useState(false);
  const { state } = file;
  return (
    <div className={`attachment attachment-${state}`} title={file.error ?? file.file.name}>
      {file.preview && !broken ? (
        <img className="attachment-thumb" src={file.preview} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="attachment-icon">
          <Icon d={FILE} size={16} />
        </span>
      )}
      <span className="attachment-text">
        <span className="attachment-name">{file.file.name || "file"}</span>
        <span className="attachment-meta">
          {state === "error" ? file.error : state === "uploading" ? `${humanSize(file.file.size)} · uploading` : humanSize(file.file.size)}
        </span>
      </span>
      <button className="attachment-remove" aria-label={`Remove ${file.file.name}`} onClick={onRemove}>
        <Icon d={CLOSE} size={12} />
      </button>
    </div>
  );
}

/** An attachment of a sent prompt. Images load their bytes from the
 *  session's host; other files show their name, with the path on hover. */
function SentAttachment({ attachment: a, load }: { attachment: Attachment; load(a: Attachment): Promise<string> }) {
  const image = isInlineImage(a.mime);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!image) return;
    let live = true;
    load(a).then(
      (u) => live && setUrl(u),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [a.id]);
  if (image && !failed) {
    return (
      <a className="sent-image" href={url ?? undefined} target="_blank" rel="noreferrer" title={`${a.name}\n${a.path}`}>
        {url ? <img src={url} alt={a.name} /> : <span className="sent-image-wait" aria-label={`Loading ${a.name}`} />}
      </a>
    );
  }
  return (
    <div className="attachment attachment-ready" title={a.path}>
      <span className="attachment-icon">
        <Icon d={FILE} size={16} />
      </span>
      <span className="attachment-text">
        <span className="attachment-name">{a.name}</span>
        <span className="attachment-meta">{humanSize(a.size)}</span>
      </span>
    </div>
  );
}

/* ---------- new session ---------- */

export function loadChoice(models: Models): Choice {
  try {
    const saved = JSON.parse(localStorage.getItem("yard.choice") ?? "null") as Choice | null;
    if (saved && models[saved.engine]?.some((m) => m.id === saved.model)) return saved;
  } catch {
    /* fall through to the default */
  }
  const first = models.claude[0];
  return { engine: "claude", model: first?.id ?? "", effort: first?.defaultEffort ?? "medium" };
}

/** Remembered per host: the folder last used there, and recent picks. */
const cwdKey = (host: string) => (host === "local" ? "yard.cwd" : `yard.cwd.${host}`);
const recentKey = (host: string) => `yard.recent.${host}`;
export function readRecent(host: string): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(recentKey(host)) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}
function remember(host: string, folder: string) {
  localStorage.setItem(cwdKey(host), folder);
  localStorage.setItem(recentKey(host), JSON.stringify([folder, ...readRecent(host).filter((p) => p !== folder)].slice(0, 12)));
}

function NewSession({ state, actions }: { state: State; actions: Actions }) {
  // Where the session runs. A remote host can be picked only while connected.
  const [host, setHost] = useState("local");
  const target = host === "local" || state.hosts.some((h) => h.id === host && hostOnline(state, h.id)) ? host : "local";
  const models = modelsOn(state, target);
  const home = homeOn(state, target);
  const workspace = state.workspace[target] || home;
  const [loggingIn, setLoggingIn] = useState(false);
  const [choice, setChoice] = useState<Choice>(() => loadChoice(modelsOn(state, "local")));
  // The account per engine on this host, remembered like the model. One that
  // was removed meanwhile falls back to Default.
  const accounts = accountsOn(state, target);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const pickKey = (engine: Engine) => `yard.account.${target}.${engine}`;
  const pickOf = (engine: Engine): string => {
    const wanted = picked[pickKey(engine)] ?? localStorage.getItem(pickKey(engine)) ?? DEFAULT_ACCOUNT;
    return accountChoices(accounts, engine).some((a) => a.id === wanted) ? wanted : DEFAULT_ACCOUNT;
  };
  const picks: Record<Engine, string> = { claude: pickOf("claude"), codex: pickOf("codex") };
  const pickAccount = (engine: Engine, id: string) => {
    localStorage.setItem(pickKey(engine), id);
    setPicked({ ...picked, [pickKey(engine)]: id });
    // Picking an account under the other engine means running on it.
    const next = engine === choice.engine ? null : choiceOnEngine(models, engine, choice.effort);
    if (next) setChoice(next);
  };
  const [permission, setPermission] = useState<Permission>(() => {
    const saved = localStorage.getItem("yard.permission");
    return PERMISSIONS.some((p) => p.id === saved) ? (saved as Permission) : "ask";
  });
  const [cwd, setCwd] = useState("");
  // What the worktree is cut from; empty means the folder's current branch.
  const [base, setBase] = useState("");
  // From send until yardd answers. On success this page is replaced by the
  // session; on failure the task stays in the box so nothing is retyped.
  const [pending, setPending] = useState(false);
  useEffect(() => setPending(false), [state.errorCount, state.connected]);
  // Models and the home folder arrive after the first render, and differ per host.
  useEffect(() => {
    if (!models[choice.engine]?.some((m) => m.id === choice.model)) setChoice(loadChoice(models));
  }, [models, target]);
  useEffect(() => {
    setCwd(localStorage.getItem(cwdKey(target)) || workspace);
  }, [target, workspace]);

  // Recent picks first, then the folders of this host's sessions. A worktree
  // session counts as the repository it was cut from.
  const recent = useMemo(() => {
    const fromSessions = Object.values(state.sessions)
      .filter((s) => hostOf(s) === target)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((s) => s.repo || s.cwd);
    return [...new Set([...readRecent(target), ...fromSessions])].slice(0, 12);
  }, [state.sessions, target]);

  // Every session in a repository gets a worktree, so the branches tell
  // whether this folder is one and what it can start from.
  const branchList = state.branches[branchKey(target, cwd)];
  useEffect(() => {
    if (!cwd || !state.connected) return;
    actions.loadBranches(cwd, target);
  }, [cwd, target, state.connected]);
  useEffect(() => setBase(""), [cwd, target]);
  const isRepo = !!branchList?.current;

  const start = (text: string, attachments: Attachment[]) => {
    if (/^\/login\s*$/.test(text.trim()) && !attachments.length) {
      setLoggingIn(true);
      return;
    }
    if (target === "local") localStorage.setItem("yard.choice", JSON.stringify(choice));
    localStorage.setItem("yard.permission", permission);
    remember(target, cwd);
    setPending(true);
    actions.create({
      ...choice,
      permission,
      account: picks[choice.engine] === DEFAULT_ACCOUNT ? undefined : picks[choice.engine],
      cwd,
      text,
      worktree: true,
      base: base || undefined,
      host: target === "local" ? undefined : target,
      attachments: attachments.length ? attachments.map((a) => a.id) : undefined,
    });
  };
  const uploadTarget = useMemo<UploadTarget>(() => (target === "local" ? {} : { host: target }), [target]);

  return (
    <div className="new">
      <div className="new-inner">
        <h1>What should we work on?</h1>
        <Composer
          placeholder="Describe the task"
          rows={1}
          large
          keepText
          target={uploadTarget}
          upload={actions.upload}
          onSubmit={start}
          busy={pending || !state.connected || !choice.model || !cwd}
        >
          <ModelPicker
            models={models}
            usage={usageForPicks(usageOn(state, target), picks)}
            value={choice}
            engines={["claude", "codex"]}
            accounts={accounts}
            picks={picks}
            onAccount={pickAccount}
            onChange={setChoice}
          />
          <PermissionPicker engine={choice.engine} value={permission} onChange={setPermission} />
        </Composer>
        <div className="new-chips">
          <HostPicker state={state} value={target} onChange={setHost} onAddHost={() => actions.go({ page: "hosts" })} />
          <FolderPicker
            host={target}
            home={home}
            workspace={workspace}
            value={cwd}
            recent={recent}
            dirs={state.dirs}
            listDirs={actions.listDirs}
            onChange={setCwd}
          />
          {isRepo && (
            <BranchPicker current={branchList.current!} branches={branchList.branches ?? []} value={base} onChange={setBase} />
          )}
          <span className="spacer" />
          {cwd && branchList && (
            <span className="muted small">{isRepo ? "New worktree" : "Works in the folder itself"}</span>
          )}
        </div>
        <EngineNotice state={state} host={target} engine={choice.engine} account={picks[choice.engine]} onLogin={() => setLoggingIn(true)} />
        {loggingIn && (
          <LoginDialog state={state} actions={actions} host={target} engine={choice.engine} account={picks[choice.engine]} onClose={() => setLoggingIn(false)} />
        )}
      </div>
    </div>
  );
}

const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z";
const BRANCH = "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a9 9 0 0 1-9 9";
const LAPTOP = "M4 5h16v11H4ZM2 20h20";
const CHECK = "M5 12l5 5 9-11";

/** Close an open menu on Escape, wherever focus is. */
export function useEscape(open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

/** A button under the prompt box that opens a menu below it. */
function ChipMenu(props: {
  icon: ReactNode;
  label: ReactNode;
  title?: string;
  open: boolean;
  setOpen(open: boolean): void;
  wide?: boolean;
  children: ReactNode;
}) {
  const { open, setOpen } = props;
  useEscape(open, () => setOpen(false));
  return (
    <div className="picker">
      <button className="chip" aria-haspopup="true" aria-expanded={open} title={props.title} onClick={() => setOpen(!open)}>
        {props.icon}
        <span className="chip-label">{props.label}</span>
        <Icon d={CHEVRON_DOWN} size={12} />
      </button>
      {open && (
        <>
          <div className="scrim" onClick={() => setOpen(false)} />
          <div className={`popover menu ${props.wide ? "menu-wide" : ""}`}>
            {props.children}
          </div>
        </>
      )}
    </div>
  );
}

export function HostPicker(props: { state: State; value: string; onChange(host: string): void; onAddHost(): void }) {
  const { state, value } = props;
  const [open, setOpen] = useState(false);
  const pick = (host: string) => {
    props.onChange(host);
    setOpen(false);
  };
  const remote = state.hosts.find((h) => h.id === value);
  return (
    <ChipMenu
      icon={remote ? <Icon d={CLOUD} /> : <Icon d={LAPTOP} />}
      label={remote ? remote.name : hostName(state, "local")}
      title="Where the session runs"
      open={open}
      setOpen={setOpen}
    >
      <button className={`picker-item menu-item ${value === "local" ? "active" : ""}`} onClick={() => pick("local")}>
        <Icon d={LAPTOP} />
        <span>{hostName(state, "local")}</span>
      </button>
      {state.hosts.map((h) => {
        const online = hostOnline(state, h.id);
        return (
          <button key={h.id} className={`picker-item menu-item ${value === h.id ? "active" : ""}`} disabled={!online} onClick={() => pick(h.id)}>
            <Icon d={CLOUD} />
            <span>{h.name}</span>
            {!online && <span className="muted small menu-aside">{h.status === "error" ? "unreachable" : h.status}</span>}
          </button>
        );
      })}
      <div className="menu-divider" />
      <button className="picker-item menu-item" onClick={props.onAddHost}>
        <Icon d={PLUS} />
        <span>Add a host…</span>
      </button>
    </ChipMenu>
  );
}

/** The desktop app's window exposes Tauri's IPC; a plain browser does not. */
const tauriInvoke = (): ((cmd: string, args: object) => Promise<unknown>) | undefined =>
  (window as any).__TAURI__?.core?.invoke;

const parentOf = (path: string) => (path.lastIndexOf("/") <= 0 ? "/" : path.slice(0, path.lastIndexOf("/")));
const joinPath = (dir: string, name: string) => (dir.endsWith("/") ? dir + name : `${dir}/${name}`);
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1) || path;

/** Recent folders, a search that browses the host's folders as a path is
 *  typed, and the Finder dialog when the session runs on this Mac. */
export function FolderPicker(props: {
  host: string;
  home: string;
  /** The folder whose subfolders are offered first: the host's projects. */
  workspace: string;
  value: string;
  recent: string[];
  dirs: State["dirs"];
  listDirs(path: string, host: string): void;
  onChange(path: string): void;
}) {
  const { host, home, workspace, value, recent } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
    }
  }, [open]);

  // A query starting with / or ~ is a path: list the folder it ends in and
  // match the last segment against its subfolders.
  const browsing = query.startsWith("/") || query.startsWith("~");
  const expanded = query.replace(/^~(?=\/|$)/, home);
  const dir = browsing ? (expanded.endsWith("/") ? expanded.replace(/(.)\/+$/, "$1") : parentOf(expanded)) : "";
  const stem = browsing && !expanded.endsWith("/") ? baseName(expanded) : "";
  const listing = browsing ? props.dirs[branchKey(host, dir)] : undefined;
  useEffect(() => {
    if (!open || !browsing || !dir) return;
    const timer = setTimeout(() => props.listDirs(dir, host), 120);
    return () => clearTimeout(timer);
  }, [open, browsing, dir, host]);

  // Without a path typed, the workspace's folders are listed under the recent ones.
  const projects = props.dirs[branchKey(host, workspace)];
  useEffect(() => {
    if (open && workspace) props.listDirs(workspace, host);
  }, [open, workspace, host]);

  type Row = { path: string; name: string; detail: string; git?: boolean; browse?: boolean; section?: string };
  const rows: Row[] = useMemo(() => {
    if (browsing) {
      const lower = stem.toLowerCase();
      const children = (listing?.dirs ?? [])
        .filter((d) => d.name.toLowerCase().startsWith(lower) && (lower.startsWith(".") || !d.name.startsWith(".")))
        .slice(0, 200)
        .map((d) => ({ path: joinPath(dir, d.name), name: d.name, detail: "", git: d.git, browse: true }));
      // The folder typed so far is itself a choice.
      const self = !stem && dir ? [{ path: dir, name: `Use ${tilde(dir, home)}`, detail: "" }] : [];
      return [...self, ...children];
    }
    const lower = query.toLowerCase();
    const recents = recent
      .filter((p) => p.toLowerCase().includes(lower))
      .slice(0, lower ? 12 : 5)
      .map((p) => ({ path: p, name: baseName(p), detail: tilde(p, home), section: "Recent" }));
    const shown = new Set(recents.map((r) => r.path));
    const inWorkspace = (projects?.dirs ?? [])
      .filter((d) => !d.name.startsWith(".") && d.name.toLowerCase().includes(lower))
      .map((d) => ({ path: joinPath(workspace, d.name), name: d.name, detail: "", git: d.git, browse: true, section: `In ${tilde(workspace, home)}` }))
      .filter((r) => !shown.has(r.path))
      .slice(0, 200);
    return [...recents, ...inWorkspace];
  }, [browsing, stem, listing, dir, query, recent, home, projects, workspace]);
  useEffect(() => setCursor(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const pick = (path: string) => {
    props.onChange(path);
    setOpen(false);
  };
  const browseInto = (path: string) => setQuery(tilde(path, home) + "/");
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const row = rows[cursor];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (row) pick(row.path);
    } else if (e.key === "Tab" && row?.browse) {
      e.preventDefault();
      browseInto(row.path);
    }
  };
  const invoke = host === "local" ? tauriInvoke() : undefined;
  const chooseInFinder = async () => {
    setOpen(false);
    try {
      const picked = await invoke!("plugin:dialog|open", { options: { directory: true, multiple: false, defaultPath: value || home } });
      if (typeof picked === "string") props.onChange(picked);
    } catch (err) {
      console.error("folder dialog failed", err);
    }
  };

  return (
    <ChipMenu icon={<Icon d={FOLDER} />} label={value ? baseName(value) : "Choose a folder"} title={value} open={open} setOpen={setOpen} wide>
      <input
        className="menu-search"
        autoFocus
        placeholder="Search folders, or type a path"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
        aria-label="Folder"
      />
      <div className="menu-list" ref={list} role="listbox">
        {rows.map((row, i) => [
          row.section && row.section !== rows[i - 1]?.section && (
            <div key={`head-${row.section}`} className="picker-head">
              {row.section}
            </div>
          ),
          <div
            key={row.path + i}
            data-row={i}
            role="option"
            aria-selected={i === cursor}
            className={`picker-item menu-item folder-row ${i === cursor ? "cursor" : ""} ${row.path === value ? "active" : ""}`}
            onMouseEnter={() => setCursor(i)}
            onClick={() => pick(row.path)}
          >
            <Icon d={row.git ? BRANCH : FOLDER} />
            <span className="folder-name">{row.name}</span>
            {row.detail && <span className="muted small folder-detail">{row.detail}</span>}
            {row.path === value && <Icon d={CHECK} />}
            {row.browse && (
              <button
                className="btn-icon folder-open"
                aria-label={`Open ${row.name}`}
                title="Show the folders inside (Tab)"
                onClick={(e) => {
                  e.stopPropagation();
                  browseInto(row.path);
                }}
              >
                <Icon d={CHEVRON_RIGHT} size={12} />
              </button>
            )}
          </div>,
        ])}
        {browsing && listing?.error && <div className="picker-empty">{listing.error}</div>}
        {/* Only a typed last segment can leave this list empty ("Use <dir>" is offered otherwise); say why Enter does nothing. */}
        {browsing && listing && !listing.error && rows.length === 0 && (
          <div className="picker-empty">
            No folder in {tilde(dir, home)} starts with “{stem}”.
          </div>
        )}
        {browsing && !listing && <div className="picker-empty">Loading…</div>}
        {!browsing && rows.length === 0 && (
          <div className="picker-empty">{!projects && !query ? "Loading…" : query ? "No folder matches. Start with / or ~ to type a path." : "No folders here yet. Start with / or ~ to type a path."}</div>
        )}
      </div>
      {(!browsing || invoke) && <div className="menu-divider" />}
      {!browsing && (
        <button className="picker-item menu-item" onClick={() => browseInto(workspace || home || "/")}>
          <Icon d={FOLDER} />
          <span>Browse folders…</span>
        </button>
      )}
      {invoke && (
        <button className="picker-item menu-item" onClick={chooseInFinder}>
          <Icon d={FOLDER} />
          <span>Choose in Finder…</span>
        </button>
      )}
    </ChipMenu>
  );
}

/** What the new worktree is cut from. */
export function BranchPicker(props: { current: string; branches: string[]; value: string; onChange(base: string): void }) {
  const { current, value } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const options = useMemo(() => {
    const all = [current, ...props.branches.filter((b) => b !== current)];
    const lower = query.toLowerCase();
    return all.filter((b) => b.toLowerCase().includes(lower)).slice(0, 200);
  }, [current, props.branches, query]);
  const pick = (b: string) => {
    props.onChange(b === current ? "" : b);
    setOpen(false);
  };
  const shown = value || current;
  return (
    <ChipMenu icon={<Icon d={BRANCH} />} label={shown} title="Branch the worktree starts from" open={open} setOpen={setOpen}>
      <input
        className="menu-search"
        autoFocus
        placeholder="Search branches"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && options[0] && pick(options[0])}
        spellCheck={false}
        aria-label="Base branch"
      />
      <div className="menu-list">
        {options.map((b) => (
          <button key={b} className={`picker-item menu-item ${b === shown ? "active" : ""}`} onClick={() => pick(b)}>
            <span className="folder-name">{b}</span>
            {b === current && <span className="muted small menu-aside">current</span>}
          </button>
        ))}
        {options.length === 0 && <div className="picker-empty">No branch matches.</div>}
      </div>
    </ChipMenu>
  );
}

/* ---------- session ---------- */

function SessionView({ meta, state, actions }: { meta: SessionMeta; state: State; actions: Actions }) {
  const thread = state.threads[meta.id];
  const items = thread?.items ?? [];
  const changes = state.changes[meta.id];
  const busy = meta.status === "running" || meta.status === "needs_approval";
  const host = hostOf(meta);
  const online = hostOnline(state, host);
  const models = modelsOn(state, host);

  // Stick to the bottom while new items arrive, unless the user scrolled up.
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [items]);
  // Thumbnails arrive after their message and grow it; stay at the bottom.
  // `load` does not bubble, but it does pass ancestors while capturing.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    };
    el.addEventListener("load", keep, true);
    return () => el.removeEventListener("load", keep, true);
  }, []);

  // The working tree has probably changed whenever a turn ends.
  const last = useRef(meta.status);
  useEffect(() => {
    if (last.current !== "idle" && meta.status === "idle") actions.loadChanges(meta.id);
    last.current = meta.status;
  }, [meta.status]);

  const running = meta.status === "running" || meta.status === "needs_approval";
  const rows = useMemo(() => layout(items, running), [items, running]);
  const handoffs = useMemo(() => handoffLinks(items, meta, state.sessions), [items, meta, state.sessions]);
  const lastItem = items[items.length - 1];
  const working = meta.status === "running" && !(lastItem?.kind === "assistant" && lastItem.streaming);
  // The open turn's start, from yardd's clock.
  const turnStart = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "turn") return it.end == null ? (it.start ?? null) : null;
    }
    return null;
  }, [items]);
  // Files go to the session's own host, through the hub for a remote one.
  const uploadTarget = useMemo<UploadTarget>(() => ({ sessionId: meta.id }), [meta.id]);
  const [loggingIn, setLoggingIn] = useState(false);
  const accounts = accountsOn(state, host);
  const sessionAccount = accountLabel(accounts, meta);
  // The engines' own /login cannot run inside a session; the app's does it.
  const submit = (text: string, attachments: Attachment[]) => {
    if (/^\/login\s*$/.test(text.trim()) && !attachments.length) setLoggingIn(true);
    else actions.send(meta.id, text, attachments.map((a) => a.id));
  };
  const loadAttachment = (a: Attachment) => actions.attachmentUrl(meta.id, a);
  // Start anyway is out: hold the button until the session leaves the queue or
  // yardd refuses, or a double click sends a second startNow that yardd
  // answers with "this session is not queued".
  const [starting, setStarting] = useState(false);
  useEffect(() => setStarting(false), [meta.status, state.errorCount, state.connected]);
  const renderItem = (item: Item) => (
    <ItemView
      key={item.key}
      item={item}
      link={handoffs[item.key]}
      onOpen={(id) => actions.go({ page: "session", id })}
      queued={meta.status === "queued"}
      starting={starting}
      loadAttachment={loadAttachment}
      onStart={() => {
        if (starting) return;
        setStarting(true);
        actions.startNow(meta.id);
      }}
      onDecide={(id, d) => actions.approve(meta.id, id, d)}
    />
  );

  return (
    <div className="session">
      <main className="thread">
        <header className="bar">
          <MenuButton />
          <h1>{meta.title}</h1>
          <code className="muted">{meta.branch || changes?.branch || tilde(meta.cwd, homeOn(state, host))}</code>
          {sessionAccount && (
            <span className="muted small session-account" title="The account this session runs under. It can't be changed mid-session.">
              {sessionAccount}
            </span>
          )}
          {host !== "local" && (
            <span className="muted small bar-host">
              <Cloud size={13} />
              {hostName(state, host)}
              {!online && " · offline"}
            </span>
          )}
          <span className="spacer" />
          {busy && online && (
            <button className="btn-text" onClick={() => actions.interrupt(meta.id)}>
              Stop
            </button>
          )}
          {online && (
            <DeleteButton
              key={meta.id}
              worktree={!!(meta.branch && meta.repo)}
              onConfirm={(removeWorktree) => actions.remove(meta.id, removeWorktree)}
            />
          )}
        </header>
        <div
          className="scroll"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="column">
            {rows.map((row) => (
              <RowView key={row.key} row={row} render={renderItem} />
            ))}
            {working && <Working since={turnStart} />}
          </div>
        </div>
        {online && <QuoteReply sessionId={meta.id} />}
        <div className="dock">
          {!online && <div className="muted small offline-note">{hostName(state, host)} is offline. This session comes back when it reconnects.</div>}
          {online && <EngineNotice state={state} host={host} engine={meta.engine} account={accountOf(meta)} onLogin={() => setLoggingIn(true)} />}
          {loggingIn && (
            <LoginDialog state={state} actions={actions} host={host} engine={meta.engine} account={accountOf(meta)} onClose={() => setLoggingIn(false)} />
          )}
          {online && (
            <PendingList pending={meta.pending ?? []} busy={busy} onEdit={(id) => actions.unqueue(meta.id, id)} onRemove={(id) => actions.unqueue(meta.id, id, true)} />
          )}
          <Composer
            placeholder={!online ? "Offline" : busy ? "Queue a message for the agent" : "Reply"}
            rows={1}
            busy={meta.status === "queued" || !online}
            queueing={busy}
            onEditLastQueued={() => {
              const last = meta.pending?.[meta.pending.length - 1];
              if (!last) return false;
              actions.unqueue(meta.id, last.id);
              return true;
            }}
            appendFor={meta.id}
            target={uploadTarget}
            upload={actions.upload}
            onSubmit={submit}
          >
            <ModelPicker
              models={models}
              usage={usageForPicks(usageOn(state, host), { [meta.engine]: accountOf(meta) })}
              accounts={accounts}
              picks={{ [meta.engine]: accountOf(meta) }}
              value={{ engine: meta.engine, model: meta.model, effort: meta.effort }}
              engines={meta.engine === "claude" ? ["claude", "codex"] : ["codex", "claude"]}
              onChange={(c) => actions.setModel(meta.id, c.model, c.effort)}
              handoff={{ blocked: busy, onConfirm: (c) => actions.handoff(meta.id, c.engine, c.model, c.effort) }}
            />
            <PermissionPicker engine={meta.engine} value={meta.permission ?? "ask"} onChange={(p) => actions.setPermission(meta.id, p)} />
          </Composer>
        </div>
      </main>
      <WorkPane sessionId={meta.id} changes={changes} connected={online} actions={actions} meta={meta} state={state} />
    </div>
  );
}

/** Deleting asks for a second click; the ask lapses after a few seconds. A
 *  session in a worktree yardd made can take its worktree with it. */
function DeleteButton({ worktree, onConfirm }: { worktree: boolean; onConfirm(removeWorktree: boolean): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), worktree ? 5000 : 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  if (worktree && armed) {
    return (
      <>
        <button className="btn-text" onClick={() => onConfirm(false)}>
          Delete session
        </button>
        <button className="btn-text" onClick={() => onConfirm(true)}>
          Delete and remove worktree
        </button>
      </>
    );
  }
  return (
    <button className="btn-text" onClick={() => (armed ? onConfirm() : setArmed(true))}>
      {armed ? "Delete session?" : "Delete"}
    </button>
  );
}

/**
 * Reply to part of an answer: selecting text inside one agent answer shows a
 * Reply button over the selection, which adds it to the reply box as a quote card.
 */
function QuoteReply({ sessionId }: { sessionId: string }) {
  const [at, setAt] = useState<{ left: number; top: number; below: boolean; text: string } | null>(null);
  useEffect(() => {
    const answerOf = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest("[data-quotable]") ?? null;
    const update = () => {
      const sel = document.getSelection();
      const box = sel && !sel.isCollapsed && sel.rangeCount > 0 ? answerOf(sel.anchorNode) : null;
      const text = sel?.toString() ?? "";
      // One answer at a time: a selection that runs into a prompt or a tool call is not a quote.
      if (!box || box !== answerOf(sel!.focusNode) || !text.trim()) return setAt(null);
      const r = sel!.getRangeAt(0).getBoundingClientRect();
      // Touch screens put their own copy menu above a selection; go below it.
      const below = r.top < 48 || window.matchMedia("(hover: none)").matches;
      setAt({ left: Math.min(Math.max(r.left + r.width / 2, 48), window.innerWidth - 48), top: below ? r.bottom : r.top, below, text });
    };
    document.addEventListener("selectionchange", update);
    // The button is fixed to the window; the thread scrolls under it.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      document.removeEventListener("selectionchange", update);
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, []);
  if (!at) return null;
  return createPortal(
    <button
      className={`btn quote-reply${at.below ? " below" : ""}`}
      style={{ left: at.left, top: at.top }}
      // Keep the selection: a mousedown on a button would clear it before the click.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        quoteInComposer(sessionId, at.text);
        document.getSelection()?.removeAllRanges();
        setAt(null);
      }}
    >
      <Icon d={REPLY} />
      Reply
    </button>,
    document.body,
  );
}

/**
 * Messages sent while a turn runs, as in Claude Code: the agent reads them at
 * its next step, in the same turn. Edit takes one back into the reply box;
 * Stop gives them all back. After a failed turn they go with the next message.
 */
function PendingList({ pending, busy, onEdit, onRemove }: { pending: PendingMessage[]; busy: boolean; onEdit(id: string): void; onRemove(id: string): void }) {
  if (pending.length === 0) return null;
  return (
    <section className="pending" aria-label="Waiting to send">
      <div className="muted small">{busy ? "Queued: the agent reads it after its current step" : "Not sent: the last turn did not finish. It goes with your next message."}</div>
      {pending.map((p) => {
        const { quotes, text } = splitQuotes(p.text);
        return (
          <div className="pending-row" key={p.id}>
            <span className="pending-text">{text || quotes.join(" ") || p.attachments?.map((a) => a.name).join(", ")}</span>
            {quotes.length > 0 && <span className="muted small">{quotes.length === 1 ? "1 quote" : `${quotes.length} quotes`}</span>}
            {!!p.attachments?.length && <span className="muted small">{p.attachments.length === 1 ? "1 file" : `${p.attachments.length} files`}</span>}
            <button className="btn-text pending-edit" aria-label="Edit" title="Back to the reply box (↑)" onClick={() => onEdit(p.id)}>
              Edit
            </button>
            <button className="btn-icon" aria-label="Remove from queue" title="Remove" onClick={() => onRemove(p.id)}>
              <Icon d={CLOSE} size={12} />
            </button>
          </div>
        );
      })}
    </section>
  );
}

/** `> ` lines in your own message show as quotes, not as `>` characters.
 *  Your text stays text: only the quote lines are picked out. */
function BubbleText({ text }: { text: string }) {
  const parts = quoteSegments(text);
  if (parts.length === 1 && !parts[0].quote) return <>{text}</>;
  return (
    <div className="bubble-parts">
      {parts.map((part, i) =>
        part.quote ? (
          <blockquote key={i} className="bubble-quote">
            {part.text}
          </blockquote>
        ) : (
          <div key={i}>{part.text}</div>
        ),
      )}
    </div>
  );
}

/** A hand-off brief can run to hundreds of lines; fold long messages. */
const FOLD_LINES = 12;

function UserBubble({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  if (lines.length <= FOLD_LINES)
    return (
      <div className="bubble">
        <BubbleText text={text} />
      </div>
    );
  return (
    <div className="bubble">
      <BubbleText text={expanded ? text : lines.slice(0, FOLD_LINES).join("\n")} />
      <button className="btn-text bubble-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        {expanded ? "Show less" : `Show more (${lines.length - FOLD_LINES} lines)`}
      </button>
    </div>
  );
}

/** Seconds since `since` (ms), ticking. The tick writes the DOM directly, so a
 *  long thread does not re-render every second. */
function Elapsed({ since }: { since: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = duration(Date.now() - since);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);
  return <span ref={ref} />;
}

function Working({ since }: { since: number | null }) {
  return (
    <div className="working" role="status">
      <span className="shimmer">Working</span>
      {since != null && (
        <span className="muted small">
          for <Elapsed since={since} />
        </span>
      )}
    </div>
  );
}

function RowView({ row, render }: { row: Row; render(item: Item): ReactNode }) {
  if (row.type === "item") return <>{render(row.item)}</>;
  if (row.type === "work") return <WorkGroup entries={row.entries} live={row.live} />;
  return <TurnFold row={row} render={render} />;
}

/** A finished turn's work, folded above its answer. */
function TurnFold({ row, render }: { row: Extract<Row, { type: "fold" }>; render(item: Item): ReactNode }) {
  const [open, setOpen] = useState(false);
  const verb = row.status === "interrupted" ? "Stopped after" : "Worked for";
  const label = row.ms != null ? `${verb} ${duration(row.ms)}` : row.status === "interrupted" ? "Stopped" : "Worked";
  return (
    <div className="fold">
      <button className="fold-row" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{label}</span>
        {row.summary && <span className="muted">· {row.summary}</span>}
        <span className={`tool-chevron ${open ? "open" : ""}`}>
          <Icon d={CHEVRON_RIGHT} size={12} />
        </span>
      </button>
      {open && (
        <div className="fold-body">
          {row.rows.map((r) => (
            <RowView key={r.key} row={r} render={render} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Tool calls and thinking between messages. While live, only the latest
 *  step shows; once done, one summary line that opens the list. */
function WorkGroup({ entries, live }: { entries: WorkItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 1) return <WorkEntry entry={entries[0]} />;
  if (live && !open) {
    return (
      <div className="work">
        <button className="work-more" onClick={() => setOpen(true)}>
          {entries.length - 1} earlier {entries.length === 2 ? "step" : "steps"}
        </button>
        <WorkEntry entry={entries[entries.length - 1]} />
      </div>
    );
  }
  return (
    <div className="work">
      <button className="work-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summarize(entries) || "Worked"}</span>
        <span className={`tool-chevron ${open ? "open" : ""}`}>
          <Icon d={CHEVRON_RIGHT} size={12} />
        </span>
      </button>
      {open && (
        <div className="work-list">
          {entries.map((e) => (
            <WorkEntry key={e.key} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkEntry({ entry }: { entry: WorkItem }) {
  const [open, setOpen] = useState(false);
  if (entry.kind === "reasoning") {
    const line = thoughtLine(entry.text);
    return (
      <div className="tool">
        <button className="tool-row" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className={`tool-chevron ${open ? "open" : ""}`}>
            <Icon d={CHEVRON_RIGHT} size={12} />
          </span>
          <span className={entry.streaming ? "shimmer" : ""}>{entry.streaming ? "Thinking" : "Thought"}</span>
          {line && <span className="thought-line">{line}</span>}
        </button>
        {open && (
          <div className="thought">
            <Markdown text={entry.text} />
          </div>
        )}
      </div>
    );
  }
  if (entry.agent || entry.steps?.length) return <AgentEntry entry={entry} />;
  const expandable = !!entry.output;
  return (
    <div className="tool">
      <button className="tool-row" aria-expanded={open} disabled={!expandable} onClick={() => setOpen(!open)}>
        <span className={`tool-chevron ${open ? "open" : ""} ${expandable ? "" : "hidden"}`}>
          <Icon d={CHEVRON_RIGHT} size={12} />
        </span>
        {/* Codex titles a command "Ran" from the start; until it ends, it has not. */}
        <span>{entry.state === "running" && entry.title === "Ran" ? "Running" : entry.title}</span>
        {entry.detail && <code>{entry.detail}</code>}
        {entry.state === "running" && <span className="pulse" aria-label="running" />}
        {entry.state === "failed" && <span className="bad">· failed</span>}
      </button>
      {open && entry.output && <pre className="tool-output">{entry.output}</pre>}
    </div>
  );
}

/** A subagent: one line, collapsed. Open, the steps it took and its report. */
function AgentEntry({ entry }: { entry: ToolItem }) {
  const [open, setOpen] = useState(false);
  const steps = entry.steps ?? [];
  const expandable = steps.length > 0 || !!entry.output;
  const latest = steps[steps.length - 1];
  const parts = [
    entry.state === "running" ? "running" : entry.state === "failed" ? "failed" : "done",
    entry.state !== "running" && entry.ms != null ? duration(entry.ms) : null,
    steps.length ? `${steps.length} ${steps.length === 1 ? "step" : "steps"}` : null,
  ].filter(Boolean);
  return (
    <div className="tool agent">
      <button className="tool-row" aria-expanded={open} disabled={!expandable} onClick={() => setOpen(!open)}>
        <span className={`tool-chevron ${open ? "open" : ""} ${expandable ? "" : "hidden"}`}>
          <Icon d={CHEVRON_RIGHT} size={12} />
        </span>
        <span>Agent</span>
        {entry.detail && <span className="agent-what">{entry.detail}</span>}
        {entry.agent && <span className="agent-type">{entry.agent}</span>}
        {entry.state === "running" && <span className="pulse" aria-label="running" />}
        <span className={entry.state === "failed" ? "bad small" : "muted small"}>{parts.join(" · ")}</span>
        {entry.state === "running" && latest && !open && <code>{latest.detail}</code>}
      </button>
      {open && (
        <div className="agent-body">
          {steps.length > 0 && (
            <div className="work-list">
              {steps.map((s) => (
                <WorkEntry key={s.key} entry={s} />
              ))}
            </div>
          )}
          {entry.output && <pre className="tool-output">{entry.output}</pre>}
        </div>
      )}
    </div>
  );
}

function ItemView(props: {
  item: Item;
  /** For a hand-off note: the session on the other side. */
  link?: string;
  onOpen(sessionId: string): void;
  /** The session is still waiting in the queue. */
  queued: boolean;
  /** Start anyway was clicked and yardd has not answered yet. */
  starting: boolean;
  loadAttachment(a: Attachment): Promise<string>;
  onStart(): void;
  onDecide(requestId: string, decision: "allow" | "allow_always" | "deny"): void;
}) {
  const { item, onDecide } = props;
  switch (item.kind) {
    case "user":
      if (!item.attachments?.length) return <UserBubble text={item.text} />;
      return (
        <div className="user-message">
          <div className="attachments attachments-sent">
            {item.attachments.map((a) => (
              <SentAttachment key={a.id} attachment={a} load={props.loadAttachment} />
            ))}
          </div>
          {item.text && <UserBubble text={item.text} />}
        </div>
      );
    case "note":
      return (
        <div className="note">
          {item.text}
          {props.link && (
            <button className="btn-text note-link" onClick={() => props.onOpen(props.link!)}>
              Open session
            </button>
          )}
        </div>
      );
    case "assistant":
      return <Markdown text={item.text} quotable />;
    case "tool":
    case "reasoning":
      return <WorkEntry entry={item} />;
    case "turn":
      return null;
    case "diff":
      return (
        <>
          {item.files.map((f, i) => (
            <FileDiff key={i} file={f} />
          ))}
        </>
      );
    case "approval":
      return (
        <div className="approval">
          <div className="approval-title">{item.approvalKind === "command" ? "Allow this command?" : "Allow this?"}</div>
          <code className="approval-what">{item.title}</code>
          {item.detail && <div className="muted small">{item.detail}</div>}
          {item.decision === null && !item.unanswered ? (
            <div className="row">
              <button className="btn-primary" disabled={item.sending} onClick={() => onDecide(item.requestId, "allow")}>
                Allow once
              </button>
              <button className="btn" disabled={item.sending} onClick={() => onDecide(item.requestId, "allow_always")}>
                Always allow
              </button>
              <button className="btn-text" disabled={item.sending} onClick={() => onDecide(item.requestId, "deny")}>
                Deny
              </button>
            </div>
          ) : (
            <div className="muted small">
              {item.decision === null
                ? "Not answered before the turn ended"
                : item.decision === "deny"
                  ? "Denied"
                  : item.decision === "allow_always"
                    ? "Always allowed"
                    : "Allowed"}
            </div>
          )}
        </div>
      );
    case "error":
      return <div className="error-line">{item.message}</div>;
    case "queued":
      return (
        <div className="queued-line">
          <span>{props.queued ? `Queued: ${item.reason}.` : `Was queued: ${item.reason}.`}</span>
          {props.queued && (
            <button className="btn" disabled={props.starting} onClick={props.onStart}>
              Start anyway
            </button>
          )}
        </div>
      );
  }
}

/* ---------- diffs ---------- */

function DiffLines({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="diff">
      {lines.map((line, i) => {
        const cls = line.startsWith("@@") ? "hunk" : line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
        return (
          <span key={i} className={`dl ${cls}`}>
            {line || " "}
          </span>
        );
      })}
    </pre>
  );
}

function FileDiff({ file }: { file: ChangedFile }) {
  return (
    <div className="card">
      <div className="card-head">
        <code>{file.path}</code>
      </div>
      {file.diff ? <DiffLines diff={file.diff} /> : <div className="muted small pad">No text diff.</div>}
    </div>
  );
}

/** Split `git diff` output into one body per file, without the git headers. */
function splitDiff(diff: string): { path: string; body: string }[] {
  return diff
    .split(/^diff --git /m)
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const header = lines[0] ?? "";
      const path = header.match(/ b\/(.+)$/)?.[1] ?? header;
      const start = lines.findIndex((l) => l.startsWith("@@"));
      return { path, body: start >= 0 ? lines.slice(start).join("\n") : "" };
    });
}

/** The right-hand pane: what changed, and a shell in the same folder. */
function WorkPane(props: { sessionId: string; changes: Changes | undefined; connected: boolean; actions: Actions; meta: SessionMeta; state: State }) {
  const [paneW, setPaneW] = useWidth("yard.paneWidth", PANE_W);
  const { sessionId, changes, connected, actions } = props;
  const [tab, setTab] = useState<"changes" | "terminal" | "pr" | "procs">("changes");
  const [prUsed, setPrUsed] = useState(false);
  // The shell starts the first time the tab is opened, then stays mounted.
  const [terminalUsed, setTerminalUsed] = useState(false);
  const parts = useMemo(() => splitDiff(changes?.diff ?? ""), [changes?.diff]);
  const files = changes?.files ?? [];
  return (
    <section className="pane" aria-label="Workspace" style={{ "--pane-w": `${paneW}px` } as CSSProperties}>
      <Resizer
        width={paneW}
        min={300}
        max={Math.max(300, window.innerWidth - 640)}
        initial={PANE_W}
        dir={-1}
        cssVar="--pane-w"
        label="Resize the workspace pane"
        onWidth={setPaneW}
      />
      <header className="bar tabs">
        <button className={`tab ${tab === "changes" ? "active" : ""}`} aria-pressed={tab === "changes"} onClick={() => setTab("changes")}>
          Changes
        </button>
        <button
          className={`tab ${tab === "terminal" ? "active" : ""}`}
          aria-pressed={tab === "terminal"}
          onClick={() => {
            setTab("terminal");
            setTerminalUsed(true);
          }}
        >
          Terminal
        </button>
        <button
          className={`tab ${tab === "pr" ? "active" : ""}`}
          aria-pressed={tab === "pr"}
          onClick={() => {
            setTab("pr");
            setPrUsed(true);
          }}
        >
          Pull request
        </button>
        <button className={`tab ${tab === "procs" ? "active" : ""}`} aria-pressed={tab === "procs"} onClick={() => setTab("procs")}>
          Processes
        </button>
        <span className="spacer" />
        {tab !== "terminal" && (
          <button
            className="btn-icon"
            aria-label={tab === "pr" ? "Refresh pull request" : tab === "procs" ? "Refresh processes" : "Refresh changes"}
            onClick={() =>
              tab === "pr" ? actions.loadPr(sessionId) : tab === "procs" ? actions.loadProcs(sessionId) : actions.loadChanges(sessionId)
            }
          >
            <Icon d={REFRESH} />
          </button>
        )}
      </header>
      {terminalUsed && <TerminalPane sessionId={sessionId} connected={connected} visible={tab === "terminal"} actions={actions} />}
      {prUsed && <PrPane meta={props.meta} state={props.state} actions={actions} visible={tab === "pr"} />}
      {tab === "procs" && <ProcPane meta={props.meta} state={props.state} actions={actions} visible />}
      <div className="scroll pane-body" style={{ display: tab === "changes" ? "flex" : "none" }}>
        {changes?.error && <div className="muted">{capitalize(changes.error)}.</div>}
        {changes && !changes.error && files.length === 0 && <div className="muted">No changes in this folder.</div>}
        {files.length > 0 && (
          <div className="file-list">
            {files.map((f) => (
              <div key={f.path} className="file-row">
                <code>{f.path}</code>
                <code className="muted">{f.untracked ? "new" : `+${f.added ?? 0} −${f.removed ?? 0}`}</code>
              </div>
            ))}
          </div>
        )}
        {parts.map((p) => (
          <FileDiff key={p.path} file={{ path: p.path, diff: p.body }} />
        ))}
        {changes?.truncated && <div className="muted small">Diff cut off at 400 KB.</div>}
      </div>
    </section>
  );
}

/* ---------- markdown (rendered as elements, never as HTML) ---------- */

function inline(text: string): ReactNode[] {
  return text.split(/(\[`?[^\]`]+`?\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    // Links are shown by their label only. Agents mostly link local files,
    // and nothing here should navigate the window away.
    const link = part.match(/^\[`?([^\]`]+)`?\]\([^)]+\)$/);
    if (link) return <code key={i}>{link[1]}</code>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

/** Wide tables scroll sideways in their own box, not the whole thread. */
function MdTableView({ table }: { table: MdTable }) {
  const cls = (k: number) => (table.align[k] ? `align-${table.align[k]}` : undefined);
  return (
    <div className="md-table">
      <table>
        <thead>
          <tr>
            {table.header.map((c, k) => (
              <th key={k} className={cls(k)}>
                {inline(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((c, k) => (
                <td key={k} className={cls(k)}>
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Markdown({ text, quotable }: { text: string; quotable?: boolean }) {
  const blocks = text.split(/```/);
  return (
    <div className="prose" data-quotable={quotable ? "" : undefined}>
      {blocks.map((block, i) => {
        if (i % 2 === 1) {
          // Fenced code: drop the language line.
          const body = block.replace(/^[^\n]*\n/, "").replace(/\n$/, "");
          return (
            <pre key={i} className="code">
              {body}
            </pre>
          );
        }
        return block
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((para, j) => {
            const lines = para.replace(/^\n+|\n+$/g, "").split("\n");
            return blockSegments(lines).map((seg, s) => {
              const key = `${i}-${j}-${s}`;
              switch (seg.kind) {
                case "table":
                  return <MdTableView key={key} table={seg.table} />;
                case "heading":
                  return <h3 key={key}>{inline(seg.text)}</h3>;
                case "ul":
                case "ol": {
                  const List = seg.kind;
                  return (
                    <List key={key}>
                      {seg.items.map((item, k) => (
                        <li key={k}>{inline(item)}</li>
                      ))}
                    </List>
                  );
                }
                default:
                  return (
                    <p key={key}>
                      {seg.lines.map((l, k) => (
                        <span key={k}>
                          {k > 0 && <br />}
                          {inline(l)}
                        </span>
                      ))}
                    </p>
                  );
              }
            });
          });
      })}
    </div>
  );
}

/* ---------- hosts ---------- */

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="muted small">Collecting CPU history.</div>;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * 300).toFixed(1)},${(35 - (Math.min(100, v) / 100) * 34).toFixed(1)}`)
    .join(" ");
  return (
    <svg role="img" aria-label="CPU over the last hour" viewBox="0 0 300 36" preserveAspectRatio="none" className="spark">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const size = (bytes: number) => (bytes < 1024 ** 3 ? `${Math.round(bytes / 1024 ** 2)} MB` : `${gb(bytes)} GB`);
/** `8` or `0.2`, without a trailing `.0`. */
const gbLimit = (bytes: number) => String(Number((bytes / 1024 ** 3).toFixed(1)));

/** What each session's processes use, and the sessions waiting to start. */
function SessionUse({ host, sessions }: { host: Host; sessions: Record<string, SessionMeta> }) {
  const reasons = new Map((host.queued ?? []).map((q) => [q.id, q.reason]));
  const rows = (host.sessions ?? []).filter((u) => sessions[u.id]);
  const queued = Object.values(sessions)
    .filter((s) => s.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt);
  const limits = host.limits;
  return (
    <section className="usage" aria-label="Sessions">
      <h2>Sessions</h2>
      {rows.length === 0 && queued.length === 0 && <div className="muted small">No session is running anything.</div>}
      {(rows.length > 0 || queued.length > 0) && (
        <table>
          <thead>
            <tr>
              <th>Session</th>
              <th className="num">CPU</th>
              <th className="num">Memory</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="usage-title">{sessions[u.id].title}</td>
                <td className="num">{u.cpuCores.toFixed(1)} cores</td>
                <td className="num">{size(u.memBytes)}</td>
              </tr>
            ))}
            {queued.map((s) => (
              <tr key={s.id}>
                <td className="usage-title">{s.title}</td>
                <td className="reason" colSpan={2}>
                  Queued: {reasons.get(s.id) ?? "waiting for room"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {limits && (
        <div className="muted small">
          {limits.forced
            ? "New sessions are queued: pressure is forced on (YARD_FORCE_PRESSURE=1)."
            : limits.minFreeBytes > 0
              ? `New sessions are queued while load is above ${host.cores} or less than ${gbLimit(limits.minFreeBytes)} GB of memory is free.`
              : `New sessions are queued while load is above ${host.cores}.`}
        </div>
      )}
    </section>
  );
}

type HostState = "ok" | "busy" | "down" | "connecting";
function hostState(state: State, id: string): HostState {
  const entry = state.hosts.find((h) => h.id === id);
  if (id !== "local" && !hostOnline(state, id)) return entry?.status === "connecting" ? "connecting" : "down";
  const stats = state.host[id];
  return stats && hostPressure(stats) ? "busy" : "ok";
}
const HOST_STATE_LABEL: Record<HostState, string> = { ok: "Healthy", busy: "Under pressure", down: "Offline", connecting: "Connecting" };

/** yardd passes on what ssh or the socket said; turn the usual ones into
 *  what to do about it. The raw text stays available under Details. */
function explainHostError(entry: HostEntry): { title: string; hint?: ReactNode; install?: boolean } {
  const err = entry.error ?? "";
  const dest = entry.destination ?? "";
  const machine = dest.replace(/^.*@/, "");
  if (/Connection lost/i.test(err)) return { title: "Connection lost. Reconnecting…" };
  if (entry.kind === "ssh" && entry.noDaemon)
    return {
      title: `SSH works, but Switchyard isn't running on ${machine} yet.`,
      hint: "Install it from here: it downloads Switchyard for that machine and runs it as a service in your user account. Nothing else on the machine changes.",
      install: true,
    };
  if (entry.kind === "ssh") {
    if (/Could not resolve hostname/i.test(err))
      return { title: `Can't find ${machine}.`, hint: "Check the name. A Tailscale machine also answers to its full name, like box.tailnet.ts.net." };
    if (/Permission denied/i.test(err))
      return { title: "SSH refused the login.", hint: <>Make <code>ssh {dest}</code> work in Terminal without a password prompt (a key or Tailscale SSH), then wait for the retry.</> };
    if (/Host key verification failed/i.test(err))
      return { title: "The host key is not trusted yet.", hint: <>Run <code>ssh {dest}</code> once in Terminal and accept the key.</> };
    if (/timed out|No route to host|Network is unreachable/i.test(err) && !/os error/i.test(err))
      return { title: `Can't reach ${machine}.`, hint: "Is it on, and on the same network or tailnet?" };
  }
  return { title: err || "Not connected." };
}

/** An engine that cannot run here yet: not installed, or not logged in. */
function EngineNotice({ state, host, engine, account = DEFAULT_ACCOUNT, onLogin }: { state: State; host: string; engine: Engine; account?: string; onLogin(): void }) {
  const st = account === DEFAULT_ACCOUNT ? state.engines[host]?.[engine] : state.engines[host]?.accounts?.[account];
  if (!st || (st.installed && st.loggedIn !== false)) return null;
  const machine = hostName(state, host);
  const which = account === DEFAULT_ACCOUNT ? ENGINE_LABEL[engine] : `${ENGINE_LABEL[engine]} (${accountName(accountsOn(state, host), engine, account)})`;
  return (
    <div className="engine-notice" role="status">
      <span className="dot host-dot-busy" aria-hidden="true" />
      {st.installed ? (
        <>
          <span>
            {which} isn't logged in on {machine}.
          </span>
          <span className="spacer" />
          <button className="btn-primary" onClick={onLogin}>
            Log in
          </button>
        </>
      ) : (
        <span>
          {ENGINE_LABEL[engine]} isn't installed on {machine}. Install it there with <code>{ENGINE_INSTALL[engine]}</code>.
        </span>
      )}
    </div>
  );
}

/** Runs an engine's login on a host. Codex: open a link and enter a code
 *  there. Claude Code: open a link, sign in, paste the code it shows here. */
function LoginDialog(props: { state: State; actions: Actions; host: string; engine: Engine; account?: string; onClose(): void }) {
  const { state, actions, host, engine, onClose } = props;
  const account = props.account ?? DEFAULT_ACCOUNT;
  // Which login this is, when the engine has several: "Claude Code (Work)".
  const which = account === DEFAULT_ACCOUNT ? ENGINE_LABEL[engine] : `${ENGINE_LABEL[engine]} (${accountName(accountsOn(state, host), engine, account)})`;
  const current = state.logins[loginKey(host, engine, account)];
  // Whatever was there before this dialog opened belongs to an older login.
  const before = useRef(current);
  const login = current === before.current ? undefined : current;
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const machine = hostName(state, host);
  const finished = login?.state === "done";
  useEffect(() => {
    actions.login(host, engine, account);
  }, []);
  useEffect(() => {
    if (!finished) return;
    const timer = setTimeout(onClose, 1500);
    return () => clearTimeout(timer);
  }, [finished]);
  const close = () => {
    if (!finished && login?.state !== "failed") actions.loginCancel(host, engine, account);
    onClose();
  };
  useEscape(true, close);
  const retry = () => {
    before.current = state.logins[loginKey(host, engine, account)];
    setCode("");
    actions.login(host, engine, account);
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the code stays selectable */
    }
  };

  let body: ReactNode;
  if (!login || login.state === "starting" || login.state === "cancelled") {
    body = <p className="muted">Starting the login on {machine}…</p>;
  } else if (login.state === "code") {
    body = (
      <>
        <ol className="login-steps">
          <li>
            Open{" "}
            <a href={login.url} target="_blank" rel="noreferrer">
              {login.url}
            </a>{" "}
            and sign in with your ChatGPT account.
          </li>
          <li>Enter this code:</li>
        </ol>
        <div className="login-code">
          <code>{login.code}</code>
          <button className="btn" onClick={() => copy(login.code ?? "")}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="muted small">This closes by itself once you've entered the code. It expires after 15 minutes.</p>
      </>
    );
  } else if (login.state === "url" || login.state === "checking") {
    const checking = login.state === "checking";
    body = (
      <>
        <ol className="login-steps">
          <li>
            <a className="btn-primary login-open" href={login.url} target="_blank" rel="noreferrer">
              Open the sign-in page
            </a>
          </li>
          <li>Sign in with your Claude account and copy the code it shows.</li>
          <li>Paste it here:</li>
        </ol>
        <form
          className="login-code"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) actions.loginCode(host, engine, code.trim(), account);
          }}
        >
          <input
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code from the sign-in page"
            spellCheck={false}
            autoComplete="off"
            disabled={checking}
            aria-label="Code from the sign-in page"
          />
          <button className="btn-primary" type="submit" disabled={checking || !code.trim()}>
            {checking ? "Checking…" : "Log in"}
          </button>
        </form>
      </>
    );
  } else if (login.state === "done") {
    body = (
      <p className="login-done">
        <Icon d={CHECK} /> {which} is logged in on {machine}.
      </p>
    );
  } else {
    body = (
      <>
        <p className="bad">{login.error || "The login did not finish."}</p>
        <div className="row">
          <button className="btn-primary" onClick={retry}>
            Try again
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Log in to ${which}`}>
        <header className="modal-head">
          <h2>
            Log in to {which} on {machine}
          </h2>
          <span className="spacer" />
          <button className="btn-icon" aria-label="Close" onClick={close}>
            <Icon d={CLOSE} size={14} />
          </button>
        </header>
        {body}
      </div>
    </div>
  );
}

/** A Claude Code session touched this recently may still be open somewhere. */
const RECENT_MS = 10 * 60_000;

/** "5 min ago": when a Claude Code session was last used. */
function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  if (min < 30 * 24 * 60) return `${Math.round(min / 1440)} d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Import a Claude Code session run outside Switchyard: the host's sessions
 * (from the Agent SDK) newest first; importing one opens it here, in its own
 * folder, and its next message continues the same conversation.
 */
function ImportDialog({ state, actions, onClose }: { state: State; actions: Actions; onClose(): void }) {
  const [host, setHost] = useState("local");
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const list = state.claudeSessions[host];
  const machine = hostName(state, host);
  const close = () => {
    actions.clearImportError();
    onClose();
  };
  useEscape(true, close);
  useEffect(() => {
    actions.clearImportError();
    setPending(null);
    actions.listClaudeSessions(host);
  }, [host]);
  // The import's `created` reply opens the session: the dialog's work is done.
  const opened = state.route.page === "session" ? state.route.id : null;
  const first = useRef(opened);
  useEffect(() => {
    if (pending && opened && opened !== first.current) onClose();
  }, [opened]);
  useEffect(() => {
    if (state.importError) setPending(null);
  }, [state.importError]);
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (list?.sessions ?? []).filter((s) => words.every((w) => `${s.title} ${s.cwd ?? ""} ${s.gitBranch ?? ""}`.toLowerCase().includes(w)));
  const open = (id: string) => {
    actions.go({ page: "session", id: host === "local" ? id : `${host}~${id}` });
    close();
  };
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal import-modal" role="dialog" aria-modal="true" aria-label="Import from Claude Code">
        <header className="modal-head">
          <h2>Import from Claude Code</h2>
          <span className="spacer" />
          <button className="btn-icon" aria-label="Close" onClick={close}>
            <Icon d={CLOSE} size={14} />
          </button>
        </header>
        <p className="muted small">Sessions you ran with Claude Code on {machine}. An imported session opens in its own folder and its next message continues that conversation.</p>
        <div className="row">
          {state.hosts.length > 0 && <HostPicker state={state} value={host} onChange={setHost} onAddHost={() => (actions.go({ page: "hosts" }), close())} />}
          <input
            className="import-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by title, folder or branch"
            aria-label="Filter sessions"
            spellCheck={false}
            autoFocus
          />
        </div>
        {state.importError && <p className="bad">{state.importError}</p>}
        {list?.error && <p className="bad">{list.error}</p>}
        {!list && <p className="muted">Loading Claude Code sessions…</p>}
        {list && !list.error && rows.length === 0 && (
          <p className="muted">{list.sessions.length ? "No session matches." : `No Claude Code sessions on ${machine}.`}</p>
        )}
        {rows.length > 0 && (
          <ul className="import-list">
            {rows.map((s) => (
              <li key={s.sessionId} className="import-row">
                <div className="import-text">
                  <div className="import-title">{s.title}</div>
                  <div className="muted small import-meta">
                    {s.cwd ? tilde(s.cwd, homeOn(state, host)) : "unknown folder"}
                    {s.gitBranch ? ` · ${s.gitBranch}` : ""} · {ago(s.lastModified)}
                  </div>
                  {!s.importedAs && Date.now() - s.lastModified < RECENT_MS && (
                    // Two writers on one Claude Code conversation would interleave.
                    <div className="warn small">Used in the last 10 minutes: if it is still open in Claude Code, close it there first.</div>
                  )}
                </div>
                {s.importedAs ? (
                  <button className="btn" aria-label={`Open ${s.title}`} onClick={() => open(s.importedAs!)}>
                    Open
                  </button>
                ) : (
                  <button
                    className="btn"
                    aria-label={`Import ${s.title}`}
                    disabled={pending !== null}
                    onClick={() => {
                      setPending(s.sessionId);
                      actions.importClaudeSession(host, s.sessionId);
                    }}
                  >
                    {pending === s.sessionId ? "Importing…" : "Import"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** What the Hosts page can do with a host's accounts. */
interface AccountActions {
  login(engine: Engine, account: string): void;
  add(engine: Engine, name: string): void;
  remove(id: string): void;
}

function HostCard(props: { state: State; id: string; onRemove?(): void; onInstall?(): void; onLogin?(engine: Engine): void; accountActions?: AccountActions }) {
  const { state, id, onRemove, onInstall, onLogin, accountActions } = props;
  const install = state.installs[id];
  const entry = state.hosts.find((h) => h.id === id);
  const status = hostState(state, id);
  const host = status === "down" || status === "connecting" ? undefined : state.host[id];
  const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, s]) => hostOf(s) === id));
  const name = hostName(state, id);
  const where = entry ? (entry.kind === "ssh" ? entry.destination : entry.url) : "";
  const problem = entry && status === "down" ? explainHostError(entry) : null;
  return (
    <section className="host-card" aria-label={name}>
      <div className="host-head">
        <span className={`dot host-dot-${status}`} aria-hidden="true" />
        <h2>{name}</h2>
        {entry && <Cloud size={14} />}
        {where && <span className="muted small host-where">{where}</span>}
        <span className="spacer" />
        <span className={`small host-state-${status}`}>{HOST_STATE_LABEL[status]}</span>
      </div>
      {install && (install.running || !install.ok || status !== "ok") && <InstallLog install={install} machine={name} />}
      {problem && !install?.running && !install?.ok && (
        <div className="host-problem">
          <div>{problem.title}</div>
          {problem.hint && <div className="muted small">{problem.hint}</div>}
          {problem.install && onInstall && (
            <div className="row">
              <button className="btn-primary" onClick={onInstall}>
                Install Switchyard on {name}
              </button>
            </div>
          )}
          {entry?.error && problem.title !== entry.error && (
            <details className="small muted">
              <summary>Details</summary>
              <code>{entry.error}</code>
            </details>
          )}
        </div>
      )}
      {status === "connecting" && <div className="muted small">Opening the SSH tunnel…</div>}
      {host && (
        <>
          <div className="stat-grid">
            <Stat label="CPU" value={host.cpu} big={pct(host.cpu)} detail={`load ${host.load.toFixed(1)} of ${host.cores}`} warn={host.load > host.cores} />
            <Stat
              label="Memory"
              value={(host.memUsed / host.memTotal) * 100}
              big={`${gb(host.memUsed)} GB`}
              detail={`of ${gb(host.memTotal)} GB`}
              warn={host.memUsed / host.memTotal > 0.9}
            />
            <Stat
              label="Disk"
              value={host.diskTotal ? (host.diskUsed / host.diskTotal) * 100 : 0}
              big={`${gb(host.diskUsed)} GB`}
              detail={`of ${gb(host.diskTotal)} GB`}
              warn={host.diskTotal > 0 && host.diskUsed / host.diskTotal > 0.9}
            />
          </div>
          <Sparkline values={host.cpuHistory ?? []} />
          <SessionUse host={host} sessions={sessions} />
        </>
      )}
      {!host && status !== "down" && status !== "connecting" && <div className="muted small">Waiting for the first sample.</div>}
      {host && state.engines[id] ? (
        <Engines engines={state.engines[id]} accounts={accountsOn(state, id)} accountActions={accountActions} errorCount={state.errorCount} connected={state.connected} onLogin={onLogin} />
      ) : (
        install?.ok && !install.running && <EngineSummary install={install} machine={name} />
      )}
      {onRemove && <RemoveHost onConfirm={onRemove} onUpdate={entry?.kind === "ssh" && host && !install?.running ? onInstall : undefined} />}
    </section>
  );
}

/** The installer's output while it runs, and its outcome when it failed. */
function InstallLog({ install, machine }: { install: State["installs"][string]; machine: string }) {
  const lines = install.lines.filter((l) => !l.startsWith("@@"));
  const failure = install.lines.find((l) => l.startsWith("@@fail "))?.slice(7);
  return (
    <div className="host-problem">
      <div>
        {install.running ? `Installing Switchyard on ${machine}…` : install.ok ? `Installed. Connecting to ${machine}…` : `The install on ${machine} failed${failure ? `: ${failure}` : "."}`}
      </div>
      {lines.length > 0 && (
        <pre className="install-log" aria-live="polite">
          {lines.slice(-8).join("\n")}
        </pre>
      )}
    </div>
  );
}

const ENGINE_LABEL: Record<string, string> = { claude: "Claude Code", codex: "Codex" };
const ENGINE_LOGIN: Record<string, string> = { claude: "claude setup-token", codex: "codex login --device-auth" };
const ENGINE_INSTALL: Record<string, string> = { claude: "npm i -g @anthropic-ai/claude-code", codex: "npm i -g @openai/codex" };

/** What the installer found about the engines, with what to run for each that is not ready. */
function EngineSummary({ install, machine }: { install: State["installs"][string]; machine: string }) {
  const engines = install.lines
    .filter((l) => l.startsWith("@@engine "))
    .map((l) => l.split(" "))
    .map(([, name, state]) => ({ name, state }));
  const notReady = engines.filter((e) => e.state !== "ok");
  if (!engines.length) return null;
  return (
    <div className="engines">
      {engines.map((e) => (
        <div key={e.name} className="engine-row">
          <span className={`dot ${e.state === "ok" ? "host-dot-ok" : "host-dot-busy"}`} aria-hidden="true" />
          <span>{ENGINE_LABEL[e.name] ?? e.name}</span>
          <span className="muted small">{e.state === "ok" ? "ready" : e.state === "missing" ? "not installed" : "not logged in"}</span>
          {e.state !== "ok" && (
            <code className="engine-cmd">{e.state === "missing" ? ENGINE_INSTALL[e.name] : ENGINE_LOGIN[e.name]}</code>
          )}
        </div>
      ))}
      {notReady.length > 0 && <div className="muted small">Run the command on {machine} once, over SSH. Sessions with that engine work after that.</div>}
    </div>
  );
}

/** Each engine on a host and whether it is ready, with a login for one that is not. */
function Engines(props: {
  engines: EngineStates;
  accounts: AccountEntry[];
  accountActions?: AccountActions;
  errorCount: number;
  connected: boolean;
  onLogin?(engine: Engine): void;
}) {
  const { engines, accounts, accountActions, errorCount, connected, onLogin } = props;
  // The engine whose Add account form is open.
  const [adding, setAdding] = useState<Engine | null>(null);
  return (
    <div className="engines">
      {(["claude", "codex"] as Engine[]).map((engine) => {
        const st = engines[engine];
        if (!st) return null;
        const ready = st.installed && st.loggedIn === true;
        return (
          <div key={engine} className="engine-block">
            <div className="engine-row">
              <span className={`dot ${ready ? "host-dot-ok" : "host-dot-busy"}`} aria-hidden="true" />
              <span>{ENGINE_LABEL[engine]}</span>
              <span className="muted small">{engineStateText(st)}</span>
              {!st.installed && <code className="engine-cmd">{ENGINE_INSTALL[engine]}</code>}
              {st.installed && st.loggedIn !== true && onLogin && (
                <button className="btn engine-login" onClick={() => onLogin(engine)}>
                  Log in
                </button>
              )}
              {st.installed && accountActions && adding !== engine && (
                <button className="btn-text engine-add" aria-label={`Add ${ENGINE_LABEL[engine]} account`} onClick={() => setAdding(engine)}>
                  <Icon d={PLUS} size={12} />
                  Add account
                </button>
              )}
            </div>
            {accounts
              .filter((a) => a.engine === engine)
              .map((a) => (
                <AccountRow
                  key={a.id}
                  account={a}
                  state={engines.accounts?.[a.id]}
                  onLogin={accountActions ? () => accountActions.login(engine, a.id) : undefined}
                  onRemove={accountActions ? () => accountActions.remove(a.id) : undefined}
                />
              ))}
            {adding === engine && accountActions && (
              <AddAccount
                engine={engine}
                accountIds={accounts.map((a) => a.id)}
                errorCount={errorCount}
                connected={connected}
                onAdd={(name) => accountActions.add(engine, name)}
                onDone={() => setAdding(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function engineStateText(st: EngineState): string {
  if (!st.installed) return "not installed";
  if (st.loggedIn === true) return st.account ? `logged in as ${st.account}` : "logged in";
  if (st.loggedIn === false) return "not logged in";
  return st.error || "status unknown";
}

/** An added account under its engine: its login state, Log in and Remove
 *  (which asks for a second click, like removing a host). */
function AccountRow({ account, state: st, onLogin, onRemove }: { account: AccountEntry; state?: EngineState; onLogin?(): void; onRemove?(): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  const ready = st?.installed && st.loggedIn === true;
  return (
    <div className="account-row">
      <span className={`dot ${ready ? "host-dot-ok" : "host-dot-busy"}`} aria-hidden="true" />
      <span className="account-name">{account.name}</span>
      <span className="muted small">{st ? engineStateText(st) : "checking…"}</span>
      {st?.installed && st.loggedIn !== true && onLogin && (
        <button className="btn engine-login" aria-label={`Log in ${account.name}`} onClick={onLogin}>
          Log in
        </button>
      )}
      {onRemove && (
        <button
          className="btn-text account-remove"
          aria-label={`Remove ${account.name}`}
          title="Deletes the account's login on this host"
          onClick={() => (armed ? onRemove() : setArmed(true))}
        >
          {armed ? "Click again to remove" : "Remove"}
        </button>
      )}
    </div>
  );
}

function AddAccount(props: { engine: Engine; accountIds: string[]; errorCount: number; connected: boolean; onAdd(name: string): void; onDone(): void }) {
  const { accountIds, errorCount, connected, onAdd, onDone } = props;
  const [name, setName] = useState("");
  // The account ids known at the submit, until yardd answers. A refusal (a
  // name already in use) keeps the form open with the name; the new account
  // appearing closes it, and a dropped connection gives Add back. A timer used
  // to close it whatever yardd said.
  const [sent, setSent] = useState<string[] | null>(null);
  const errors = useRef(errorCount);
  useEffect(() => {
    if (sent && errorCount !== errors.current) setSent(null);
  }, [errorCount]);
  useEffect(() => setSent(null), [connected]);
  useEffect(() => {
    if (sent && accountIds.some((id) => !sent.includes(id))) onDone();
  }, [sent, accountIds]);
  return (
    <form
      className="account-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || sent) return;
        errors.current = errorCount;
        setSent(accountIds);
        onAdd(name.trim());
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Name, such as Work`}
        maxLength={40}
        spellCheck={false}
        autoComplete="off"
        aria-label="Account name"
        onKeyDown={(e) => e.key === "Escape" && onDone()}
      />
      <button className="btn-primary" type="submit" disabled={!name.trim() || !!sent}>
        Add
      </button>
      <button className="btn-text" type="button" onClick={onDone}>
        Cancel
      </button>
    </form>
  );
}

function Stat({ label, value, big, detail, warn }: { label: string; value: number; big: string; detail: string; warn?: boolean }) {
  return (
    <div className={`stat ${warn ? "warn" : ""}`}>
      <span className="muted small">{label}</span>
      <span className="stat-big">{big}</span>
      <div className="bar-track" aria-hidden="true">
        <div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="muted small">{detail}</span>
    </div>
  );
}

/** Removing asks for a second click, like deleting a session. */
function RemoveHost({ onConfirm, onUpdate }: { onConfirm(): void; onUpdate?(): void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <div className="host-foot">
      <button className="btn-text" onClick={() => (armed ? onConfirm() : setArmed(true))}>
        {armed ? "Click again to remove" : "Remove host"}
      </button>
      {armed && <span className="muted small">Its sessions keep running there.</span>}
      {onUpdate && !armed && (
        <button className="btn-text" onClick={onUpdate} title="Install the latest Switchyard there and restart it">
          Update Switchyard
        </button>
      )}
    </div>
  );
}

/** `user@box.tailnet.ts.net` → `box`. */
const nameFromDestination = (dest: string) => dest.trim().replace(/^.*@/, "").split(".")[0] ?? "";

function AddHost(props: { actions: Actions; hosts: HostEntry[]; errorCount: number; connected: boolean; onDone(): void }) {
  const { actions, hosts, errorCount, connected, onDone } = props;
  const [destination, setDestination] = useState("");
  const [name, setName] = useState("");
  const [port, setPort] = useState("47717");
  const [more, setMore] = useState(false);
  const [direct, setDirect] = useState(false);
  const [url, setUrl] = useState("");
  // The host ids known when Add was clicked, until yardd answers. A new host
  // appearing closes the form; an error keeps it open with what was typed, and
  // a dropped connection gives Add back. Closing on the click itself lost the
  // input whenever yardd refused.
  const [sent, setSent] = useState<string[] | null>(null);
  useEffect(() => setSent(null), [errorCount, connected]);
  useEffect(() => {
    if (sent && hosts.some((h) => !sent.includes(h.id))) onDone();
  }, [sent, hosts]);
  const finalName = (name.trim() || (direct ? "" : nameFromDestination(destination))).trim();
  const ready = finalName && (direct ? url.trim() : destination.trim());
  const submit = () => {
    if (!ready || sent) return;
    actions.addHost(
      direct
        ? { name: finalName, kind: "direct", url: url.trim() }
        : { name: finalName, kind: "ssh", destination: destination.trim(), remotePort: Number(port) || 47717 },
    );
    setSent(hosts.map((h) => h.id));
  };
  return (
    <section className="host-card add-host" aria-label="Add host">
      <h2>Add a host</h2>
      <div className="muted small">
        Run sessions on another machine you can <code>ssh</code> into without a password. If Switchyard isn't there yet, you can install it from
        here next.
      </div>
      {!direct && (
        <input
          className="field"
          autoFocus
          type="text"
          placeholder="user@machine"
          aria-label="SSH destination"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          spellCheck={false}
        />
      )}
      {more && (
        <div className="form-grid">
          <label htmlFor="host-name">Name</label>
          <input id="host-name" type="text" placeholder={nameFromDestination(destination) || "devbox"} value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
          {direct ? (
            <>
              <label htmlFor="host-url">URL</label>
              <input id="host-url" type="text" placeholder="ws://127.0.0.1:47726/ws" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false} />
            </>
          ) : (
            <>
              <label htmlFor="host-port">Remote port</label>
              <input id="host-port" type="text" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} />
            </>
          )}
          <span />
          <label className="check small">
            <input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} />
            Direct WebSocket URL, for testing
          </label>
        </div>
      )}
      <div className="row">
        <button className="btn-primary" disabled={!ready || !!sent} onClick={submit}>
          Add {finalName || "host"}
        </button>
        <button className="btn-text" onClick={onDone}>
          Cancel
        </button>
        <span className="spacer" />
        {!more && (
          <button className="btn-text" onClick={() => setMore(true)}>
            Options
          </button>
        )}
      </div>
    </section>
  );
}

function Hosts({ state, actions }: { state: State; actions: Actions }) {
  const [adding, setAdding] = useState(false);
  const [login, setLogin] = useState<{ host: string; engine: Engine; account?: string } | null>(null);
  const accountActions = (host: string): AccountActions => ({
    login: (engine, account) => setLogin({ host, engine, account }),
    add: (engine, name) => actions.addAccount(host, engine, name),
    remove: (id) => actions.removeAccount(host, id),
  });
  return (
    <div className="hosts">
      <header className="bar">
        <MenuButton />
        <h1>Hosts</h1>
        <span className="spacer" />
        {!adding && (
          <button className="btn" onClick={() => setAdding(true)}>
            <Icon d={PLUS} size={13} />
            Add host
          </button>
        )}
      </header>
      <div className="scroll">
        <div className="hosts-inner">
          {adding && <AddHost actions={actions} hosts={state.hosts} errorCount={state.errorCount} connected={state.connected} onDone={() => setAdding(false)} />}
          <HostCard state={state} id="local" accountActions={accountActions("local")} onLogin={(engine) => setLogin({ host: "local", engine })} />
          {state.hosts.map((h) => (
            <HostCard
              key={h.id}
              state={state}
              id={h.id}
              onRemove={() => actions.removeHost(h.id)}
              onInstall={h.kind === "ssh" ? () => actions.installHost(h.id) : undefined}
              accountActions={accountActions(h.id)}
              onLogin={(engine) => setLogin({ host: h.id, engine })}
            />
          ))}
          {login && <LoginDialog state={state} actions={actions} host={login.host} engine={login.engine} account={login.account} onClose={() => setLogin(null)} />}
          {state.hosts.length === 0 && !adding && (
            <button className="host-empty" onClick={() => setAdding(true)}>
              <Icon d={CLOUD} size={16} />
              <span>
                <strong>Run sessions on another machine</strong>
                <span className="muted small">A server or desktop you reach over SSH. Its sessions show up here next to this one's.</span>
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
