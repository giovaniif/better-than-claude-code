# Automations

Scheduled work: an automation is a prompt, a folder on a host, an engine,
model, effort and permission, a base branch and a schedule in the host's local
time. Each run is an ordinary session in its own worktree with `automation`
set in its metadata. Runs stay out of the sidebar; a finished run archives
itself; the Automations page lists every automation with its schedule in words,
next and last run, an enabled switch, Run now, and its runs newest first, each
opening its session. Pinning a run brings it back to the sidebar. Scheduled
runs skip while the previous one is still going and, when set, while the
engine's usage is above a limit.

## Setup

```sh
yv iso up
yv iso seed
yv api '{"op":"automation.save","automation":{"name":"TEST-Patrol","prompt":"TEST-say hello","cwd":"{{repo}}","engine":"codex","model":"fake-fast","effort":"low","permission":"ask","schedule":{"kind":"daily","time":"09:30"}}}' --wait '{"op":"automation.saved"}' --save auto_id=automation.id
```

## Cleanup

```sh
yv iso down
```

## Recipes

### list-shows-schedule-next-and-last
The seeded automation is listed with its schedule in words, a next run, "never" as its last run, and the enabled switch on. (At 390 px the heading is pushed out of view: see layout.)

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"expect":"role:heading:Automations"},{"expect":{"css":".automation","hasText":"TEST-Patrol"}},{"expect":{"css":".automation","hasText":"Daily at 09:30"}},{"expect":{"css":".automation","hasText":"Last run never"}},{"expect":"role:switch:Enabled: TEST-Patrol"},{"shot":"list"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Automations"},{"expect":{"css":".automation","hasText":"Daily at 09:30"}},{"expect":{"css":".automation","hasText":"Last run never"}},{"shot":"list"}]'
```

### create-from-the-form
Fill the form and save: the new automation appears in the list and in the daemon. Each viewport creates its own.

Viewports: both, one automation each.

```sh
yv drive new --viewport mobile --steps '[{"click":"role:button:Automations"},{"click":"role:button:New automation"},{"fill":"label:Automation name","value":"TEST-mobile one"},{"fill":"label:Prompt","value":"TEST-mobile prompt"},{"click":{"css":".chip","hasText":"work"}},{"fill":"css:.menu-search","value":"{{repo}}"},{"press":"Enter"},{"fill":"label:Time","value":"10:15"},{"shot":"form"},{"click":"role:button:Save automation"},{"expect":{"css":".automation","hasText":"TEST-mobile one"}},{"expect":{"css":".automation","hasText":"Daily at 10:15"}}]'
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":"role:button:New automation"},{"fill":"label:Automation name","value":"TEST-desktop one"},{"fill":"label:Prompt","value":"TEST-desktop prompt"},{"click":{"css":".chip","hasText":"work"}},{"fill":"css:.menu-search","value":"{{repo}}"},{"press":"Enter"},{"fill":"label:Time","value":"10:15"},{"shot":"form"},{"click":"role:button:Save automation"},{"expect":{"css":".automation","hasText":"TEST-desktop one"}},{"expect":{"css":".automation","hasText":"Daily at 10:15"}}]'
yv api '{"op":"automation.list"}' --wait '{"op":"automations"}' --expect '{"op":"automations","automations":[{"name":"TEST-mobile one"},{"name":"TEST-desktop one"}]}'
```

### run-now-archives-and-lists-the-run
Run now starts a session; when it ends it is archived, so it is not in the sidebar, but it is listed under its automation and opens.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":"role:button:Run now: TEST-Patrol"},{"expect":{"css":".automation-run","hasText":"TEST-Patrol ·"}},{"expect":{"css":".automation-run","hasText":"Idle"},"timeout":90000},{"expect":{"css":".session-row","hasText":"TEST-Patrol ·"},"visible":false},{"shot":"runs"}]'
yv api '{"op":"automation.list"}' --wait '{"op":"automations"}' --expect '{"op":"automations","automations":[{"id":"{{auto_id}}","lastRun":{"outcome":"started"}}]}' --save run_sid='automations[id={{auto_id}}].lastRun.sessionId'
yv state --expect '{"sessions":[{"id":"{{run_sid}}","title":"~TEST-Patrol · ","archived":true,"status":"idle"}]}'
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":{"css":".automation-run","hasText":"TEST-Patrol ·"}},{"expect":"css:.thread","text":"Echo: TEST-say hello"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Automations"},{"expect":{"css":".automation-run","hasText":"TEST-Patrol ·"}},{"shot":"runs"}]'
```

### pinning-a-run-brings-it-back
Pinning a run from the Automations page puts it under Pinned in the sidebar.

```sh
yv api '{"op":"session.update","sessionId":"{{run_sid}}","pinned":true}'
yv drive new --viewport desktop --steps '[{"expect":"css:.list-head","text":"Pinned"},{"expect":{"css":".session-row","hasText":"TEST-Patrol ·"}}]'
```

### edit-changes-the-schedule
Edit opens the form with the saved values; saving a new time updates the words in the list.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":"role:button:Edit: TEST-Patrol"},{"expect":{"css":"input","value":"TEST-Patrol"}},{"fill":"label:Time","value":"07:45"},{"click":"role:button:Save automation"},{"expect":{"css":".automation","hasText":"Daily at 07:45"}}]'
yv api '{"op":"automation.list"}' --wait '{"op":"automations"}' --expect '{"op":"automations","automations":[{"id":"{{auto_id}}","schedule":{"kind":"daily","time":"07:45"}}]}'
yv drive new --viewport mobile --steps '[{"click":"role:button:Automations"},{"click":"role:button:Edit: TEST-Patrol"},{"shot":"edit"}]'
```

### disable-stops-the-schedule
Turning the switch off shows "off" as the next run and stores `enabled: false`; turning it back on schedules again.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":"role:switch:Enabled: TEST-Patrol"},{"expect":{"css":".automation","hasText":"Next run off"}}]'
yv api '{"op":"automation.list"}' --wait '{"op":"automations"}' --expect '{"op":"automations","automations":[{"id":"{{auto_id}}","enabled":false,"nextRun":null}]}'
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":"role:switch:Enabled: TEST-Patrol"},{"expect":{"css":".automation","hasText":"Next run off"},"visible":false}]'
```

### reload-and-back-keep-the-page
A reload keeps the Automations page, and the Edit form with its saved values (not a blank "New automation" that would save a copy); Back from a run opened there returns to the page.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"expect":"role:heading:Automations"},{"reload":true},{"expect":"role:heading:Automations"},{"click":"role:button:Edit: TEST-Patrol"},{"reload":true},{"expect":"role:heading:Edit automation"},{"expect":{"css":"input","value":"TEST-Patrol"}},{"click":"role:button:Cancel"},{"click":"role:button:Run now: TEST-Patrol"},{"expect":{"css":".automation-run","hasText":"Idle"},"timeout":90000},{"click":{"css":".automation-run","hasText":"TEST-Patrol ·"}},{"expect":"css:.thread","text":"Echo: TEST-say hello"},{"eval":"history.back()"},{"expect":"role:heading:Automations"}]'
yv drive new --viewport mobile --steps '[{"click":"role:button:Automations"},{"reload":true},{"expect":{"css":".automation","hasText":"TEST-Patrol"}},{"click":"role:button:Edit: TEST-Patrol"},{"reload":true},{"expect":{"css":"input","value":"TEST-Patrol"}},{"shot":"edit-after-reload"}]'
```

### delete-removes-the-automation-and-frees-its-runs
Deleting asks once; the automation goes and its runs become ordinary (archived) sessions.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Automations"},{"click":"role:button:Edit: TEST-Patrol"},{"click":"role:button:Delete automation"},{"click":"role:button:Confirm delete"},{"expect":{"css":".automation","hasText":"TEST-Patrol"},"visible":false}]'
yv api '{"op":"automation.list"}' --wait '{"op":"automations"}' --expect '{"op":"automations","automations":[{"name":"TEST-mobile one"},{"name":"TEST-desktop one"}]}'
```

## Gotchas
- Recipes share one isolated yardd and run in order: later recipes use the automation and run the earlier ones made.
- A drive at both viewports runs on the same data, so the create recipe uses one drive per viewport.
