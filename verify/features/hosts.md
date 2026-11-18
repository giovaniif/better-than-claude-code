# Hosts

Compact host rows show CPU, memory, disk and connection state. Selecting a host opens one inspector below the list: Sessions, Engine logins, and System. Login notes never resize the host summaries. Remotes use SSH or a direct WebSocket URL; their sessions join the same sidebar.

## Setup

```sh
yv iso up
yv iso seed
yv var set remote_port "$(yv iso up --name map-hosts-remote --host-name TEST-remote | jq -r .iso.port)"
yv var set remote_work "$(yv var get work --iso map-hosts-remote | jq -er .value)"
```

## Cleanup

```sh
yv iso down --name map-hosts-remote
yv iso down
```

## Recipes

### hosts-page
Viewports: both
The host summary shows its state and resources. The selected inspector separates logins from sessions.

```sh
yv drive 'hosts' --steps '[{"expect":"role:heading:Hosts"},{"expect":"role:button:Select iso-host","text":"CPU"},{"click":"role:tab:Engine logins"},{"expect":{"css":".engine-row","hasText":"Claude Code"},"text":"logged in as me@example.com"},{"expect":{"css":".engine-row","hasText":"Codex"},"text":"logged in as me@example.com"},{"shot":"hosts-logins"}]'
```

### empty-state-tile
With no remote host, the dashed invitation opens Add host. Cancel restores it.

```sh
yv drive 'hosts' --steps '[{"click":"role:button:Run sessions on another machine"},{"expect":"role:region:Add host"},{"expect":"role:button:Run sessions on another machine","count":0},{"shot":"add-host"},{"click":"role:button:Cancel"},{"expect":"role:button:Run sessions on another machine"}]'
```

### sessions-list-collapsed
Viewports: both
The Sessions tab lists activity with clickable titles; logins and queue policy live in their own tabs.

```sh
yv drive 'hosts' --steps '[{"expect":{"css":".focused-session-row","hasText":"TEST-hello from Claude"}},{"expect":"css:.engines","count":0},{"click":"role:tab:System"},{"expect":"css:.host-inspector-panel","text":"New sessions are queued while load is above"},{"click":"role:tab:Sessions"},{"click":{"css":".focused-session-row","hasText":"TEST-hello from Claude"}},{"expect":"css:.thread","text":"hello from Claude"}]'
```

### add-direct-host
A direct host connects; its card and sidebar row appear.

```sh
yv api '{"op":"host.add","name":"TEST-remote","kind":"direct","url":"ws://127.0.0.1:{{remote_port}}/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-remote","status":"connected"}]}' --save remote_id='hosts[name=TEST-remote].id'
yv drive hosts --viewport desktop --steps '[{"expect":"role:button:Select TEST-remote"},{"expect":{"css":".host-row","hasText":"TEST-remote"}}]'
```

### remote-session
A session created on the remote runs there and shows in the hub's sidebar.

```sh
yv api '{"op":"session.create","host":"{{remote_id}}","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{remote_work}}","text":"TEST-on the remote"}' --wait '{"op":"created"}' --save rsid=sessionId
yv drive 'session:{{rsid}}' --steps '[{"expect":"css:.thread","text":"Echo: TEST-on the remote"}]'
yv state --iso map-hosts-remote --expect '{"sessions":[{"title":"TEST-on the remote","status":"idle"}]}'
```

### hosts-grid
Viewports: both
Compact host rows share one full width. Selecting another host replaces the single inspector without growing either summary.

```sh
yv api '{"op":"host.add","name":"TEST-grid","kind":"direct","url":"ws://127.0.0.1:{{remote_port}}/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-grid","status":"connected"}]}' --save grid_id='hosts[name=TEST-grid].id'
yv drive 'hosts' --steps '[{"expect":"role:button:Select TEST-grid"},{"eval":"(() => { const rows=[...document.querySelectorAll(\".host-summary\")]; const a=rows[0].getBoundingClientRect(), b=rows.at(-1).getBoundingClientRect(); return b.top>=a.bottom && Math.round(a.width)===Math.round(b.width); })()","equals":true},{"click":"role:button:Select TEST-grid"},{"expect":"css:.host-inspector","count":1},{"expect":"css:.host-inspector-heading","text":"TEST-grid"},{"shot":"selected-remote"},{"click":"role:tab:Engine logins"},{"expect":"css:.engine-row","text":"Claude Code"},{"eval":"document.documentElement.scrollWidth <= innerWidth","equals":true}]'
yv api '{"op":"host.remove","hostId":"{{grid_id}}"}' --wait '{"op":"hosts"}'
```

### ssh-host-unreachable
An SSH host that cannot be reached reports an error instead of hanging.

```sh
yv api '{"op":"host.add","name":"TEST-ssh","kind":"ssh","destination":"test@unreachable.invalid"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-ssh","status":"error"}]}' --timeout 30000
yv drive hosts --viewport desktop --steps '[{"expect":"role:button:Select TEST-ssh"}]'
```

### remove-host
Viewports: desktop
System asks for a second click to remove a host, which disappears across reloads.

```sh
yv api '{"op":"host.add","name":"TEST-gone","kind":"ssh","destination":"test@gone.invalid"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-gone"}]}'
yv drive 'hosts' --viewport desktop --steps '[{"click":"role:button:Select TEST-gone"},{"click":"role:tab:System"},{"click":"role:button:Remove host"},{"expect":"css:.host-foot","text":"Its sessions keep running there."},{"click":"role:button:Click again to remove"},{"expect":"role:button:Select TEST-gone","count":0},{"reload":true},{"expect":"role:button:Select TEST-gone","count":0}]'
```

### refused-add-keeps-the-form
Viewports: desktop
A value yardd refuses (remote port 99999) shows the error and keeps the form
with what was typed; fixing the field and adding again closes it once the host
appears.

```sh
yv drive hosts --viewport desktop --allow-errors --steps '[{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@TEST-devbox"},{"click":"role:button:Options"},{"fill":"label:Remote port","value":"99999"},{"click":"role:button:Add TEST-devbox"},{"expect":"css:.banner-error","text":"remote port must be a number"},{"expect":"label:SSH destination","value":"test@TEST-devbox"},{"expect":"label:Remote port","value":"99999"},{"shot":"refused"},{"fill":"label:Remote port","value":"2222"},{"click":"role:button:Add TEST-devbox"},{"expect":"role:button:Select TEST-devbox"},{"expect":"role:region:Add host","visible":false},{"shot":"added"}]'
```

### local-name-right-after-start
Viewports: desktop
Right after yardd starts, before its first stats sample (about 3 s), the
local host already shows its own name (`iso-host`, from YARD_HOST_NAME), not
"This Mac", in the sidebar's host row and the new-session host picker. The
daemon test `the_snapshot_names_this_machine_before_its_first_stats_sample`
pins the snapshot field without the timing.

```sh
yv iso restart
yv drive new --viewport desktop --steps '[{"expect":{"css":".host-row .host-name","hasText":"iso-host"}},{"expect":{"css":".main button","hasText":"iso-host"}},{"expect":{"css":".host-row .host-name","hasText":"This Mac"},"count":0}]'
```

### no-memory-limit-says-load-only
Viewports: both
When the memory limit is disabled System explains the load rule alone.

```sh
yv iso up --name map-hosts-nomem --env YARD_MIN_FREE_GB=0 >/dev/null
yv drive 'hosts' --iso map-hosts-nomem --steps '[{"click":"role:tab:System"},{"expect":"css:.host-inspector-panel","text":"New sessions are queued while load is above"},{"expect":{"css":".host-inspector-panel","hasText":"GB of memory"},"count":0},{"shot":"load-only"}]'
yv iso down --name map-hosts-nomem
```

### ip-destination-keeps-the-whole-address
Viewports: both
An SSH destination that is an IP address names the host by the whole address,
not its first part: `test@100.64.0.7` offers "Add 100.64.0.7" and saves that
name, and a second host on the same tailnet (`test@100.64.0.8`) is added too,
not refused as "a host named 100 already exists". A host name still gives its
first label (`TEST-devbox` in refused-add-keeps-the-form).

```sh
yv drive hosts --viewport mobile --steps '[{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@100.64.0.9"},{"expect":{"css":".add-host .btn-primary"},"text":"Add 100.64.0.9"},{"shot":"ip-label"}]'
yv drive hosts --viewport desktop --steps '[{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@100.64.0.7"},{"click":"role:button:Add 100.64.0.7"},{"expect":"role:button:Select 100.64.0.7"},{"click":"role:button:Add host"},{"fill":"label:SSH destination","value":"test@100.64.0.8"},{"click":"role:button:Add 100.64.0.8"},{"expect":"role:button:Select 100.64.0.8"},{"expect":{"css":".host-row","hasText":"100.64.0.8"}},{"expect":"css:.banner-error","count":0},{"shot":"two-ip-hosts"}]'
```

### install-on-host (manual: needs a real SSH server)
"Install Switchyard" runs scripts/remote-install.sh over ssh; the daemon suite
covers it with a fake ssh and a file:// release.

### engine-status-keeps-cards-aligned
Viewports: both
Long login details cannot change summary row height or create horizontal overflow.

```sh
yv drive 'hosts' --steps '[{"click":"role:tab:Engine logins"},{"eval":"window.__summaryHeight=document.querySelector(\".host-summary\").getBoundingClientRect().height; document.querySelector(\".engine-row .muted\").textContent=\"logged in as TEST-a-very-long-account-name@a-very-long-domain.example · not logged in\"; true","equals":true},{"eval":"document.querySelector(\".host-summary\").getBoundingClientRect().height === window.__summaryHeight && document.documentElement.scrollWidth <= innerWidth","equals":true},{"shot":"long-login"}]'
```

### processes-say-the-host-is-offline
Viewports: desktop
A remote session's Processes tab, open when its host goes away, says the list
comes back when the host reconnects. Once, it kept saying "Nothing is running
for this session." (or kept a stale list, with Stop buttons that could only
fail), and a tab first opened offline said "Loading…" forever. Uses its own
remote so the area's TEST-remote stays up.

```sh
gone_port="$(yv iso up --name map-hosts-gone --host-name TEST-gone | jq -r .iso.port)"
gone_work="$(yv var get work --iso map-hosts-gone | jq -er .value)"
yv api '{"op":"host.add","name":"TEST-gone","kind":"direct","url":"ws://127.0.0.1:'"$gone_port"'/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-gone","status":"connected"}]}' --save gone_id='hosts[name=TEST-gone].id'
yv api '{"op":"session.create","host":"{{gone_id}}","engine":"codex","model":"fake-fast","effort":"low","cwd":"'"$gone_work"'","text":"TEST-procs on a host that goes"}' --wait '{"op":"created"}' --save gone_sid=sessionId
(sleep 8; yv iso down --name map-hosts-gone >/dev/null) &
yv drive 'session:{{gone_sid}}' --viewport desktop --allow-errors --steps '[{"expect":"css:.thread","text":"Echo: TEST-procs on a host that goes","timeout":15000},{"click":"role:button:Processes"},{"expect":{"role":"region","name":"Workspace"},"text":"Nothing is running for this session.","timeout":10000},{"expect":"css:.bar-host","text":"offline","timeout":20000},{"expect":{"role":"region","name":"Workspace"},"text":"Processes are available when this host reconnects.","timeout":5000},{"expect":"css:.proc-table","count":0},{"shot":"procs-offline"}]'
wait
```

## Gotchas
- Isolated environments replace `ssh` with `verify/fakes/ssh`, which always fails like an unreachable host.
