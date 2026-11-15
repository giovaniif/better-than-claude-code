# Changelog

Each version is a [GitHub release](https://github.com/giovaniif/better-than-claude-code/releases) with the signed Mac app and the Linux packages. The section for a version becomes its release notes.

## 0.2.3 (2026-11-15)

- **Fixed: the session menu stays on screen.** With a narrow sidebar, or on a row near the bottom of the list, the … menu (Pin, Archive, Delete) was cut off. It now opens over the rest of the window, above the row when there's no room below.
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
