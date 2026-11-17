import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { PrPeek } from "./protocol";
import { ago, checksLine, peekKey, peekState, prLink, prPeeks, reviewLabel, type PeekResult } from "./prPeek";

interface Peeker {
  peek(url: string): Promise<PeekResult>;
  cached(url: string): PeekResult | undefined;
}

const PeekContext = createContext<Peeker | null>(null);

/** Gives the PR links in a session's thread their hover cards, asked
 *  through the session so they run on its host with that host's gh. */
export function PeekScope({ sessionId, peek, children }: { sessionId: string; peek(sessionId: string, url: string): Promise<PeekResult>; children: ReactNode }) {
  const value = useMemo<Peeker>(
    () => ({ peek: (url) => peek(sessionId, url), cached: (url) => prPeeks.settled(peekKey(sessionId, url)) }),
    [sessionId, peek],
  );
  return <PeekContext.Provider value={value}>{children}</PeekContext.Provider>;
}

const OPEN_DELAY = 350;
const CLOSE_DELAY = 150;
const GAP = 6;
const EDGE = 8;

/** A GitHub PR link in agent Markdown. `href` must pass `prLink`. A mouse
 *  resting on it, or keyboard focus, opens the PR's card; a touch just
 *  follows the link, since there is no hover to end the card. */
export function PrLink({ href, children }: { href: string; children: ReactNode }) {
  const link = prLink(href)!;
  const peeker = useContext(PeekContext);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<PeekResult | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLAnchorElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const id = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const close = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };
  // Asked when the pointer arrives, so the answer is often in by the time the card opens.
  const enter = () => {
    clearTimeout(timer.current);
    if (!peeker || open) return;
    const known = peeker.cached(link.url);
    if (known) setResult(known);
    else {
      // A stale answer may stay up while it refreshes; a stale failure may not.
      setResult((r) => (r && "error" in r ? null : r));
      peeker.peek(link.url).then((r) => mounted.current && setResult(r));
    }
    timer.current = setTimeout(() => setOpen(true), OPEN_DELAY);
  };
  const leave = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(close, CLOSE_DELAY);
  };
  const byMouse = (e: PointerEvent) => e.pointerType !== "touch";

  // Under the link, above it when there is no room, always inside the window.
  useLayoutEffect(() => {
    if (!open || !anchor.current || !card.current) return;
    const at = anchor.current.getClientRects()[0] ?? anchor.current.getBoundingClientRect();
    const { width, height } = card.current.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(at.left, window.innerWidth - width - EDGE));
    const below = at.bottom + GAP;
    const above = at.top - GAP - height;
    const top = below + height <= window.innerHeight - EDGE || above < EDGE ? below : above;
    setPos({ left, top: Math.max(EDGE, Math.min(top, window.innerHeight - height - EDGE)) });
  }, [open, result]);

  useEffect(() => {
    if (!open) return;
    // A fixed card would drift away from its link.
    const scrolled = (e: Event) => !card.current?.contains(e.target as Node) && close();
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <>
      <a
        ref={anchor}
        className="pr-link"
        href={href}
        target="_blank"
        rel="noreferrer"
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => byMouse(e) && enter()}
        onPointerLeave={(e) => byMouse(e) && leave()}
        onFocus={(e) => e.currentTarget.matches(":focus-visible") && enter()}
        onBlur={close}
        onClick={close}
      >
        {children}
      </a>
      {open &&
        createPortal(
          <div
            ref={card}
            id={id}
            role="tooltip"
            className="pr-peek"
            style={pos ?? { left: 0, top: 0, visibility: "hidden" }}
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={leave}
          >
            <div className="pr-peek-repo">
              {link.repo} #{link.number}
            </div>
            {!result && <div className="muted small">Loading pull request…</div>}
            {result && "error" in result && <div className="pr-peek-error small">Can't show this pull request: {result.error}.</div>}
            {result && "pr" in result && <PeekBody pr={result.pr} />}
          </div>,
          document.body,
        )}
    </>
  );
}

function PeekBody({ pr }: { pr: PrPeek }) {
  const state = peekState(pr);
  const checks = checksLine(pr.checks);
  const review = reviewLabel(pr.reviewDecision);
  const updated = ago(pr.updatedAt);
  const failing = pr.checks.failing.join(", ");
  return (
    <>
      <div className="pr-peek-title">{pr.title}</div>
      <div className="pr-peek-state">
        <span className={`pr-pill pr-pill-${state.tone}`}>{state.label}</span>
        {pr.base && (
          <span className="pr-peek-branch muted small">
            into <code>{pr.base}</code>
            {pr.head && (
              <>
                {" "}
                from <code>{pr.head}</code>
              </>
            )}
          </span>
        )}
      </div>
      <div className="pr-peek-facts small">
        <span className={checks.tone === "none" ? "muted" : `pr-${checks.tone}`}>
          {checks.text}
          {failing && <span className="pr-peek-failing">: {failing}</span>}
        </span>
        {review && <span>{review}</span>}
        {pr.additions != null && pr.deletions != null && (
          <span className="pr-peek-lines">
            <span className="pr-passed">+{pr.additions}</span> <span className="pr-failed">−{pr.deletions}</span>
          </span>
        )}
      </div>
      <div className="muted small">
        @{pr.author}
        {updated && ` · updated ${updated}`}
      </div>
    </>
  );
}
