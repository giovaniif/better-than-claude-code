# Feature map

What "working" means for Switchyard, area by area, as recipes the CLI runs.
`verify/yv map run <area>` runs one area in its own isolated yardd
(`map-<area>`); `verify/yv map run all` runs every area; `verify/yv map status`
shows the last result of each recipe (pass, fail, needs-var, manual).

Every area file has: a paragraph on what must be true, **Setup** and
**Cleanup**, **Recipes** (a `### label`, then what to expect at both viewports
and what to read back, then fenced `sh` blocks of `yv` commands; a block fails
when any command exits non-zero), and **Gotchas**. `(manual: why)` marks a
flow the CLI cannot drive. `Needs: VAR` marks a recipe that runs only when the
variable is set. `Viewports:` says which viewports a recipe covers when it is
not both.

Data is synthetic: the seeded repositories, sessions and PR are all named
`TEST-…`, the engines are the scripted fakes in `crates/yardd/tests/fake-codex`,
`gh` and `ssh` are the fakes in `verify/fakes`.

Rules: never weaken a recipe to make it pass. A failing recipe is either map
drift (fix the recipe to match what the app really does) or a product bug
(keep it failing, add a Gotcha, queue a finding). Every fixed bug adds a
recipe with its repro.

| Area | What it covers |
|---|---|
| [new-session](new-session.md) | The new-session page: prompt, model, effort, permission, folder, host, worktree note |
| [thread](thread.md) | How a session's turns render: replies, thinking, edits, failures, the work-log fold |
| [approvals](approvals.md) | Command approvals: allow once, always, deny, and the sidebar status |
| [stop](stop.md) | Stopping a running turn, including one the engine ignores |
| [changes-pane](changes-pane.md) | The Changes tab: the session folder's git diff |
| [terminal](terminal.md) | The Terminal tab: shells per session, tabs, scrollback, Add to message |
| [pr-pane](pr-pane.md) | The Pull request tab: PR state, checks, review threads, Send to session |
| [sidebar](sidebar.md) | Session rows: order, status, pin, archive, restore, delete |
| [persistence](persistence.md) | Sessions and history across a yardd restart |
| [hosts](hosts.md) | The Hosts page, adding a direct host, an unreachable SSH host |
| [queue](queue.md) | The resource guard: sessions queue under pressure, Start anyway |
| [logins](logins.md) | Engine login state and the Codex and Claude login flows |
| [attachments](attachments.md) | Files with a prompt: upload, chips, thumbnails, size cap |
| [models](models.md) | Model and effort switches, permission modes, hand-off to the other engine |
| [worktrees](worktrees.md) | A worktree per session, in-place folders, removing a worktree |
| [notifications](notifications.md) | OS notifications: the sidebar switch, when a session or the `notify` op shows one |
| [security](security.md) | Origin checks on the WebSocket, loopback binding |
| [layout](layout.md) | Viewport behaviour: desktop, the narrow pane cut-off, mobile |
