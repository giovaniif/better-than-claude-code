# Changelog

Each version is a [GitHub release](https://github.com/giovaniif/better-than-claude-code/releases) with the signed Mac app and the Linux packages. The section for a version becomes its release notes.

## 0.4.2 (2026-11-16)

- **Fixed: an update could leave the app showing the previous version's screens.** The app's window kept an old copy of the page in its cache and didn't check for a new one. It now checks on every load, so an update shows right away.

## 0.4.1 (2026-11-16)

- **Works on a phone.** Below 700 px the sessions sidebar is a drawer: a menu button at the top of each page opens it, and picking something, tapping beside it or Escape closes it. The session, Hosts and Automations pages get the full width instead of a 140 px column. Desktop is unchanged.
- **The Changes pane shows new files.** A file the agent created shows its lines like any other change, a binary one says "No text diff", and with many files the pane scrolls instead of squashing the cards. File names with accents or other non-ASCII letters show as written, not as `\303\247` escapes.
- **A session whose folder was removed says so.** The Changes and Pull request panes and the terminal say the folder no longer exists, instead of "Not a git repository", and no terminal quietly opens in your home folder.
- **Terminal.** Reloading with a shell that already exited no longer shows a "terminal is closed" error. Closing the last terminal leaves an "Open a terminal" button instead of a blank pane.
- **Automations.** A run shows how long it ran, not how long since it last changed (pinning or replying no longer inflates it). Claude automations skip a run when usage is above their limit.
- **Fixed:**
  - Claude usage meters survive a restart.
  - The Notifications switch shows Off, and why, when the browser's permission was revoked.
  - Picking a Codex account in a new session switches it to Codex.
  - A refused "Add host" or "Add account" keeps what you typed.
  - Double clicks on Start anyway, Send to session or Review no longer act twice.
  - A reload or Back keeps you on the Automations page.
  - A window that connects while something changes no longer loses that change.
  - The folder picker says when a typed path matches no folder.

## 0.4.0 (2026-11-16)

- **Automations.** Schedule a prompt on a repository: every N minutes or hours, daily or weekly at a time, with its engine, model and permission mode. Each run gets its own worktree, is archived when it ends, and is listed under its automation on the new Automations page, so runs don't fill the sidebar. Run now, pause, edit; optionally skip a run while the last one is going or when usage is high.
- **Several accounts per engine.** Add a second Claude Code or Codex login (say, your company's) on any host from the Hosts page, log in to it from the app, and pick the account per session. Each account keeps its own login and usage; your existing login stays the Default.
- **Import Claude Code sessions.** "Import" in the sidebar lists the Claude Code sessions on a host; importing one opens it with its history, and your next message continues the same conversation.
- **The message queue works like Claude Code's.** A message you send while the agent works reaches it at its next step, in the same turn, and shows in the thread where it went in. Several queued messages go as one. Stop puts what's queued back in the reply box; Edit (or ↑ in an empty box) takes one back.
- **OS notifications.** Turn on Notifications in the sidebar to get a system notification when a session needs an approval, finishes or fails while you're looking elsewhere; clicking it opens the session.
- **Usage you can see.** Meters for the 5-hour window and the week, with when each resets, in the sidebar and the model picker. The model picker is tidier: the other engine folds into one row.
- **Subagents and processes.** A Claude subagent shows as one entry under the call that started it, with its own steps and report. A Processes tab lists what the session is running right now.
- **Group sessions.** "Move to group…" in a session's menu; groups fold, can be renamed or ungrouped. Archived stays at the bottom of the sidebar.
- **Fixed:** a reload or Back keeps you in the session you had open; a quick approval no longer leaves a session stuck as running; a double click on Allow once no longer shows an error; usage meters read 0% once a window has reset.

## 0.3.0 (2026-11-15)

- **Reply to part of an answer.** Select text in one of the agent's answers and a Reply button appears over it. It puts the selection in the reply box as a quote, ready for your reply underneath.
- **Queue messages while the agent works.** The reply box stays open during a turn: "Add to queue" lines up your next message, shown above the box with a button to remove it, and it goes once the turn finishes. Several queued messages go in order. Stop keeps them waiting instead of sending them.
- **Fixed: the terminal after a reload.** Reloading the page (or reopening the web version) could bring a session's terminal back garbled: a long prompt overwritten by the next command, or a command's output missing. The terminal now waits for its real size before it replays anything.
- **Fixed: terminal keys out of order.** Fast typing could reach the shell with two keys swapped (`TSET` for `TEST`). Keys are now sent in the order they were typed.

## 0.2.3 (2026-11-15)

- **Fixed: the session menu stays on screen.** With a narrow sidebar, or on a row near the bottom of the list, the … menu (Pin, Archive, Delete) was cut off. It now opens over the rest of the window, above the row when there's no room below.
- **The app updates itself.** It checks for a new release at launch and every 6 hours, installs it in the background, and asks before restarting. The restart also restarts the background service, so "an older daemon is running" goes away; sessions are kept, a running turn stops. This is the last version you need to download by hand.
- **A server's Switchyard in the browser, as your own user.** `YARD_BIND` now takes a comma-separated list, so a yardd installed on a server (as an SSH host) can keep loopback for the app and also listen on one address a reverse proxy reaches. Its sessions and terminals then run as you, with your `gh`, SSH keys and tools, instead of as the container's `yard` user. See "Also in a browser" in docs/remote-hosts.md.

## 0.2.2 (2026-11-15)

- **No more memory cap.** Switchyard no longer stops a session for the memory its processes use. The Hosts page still shows each session's CPU and memory, and new sessions still wait while a machine is under pressure. `YARD_SESSION_MEM_CAP_GB` is gone.

## 0.2.1 (2026-11-15)

- **Fixed: Stop always stops.** If Claude Code or Codex doesn't end the turn within 5 seconds, Switchyard ends it. A stuck Claude process is ended and the next message resumes the conversation.
- **Fixed: a session whose Claude Code process died** no longer swallows the next message and stays "Working" forever. The next message starts Claude Code again on the same conversation.
- **Fixed: the memory cap on Linux** counted every thread as a separate process. A Claude session looked many times its real size (an "8.7 GB, over the 8 GB cap" stop at well under 1 GB), and the stop killed Claude Code itself instead of only the commands it ran.
- **Web version and desktop app on the same server.** The compose file now publishes the port on the server's loopback, so adding that server as an SSH host in the desktop app shows the web version's sessions instead of offering to install a second Switchyard. The installer now refuses to install over a Switchyard it didn't set up.

## 0.2.0 (2026-11-15)

- **Log in from the app.** When Claude Code or Codex isn't logged in on a machine, the new-session page and its sessions say so, with **Log in**. Codex shows a link and a code; Claude Code shows a sign-in link and takes the code it gives back. `/login` in a session opens the same dialog, and the Hosts page shows each engine's state.
- **Thinking.** Claude's and Codex's thinking stream into the thread as a one-line preview that opens to the full text.
- **A calmer thread.** Tool calls between messages fold into one line ("Read 3 files, ran 2 commands"). A running turn shows its latest step under "Working for 12s"; a finished turn folds its work into "Worked for 1m 12s" above the answer.
- **Fixed:** a reply could appear above the question it answered after the Claude sidecar restarted (for example after logging in). Threads recorded that way now show in order too.
- **Pin, archive and delete** sessions from the sidebar: the … button on a row, or right-click.
- **Resizable sidebars:** drag the edge of the session list or the workspace pane.
- **Web version:** set `PROJECTS` to a folder on the server and it is mounted at the same path; the folder picker lists it first. Codex retries no longer show as errors.
- A favicon.

## 0.1.0 (2026-11-15)

The first release.

- **Claude Code and Codex in one window.** Streamed answers, commands, edits as diffs and approvals inline, the same for both engines. Switch models mid-session; picking the other engine's model hands the conversation off with a summary.
- **A worktree per session.** Every session in a git repository gets its own branch and worktree, with a folder picker like Claude Code's. Changes, Terminal and Pull request panes sit next to the thread.
- **Permission modes.** Ask first, accept edits, plan only or full access, per session, switchable at any time.
- **Files and images.** Paste, drop or attach them to a prompt; they reach remote agents too.
- **Remote hosts.** Add any machine you can `ssh` into and install Switchyard there from the app. Its sessions show up in the same sidebar and keep running when your Mac sleeps.
- **Guard rails.** CPU, memory and disk for every host on screen; new sessions wait while a machine is under pressure, and a runaway session is stopped.
- **Sessions survive restarts.** yardd keeps every session's events in SQLite and resumes the engines when it starts again.
- **Web version.** One Docker image for Coolify or Docker Compose.
