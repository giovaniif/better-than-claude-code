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
| `queued` | The session is waiting for the host to have room. Carries its prompt |
| `note` | A quiet line from yardd, such as a hand-off. Changes no status |

Session status (`idle`, `running`, `needs_approval`, `queued`, `error`) is derived from these.

## Persistence

yardd saves every session in SQLite: `yard.db` in `$YARD_DATA_DIR`, or `~/.yard` when that is unset.

- One writer thread takes writes from a channel and saves them in batches, so emitting an event never waits on the disk.
- Streamed `assistant_delta`s are not saved. The final `assistant_message` has the full text.
- On startup yardd loads every session. One that was mid-turn gets an `error` ("yardd restarted during this turn.") and a failed `turn_completed`.
- A restored session resumes on its next message. Codex: `thread/resume` with the saved thread id. Claude: a new sidecar started with the SDK `resume` option and the saved Claude Code session id.
- `session.delete` stops the session's engine and terminal and removes it from memory and the database. Git worktrees are kept.

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

**Switching engine** cannot share a thread, so it is a hand-off. Picking a model of the other engine in a session asks for confirmation, then starts a new session on that engine in the same folder, with the same branch and title and a `parent` pointing back.

- yardd builds the first message from the source session's event log, with no model call, because the source is usually out of quota.
- The brief holds the original task, each later prompt, each turn's final answer, the uncommitted changed files and any unresolved state. It is capped at 12,000 characters, keeping the task and the most recent turns.
- Agent text is quoted in `<earlier-work>` blocks marked as a record, not instructions.
- Refused for the same engine, and while a turn is running: two agents must not write to one folder at once.

## Resources

- yardd samples CPU, load, memory and disk every 3 s with `sysinfo` and keeps an hour of CPU history in memory.
- **Per session:** the same sample sums CPU and memory over each session's processes: the Claude sidecar tree, the terminal shell tree, and for Codex the app-server's children matched by command folder and start time. Codex runs as one shared app-server, so two Codex sessions running commands in the same folder at the same moment can be mixed up.
- **Memory cap:** `YARD_SESSION_MEM_CAP_GB` (default 8, 0 off). Over it, yardd reports an error in the session, interrupts the turn and kills the command and terminal trees. For Claude it kills only what runs below the CLI, so the conversation survives. It is a polling soft cap, not a cgroup.
- **Queue:** a new session waits (status `queued`) while 1-minute load is above the core count or free memory is under `YARD_MIN_FREE_GB` (default 2). One queued session starts per sample once there is room. "Start anyway" skips the wait. Queued sessions survive a restart.
- Not built: worktree disk sizes with cleanup, cgroups on Linux.

## Remote hosts

The local yardd is a hub. The UI keeps its one WebSocket to it.

- Each UI client gets its own connection from the hub to every remote yardd, piped both ways, so replies go back to the client that asked.
- Session and terminal ids that cross the hub are written `<hostId>~<remoteId>`. An op with such an id, or a `session.create` with `host`, goes to that host with the prefix removed.
- A remote `snapshot` arrives as `host.snapshot`; its `host`, `models` and `usage` messages carry a `hostId`. Models, usage and the home folder are kept per host.
- Hosts are saved in `hosts.json` in the data dir and changed with `host.add` and `host.remove`. Status (`connecting`, `connected`, `error` with a message) is broadcast as `hosts`.
- An `ssh` host gets one `ssh -N -L` tunnel shared by all clients, on a free loopback port, restarted with backoff up to 30 s and killed when the host is removed or yardd stops. The destination is passed after `--` and may not start with `-`.
- A `direct` host is a plain `ws://` URL, for local testing.
- Remote sessions stay listed but offline while their host is down.
- Preparing the box is in the README.

## Worktrees

"New worktree" on the new-session page makes yardd cut a branch and worktree at `<data dir>/wt/<repo>/<branch>` (`~/.yard/wt` by default) and run the session there. Both engines share this layout.

- The branch is named from the task (`yard/<first words>-<4 hex>`) unless I type one.
- **Base:** the "From" select lists local and `origin/*` branches, newest first (`git.branches`). The default is the current branch.
- The worktree is made before the session. If `git worktree add` fails, nothing else runs and no session exists.
- **Setup:** after a successful add, yardd runs `<data dir>/setup/<repo>.sh` if it exists, else `.yard/worktree-setup.sh` from the repo, with bash in the new worktree (`YARD_REPO`, `YARD_WORKTREE`, 5 minute limit). This is where `node_modules` and `.env` get linked. If it fails, yardd removes that worktree and branch and creates no session. It never runs in the original checkout.
- **Removal:** deleting a worktree session offers "Delete and remove worktree". It runs `git worktree remove`, never forced, and is refused if anything is uncommitted or untracked, or another session still uses the folder. The branch goes with `git branch -d`, which keeps unmerged branches.
- **One writer per folder:** a session without a new worktree is refused while another session in the same folder is running, waiting for approval or queued.
- Uncommitted changes in the original checkout are not carried over.
- Files a setup script creates count as untracked unless gitignored, so they block removal.

## Terminal

The right pane has a Terminal tab next to Changes.

- yardd owns one PTY per session (`portable-pty`), running my login shell in the session folder. The UI renders it with xterm.js.
- yardd keeps 256 KB of output per terminal. Every chunk carries its byte offset, so a tab switch, page reload or reconnect replays the scrollback without gaps or repeats.
- The shell starts the first time the tab is opened and stays alive after the app closes.
- Not built: more than one terminal per session, splits, and a way to send a selection to the agent.

## PR pane

The right pane has a Pull request tab.

- yardd runs `gh pr view --json` and `gh api graphql` (review threads) in the session folder through my own `gh` login. It holds no token and only reads.
- It shows the branch's PR: state, base and head, review decision, checks and review threads, unresolved first. It loads when first opened, refreshes when a turn ends, and polls every 60 s while visible.
- **Send to session** turns a review thread into a normal prompt quoting the comment with its file and line.
- **Review with the other engine** starts a new session on the other engine in the same folder, asking for a review of `git diff <base>...HEAD` and no file changes. The prompt leaves out the PR title and comments, because they are untrusted text.
- Not built: creating a PR, pushing, replying to or resolving threads.

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

- Persistence: a session survived a restart with its history, and a follow-up after the restart used the earlier conversation (Codex).
- PR pane: rendered a real open PR from a public repo, with checks and review threads.
- Hand-off: Codex received a hand-off brief and answered from the earlier work. The picker's confirmation was checked in the UI.
- Resource guard: per-session CPU and memory in the Hosts table, the memory cap killing an over-cap process, and the queue with "Start anyway".
- Remote hosts: a second local yardd added as a `direct` host. A session created on it from the UI ran there, with its terminal and Changes pane working through the hub, and came back after the remote restarted.

Not checked:

- A real SSH tunnel. This Mac has no SSH server to tunnel to, so only the failure and retry paths ran.
- Anything that needs a Claude turn in the newer features: Claude resume after a restart, hand-off into Claude, and Claude's per-session usage and cap. Claude weekly usage was nearly exhausted.
- Stop and a mid-session model switch on Claude. Both passed in the script spike.

Codex sessions run with `approvalPolicy: on-request` in a workspace-write sandbox. `untrusted` asked before every `cat`.

The app is self-contained. `app/build.sh` compiles the sidecar with `bun build --compile`, builds a release yardd, and bundles both with `ui/dist` under `Switchyard.app/Contents/Resources/yard` (78 MB, most of it the sidecar's Bun runtime).

- The shell starts that yardd with `YARD_ROOT` set to that folder and `YARD_SIDECAR` set to the compiled sidecar, so neither Bun nor the repo is needed at run time. The sidecar uses my installed `claude`.
- It asks the login shell for `PATH`, because an app opened from Finder cannot see `codex` or `claude` otherwise.
- `/health` returns `yardd <version> <build id>`. If a yardd with another build id is already running, the shell leaves it alone and says so in the title, because it may hold live sessions.
- With no bundled files (`cargo run`), the shell falls back to the repo builds.
- Unsigned, no auto-update.

Next:

1. Try a real box over Tailscale SSH, and the Claude paths listed above.
2. Creating a PR and replying to review threads from the pane.
3. Claude: effort changes mid-session, and showing Claude's questions as question cards.

## Risks

- `codex app-server` is experimental and can change between CLI versions.
- Two agents in one worktree will fight. Enforce one writer.
- If yardd is killed with SIGKILL, an SSH tunnel it started is left running. A normal stop kills it.
- The memory cap on a Claude session kills everything below the CLI, MCP servers included.
