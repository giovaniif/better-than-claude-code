// Hover cards on GitHub PR links in agent answers: which links get one, how
// the card words a PR, and the cache that keeps a list of links from asking
// yardd (and gh) once per hover. PrHoverCard.tsx draws the card.

import type { PrPeek } from "./protocol";

export type PeekResult = { pr: PrPeek } | { error: string };

export interface PrLinkParts {
  /** `https://github.com/<owner>/<repo>/pull/<number>`, what yardd is asked about. */
  url: string;
  /** `owner/repo`. */
  repo: string;
  number: number;
}

/** A bare PR URL in text. The tail takes a tab (`/files`) and an anchor but
 *  no dots, so the full stop that ends a sentence stays text. */
export const PR_URL_SOURCE =
  "https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pull/[1-9][0-9]{0,8}(?![0-9])(?:/[A-Za-z0-9_-]+)*(?:#[A-Za-z0-9_-]+)?";

const OWNER = /^(?!-)[A-Za-z0-9-]{1,39}$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const NUMBER = /^[1-9][0-9]{0,8}$/;
const TAIL = /^[A-Za-z0-9._-]*$/;

/** The PR a link points at, or null for any other link. Mirrors yardd's
 *  `canonical_pr_url`, which checks again before running gh. */
export function prLink(raw: string): PrLinkParts | null {
  if (raw.length > 2048 || !raw.startsWith("https://github.com/")) return null;
  const path = raw.slice("https://github.com/".length).split(/[?#]/)[0];
  const [owner, repo, pull, number, ...tail] = path.split("/");
  if (!owner || !repo || !number || pull !== "pull") return null;
  if (!OWNER.test(owner) || !REPO.test(repo) || repo === "." || repo === ".." || !NUMBER.test(number)) return null;
  if (!tail.every((t) => TAIL.test(t))) return null;
  return { url: `https://github.com/${owner}/${repo}/pull/${number}`, repo: `${owner}/${repo}`, number: Number(number) };
}

/** How GitHub itself shows a bare PR URL: `owner/repo#12`. */
export const shortLabel = (link: PrLinkParts) => `${link.repo}#${link.number}`;

export type PeekTone = "open" | "draft" | "merged" | "closed";

export function peekState(pr: Pick<PrPeek, "state" | "isDraft">): { label: string; tone: PeekTone } {
  if (pr.state === "MERGED") return { label: "Merged", tone: "merged" };
  if (pr.state === "CLOSED") return { label: "Closed", tone: "closed" };
  return pr.isDraft ? { label: "Draft", tone: "draft" } : { label: "Open", tone: "open" };
}

const DECISION: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};
export const reviewLabel = (decision: string | null | undefined) => (decision ? (DECISION[decision] ?? null) : null);

/** One line for the checks, toned like the PR pane's results. Skipped and
 *  neutral checks are left out, as GitHub's summary does. */
export function checksLine(c: PrPeek["checks"]): { text: string; tone: "passed" | "failed" | "running" | "none" } {
  const total = c.passed + c.failed + c.running;
  const of = (n: number, what: string) => (n === total ? `${total === 1 ? "1 check" : `All ${total} checks`} ${what}` : `${n} of ${total} checks ${what}`);
  if (total === 0) return { text: "No checks", tone: "none" };
  if (c.failed) return { text: of(c.failed, "failed"), tone: "failed" };
  if (c.running) return { text: of(c.running, "running"), tone: "running" };
  return { text: of(c.passed, "passed"), tone: "passed" };
}

/** "3 h ago", the way the card says when the PR last changed. */
export function ago(iso: string | null | undefined, now = Date.now()): string | null {
  const at = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(at)) return null;
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return days === 1 ? "1 day ago" : `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years <= 1 ? "1 year ago" : `${years} years ago`;
}

/** A `pr.peek` reply (or a refusal, timeout or dropped socket) as a card's content. */
export function peekResult(reply: { pr?: PrPeek; error?: string } | null | undefined): PeekResult {
  if (reply?.pr && typeof reply.pr.number === "number") return { pr: reply.pr };
  const error = reply?.error || "no answer";
  // A host whose yardd predates hover cards.
  if (error.startsWith("unknown op")) return { error: "this session's host runs an older Switchyard" };
  return { error: error.replace(/\.$/, "") };
}

/** Cache key: the same URL may read differently through another host's gh login. */
export const peekKey = (sessionId: string, url: string) => `${sessionId.includes("~") ? sessionId.split("~")[0] : "local"}\n${url}`;

interface Entry {
  value: Promise<PeekResult>;
  /** When the answer came; null while it is on its way. */
  at: number | null;
  result?: PeekResult;
}

/** Answers per key for a minute (failures for 10 s); asks in flight are shared. */
export class PeekCache {
  private entries = new Map<string, Entry>();
  constructor(
    private fresh = 60_000,
    private errorFresh = 10_000,
    private now = () => Date.now(),
  ) {}

  private live(e: Entry): boolean {
    if (e.at === null) return true;
    return this.now() - e.at < (e.result && "error" in e.result ? this.errorFresh : this.fresh);
  }

  /** The answer, when one is in and still fresh: the card opens on it with no loading line. */
  settled(key: string): PeekResult | undefined {
    const e = this.entries.get(key);
    return e && e.at !== null && this.live(e) ? e.result : undefined;
  }

  get(key: string, load: () => Promise<PeekResult>): Promise<PeekResult> {
    const known = this.entries.get(key);
    if (known && this.live(known)) return known.value;
    for (const [k, e] of this.entries) if (!this.live(e)) this.entries.delete(k);
    const entry: Entry = { at: null, value: Promise.resolve({ error: "no answer" }) };
    entry.value = load()
      .catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
      .then((result) => {
        entry.at = this.now();
        entry.result = result;
        return result;
      });
    this.entries.set(key, entry);
    return entry.value;
  }
}

export const prPeeks = new PeekCache();
