# Switchyard: architecture

Working name. Design: [Agent Harness UI](https://claude.ai/artifact/XQdXoraWtiuUwwrrCt3462), sources in [design/](../design).

One UI for Claude Code and Codex sessions on my own subscriptions: fast switching between engines, models and efforts, a terminal and PR review next to each session, and the same view for sessions on a remote box.

Rewritten 2026-11-13. Replaces the 2026-11-06 version. Checked against claude 2.1.318, codex-cli 0.159.2, Agent SDK 0.3.323.

## Decided

- Tauri shell. Rust core, web UI. Personal first.
- The app drives the installed `claude` and `codex` CLIs and turns their event streams into one UI. It never holds a login: credentials stay where each CLI keeps them. It can start a CLI's own login flow on a host (see Engine logins).
- Chat UI in the Claude Code message style, not a terminal. The terminal is a separate pane.
- White, minimal theme. One flat session list. A cloud icon marks sessions on a remote host.
- New session is a full page with a centered prompt box, not a dialog.
- Remote sessions run on my own box over SSH and Tailscale, not on claude.ai/code. A claude.ai webview and a hook bridge were considered and dropped.
- Host CPU, memory and disk are always visible. The daemon queues new sessions when a host is under pressure.

## Shape

- **yardd** (`crates/yardd`): Rust daemon. Owns every agent process, the event log and host stats. Serves the UI and a WebSocket on `127.0.0.1:47717` (`YARD_BIND` changes the address; only the container image does). The port stays out of 4510-4559, which LocalStack publishes on every interface.
- **yard-claude** (`sidecar/yard-claude`): TypeScript sidecar on the Claude Agent SDK, run with Bun. One per Claude session, JSON lines over stdio. The SDK exists only for TypeScript and Python.
- **ui** (`ui`): React + Vite. Talks only to yardd.
- **app** (`app/src-tauri`): Tauri v2 window. Starts yardd if nothing is listening, then loads yardd's page. It holds no agent state and yardd outlives it, so sessions survive closing the app.

The same yardd binary runs on my Mac and on the remote box. A remote session is a session on another yardd, reached through an SSH port forward over Tailscale. No open port, no auth layer of our own.

The WebSocket is on a localhost TCP port because a webview cannot open a unix socket. yardd rejects any browser origin other than its own page and the Tauri window, so a website cannot drive agents.

## Events

Both engines are normalized to one event list per session. The UI replays it on open.

| Event | Meaning |
|---|---|
| `user_message` | My prompt, with any attachments' details |
| `turn_started`, `turn_completed` | Turn boundaries, with yardd's clock in `at` (ms) |
| `assistant_delta`, `assistant_message` | Streamed text, then the final text |
| `reasoning_delta`, `reasoning` | Thinking: Claude's summarized thinking (`--thinking-display summarized`), Codex's reasoning summary (parts become paragraphs) |
| `tool_started`, `tool_completed` | A command, read, search or other tool call |
| `file_change` | Edited files with diffs |
| `approval_request`, `approval_resolved` | A command or edit waiting on me |
| `error` | Engine error text |
| `queued` | The session is waiting for the host to have room. Carries its prompt |
| `note` | A quiet line from yardd, such as a hand-off. Changes no status |

Session status (`idle`, `running`, `needs_approval`, `queued`, `error`) is derived from these.

- Item ids come from the engine (Codex item ids, Claude `tool_use` ids; the sidecar's own ids carry a per-process prefix). The UI matches an id only within the current turn, after the last user message, so a reused id can never pull new text up into an earlier turn. Order is the log's order.
- Codex errors with `willRetry` ("Reconnecting... 2/5") are dropped; a turn that fails still ends with its error.
- The thread is laid out like T3 Code's work log (`ui/src/thread.ts`): tool calls and thinking between messages fold into a one-line group ("Read 3 files, ran 2 commands"); while a turn runs, only its latest step shows, under "Working for 12s"; a finished turn folds all of its work into "Worked for 1m 12s" above its answer. A thought shows as one line, its bold heading or first sentence, and opens to the full text.

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

**Permission modes.** A picker next to the model, named like Claude Code's modes. Saved on the session (`permission`), set by `session.create` and changed any time by `session.setPermission`; a hand-off keeps it.

| Mode | Claude (SDK `permissionMode`) | Codex (`turn/start` overrides) |
|---|---|---|
| Ask first (`ask`, default) | `default`: asks before commands and edits | `on-request`, workspace-write sandbox |
| Accept edits (`acceptEdits`) | `acceptEdits` | same as Ask first: Codex already edits inside its sandbox freely |
| Plan only (`plan`) | `plan` | `on-request`, read-only sandbox |
| Full access (`full`) | `bypassPermissions` | `never`, no sandbox |

Claude switches at once with `setPermissionMode` (the sidecar always passes `allowDangerouslySkipPermissions` so a later switch to full access works); Codex takes the mode from its next turn. Approving Claude's plan-mode exit leaves the picker showing Plan only until it is changed.

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
- **Install from the app:** when the ssh tunnel is up but no yardd answers behind it, the host reports `noDaemon` and its card offers "Install Switchyard". The hub runs `scripts/remote-install.sh` (compiled into yardd) over the host's ssh as `bash -s -- <port>`, streaming each line to every client as `host.install`. The script downloads `switchyard-linux-{x64,arm64}.tar.gz` from the `latest` release (built by `.github/workflows/linux-host.yml`), swaps it into `~/.local/share/switchyard`, runs yardd as a systemd user service with lingering (or detached where there is no user systemd), checks `/health`, and reports whether `claude` and `codex` are installed and logged in (`@@engine` lines). The same card offers "Update Switchyard" on a connected SSH host. `YARD_SSH` and `YARD_RELEASE_URL` exist for the tests.
- `scripts/install-host.sh` builds and installs from a checkout instead, for development.

## Web version

A container image (`Dockerfile`, `docker-compose.yml`) runs yardd as a web app, for Coolify or plain Docker Compose. Details and setup are in the README.

- One image: release yardd, `ui/dist`, the compiled sidecar, and pinned `codex`, `claude` and `gh` from npm and GitHub's apt repository. It runs as uid 1000 with `HOME` (logins, `~/.yard`) and `/workspace` as volumes.
- No sign-in, by decision: it is meant for a private network such as a tailnet. Anyone who reaches it can run commands in the container.
- yardd binds `YARD_BIND=0.0.0.0` there; loopback stays the default everywhere else. The Origin check stays: `YARD_ALLOW_ORIGIN` (comma separated) names the page's URL. yardd never trusts an Origin because it matches the Host header, since a rebound DNS name would pass that. It warns at startup when bound off loopback with no allowed origin.
- The page uses `wss://` when it is served over https (behind Coolify's Traefik).
- Codex's `workspace-write` sandbox uses bubblewrap, which cannot create namespaces in an unprivileged container (checked: "No permissions to create a new namespace"; with seccomp and AppArmor unconfined it still failed on the loopback interface). The image sets `YARD_CODEX_SANDBOX=danger-full-access`, so the container is the boundary. Approvals stay `on-request`. Elsewhere the default is unchanged.
- The local host's name is `YARD_HOST_NAME`, else "This Mac" on macOS and the hostname elsewhere. A remote host may not take that name.
- `.github/workflows/docker.yml` pushes `ghcr.io/giovaniif/switchyard` (`latest` from main, and the short sha).

## Sidebar

- Each session row has a menu (the … button, or right-click): Pin, Archive or Restore, and Delete, which asks once and, for a worktree session, offers to remove the worktree too. `session.update { pinned?, archived? }` stores both flags in the session's metadata, so every window and the web version agree, and they survive restarts. Archiving unpins. Archived sessions sit in a collapsed Archived section and still open and run.
- The sessions sidebar and the workspace pane are resizable; widths are per browser.

## Engine logins

- `engines.status` (per host) reports each engine as installed or not, and logged in or not: `claude auth status` (JSON) and Codex's `account/read`. The UI asks once per host snapshot. A logged-out engine shows a notice on the new-session page and in its sessions, with **Log in**; typing `/login` in a session opens the same dialog. The Hosts page lists both engines per host.
- Codex: `account/login/start` with `chatgptDeviceCode` on the shared app-server returns a link and a code; `account/login/completed` ends it, then models and limits reload. No terminal involved.
- Claude Code: `claude auth login` runs in a PTY (wide, so the link never wraps). yardd strips the escapes, sends the sign-in link to the UI, and types the code the user pastes back. Exit 0 is success; "Invalid code" ends it as failed. Idle Claude sessions then get a fresh sidecar with their next message, since one started logged out keeps failing.
- Both go through the CLIs' own flows and files; yardd never sees a token. See Policy and cost for the Claude side.

## Worktrees

Every new session in a git repository with at least one commit gets its own branch and worktree at `<data dir>/wt/<repo>/<branch>` (`~/.yard/wt` by default); there is no switch for it. A folder outside a repository, or in one with no commits, runs in place, and the session says so in a note. Both engines share this layout.

- **Folder picker:** a button under the prompt box, next to the host and base branch buttons. It lists recent folders (recent picks, then sessions' repositories), browses the chosen host's folders as a path is typed (`fs.dirs`, routed through the hub like `git.branches`), and in the desktop app opens the Finder dialog (Tauri dialog plugin; the capability lets only the loopback page call `dialog:allow-open`).

- The branch is named from the task (`yard/<first words>-<4 hex>`) unless I type one.
- **Base:** the branch button lists local and `origin/*` branches, newest first (`git.branches`). The default is the current branch. The branch name comes from the task.
- The worktree is made before the session. If `git worktree add` fails, nothing else runs and no session exists.
- **Setup:** after a successful add, yardd runs `<data dir>/setup/<repo>.sh` if it exists, else `.yard/worktree-setup.sh` from the repo, with bash in the new worktree (`YARD_REPO`, `YARD_WORKTREE`, 5 minute limit). This is where `node_modules` and `.env` get linked. If it fails, yardd removes that worktree and branch and creates no session. It never runs in the original checkout.
- **Removal:** deleting a worktree session offers "Delete and remove worktree". It runs `git worktree remove`, never forced, and is refused if anything is uncommitted or untracked, or another session still uses the folder. The branch goes with `git branch -d`, which keeps unmerged branches.
- **One writer per folder:** a session without a new worktree is refused while another session in the same folder is running, waiting for approval or queued.
- Uncommitted changes in the original checkout are not carried over.
- Files a setup script creates count as untracked unless gitignored, so they block removal.

## Attachments

Files and images go with a prompt, on the new-session page and in the reply box: paste (clipboard images and files), drop on the composer, or the paperclip. Pending files show as chips above the text (a local preview for images) and can be removed. A prompt can be attachments alone.

- **Upload as soon as attached**, over the same WebSocket: `attach.put { ref, name, mime, data (base64), host? | sessionId? }` answers `attach.stored { ref, attachment | error, hostId? }`. It is routed like the other ops: `host` from the new-session page, `sessionId` (with its `<hostId>~` prefix) from a reply box, so the bytes land on the host that runs the session. Picking another host re-uploads the pending files there.
- yardd saves each file as `<data dir>/attachments/<id>/<name>` with a `.meta.json` beside it. The name is cut to its last path segment, with no control characters and no leading dot or dash. An inline image type (png, jpeg, gif, webp) must match the file's bytes, or the file counts as `application/octet-stream`.
- **Cap: 10 MB per file**, checked in the UI before sending (a red chip, Send disabled) and again by yardd. yardd's server and the hub's client to remotes both allow 32 MiB messages, so a full-size upload (about 14 MB of base64) fits on both hops; tungstenite's default 16 MiB frame limit was too close.
- `session.create` and `session.send` take `attachments: [id]`. The `user_message` event (and `queued`) carries `attachments: [{ id, name, mime, size, path }]`, never the bytes.
- **Codex:** the text gets an "Attached files:" list of absolute paths; each image also goes as a `{ type: "localImage", path }` item on `turn/start` (the `UserInput` shape of codex-cli 0.164, from `codex app-server generate-ts`).
- **Claude:** yardd sends the sidecar `{ type: "user", text, attachments }`. The sidecar (`message.ts`) puts each image first as a base64 image block, then one text block with the same path list. Images over 3.75 MB (5 MB of base64, the API's limit) are named by path only.
- **Thumbnails** in the thread come from `attach.get { ref, sessionId, id }` -> `attach.data { sessionId, id, mime, data }`, routed by session like any session op, so they work for remote sessions. yardd serves only attachments that the session's own prompts carry. Replies with a `ref` skip the reducer.
- Hand-off briefs list each prompt's attachments by name and path.
- The desktop window disables Tauri's own drop handler so the page gets file drops; a drop outside the composer is ignored instead of opening the file.
- Not built: removing attachment files when their session is deleted.

The right pane has a Terminal tab next to Changes.

- yardd owns one PTY per session (`portable-pty`), running my login shell in the session folder. The UI renders it with xterm.js.
- yardd keeps 256 KB of output per terminal. Every chunk carries its byte offset, so a tab switch, page reload or reconnect replays the scrollback without gaps or repeats.
- The shell starts the first time the tab is opened and stays alive after the app closes.
- A session can have several terminals, shown as tabs ("1", "2", ...) above the terminal. Numbers are not reused while the session lives. `term.list`, `term.new` and `term.attach` sit beside `term.open`, which attaches to the first live terminal or starts one. An exited shell stays listed until closed.
- **Add to message** appends the selected terminal text to the reply box as a fenced block, capped at 20,000 characters. It does not send.
- Not built: splits.

## Tests

- `CARGO_BUILD_JOBS=2 cargo test -p yardd`: integration tests start the real yardd binary on a free port with a temp data dir and a fake `codex app-server` first on `PATH` (`crates/yardd/tests/fake-codex`). They spend no subscription usage and take a few seconds. The fake records each `turn/start` input in `turn-inputs.jsonl`, so the attachment tests check what reached the engine, locally and on a `direct` remote through a hub. A fake `ssh` (`YARD_SSH`) runs the remote installer locally against a `file://` release. Unit tests cover the hand-off brief, the hub's id rewriting, the `YARD_ALLOW_ORIGIN` list and attachment names.
- `cd ui && bun test`: `applyEvent`, the store reducer and the attachment helpers.
- `cd sidecar/yard-claude && bun test`: the Claude user message with attachments, without the SDK.
- Not covered: anything that needs Claude, the PR pane, SSH hosts, the memory cap, and the UI beyond its reducers.

## PR pane

The right pane has a Pull request tab.

- yardd runs `gh pr view --json` and `gh api graphql` (review threads) in the session folder through my own `gh` login. It holds no token and only reads.
- It shows the branch's PR: state, base and head, review decision, checks and review threads, unresolved first. It loads when first opened, refreshes when a turn ends, and polls every 60 s while visible.
- **Send to session** turns a review thread into a normal prompt quoting the comment with its file and line.
- **Review with the other engine** starts a new session on the other engine in the same folder, asking for a review of `git diff <base>...HEAD` and no file changes. The prompt leaves out the PR title and comments, because they are untrusted text.
- Not built: creating a PR, pushing, replying to or resolving threads.

## Policy and cost

- Anthropic's docs say products built on the Agent SDK should use API keys and must not offer claude.ai login. A personal tool that runs my own logged-in CLI is not addressed. Keep it personal; ask Anthropic before any public release.
- The in-app Claude login (Engine logins) runs the CLI's own `claude auth login`, but it is still a claude.ai login offered from Switchyard's UI. Fine for my own hosts; it is the first thing to settle with Anthropic, or to switch to API keys, before others are pointed at it.
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
- Worktrees: the "From" select, and "Delete and remove worktree" removing a clean worktree and its merged branch.
- Terminal tabs: a second terminal running its own command, and a selection added to the reply box.
- Self-contained app: a copy of the release bundle outside the repo started its own bundled yardd on a test port and ran a Codex turn.
- Remote hosts: a second local yardd added as a `direct` host. A session created on it from the UI ran there, with its terminal and Changes pane working through the hub, and came back after the remote restarted.

Not checked:

- A real SSH tunnel. This Mac has no SSH server to tunnel to, so only the failure and retry paths ran.
- Anything that needs a Claude turn in the newer features: Claude resume after a restart, hand-off into Claude, and Claude's per-session usage and cap. Claude weekly usage was nearly exhausted.
- Stop and a mid-session model switch on Claude. Both passed in the script spike.
- Attachments with a real engine. Paste, drop, the paperclip, the size cap, thumbnails after a reload and a remote session were driven in headless Chromium (2026-11-14) against the fake Codex; no real Codex or Claude turn has seen an image yet, and drops were not tried in the desktop window.

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
