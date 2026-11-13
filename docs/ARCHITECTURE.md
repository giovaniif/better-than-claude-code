# Switchyard: architecture

Working name. Design: [Agent Harness UI](https://claude.ai/artifact/XQdXoraWtiuUwwrrCt3462), sources in [design/](../design).

One UI for Claude Code and Codex sessions on my own subscriptions: fast switching between engines, models and efforts, a terminal and PR review next to each session, and the same view for sessions on a remote box.

Rewritten 2026-11-13. Replaces the 2026-11-06 version. Checked against claude 2.1.318, codex-cli 0.159.2, Agent SDK 0.3.323.

## Decided

- Tauri shell. Rust core, web UI. Personal first.
- The app drives the installed `claude` and `codex` CLIs and turns their event streams into one UI. It never holds or offers a login.
- Chat UI in the Claude Code message style, not a terminal. The terminal is a separate pane.
- White, minimal theme. One flat session list. A cloud icon marks sessions on a remote host.
- New session is a full page with a centered prompt box, not a dialog.
- Remote sessions run on my own box over SSH and Tailscale, not on claude.ai/code. A claude.ai webview and a hook bridge were considered and dropped.
- Host CPU, memory and disk are always visible. The daemon queues new sessions when a host is under pressure.

## Shape

- **yardd** (`crates/yardd`): Rust daemon. Owns every agent process, the event log and host stats. Serves the UI and a WebSocket on `127.0.0.1:47717`. The port stays out of 4510-4559, which LocalStack publishes on every interface.
- **yard-claude** (`sidecar/yard-claude`): TypeScript sidecar on the Claude Agent SDK, run with Bun. One per Claude session, JSON lines over stdio. The SDK exists only for TypeScript and Python.
- **ui** (`ui`): React + Vite. Talks only to yardd.
- **app** (`app/src-tauri`): Tauri v2 window. Starts yardd if nothing is listening, then loads yardd's page. It holds no agent state and yardd outlives it, so sessions survive closing the app.

The same yardd binary runs on my Mac and on the remote box. A remote session is a session on another yardd, reached through an SSH port forward over Tailscale. No open port, no auth layer of our own.

The WebSocket is on a localhost TCP port because a webview cannot open a unix socket. yardd rejects any browser origin other than its own page and the Tauri window, so a website cannot drive agents.

## Events

Both engines are normalized to one event list per session. The UI replays it on open.

| Event | Meaning |
|---|---|
| `user_message` | My prompt |
| `turn_started`, `turn_completed` | Turn boundaries |
| `assistant_delta`, `assistant_message` | Streamed text, then the final text |
| `tool_started`, `tool_completed` | A command, read, search or other tool call |
| `file_change` | Edited files with diffs |
| `approval_request`, `approval_resolved` | A command or edit waiting on me |
| `error` | Engine error text |

Session status (`idle`, `running`, `needs_approval`, `error`) is derived from these.

## Engines

**Codex.** One shared `codex app-server` over stdio, JSON-RPC, driven from Rust.

- `thread/start` per session, `turn/start` per message. `turn/start` takes `model` and `effort`, so switching is per turn.
- Approvals arrive as server requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) and are answered with `accept`, `acceptForSession` or `decline`.
- `model/list` returns the models and each one's efforts. Today: `gpt-6.1-sol` (default), `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; efforts `low` to `ultra`.
- `account/rateLimits/updated` gives the usage percentage.
- The protocol is marked experimental. Pin the CLI version.

**Claude.** Agent SDK `query()` in streaming-input mode inside yard-claude.

- `canUseTool` carries approvals. `setModel()` switches model mid-session. `interrupt()` stops a turn.
- Effort is `low`, `medium`, `high`, `xhigh`, `max`. It is set at session start; changing it mid-session goes through `applyFlagSettings` (not wired yet).
- `rate_limit_event` gives five-hour and seven-day utilization.
- It runs on the CLI's own login (`apiKeySource: none`).
- Never parse `~/.claude/projects/*.jsonl`. Use the SDK's `listSessions` and `getSessionMessages`.

**Switching engine inside a session** cannot share a thread. It will be a hand-off: a new session on the other engine, same worktree, seeded with a summary. Not built yet.

## Resources

- yardd samples CPU, load, memory and disk every 3 s with `sysinfo` and keeps an hour of CPU history in memory.
- Planned: per-session usage from the process tree, a cgroup per session on Linux with a memory cap, admission control (queue when load is above the core count or free memory is under a limit), worktree disk sizes with cleanup.

## Worktrees

"New worktree" on the new-session page makes yardd cut a branch and worktree from the folder's current HEAD, at `~/.yard/wt/<repo>/<branch>`, and run the session there. Both engines share this layout.

- The branch is named from the task (`yard/<first words>-<4 hex>`) unless I type one.
- The worktree is made before the session. If `git worktree add` fails, nothing else runs and no session exists.
- Uncommitted changes in the original checkout are not carried over.
- Not built: picking a base branch, removing a worktree when its session is done, one writer per worktree, and per-repo setup (symlinking `node_modules`, `.env`).

## Terminal

The right pane has a Terminal tab next to Changes.

- yardd owns one PTY per session (`portable-pty`), running my login shell in the session folder. The UI renders it with xterm.js.
- yardd keeps 256 KB of output per terminal. Every chunk carries its byte offset, so a tab switch, page reload or reconnect replays the scrollback without gaps or repeats.
- The shell starts the first time the tab is opened and stays alive after the app closes.
- Not built: more than one terminal per session, splits, and a way to send a selection to the agent.

## PR pane

Not built yet. `gh pr view --json`, `gh pr diff`, `gh api` for threads. A comment on a line becomes a prompt to the session. One button asks the other engine to review the diff.

## Policy and cost

- Anthropic's docs say products built on the Agent SDK should use API keys and must not offer claude.ai login. A personal tool that runs my own logged-in CLI is not addressed. Keep it personal; ask Anthropic before any public release.
- Unconfirmed: whether Agent SDK usage on a subscription is metered separately from interactive use. Check the Usage page.
- The SDK loads my full Claude Code setup, including every MCP tool. A two-turn test cost $0.24 at API rates. Offer a trimmed profile.

## Status

Built and checked in the browser on 2026-11-13:

- yardd with both adapters, the event log, host stats and a git diff for the Changes pane.
- UI: new session, session thread, model and effort picker, approvals, Changes pane, hosts.
- A Codex session fixed a file and ran a check, with command and edit approvals answered in the UI.
- A Claude session (Haiku) did the same through the sidecar.
- Stop interrupts a Codex turn. A follow-up turn on a different Codex model and effort works in the same thread.
- The WebSocket refuses a foreign browser origin (403) and accepts its own (101).

- A session started with "New worktree" ran on its own branch under `~/.yard/wt`, and its edit stayed out of the original checkout. Asking for a branch that exists is refused with no session made.
- The terminal ran commands in the worktree, fit the pane, and showed its earlier output again after a page reload.
- The desktop app starts yardd, loads the UI, and leaves yardd running when it quits.

Not checked: Stop and a mid-session model switch on Claude, to save weekly usage. Both passed in the script spike.

Codex sessions run with `approvalPolicy: on-request` in a workspace-write sandbox. `untrusted` asked before every `cat`.

The app is a personal build: it finds yardd, the UI and the sidecar in the repo it was compiled from. It asks the login shell for `PATH`, because an app opened from Finder cannot see `codex`, `claude` or `bun` otherwise.

Next:

1. Bundle yardd, the UI and a compiled sidecar into the app so it runs outside this repo.
2. Worktree cleanup, base branch, and per-repo setup.
3. PR pane and cross-engine review.
4. Persist sessions (SQLite) and resume engine threads after a yardd restart.
5. Remote yardd over SSH and Tailscale, with the cloud icon.
6. Per-session resource use, memory caps and the queue.
7. Engine hand-off.

## Risks

- `codex app-server` is experimental and can change between CLI versions.
- Two agents in one worktree will fight. Enforce one writer.
- Sessions live in memory until step 4. Restarting yardd loses them.
