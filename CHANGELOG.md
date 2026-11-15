# Changelog

Each version is a [GitHub release](https://github.com/giovaniif/better-than-claude-code/releases) with the signed Mac app and the Linux packages. The section for a version becomes its release notes.

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
