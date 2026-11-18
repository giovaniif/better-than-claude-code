# Launch defaults

Settings saves independent model/effort and host defaults for New sessions and
Switchy. Explicit defaults beat last-used choices and survive reloads. Switchy
uses local models with a separate context-host scope. Reset restores last-used
behavior. Configured offline session hosts stay selected; removed hosts fall back.

## Setup

```sh
yv iso up
yv iso seed
yv var set remote_port "$(yv iso up --name map-launch-defaults-remote --host-name TEST-default-host | jq -r .iso.port)"
yv api '{"op":"host.add","name":"TEST-default-host","kind":"direct","url":"ws://127.0.0.1:{{remote_port}}/ws"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-default-host","status":"connected"}]}' --save default_host='hosts[name=TEST-default-host].id'
```

## Cleanup

```sh
yv iso down
yv iso down --name map-launch-defaults-remote
```

## Recipes

### independent-defaults
Viewports: both
Save different model/host defaults, reload Settings and New session, then make a
one-off Switchy request. Reopening Switchy restores its defaults.

```sh
yv drive settings --steps '[{"eval":"localStorage.removeItem(\"yard.defaults.sessions\"); localStorage.removeItem(\"yard.defaults.switchy\"); true"},{"reload":true},{"click":"css:section[aria-labelledby=\"defaults-sessions\"] .chip"},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] .popover","inViewport":true},{"click":{"css":"section[aria-labelledby=\"defaults-sessions\"] .menu-item","hasText":"TEST-default-host"}},{"click":"css:section[aria-labelledby=\"defaults-sessions\"] button[aria-label^=\"Model \"]"},{"click":{"css":"section[aria-labelledby=\"defaults-sessions\"] .picker-fold","hasText":"Codex"}},{"click":"role:button:Fake Deep"},{"press":"Escape"},{"click":{"css":"section[aria-labelledby=\"defaults-sessions\"] .btn-primary","hasText":"Save defaults"}},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] [role=status]","text":"Defaults saved."},{"click":"css:section[aria-labelledby=\"defaults-switchy\"] .chip"},{"click":{"css":"section[aria-labelledby=\"defaults-switchy\"] .menu-item","hasText":"iso-host"}},{"expect":"css:section[aria-labelledby=\"defaults-switchy\"] button[aria-label^=\"Model \"]","text":"Fake Fast"},{"click":{"css":"section[aria-labelledby=\"defaults-switchy\"] .btn-primary","hasText":"Save defaults"}},{"reload":true},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] .chip","text":"TEST-default-host"},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] button[aria-label^=\"Model \"]","text":"Fake Deep"},{"expect":"css:section[aria-labelledby=\"defaults-switchy\"] .chip","text":"iso-host"},{"expect":"css:section[aria-labelledby=\"defaults-switchy\"] button[aria-label^=\"Model \"]","text":"Fake Fast"},{"shot":"saved-defaults"},{"goto":"new"},{"expect":"role:button:Model Fake Deep"},{"expect":"role:button:TEST-default-host"},{"reload":true},{"expect":"role:button:Model Fake Deep"},{"expect":"role:button:TEST-default-host"},{"shot":"session-defaults"},{"goto":"switchy"},{"expect":"role:button:Model Fake Fast"},{"expect":"css:.composer-chips .chip","text":"iso-host"},{"click":"role:button:Model Fake Fast"},{"click":"role:button:Fake Deep"},{"press":"Escape"},{"click":"css:.composer-chips .chip"},{"click":{"css":".composer-chips .menu-item","hasText":"All hosts"}},{"fill":"label:Message","value":"TEST-one-off Switchy model and host"},{"click":"role:button:Send"},{"wait":"text:This is a scripted Switchy answer."},{"goto":"new"},{"expect":"role:button:Model Fake Deep"},{"goto":"switchy"},{"expect":"role:button:Model Fake Fast"},{"expect":"css:.composer-chips .chip","text":"iso-host"},{"shot":"switchy-defaults"}]'
```

### effort-menu-stays-on-screen
Viewports: both
The effort menu opens fully on screen in both defaults rows. (On a 390 px
phone the effort chip comes last in the row, and its menu hung from the chip's
left edge to x ≈ 393-398, past the screen's right edge, cutting off the menu's
right side.)

```sh
yv drive settings --steps '[{"click":"css:section[aria-labelledby=\"defaults-sessions\"] button[aria-label^=\"Effort \"]"},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] .effort-menu"},{"shot":"sessions-effort-menu"},{"eval":"(() => { const r = document.querySelector(\".effort-menu\").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()","equals":true},{"press":"Escape"},{"click":"css:section[aria-labelledby=\"defaults-switchy\"] button[aria-label^=\"Effort \"]"},{"expect":"css:section[aria-labelledby=\"defaults-switchy\"] .effort-menu"},{"shot":"switchy-effort-menu"},{"eval":"(() => { const r = document.querySelector(\".effort-menu\").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()","equals":true}]'
```

### reset-defaults
Viewports: both
Explicit defaults can be cleared independently without changing the conversation.

```sh
yv drive settings --steps '[{"eval":"for (const target of [\"sessions\",\"switchy\"]) localStorage.setItem(\"yard.defaults.\"+target,JSON.stringify({host:\"local\",choice:{engine:\"codex\",model:\"fake-fast\",effort:\"low\"}})); true"},{"reload":true},{"click":{"css":"section[aria-labelledby=defaults-sessions] button","hasText":"Use last used"}},{"eval":"localStorage.getItem(\"yard.defaults.sessions\")","equals":null},{"eval":"localStorage.getItem(\"yard.defaults.switchy\") !== null","equals":true},{"click":{"css":"section[aria-labelledby=defaults-switchy] button","hasText":"Use last used"}},{"eval":"localStorage.getItem(\"yard.defaults.switchy\")","equals":null},{"shot":"reset-defaults"}]'
```

### removed-default-host-keeps-the-model
Viewports: both
The saved default host was removed: New session falls back to this computer
but still starts on the saved default model and effort, as Settings shows.

```sh
yv api '{"op":"host.add","name":"TEST-removed-default","kind":"ssh","destination":"test@gone.invalid"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-removed-default"}]}' --save removed_host='hosts[name=TEST-removed-default].id'
yv api '{"op":"host.remove","hostId":"{{removed_host}}"}'
yv drive new --steps '[{"eval":"localStorage.setItem(\"yard.defaults.sessions\",JSON.stringify({host:\"{{removed_host}}\",choice:{engine:\"codex\",model:\"fake-deep\",effort:\"xhigh\"}})); true"},{"reload":true},{"expect":{"css":".new-chips button","hasText":"iso-host"}},{"expect":"role:button:Model Fake Deep"},{"expect":"role:button:Effort Xhigh"},{"shot":"new-session"},{"goto":"settings"},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] .chip","text":"iso-host"},{"expect":"css:section[aria-labelledby=\"defaults-sessions\"] button[aria-label^=\"Model \"]","text":"Fake Deep"},{"shot":"settings"}]'
```
