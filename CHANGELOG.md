# Changelog

Each version is a [GitHub release](https://github.com/giovaniif/better-than-claude-code/releases) with the signed Mac app and the Linux packages. The section for a version becomes its release notes.

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
