import { useEffect, useRef, useState } from "react";
import type { Engine, PrCheck, PrResult, PrThread, PullRequest, SessionMeta } from "./protocol";
import { hostOf, hostOnline, modelsOn, type Actions, type State } from "./store";
import { ENGINE_NAME, reviewEngine } from "./engines";
const RESULT_LABEL: Record<PrCheck["result"], string> = {
  passed: "passed",
  failed: "failed",
  running: "running",
  skipped: "skipped",
  neutral: "neutral",
};
const DECISION_LABEL: Record<string, string> = {
  APPROVED: "Approved",
  CHANGES_REQUESTED: "Changes requested",
  REVIEW_REQUIRED: "Review required",
};

const isPr = (pr: PrResult | undefined): pr is PullRequest => !!pr && "number" in pr;

function stateLine(pr: PullRequest): string {
  const state = pr.state === "MERGED" ? "Merged" : pr.state === "CLOSED" ? "Closed" : pr.isDraft ? "Draft" : "Open";
  const parts = [`${state} · into ${pr.base}`];
  if (pr.reviewDecision && DECISION_LABEL[pr.reviewDecision]) parts.push(DECISION_LABEL[pr.reviewDecision]);
  if (pr.mergeable === "CONFLICTING") parts.push("Conflicts");
  return parts.join(" · ");
}

const quote = (text: string) =>
  text
    .trim()
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");

/** The prompt a review thread becomes: where, who, the words, and the ask. */
function threadPrompt(t: PrThread): string {
  const where = t.line != null ? `${t.path}:${t.line}` : t.path;
  const [first, ...replies] = t.comments;
  let text = `Review comment on ${where} from @${first.author}:\n${quote(first.body)}`;
  for (const c of replies) text += `\n@${c.author} replied:\n${quote(c.body)}`;
  return `${text}\nAddress it.`;
}

/**
 * The other engine's review prompt. The PR title and comments are left out:
 * they come from GitHub and may be written by anyone.
 */
export function reviewPrompt(pr: PrResult | undefined): string {
  let against: string;
  let read: string;
  if (isPr(pr)) {
    against = `the base of pull request #${pr.number} (${pr.base})`;
    read = `Read \`git diff origin/${pr.base}...HEAD\` (fetch first if the ref is missing)`;
  } else {
    // yardd names a base only when the repository has it; a guessed
    // origin/HEAD sends the reviewer into a failing command.
    const def = pr && "defaultBranch" in pr ? pr.defaultBranch : null;
    against = def ? `the default branch (${def})` : "the default branch";
    read = def
      ? `Read \`git diff ${def}...HEAD\``
      : "Find the default branch in this repository, read the diff from it to HEAD (`git diff <branch>...HEAD`),";
  }
  return [
    `Review this branch's changes against ${against}.`,
    `${read} and the files it touches.`,
    "Report bugs, risks and unclear code, each with file and line, most serious first.",
    "Do not change, create or delete any files. This is a review only.",
  ].join("\n");
}

const safeUrl = (url: string | null | undefined) => (url && /^https:\/\//.test(url) ? url : undefined);

/** The PR tab: the pull request for the session folder's branch. */
export function PrPane(props: { meta: SessionMeta; state: State; actions: Actions; visible: boolean }) {
  const { meta, state, actions, visible } = props;
  const pr = state.pr[meta.id];
  const busy = meta.status === "running" || meta.status === "needs_approval";
  const connected = hostOnline(state, hostOf(meta));

  // A request is out: hold the buttons until yardd answers, or a double click
  // sends the thread twice. Any update to this session (it starts running, or
  // the new review session opens) or a refusal is the answer.
  const [sent, setSent] = useState(false);
  useEffect(() => setSent(false), [meta, connected, state.errorCount]);

  // First time the tab is shown for this session.
  useEffect(() => {
    if (visible && connected && !state.pr[meta.id]) actions.loadPr(meta.id);
  }, [visible, connected, meta.id]);

  // Checks and threads move on their own; poll only while someone is looking.
  useEffect(() => {
    if (!visible || !connected) return;
    const timer = setInterval(() => actions.loadPr(meta.id), 60_000);
    return () => clearInterval(timer);
  }, [visible, connected, meta.id]);

  // A turn may have committed or pushed: refresh when it ends.
  const last = useRef({ id: meta.id, busy });
  useEffect(() => {
    if (last.current.id === meta.id && last.current.busy && !busy) actions.loadPr(meta.id);
    last.current = { id: meta.id, busy };
  }, [meta.id, busy]);

  const models = modelsOn(state, hostOf(meta));
  const other: Engine = reviewEngine(meta.engine, models) ?? (meta.engine === "claude" ? "codex" : "claude");
  const reviewModel = models[other]?.find((m) => m.isDefault) ?? models[other]?.[0];
  const review = () => {
    if (!reviewModel || sent) return;
    setSent(true);
    actions.create({
      engine: other,
      model: reviewModel.id,
      effort: reviewModel.defaultEffort ?? reviewModel.efforts[0] ?? "medium",
      cwd: meta.cwd,
      text: reviewPrompt(pr),
      worktree: false,
      // The review runs where the code is.
      host: hostOf(meta) === "local" ? undefined : hostOf(meta),
    });
  };
  const reviewButton = (
    <div className="pr-foot">
      <button className="btn" disabled={!connected || !reviewModel || sent} onClick={review}>
        Review with {ENGINE_NAME[other]}
      </button>
      <span className="muted small">Starts a new {ENGINE_NAME[other]} session in this folder. It reports and changes nothing.</span>
    </div>
  );

  return (
    <div className="scroll pane-body" style={{ display: visible ? "flex" : "none" }}>
      {!pr && <div className="muted">Loading pull request.</div>}
      {pr && "error" in pr && (
        <>
          <div className="muted">Cannot read the pull request: {pr.error}.</div>
          {pr.repo && reviewButton}
        </>
      )}
      {pr && "none" in pr && (
        <>
          <div className="muted">
            No pull request for <code>{pr.branch}</code>.
          </div>
          {reviewButton}
        </>
      )}
      {isPr(pr) && (
        <PrView
          pr={pr}
          busy={busy || !connected || sent}
          onSend={(t) => {
            if (sent) return;
            setSent(true);
            actions.send(meta.id, threadPrompt(t));
          }}
        />
      )}
      {isPr(pr) && reviewButton}
    </div>
  );
}

function PrView({ pr, busy, onSend }: { pr: PullRequest; busy: boolean; onSend(t: PrThread): void }) {
  const threads = [...pr.threads.filter((t) => !t.resolved), ...pr.threads.filter((t) => t.resolved)];
  const open = pr.threads.filter((t) => !t.resolved).length;
  const failed = pr.checks.filter((c) => c.result === "failed").length;
  const running = pr.checks.filter((c) => c.result === "running").length;
  return (
    <>
      <div className="pr-head">
        <h2>{pr.title}</h2>
        <a href={safeUrl(pr.url)} target="_blank" rel="noreferrer">
          #{pr.number}
        </a>
      </div>
      <div className="muted">{stateLine(pr)}</div>

      <section className="pr-section" aria-label="Checks">
        <div className="pr-label">
          Checks
          {pr.checks.length > 0 && (
            <span className="muted">
              {" "}
              · {failed ? `${failed} failed` : running ? `${running} running` : "all passed"}
            </span>
          )}
        </div>
        {pr.checks.length === 0 && <div className="muted small">No checks.</div>}
        {pr.checks.map((c, i) => (
          <div key={i} className="pr-row">
            {safeUrl(c.url) ? (
              <a className="pr-name" href={safeUrl(c.url)} target="_blank" rel="noreferrer">
                {c.name}
              </a>
            ) : (
              <span className="pr-name">{c.name}</span>
            )}
            <span className={`pr-result pr-${c.result}`}>{RESULT_LABEL[c.result]}</span>
          </div>
        ))}
        {pr.checksTruncated && <div className="muted small">Showing the first 100 checks.</div>}
      </section>

      <section className="pr-section" aria-label="Review comments">
        <div className="pr-label">
          Review comments
          {pr.threads.length > 0 && <span className="muted"> · {open} unresolved</span>}
        </div>
        {pr.threadsError && <div className="muted small">Cannot read review comments: {pr.threadsError}.</div>}
        {!pr.threadsError && pr.threads.length === 0 && <div className="muted small">No review comments.</div>}
        {threads.map((t, i) => (
          <div key={i} className={`pr-thread ${t.resolved ? "resolved" : ""}`}>
            <div className="pr-where">
              <code>{t.line != null ? `${t.path}:${t.line}` : t.path}</code>
              {t.resolved && <span className="muted small">resolved</span>}
              {t.outdated && <span className="muted small">outdated</span>}
            </div>
            {t.comments.map((c, j) => (
              <div key={j} className="pr-comment">
                <span className="pr-author">@{c.author}</span>
                <div className="pr-body">{c.body}</div>
              </div>
            ))}
            {t.comments.length > 0 && (
              <div className="row">
                <button className="btn" disabled={busy} onClick={() => onSend(t)}>
                  Send to session
                </button>
              </div>
            )}
          </div>
        ))}
      </section>
    </>
  );
}
