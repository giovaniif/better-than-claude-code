# Settings

The Settings page (`#/settings`, the gear row in the sidebar's top nav, after
Import) holds what this browser keeps for itself: the **Notifications** switch
(see notifications) and, under **Sidebar**, a "Show in sidebar" switch per host,
This Mac included. A hidden host loses its row at the foot of the sidebar and
lends nothing to the plan-usage strip above the rows; the choice is kept per
browser (`localStorage` `yard.sidebar.hiddenHosts`, a list of host ids). The
Hosts page, the pickers and the session list still show every host.

The strip shows each engine and account once, from the shown hosts: an added
account gets a line with its name ("Claude · TEST-Work") above its meters, and
when two shown hosts report the same engine and account the one that reported
last wins (later reset time, then more used), else the first listed. Setup
gives the remote a Claude account TEST-Work and runs a scripted Claude session
under it, so only the remote has Claude TEST-Work limits (the fake reports 91%
for an added account) while This Mac has the seeded Default Claude (47%).

## Setup

```sh
yv iso up
yv iso seed
yv var set remote_port "$(yv iso up --name map-settings-remote --host-name TEST-server | jq -r .iso.port)"
yv var set remote_work "$(yv var get work --iso map-settings-remote | jq -er .value)"
yv api '{"op":"host.add","name":"TEST-server","kind":"direct","url":"ws://127.0.0.1:{{remote_port}}/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-server","status":"connected"}]}' --save remote_id='hosts[name=TEST-server].id'
yv api '{"op":"account.add","engine":"claude","name":"TEST-Work","host":"{{remote_id}}"}' --wait '{"op":"accounts","hostId":"{{remote_id}}"}' --save work_acct='accounts[name=TEST-Work].id'
yv api '{"op":"session.create","host":"{{remote_id}}","engine":"claude","account":"{{work_acct}}","model":"claude-haiku-5-5","effort":"medium","cwd":"{{remote_work}}","text":"TEST-work on the server"}' --wait '{"op":"usage","hostId":"{{remote_id}}","usage":{"accounts":{"{{work_acct}}":{"status":"allowed"}}}}' --timeout 30000
```

## Cleanup

```sh
yv iso down --name map-settings-remote
yv iso down
```

## Recipes

### settings-page
The gear row opens the page (marked active): the Notifications switch, and a
Show in sidebar switch per host, all hosts shown at first. The sidebar itself
has no switch. On a phone the drawer closes once the page opens.

```sh
yv drive settings --viewport desktop --steps '[{"expect":"role:heading:Settings"},{"expect":{"css":".nav-row.active","hasText":"Settings"}},{"expect":"role:switch:Notifications"},{"expect":{"css":"[role=switch][aria-checked=true][aria-label=\"Show iso-host in sidebar\"]"}},{"expect":{"css":"[role=switch][aria-checked=true][aria-label=\"Show TEST-server in sidebar\"]"}},{"expect":{"css":".sidebar [role=switch]"},"count":0},{"expect":{"css":".host-row","hasText":"iso-host"}},{"expect":{"css":".host-row","hasText":"TEST-server"}},{"shot":"settings"}]'
yv drive settings --viewport mobile --steps '[{"expect":"role:heading:Settings"},{"expect":{"css":".app.drawer-open"},"count":0},{"expect":"role:switch:Notifications"},{"expect":{"css":"[role=switch][aria-checked=true][aria-label=\"Show iso-host in sidebar\"]"}},{"expect":{"css":"[role=switch][aria-checked=true][aria-label=\"Show TEST-server in sidebar\"]"}},{"shot":"settings"},{"click":"role:button:Open sessions"},{"expect":{"css":".nav-row.active","hasText":"Settings"}},{"expect":{"css":".sidebar [role=switch]"},"count":0}]'
```

### hide-this-mac
Turning This Mac (here `iso-host`) off removes its row from the sidebar and
keeps the remote's; after a reload it is still off and still hidden. The Hosts
page (Manage hosts) still lists it; turning it back on brings the row back.

```sh
yv drive settings --viewport desktop --steps '[{"click":"role:switch:Show iso-host in sidebar"},{"expect":{"css":".host-row","hasText":"iso-host"},"count":0},{"expect":{"css":".host-row","hasText":"TEST-server"}},{"eval":"localStorage.getItem(\"yard.sidebar.hiddenHosts\")","equals":"[\"local\"]"},{"reload":true},{"expect":"role:heading:Settings"},{"expect":{"css":"[role=switch][aria-checked=false][aria-label=\"Show iso-host in sidebar\"]"}},{"expect":{"css":".host-row","hasText":"iso-host"},"count":0},{"expect":{"css":".host-row","hasText":"TEST-server"}},{"shot":"this-mac-hidden"},{"click":"role:button:Manage hosts"},{"expect":"role:heading:Hosts"},{"expect":"role:region:iso-host"},{"eval":"(history.back(),1)"},{"click":"role:switch:Show iso-host in sidebar"},{"expect":{"css":".host-row","hasText":"iso-host"}}]'
yv drive settings --viewport mobile --steps '[{"click":"role:switch:Show iso-host in sidebar"},{"reload":true},{"expect":{"css":"[role=switch][aria-checked=false][aria-label=\"Show iso-host in sidebar\"]"}},{"click":"role:button:Open sessions"},{"wait":400},{"expect":{"css":".host-row","hasText":"TEST-server"},"inViewport":true},{"expect":{"css":".host-row","hasText":"iso-host"},"count":0},{"shot":"this-mac-hidden"}]'
```

### strip-from-shown-hosts
Viewports: both
With both hosts shown the strip has This Mac's Default Claude (47%) and the
remote's TEST-Work account (91%) on its own labelled line. With This Mac hidden
the remote's limits stay: TEST-Work 91% and Codex 12% / 34%, and the 47% that
only This Mac had is gone. With every host hidden there is neither strip nor
host row.

```sh
yv drive settings --viewport desktop --steps '[{"expect":{"css":".usage-strip","hasText":"47%"}},{"expect":{"css":".usage-line-account","hasText":"Claude · TEST-Work"}},{"expect":{"css":".usage-strip","hasText":"91%"}},{"click":"role:switch:Show iso-host in sidebar"},{"expect":{"css":".usage-strip","hasText":"47%"},"count":0},{"expect":{"css":".usage-line-account","hasText":"Claude · TEST-Work"}},{"expect":{"css":".usage-strip","hasText":"91%"}},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"12%"},{"expect":{"css":".usage-strip","hasText":"34%"}},{"expect":{"css":".usage-strip"},"inViewport":true},{"shot":"strip-remote-only"},{"click":"role:switch:Show TEST-server in sidebar"},{"expect":"css:.usage-strip","count":0},{"expect":"css:.host-row","count":0},{"shot":"nothing-shown"}]'
yv drive settings --viewport mobile --steps '[{"click":"role:switch:Show iso-host in sidebar"},{"click":"role:button:Open sessions"},{"wait":400},{"expect":{"css":".usage-line-account","hasText":"Claude · TEST-Work"},"inViewport":true},{"expect":{"css":".usage-strip","hasText":"91%"}},{"expect":{"css":".usage-strip","hasText":"47%"},"count":0},{"expect":{"css":".usage-line","hasText":"Codex"},"text":"12%"},{"shot":"strip-remote-only"}]'
```

## Gotchas
- Which of two hosts reported last is read from the reports themselves (reset
  times, then use); the fakes always report the same figures, so the tie-breaks
  are covered by `stripGroups` tests in `ui/src/usage.test.ts`, not here.
