# Import

Claude Code sessions run outside Switchyard (in a terminal, an IDE) can be
imported: "Import" in the sidebar lists the host's Claude Code sessions (the
Agent SDK's `listSessions`, newest first) and imports one as a Switchyard
session in its own folder, in place, with its history; the next message
resumes the same Claude Code conversation. In isolated environments the fake
sidecar offers three TEST- sessions: two in the iso's work folder, one whose
folder no longer exists.

## Setup

```sh
yv iso up
yv iso seed --profile empty
```

## Cleanup

```sh
yv iso down
```

## Recipes

### dialog-lists-sessions
Expect at both viewports: the Import dialog with the three TEST- sessions,
newest first, each with its folder, and the dialog inside the viewport.

```sh
yv drive new --steps '[{"click":{"role":"button","name":"Import","exact":true}},{"expect":"role:dialog:Import from Claude Code","inViewport":true},{"expect":"role:dialog","text":"TEST-fix the login redirect"},{"expect":"role:dialog","text":"TEST-write the release notes"},{"expect":"role:dialog","text":"TEST-old refactor of the parser"},{"shot":"import-dialog"}]'
```

### filter-narrows-the-list
Typing in the filter keeps only matching sessions.

```sh
yv drive new --viewport desktop --steps '[{"click":{"role":"button","name":"Import","exact":true}},{"fill":"label:Filter sessions","value":"parser"},{"expect":"role:dialog","text":"TEST-old refactor of the parser"},{"expect":"role:button:Import TEST-fix the login redirect","visible":false}]'
```

### import-opens-the-session
Viewports: desktop
Importing opens a Claude session in that folder with its history and a note;
listing again offers "Open" instead.

```sh
yv drive new --viewport desktop --steps '[{"click":{"role":"button","name":"Import","exact":true}},{"click":"role:button:Import TEST-fix the login redirect"},{"expect":"role:heading:TEST-fix the login redirect"},{"expect":"css:.thread","text":"TEST-added login.test.ts."},{"expect":"css:.thread","text":"Imported from Claude Code"},{"shot":"imported"},{"click":{"role":"button","name":"Import","exact":true}},{"expect":"role:button:Open TEST-fix the login redirect"}]'
yv state --expect '{"sessions":[{"title":"TEST-fix the login redirect","engine":"claude","cwd":"{{work}}"}]}'
```

### import-on-mobile
Viewports: mobile
At 390 px the dialog's Import button is on screen and importing opens the session.

```sh
yv drive new --viewport mobile --steps '[{"click":{"role":"button","name":"Import","exact":true}},{"expect":"role:button:Import TEST-old refactor of the parser","inViewport":true},{"click":"role:button:Import TEST-old refactor of the parser"},{"expect":"css:.thread","text":"TEST-answer to: TEST-old refactor of the parser"},{"shot":"imported-mobile"}]'
```

### next-message-resumes
The first message after an import resumes the same Claude Code session.

```sh
yv state --save imp_sid='sessions[title=TEST-old refactor of the parser].id' || {
  yv api '{"op":"session.import","claudeSessionId":"33333333-3333-4333-8333-333333333333"}' --wait '{"op":"created"}' --save imp_sid=sessionId
}
yv api '{"op":"session.send","sessionId":"{{imp_sid}}","text":"TEST-carry on"}' --wait '{"op":"event","sessionId":"{{imp_sid}}","event":{"type":"turn_completed"}}'
grep -q "resume=33333333-3333-4333-8333-333333333333" "$(v fake)/sidecar.log"
```

### missing-folder-is-refused
Viewports: desktop
A session whose folder is gone cannot be imported; the dialog says why.

```sh
yv drive new --viewport desktop --allow-errors --steps '[{"click":{"role":"button","name":"Import","exact":true}},{"click":"role:button:Import TEST-write the release notes"},{"expect":"role:dialog","text":"no longer exists"}]'
```

### import-from-a-remote-host (manual: needs a second machine with Claude Code sessions)
The dialog's host picker lists remote hosts; the hub routes `claude.sessions`
and `session.import` to the chosen one. The daemon suite covers the routing
rule; a real remote was not tried.

## Gotchas
- Imported sessions run in place (no worktree): Claude Code keeps a session's transcript by folder, and resuming needs the same folder.
- Titles come from the SDK: the custom title (`/rename`), else the summary, else the first prompt.
