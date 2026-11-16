# Switchyard: architecture

Working name. Design: [Agent Harness UI](https://claude.ai/artifact/XQdXoraWtiuUwwrrCt3462), sources in [design/](../design).

One UI for Claude Code, Codex, OpenCode and Grok sessions on my own subscriptions: fast switching between engines, models and efforts, a terminal and PR review next to each session, and the same view for sessions on a remote box.

Rewritten 2026-11-13. Replaces the 2026-11-06 version. Checked against claude 2.1.318, codex-cli 0.159.2, Agent SDK 0.3.323. OpenCode and Grok added 2026-11-16, checked against opencode-ai 1.19.5 and @xai-official/grok 1.0.77.

## Decided

- Tauri shell. Rust core, web UI. Personal first.
- The app drives the installed `claude`, `codex`, `opencode` and `grok` CLIs and turns their event streams into one UI. Which engines exist, their names and what they can do live in one place each side: `crates/yardd/src/engines.rs` and `ui/src/engines.ts`. It never holds a login: credentials stay where each CLI keeps them. It can start a CLI's own login flow on a host (see Engine logins).
- Chat UI in the Claude Code message style, not a terminal. The terminal is a separate pane.
- White, minimal theme. One flat session list. A cloud icon marks sessions on a remote host.
- New session is a full page with a centered prompt box, not a dialog.
- Remote sessions run on my own box over SSH and Tailscale, not on claude.ai/code. A claude.ai webview and a hook bridge were considered and dropped.
- Host CPU, memory and disk are always visible. The daemon queues new sessions when a host is under pressure.

## Shape

- **yardd** (`crates/yardd`): Rust daemon. Owns every agent process, the event log and host stats. Serves the UI and a WebSocket on `127.0.0.1:47717` (`YARD_BIND` changes it: one address or a comma-separated list; the container image uses `0.0.0.0`, a server behind a reverse proxy adds the proxy-facing address next to loopback). The port stays out of 4510-4559, which LocalStack publishes on every interface.
- **yard-claude** (`sidecar/yard-claude`): TypeScript sidecar on the Claude Agent SDK, run with Bun. One per Claude session, JSON lines over stdio. The SDK exists only for TypeScript and Python.
- **ACP agents**: `opencode acp` and `grok agent stdio`, one per engine and account, driven from yardd's `acp.rs` (see Engines).
- **ui** (`ui`): React + Vite. Talks only to yardd.
- **app** (`app/src-tauri`): Tauri v2 window. Starts yardd if nothing is listening, then loads yardd's page. It holds no agent state and yardd outlives it, so sessions survive closing the app.
- **App updates:** the packaged app checks `releases/latest/download/latest.json` at launch and every 6 hours (Tauri updater plugin), installs a newer release in place, then asks before restarting. Restarting stops the local yardd (SIGTERM, found with `lsof` on the port) so the new app starts its own; sessions come back, a running turn stops. At launch, an older yardd than the bundled one gets the same question instead of only the title warning. The package is the notarized, stapled `.app`, tarred and signed with the updater key by `.github/scripts/macos-sign.sh`; `tauri.conf.json` holds the public key. A copy run from the repo never updates.

The same yardd binary runs on my Mac and on the remote box. A remote session is a session on another yardd, reached through an SSH port forward over Tailscale. No open port, no auth layer of our own.

The WebSocket is on a localhost TCP port because a webview cannot open a unix socket. yardd rejects any browser origin other than its own page and the Tauri window, so a website cannot drive agents.

## Events

Every engine is normalized to one event list per session. The UI replays it on open.

| Event | Meaning |
|---|---|
| `user_message` | My prompt, with any attachments' details |
| `turn_started`, `turn_completed` | Turn boundaries, with yardd's clock in `at` (ms) |
| `assistant_delta`, `assistant_message` | Streamed text, then the final text |
| `reasoning_delta`, `reasoning` | Thinking: Claude's summarized thinking (`--thinking-display summarized`), Codex's reasoning summary (parts become paragraphs) |
| `tool_started`, `tool_completed` | A command, read, search or other tool call. Claude's Agent call carries `agent` (the subagent's type); a subagent's own steps carry `parent` (the Agent call's id); its `tool_completed` carries `ms` |
| `file_change` | Edited files with diffs |
| `approval_request`, `approval_resolved` | A command or edit waiting on me |
| `error` | Engine error text |
| `queued` | The session is waiting for the host to have room. Carries its prompt |
| `note` | A quiet line from yardd, such as a hand-off. Changes no status |

Session status (`idle`, `running`, `needs_approval`, `queued`, `error`) is derived from these.

**Stop** (`session.interrupt`) asks the engine to stop. If it cannot be asked, or the turn is still open 5 s later, yardd ends the turn itself (`turn_completed` `interrupted`, with a note): a Claude sidecar is killed, and its next message starts a new one that resumes the conversation; a Codex turn is closed on our side. A Claude sidecar that exits on its own is also dropped, so the next message starts a fresh one instead of writing into a dead pipe.

- Item ids come from the engine (Codex item ids, Claude `tool_use` ids; the sidecar's own ids carry a per-process prefix). The UI matches an id only within the current turn, after the last user message, so a reused id can never pull new text up into an earlier turn. Order is the log's order.
- **Subagents** (Claude's Agent tool, formerly Task). The SDK streams a subagent's messages with `parent_tool_use_id` set, plus system `task_started` and `task_notification`. `sidecar/yard-claude/src/subagents.ts` keeps the subagent's tool calls (`tool_started` with `parent`, `tool_completed`) and drops its thinking, text and diffs; the Agent call ends with its `task_notification` (`tool_completed` with the subagent's last words as `output`, its duration as `ms`), and its own `tool_result` is ignored. Checked on a real Haiku turn: an Agent call runs in the background by default, so its `tool_result` is only "launched" and the report arrives in the notification, even after the turn that started it has ended; a foreground one gets its notification before the `tool_result`. So a completed turn leaves a still-running Agent call (and its steps) running, Stop or a failure ends it, and `tool_completed` finds an Agent call in an earlier turn. `layout` nests each step under its call (`steps`, as deep as subagents nest); a still-running Agent call stays out of the turn's fold. The UI shows it as one collapsed line: its description, type, "running" or "done · 2s", its step count; open, the steps and the report. Codex has no subagents.
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

**Codex.** One `codex app-server` per account (started on first use) over stdio, JSON-RPC, driven from Rust. See Accounts.

- `thread/start` per session, `turn/start` per message. `turn/start` takes `model` and `effort`, so switching is per turn.
- Approvals arrive as server requests (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) and are answered with `accept`, `acceptForSession` or `decline`.
- `model/list` returns the models and each one's efforts. Today: `gpt-6.1-sol` (default), `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; efforts `low` to `ultra`.
- `account/rateLimits/updated` and `account/rateLimits/read` give `primary` (the 5-hour window) and `secondary` (the week), each with `usedPercent`, `windowDurationMins` and `resetsAt` (epoch seconds). yardd relays them untouched as `usage.codex` (Default) or `usage.accounts[<id>]` (an added account: see Accounts).
- The protocol is marked experimental. Pin the CLI version.

**Claude.** Agent SDK `query()` in streaming-input mode inside yard-claude.

- `canUseTool` carries approvals. `setModel()` switches model mid-session. `interrupt()` stops a turn.
- Effort is `low`, `medium`, `high`, `xhigh`, `max`. It is set at session start; changing it mid-session goes through `applyFlagSettings` (not wired yet).
- `rate_limit_event` describes ONE window per event (`rateLimitType`: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, ...) with `utilization` (a fraction) and `resetsAt` (epoch seconds); some CLI builds send them all as `unifiedWindows`. The sidecar (`src/usage.ts`, `mergeUsage`) folds events into `usage.claude = { status, windows }`, so a five-hour event does not wipe out the weekly one. yardd saves the last usage in `usage.json` in the data dir, so the Claude meters survive a restart; each window carries `resetsAt`, so one that reset meanwhile reads as unknown. (The old mapping read only `unifiedWindows`, which the SDK's types do not have.)

**Plan usage in the UI.** `ui/src/usage.ts` turns either engine's shape into meters (5-hour, week, per-model weeks; amber above 70%, red above 90%; "resets in 2 h 10 min"). They show in the model picker's header and in a strip above the host rows in the sidebar. The strip reads every host the sidebar shows (see Sidebar), so Claude limits reported only by a remote host where the Claude sessions run still show: each engine and account once (`stripGroups` in `usage.ts`; an account is matched across hosts by engine and name, since each host gives it its own id), from the shown host whose report is newest by its own figures (a later reset time, then more used, since use only grows inside a window), else the first host listed. A login is taken to be the same subscription on every machine. An added account gets a line with its name above its meters ("Claude · Work"). The picker opens on the current engine and folds the other into one row; on narrow screens it is a sheet over the window's bottom. No context-window meter: the SDK's `getContextUsage` is a control request per turn and would need a per-session event through yardd's log, which could not be proven without a real Claude turn; the result's `usage` is per turn, not the context size.
- It runs on the CLI's own login (`apiKeySource: none`).
- Never parse `~/.claude/projects/*.jsonl`. Use the SDK's `listSessions` and `getSessionMessages`.

**ACP engines: OpenCode and Grok.** Both speak ACP, the Agent Client Protocol (JSON-RPC lines on stdio), so one driver, `crates/yardd/src/acp.rs`, runs both. One agent process per engine and account, started on first use like Codex's app-server, holds that account's sessions. `opencode serve` (HTTP + SSE) and a sidecar were the alternatives; ACP gave both engines from one client and needs no port.

- `initialize` (we offer no file system and no terminal: the agent uses its own), `session/new { cwd }` per session, `session/prompt` per message. The prompt's answer (`stopReason`) ends the turn: `end_turn` completed, `cancelled` interrupted, `refusal` failed, `max_tokens` completed with a note.
- `session/update` becomes events: `agent_message_chunk` deltas and `agent_thought_chunk` reasoning deltas, closed into `assistant_message` and `reasoning` when a tool call starts or the turn ends; `tool_call`/`tool_call_update` become `tool_started`/`tool_completed` (kinds `execute`, `read`, `edit`, `search`, `fetch` map to command, read, edit, search, other); a `diff` content becomes one `file_change` (the Claude sidecar's patch: changed lines with two lines of context), before the approval that asks about it.
- Model, effort and mode are the session's `configOptions` (`session/set_config_option`; categories `model`, `thought_level`, `mode`), or `session/set_mode`. yardd sets them before a prompt when they differ from what it last set, so a switch takes effect from the next turn.
- Approvals: `session/request_permission` becomes an `approval_request`; the answer picks the offered option of that kind (`allow_once`, `allow_always`, `reject_once`). The session's mode answers some itself (see Permission modes). Stop sends `session/cancel` and answers open requests `cancelled`; a turn still open after 5 s is ended here, and its late answer is ignored.
- No steering: a message sent mid-turn waits for the next turn (`engines::can_steer`).
- Resume: the ACP session id is the engine ref. After a yardd restart, or when the agent exited (its running turn fails with "stopped before answering"), the next message starts a new agent and reopens the session with `session/resume`, else `session/load` (its replayed history is dropped).
- Usage: neither reports plan limits (ACP `usage_update` is context size and cost), so no meters and no usage skips for them.
- Per-session processes: the agent is registered like a Codex app-server, so its command children are matched by folder.

**OpenCode** (npm `opencode-ai`). `opencode acp`, with `OPENCODE_PERMISSION={"edit":"ask","bash":"ask","webfetch":"ask"}` on top of the user's config: without it OpenCode edits and runs commands unasked and Ask first would mean nothing. Models come from `opencode models --verbose` (ids `provider/model`; a model's `variants` are its efforts, after `default`); the list is Default's providers'. Modes are `build` and `plan` (the plan agent refuses edits). OpenCode works with its own free models and no login.

**Grok** (xAI's Grok Build CLI, npm `@xai-official/grok`, command `grok`). Chosen over superagent-ai/grok-cli, which was renamed `grok-dev` and has had no release since 2026-05; xAI's own CLI ships near-daily, logs in with a Grok account and speaks ACP. `grok agent stdio`. Models and efforts come from `initialize` (`_meta.modelState`, `reasoningEfforts`), effort is the `reasoning_effort` option, and permission modes map to Grok's own modes. `session/new` answers "Authentication required" while logged out; the session shows it.

**Permission modes.** A picker next to the model, named like Claude Code's modes. Saved on the session (`permission`), set by `session.create` and changed any time by `session.setPermission`; a hand-off keeps it.

| Mode | Claude (SDK `permissionMode`) | Codex (`turn/start` overrides) | OpenCode, Grok (agent mode; what yardd answers itself) |
|---|---|---|---|
| Ask first (`ask`, default) | `default`: asks before commands and edits | `on-request`, workspace-write sandbox | `build` / `default`; every question goes to the user |
| Accept edits (`acceptEdits`) | `acceptEdits` | same as Ask first: Codex already edits inside its sandbox freely | `build` / `acceptEdits`; edits allowed unasked |
| Plan only (`plan`) | `plan` | `on-request`, read-only sandbox | `plan`; edits refused unasked, commands still asked |
| Full access (`full`) | `bypassPermissions` | `never`, no sandbox | `build` / `bypassPermissions`; everything allowed unasked |

Claude switches at once with `setPermissionMode` (the sidecar always passes `allowDangerouslySkipPermissions` so a later switch to full access works); Codex takes the mode from its next turn. Approving Claude's plan-mode exit leaves the picker showing Plan only until it is changed.

**Switching engine** cannot share a thread, so it is a hand-off. Picking a model of another engine in a session asks for confirmation, then starts a new session on that engine in the same folder, with the same branch, title and sidebar group and a `parent` pointing back.

- yardd builds the first message from the source session's event log, with no model call, because the source is usually out of quota.
- The brief holds the original task, each later prompt, each turn's final answer, the uncommitted changed files and any unresolved state. It is capped at 12,000 characters, keeping the task and the most recent turns.
- Agent text is quoted in `<earlier-work>` blocks marked as a record, not instructions.
- Refused for the same engine, and while a turn is running: two agents must not write to one folder at once.

## Resources

- yardd samples CPU, load, memory and disk every 3 s with `sysinfo` and keeps an hour of CPU history in memory.
- **Per session:** the same sample sums CPU and memory over each session's processes: the Claude sidecar tree, the terminal shell tree, and for Codex the app-server's children matched by command folder and start time. Codex runs one app-server per account, so two Codex sessions of one account running commands in the same folder at the same moment can be mixed up.
- **No memory cap.** yardd never stops a running session for its size. A per-session cap (`YARD_SESSION_MEM_CAP_GB`) existed until 0.2.1 and was removed on 2026-11-15: a polling soft cap killed real work, and the queue below already keeps new sessions off a busy host.
- Threads are not processes: on Linux `sysinfo` lists each thread with its process as parent and the process's memory as its own. They are skipped; counting them made a Claude CLI look 8.7 GB (2026-11-14).
- **Queue:** a new session waits (status `queued`) while 1-minute load is above the core count or free memory is under `YARD_MIN_FREE_GB` (default 2). One queued session starts per sample once there is room. "Start anyway" skips the wait. Queued sessions survive a restart.
- **Processes tab:** `session.procs { sessionId }` answers `session.procs { sessionId, procs }`, the session's processes from the same sample (so up to 3 s old): `pid`, `ppid`, `name`, `cmd` (at most 400 characters), `cpu` (percent of one core), `memBytes`, `ageSecs` and `origin` (`agent` for the sidecar tree or a Codex command, `terminal` for a shell). It is asked for, not broadcast, and routes through the hub like any session op. The tab (`ProcPane`, next to Changes, Terminal and Pull request, so hidden below 1100 px) asks when opened and every 3 s while visible, and draws the tree with each command line shortened. An older remote yardd answers "unknown op": the tab stays on "Loading…".
- Not built: worktree disk sizes with cleanup.

## Remote hosts

The local yardd is a hub. The UI keeps its one WebSocket to it.

- Each UI client gets its own connection from the hub to every remote yardd, piped both ways, so replies go back to the client that asked.
- Session and terminal ids that cross the hub are written `<hostId>~<remoteId>`. An op with such an id, or a `session.create` with `host`, goes to that host with the prefix removed.
- A remote `snapshot` arrives as `host.snapshot`; its `host`, `models` and `usage` messages carry a `hostId`. Models, usage, accounts and the home folder are kept per host. `account.add` and `account.remove` carry `host` like `engines.status`, and the remote's `accounts` list comes back with its `hostId`.
- Hosts are saved in `hosts.json` in the data dir and changed with `host.add` and `host.remove`. Status (`connecting`, `connected`, `error` with a message) is broadcast as `hosts`.
- An `ssh` host gets one `ssh -N -L` tunnel shared by all clients, on a free loopback port, restarted with backoff up to 30 s and killed when the host is removed or yardd stops. The destination is passed after `--` and may not start with `-`.
- A `direct` host is a plain `ws://` URL, for local testing.
- Remote sessions stay listed but offline while their host is down.
- **The web version as a host:** its compose file publishes the container's 47717 on the server's loopback, so an `ssh` host for that server reaches the same yardd as the web page. The installer refuses to install over a yardd it did not set up.
- **Install from the app:** when the ssh tunnel is up but no yardd answers behind it, the host reports `noDaemon` and its card offers "Install Switchyard". The hub runs `scripts/remote-install.sh` (compiled into yardd) over the host's ssh as `bash -s -- <port>`, streaming each line to every client as `host.install`. The script downloads `switchyard-linux-{x64,arm64}.tar.gz` from the `latest` release (built by `.github/workflows/linux-host.yml`), swaps it into `~/.local/share/switchyard`, runs yardd as a systemd user service with lingering (or detached where there is no user systemd), checks `/health`, and reports whether `claude` and `codex` are installed and logged in, and `opencode` and `grok` where installed (`@@engine` lines). The same card offers "Update Switchyard" on a connected SSH host. `YARD_SSH` and `YARD_RELEASE_URL` exist for the tests.
- `scripts/install-host.sh` builds and installs from a checkout instead, for development.

## Web version

A container image (`Dockerfile`, `docker-compose.yml`) runs yardd as a web app, for Coolify or plain Docker Compose. Details and setup are in the README.

- One image: release yardd, `ui/dist`, the compiled sidecar, and pinned `codex`, `claude` and `gh` from npm and GitHub's apt repository. It runs as uid 1000 with `HOME` (logins, `~/.yard`) and `/workspace` as volumes.
- No sign-in, by decision: it is meant for a private network such as a tailnet. Anyone who reaches it can run commands in the container.
- yardd binds `YARD_BIND=0.0.0.0` there; loopback stays the default everywhere else. The Origin check stays: `YARD_ALLOW_ORIGIN` (comma separated) names the page's URL. yardd never trusts an Origin because it matches the Host header, since a rebound DNS name would pass that. It warns at startup when bound off loopback with no allowed origin.
- The page uses `wss://` when it is served over https (behind Coolify's Traefik).
- Codex's `workspace-write` sandbox uses bubblewrap, which cannot create namespaces in an unprivileged container (checked: "No permissions to create a new namespace"; with seccomp and AppArmor unconfined it still failed on the loopback interface). The image sets `YARD_CODEX_SANDBOX=danger-full-access`, so the container is the boundary. Approvals stay `on-request`. Elsewhere the default is unchanged.
- The local host's name is `YARD_HOST_NAME`, else "This Mac" on macOS and the hostname elsewhere. A remote host may not take that name. The snapshot carries it as `hostName`, so the UI has it before the first `host` stats sample.
- `.github/workflows/docker.yml` pushes `ghcr.io/giovaniif/switchyard` (`latest` from main, and the short sha).

## Automations

Scheduled work, built into yardd (`crates/yardd/src/automations.rs`, UI in `ui/src/AutomationsPage.tsx`, words in `ui/src/automations.ts`). It replaces timers that started sessions from outside.

- **An automation** is saved in `automations.json` in the data dir (like `hosts.json`; an unreadable file is kept as `.json.bad`): name, prompt, folder, engine, model, effort, permission, base branch, schedule, `skipWhileRunning` (on by default), optional `maxFiveHour` and `maxWeek` usage limits (percent), `enabled`, `nextRun` and `lastRun`.
- **Schedule**, in the host's local time zone (chrono `Local`): `interval` (every N minutes or hours, counted from the last slot), `daily` at `HH:MM`, `weekly` on a day (0 = Sunday) at `HH:MM`. A time that does not exist on a daylight saving day runs an hour later; one that happens twice runs the first time.
- **Scheduler:** one task ticks every 15 s (`YARD_AUTOMATION_TICK_MS` for tests). An enabled automation whose `nextRun` has passed fires, and `nextRun` moves to the next slot after now before it runs. A run missed while yardd was down therefore fires once, not once per missed slot. Saving a changed schedule, or enabling, recomputes `nextRun`; disabling clears it.
- **A run** is `session.create` with a worktree, `permission` and the title `<name> · YYYY-MM-DD HH:MM`; the session's `Meta.automation` is the automation's id (set when the session is inserted, so the first broadcast already has it). Before cutting the worktree yardd runs `git fetch origin` (60 s limit, no credential prompt; a failure only logs). The base is the chosen branch or the repository's default (`origin/HEAD`, else main or master), taken from `origin/<branch>` when that exists. A folder that is not a repository with commits runs in place, one at a time.
- **Skips** (scheduled runs only; "Run now" starts one regardless): the previous run is still going (a session with this `automation` that is running, waiting for approval or queued), or the engine's usage is above a limit. Claude reports fractions, Codex percentages; a window that already reset is treated as unknown, like the old loop budget check. The outcome is saved as `lastRun` (`started`, `skipped` with a reason, or `failed` with the error).
- **Auto-archive:** when a run's first turn ends, yardd archives it unless it is pinned. Later turns (someone reopened it) do not re-archive. Pinning an archived session unarchives it, so pinning a run brings it back to the sidebar. The sidebar leaves out every unpinned session with `automation` set; a clock row, "Automations", opens the page, with a dot while a run works.
- **Ops:** `automation.list`, `automation.save { automation }` (an `id` edits; only the fields sent change, so a switch sends `{ id, enabled }`; answers `automation.saved`), `automation.delete { id }` (its runs stay as ordinary sessions: `automation` is cleared), `automation.run { id, force? }` (answers `automation.ran { outcome, sessionId, reason }`). Every change broadcasts `automations`, and the snapshot carries the list.
- **Per host:** each host runs its own automations. The four ops route by `host` like `session.create`; a remote's `automations` message gets a `hostId`, and its snapshot reaches the UI as `host.snapshot.automations`. Session ids in a run's reply carry the `<hostId>~` prefix like any session id. The page groups runs by host and the automation id.
- **The page:** a card per automation (name, schedule in words, next and last run, an Enabled switch, Run now, Edit) with its runs newest first (status, duration, a pin button), each opening the session. The form reuses the new-session host, folder, branch, model and permission pickers.
- **The agent loops** (since 2026-11-16): patrol, maintain and review are automations named `Loop <kind>` on the live yardd, no longer systemd timers. `verify/yv loop automations --apply` builds them from `verify/loops.json` (schedule, engine, model, effort; the Claude budget becomes `maxFiveHour` 70 and `maxWeek` 80; permission `full`; base `main`; folder the loops' checkout) with a fixed prompt from `automationPrompt()` in `verify/src/loop.ts`, which tells the agent to read its start time with `date -u` where `prompt()` writes it in. It finds them by name, so rerunning edits them, and turns off the old timers. Keeping the `Loop <kind>` title prefix lets `yv loop status`, `log`, `tidy` and the patrol's checks find automation runs like the old ones. Verify and babysit stay on `verify/yv loop run`. Lost in the move: the pause flag (`yv loop pause` now stops only `loop run`; switch an automation off instead) and the machine-load skip.
- Not built: a machine-load skip, a per-automation retention count, run history for skipped runs beyond the last one.

## Sidebar

- Each session row has a menu (the … button, or right-click): Pin, Move to group…, Remove from group, Archive or Restore, and Delete, which asks once and, for a worktree session, offers to remove the worktree too. `session.update { pinned?, archived?, group? }` stores the flags and the group name in the session's metadata, so every window and the web version agree, and they survive restarts; remote sessions route through the hub like every session op. Archiving unpins. `group` is a trimmed name (max 60 characters); null or blank clears it, and leaving the field out leaves it alone.
- **Drag and drop** (native HTML5, no library): a row dragged onto a group (its header or rows) moves into it, onto the ungrouped Sessions rows leaves its group, onto Pinned pins it. A group or Sessions drop also unpins, since those sections only show unpinned sessions. `dropUpdate` in `ui/src/sidebarDrop.ts` turns a drop into one `session.update { pinned?, group? }`, or nothing when the session is already there; such a section refuses the drop, so the cursor says no and nothing lights up. The dragged row dims; the section under the pointer is highlighted; a collapsed group opens after 600 ms over it; with no ungrouped rows a "Drop here to remove from group" slot appears while dragging; Escape cancels (the browser's own). The drag carries the session id as `application/x-yard-session`. Archived rows and rows on an unreachable host are not draggable, like the menu. No reordering: order comes from creation and activity and is not stored. Touch has no HTML5 drag, so in the phone drawer (below 700 px) rows are not draggable and the … menu is the way; it is also the keyboard path. The Mac app turns off Tauri's own drop handler (`disable_drag_drop_handler`), which is what lets drags inside the page work.
- Groups have no record of their own: a group exists while a session names it. The sidebar lists Pinned, then ungrouped sessions (creation order), then one collapsible section per group (sorted by name, newest activity first inside; `sidebarLayout` in `store.ts`). Pinned and archived sessions are not shown inside groups. A group header shows name, count and chevron; its menu renames or ungroups every session that carries the name, archived ones included. Which groups are collapsed is per browser (`yard.groups.collapsed` in localStorage).
- **Row marks** (`ui/src/rowState.ts`): a turning ring while running, an amber "!" that breathes while it waits for approval, a blue dot with a bold title and "Answered" for a finished turn not opened yet, red for a failure (live, or an unseen failed turn), a hollow ring when idle; shapes differ so they read without color. yardd stamps every session with `turnEndedAt` and `lastTurn` (`completed`, `failed`, `interrupted`) when a turn ends. Which answers were seen is per browser (`yard.seen` in localStorage, the `turnEndedAt` last had open while the window was in front; other windows follow through `storage`). Turns that ended before the browser first kept track (`yard.seen.since`) count as seen, and a stopped turn never stands out.
- Archived is a dock under the scrolling list, just above the host rows, so it never scrolls away. It is shown whenever something is archived, collapsed by default; opened, its rows expand upward in a list with its own scroll (max 40% of the window height, at most 320 px). Archived sessions still open and run.
- The sessions sidebar and the workspace pane are resizable; widths are per browser.
- The top nav: New session, Automations, Import, Settings. **Settings** (`#/settings`, `ui/src/SettingsPage.tsx`) holds what the browser keeps for itself: the Notifications switch and, under Sidebar, a "Show in sidebar" switch per host, This Mac included. The bottom block lists a row per shown host (CPU · memory, opens Hosts) under the plan-usage strip, which reads only the shown hosts. Hidden hosts are per browser (`yard.sidebar.hiddenHosts`, host ids; `ui/src/sidebarHosts.ts`); the Hosts page, the pickers and the session list still show every host, and Settings links to Hosts for when every row is hidden.
- Below 700 px (phones on the web version) the sidebar is a drawer over the page, so the page keeps the full width: a menu button first in each page's bar opens it; picking anything in it, any route change, the backdrop or Escape closes it. The workspace pane is already hidden below 1100 px.

## Notifications

- Switchyard shows an OS notification when a session needs the user: it waits for an approval, or it failed, or a turn of at least a minute finished (`MIN_TURN_MS`; an automation's run reports a finish on its page, not in a banner). Only when the window is not focused or that session is not the one open (`shouldNotify` in `ui/src/notify.ts`).
- The banner says what happened, from the session's events (yardd broadcasts every session's events): the command or edit waiting for approval, the error, or how long the turn took and the start of its last answer as one plain line (`noticeText`, `plainLine`). A turn's length is timed on the page's clock, since a remote host's `at` would mix two clocks; a turn already running when the page loaded has no length and is reported. Clicking one focuses the window and opens the session.
- The UI works out the cases from what yardd already sends: a `session` message that changes status (`needs_approval`; running to idle) and the `turn_completed` event before it. A failed turn ends `idle` too, so the event's status tells a failure from a finish, and a Stop (`interrupted`) says nothing. A snapshot (also after a reconnect or a host reload) only sets the baseline, so opening the page never notifies.
- The **Notifications** switch on the Settings page turns them on and off, kept per browser (`localStorage` `yard.notifications`). Turning it on asks the browser for permission; a refusal leaves it off and says why.
- Browser: the Web Notifications API, one banner per session (`tag`). Desktop app: WKWebView has no `Notification`, so the UI calls the Tauri notification plugin through `window.__TAURI__` (`plugin:notification|notify`). The capability gives the loopback page only those calls (is-permission-granted, request-permission, notify, register/remove-listener), next to the folder dialog. A click is reported by the plugin's `actionPerformed` listener, with the session id attached as `extra`; if the listener cannot register, a window focus within 20 s of a banner counts as the click. No change to `tauri.conf.json` or the plist.
- `notify { title, body?, sessionId?, url? }` is the way for an agent or script to reach the owner. yardd checks it (a title; `url` only http or https), clips the text, and broadcasts `{ op: "notify", ... }` to every connected window, which shows it under the same setting. A note that names no session shows even in a focused window. The sender gets `notify.sent { windows }`, the number of connected clients counting itself, so a caller can tell that nobody was there. `verify/yv notify` sends it to the live yardd; an older yardd answers `unknown op`. A session on a remote host is routed to that host like any session op, and its `notify` comes back through the hub with the id prefixed.
- Not covered: the real browser prompt and OS banner (the feature map replaces `window.Notification` with a recorder), and the desktop app, which cannot run in CI.

## Engine logins

- `engines.status` (per host) reports each engine as installed or not, and logged in or not: `claude auth status` (JSON), Codex's `account/read`, the first line of `grok models` ("You are not authenticated.", or who is signed in), and for OpenCode the providers `opencode models` lists (`providers`; it counts as logged in with any, its free ones included). The UI asks once per host snapshot. A logged-out engine shows a notice on the new-session page and in its sessions, with **Log in**; typing `/login` in a session opens the same dialog. The Hosts page lists every engine per host; OpenCode's button is **Add provider**, since it is never logged out.
- Codex: `account/login/start` with `chatgptDeviceCode` on the shared app-server returns a link and a code; `account/login/completed` ends it, then models and limits reload. No terminal involved.
- Claude Code: `claude auth login` runs in a PTY (wide, so the link never wraps). yardd strips the escapes, sends the sign-in link to the UI, and types the code the user pastes back. Exit 0 is success; "Invalid code" ends it as failed. Idle Claude sessions then get a fresh sidecar with their next message, since one started logged out keeps failing.
- Grok: `grok login --device-auth` runs in a PTY like Claude's. yardd reads the link and code it prints and shows them like Codex's; exit 0 is success. The account's agent is then restarted once idle (it may have started logged out), and its sessions resume.
- OpenCode: logging in adds a provider. There is no CLI flow to drive without its terminal UI, so a short-lived `opencode serve` on a free loopback port, with a random password and stopped by a shell in front of it once yardd lets go (it never reads stdin, so it would outlive a killed yardd), does it through its own endpoints. `login.start` answers `providers` (from `/provider` and `/provider/auth`: connected first, then popular, then by name; ways in that need a typed setting, such as GitLab's instance URL, are left to the terminal). `login.choose { provider, method }` answers `key` for an API key, `url` for a sign-in that gives back a code, or `code` for a device code (the server finishes it; yardd waits on `oauth/callback` up to 15 minutes). `login.code` carries the key or code: `PUT /auth/<provider>` or `oauth/callback`. The key passes through yardd's memory only. Every request has a time limit: the server accepts connections before it answers them.
- All go through the CLIs' own flows and files; yardd never sees a token, and an OpenCode API key only passes through. See Policy and cost for the Claude side.
- Every login op takes an optional `account` (Default when left out), and `login` progress messages name it. A Claude login runs `claude auth login` with that account's `CLAUDE_CONFIG_DIR`; a Codex login runs on that account's app-server. Logins of different accounts can run at once. After a Claude login, only idle sessions of that account get a fresh sidecar.

## Accounts

More than one login per engine on a host, for example a personal and a company Claude Code subscription.

- Each engine has a **Default** account: the login the CLI already has, run with yardd's own environment, unchanged. Added accounts (`account.add { engine, name, host? }`) each get a folder `<data dir>/accounts/<id>/`, used as `CLAUDE_CONFIG_DIR` for Claude Code (the sidecar, `claude auth status` and `claude auth login`), as `CODEX_HOME` for Codex (that account's app-server), as `GROK_HOME` for Grok (its agent, `grok models`, `grok login`) and as `XDG_DATA_HOME` for OpenCode (its logins and sessions; its config stays the user's). OpenCode has no variable of its own for this, so commands its agent runs see the moved data folder too. These variables are documented by their CLIs (XDG by the spec OpenCode follows); Switchyard never reads what is in the folders. Names are unique per engine (case-insensitive) and at most 40 plain characters.
- They are saved in `accounts.json` next to `hosts.json`, per host, and listed in the `snapshot` and the `accounts` broadcast. `account.remove { id, host? }` cancels a login in progress, stops the account's Codex app-server, and deletes the folder, and with it the login. It is refused while any session (archived ones too) uses the account.
- `engines.status` answers `{ engines: { claude, codex, opencode, grok }, accounts: { <id>: state } }`: Default under `engines`, the added ones by id. Adding or removing an account triggers a fresh answer.
- `session.create` takes `account` (an id of that engine; Default when left out) and checks it. It is saved in the session's metadata (`account`, `default` for older rows), so resume after a restart and every later turn use the same account: the Claude sidecar is started with the account's `CLAUDE_CONFIG_DIR`, and the session's Codex thread lives on that account's app-server (a thread is only known to the `CODEX_HOME` that made it). **The account cannot be changed mid-session**; start a new session instead.
- A hand-off starts a session on another engine, so the source's account does not carry over: it runs on the target engine's Default unless `session.handoff` names an `account` of that engine (the UI does not offer one yet).
- **Usage is per account**: Default's limits stay at `usage.claude` and `usage.codex`; an added account's are at `usage.accounts[<id>]` in the same shape as its engine's. The model picker shows the limits of the account picked for each engine (a session's own account inside a session); the sidebar strip shows Default's and every added account's, from the hosts the sidebar shows. Codex model lists are loaded from Default's app-server and shared; so are Grok's (Default's agent) and OpenCode's (Default's providers, so an added OpenCode account with other providers still sees Default's list).
- **UI.** The Hosts page lists each engine's added accounts under it with their login state, Log in and Remove (a second click confirms), and **Add account**. The model picker shows an account row under an engine only when it has more than one account, and the trigger names the account then. The session header and the sidebar row name the account, again only where the engine has a choice (or the session is not on Default).
- Not built: moving a session to another account, per-account models, logging out without removing.

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

## Terminal output as context

The Terminal tab's **Attach** menu puts terminal output in a card above the reply box: the selection, the rows on screen, or the last 100 or 500 lines (`ui/src/termRows.ts` reads xterm's buffer: wrapped rows join their line, the blank screen under the prompt is dropped). A card names the terminal and its line count, shows three monospace lines with More, and has ×; several stack next to quote cards. Sending puts each after any quotes and before the typed text as `Terminal 1, 8 lines:` and a fenced `text` block whose fence is longer than any backtick run inside (`snippetBlock` in `compose.ts`), so engines and older yardds read plain Markdown. A sent bubble shows closed fenced blocks as code (`fenceSegments`). Cut to the selection cap (20,000 characters).

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
- `cd ui && bun test`: `applyEvent`, the store reducer, the attachment helpers, the notification rule, and which hosts and usage rows the sidebar shows.
- `cd sidecar/yard-claude && bun test`: the Claude user message with attachments and the subagent mapping, without the SDK.
- A scripted Claude sidecar (`tests/fake-codex/yard-claude`, through `YARD_SIDECAR`) covers a sidecar that dies mid-session and one that ignores Stop, and a `[subagent]` turn (a nested subagent, and a `sleep 30` left running for the process list); a `[stuck]` fake Codex turn covers the Codex side of Stop.
- `verify/yv` (docs/VERIFICATION.md) drives the built UI in headless Chromium against an isolated yardd with the same fakes plus a fake `gh` (one canned PR) and a fake `ssh`; the feature map `verify/features` covers the PR pane and the UI end to end. CI runs its selftest and two map areas.
- OpenCode and Grok (`tests/acp.rs`): the scripted `opencode` and `grok` in `tests/fake-codex` share one ACP agent (`acp-agent.mjs`, the same prompt markers as the fake Codex) and fake the CLIs' other commands: `opencode models`, an `opencode serve` with the login endpoints, `grok models` and `grok login --device-auth` with the real output. They log every request to `acp.log` and every prompt with the session's model, effort and mode to `acp-prompts.jsonl`.
- Not covered: anything that needs the real Claude SDK, real SSH hosts, real OpenCode or Grok turns.

## PR pane

The right pane has a Pull request tab.

- yardd runs `gh pr view --json` and `gh api graphql` (review threads) in the session folder through my own `gh` login. It holds no token and only reads.
- It shows the branch's PR: state, base and head, review decision, checks and review threads, unresolved first. It loads when first opened, refreshes when a turn ends, and polls every 60 s while visible.
- **Send to session** turns a review thread into a normal prompt quoting the comment with its file and line.
- **Review with another engine** starts a new session in the same folder on Codex for Claude work, Claude for anything else (or the first engine with models), asking for a review of `git diff <base>...HEAD` and no file changes. The prompt leaves out the PR title and comments, because they are untrusted text.
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
- Resource guard: per-session CPU and memory in the Hosts table and the queue with "Start anyway".
- Worktrees: the "From" select, and "Delete and remove worktree" removing a clean worktree and its merged branch.
- Terminal tabs: a second terminal running its own command, and a selection added to the reply box.
- Self-contained app: a copy of the release bundle outside the repo started its own bundled yardd on a test port and ran a Codex turn.
- Remote hosts: a second local yardd added as a `direct` host. A session created on it from the UI ran there, with its terminal and Changes pane working through the hub, and came back after the remote restarted.

Not checked:

- Any real OpenCode or Grok turn: no model was asked anything. Checked against the real CLIs (2026-11-16): `opencode acp`'s `initialize`, `session/new`, `set_config_option` for model, effort and mode, and `session/resume`; `opencode models --verbose`; the whole OpenCode API-key login through a test yardd, with a made-up key in a throwaway HOME; `grok agent stdio`'s `initialize` models and its "Authentication required" answer; `grok models` logged out; the start of `grok login --device-auth` (cancelled). Not seen: Grok's session shapes when logged in (its `configOptions`, modes, tool calls), OpenCode's tool-call and permission updates outside its source, and an OAuth or device sign-in to a real provider.

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
- ACP's `session/resume` and `configOptions` are recent; Grok's ACP has `x.ai/` extensions and changes with its near-daily releases.
- Two agents in one worktree will fight. Enforce one writer.
- If yardd is killed with SIGKILL, an SSH tunnel it started is left running. A normal stop kills it.
