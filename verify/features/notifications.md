# Notifications

Switchyard shows an OS notification when a session needs the user: it waits for
an approval, its turn finished, or it failed. Only when the window is not
focused or that session is not the one open. A **Notifications** switch in the
sidebar turns them on (the browser asks permission the first time) and off,
kept per browser (`localStorage` `yard.notifications`). The `notify` op
(`{"op":"notify","title","body","sessionId"?,"url"?}`) makes every connected
window show one too; agents use it through `yv notify`. Clicking a notification
focuses the window and opens its session.

The headless browser cannot show an OS notification, so recipes replace
`window.Notification` with a recorder (`window.__n`) and stub `document.hasFocus`.

## Setup

```sh
yv iso up
yv iso seed
```

## Cleanup

```sh
yv iso down
```

## Recipes

### notifications-switch
The switch turns on and off again, and the choice is kept in the browser.

```sh
yv drive new --steps '[{"eval":"(()=>{window.__n=[];window.Notification=class{constructor(t,o){this.title=t;this.o=o||{};window.__n.push(this)}close(){}};window.Notification.permission=\"granted\";window.Notification.requestPermission=()=>Promise.resolve(\"granted\");return 1})()"},{"click":"role:switch:Notifications"},{"eval":"localStorage.getItem(\"yard.notifications\")||\"off\"","equals":"on"},{"click":"role:switch:Notifications"},{"eval":"localStorage.getItem(\"yard.notifications\")||\"off\"","equals":"off"}]'
```

### notifications-permission-denied
When the browser refuses permission the switch stays off and says why.

```sh
yv drive new --steps '[{"eval":"(()=>{window.__n=[];window.Notification=class{constructor(t,o){this.title=t;this.o=o||{};window.__n.push(this)}close(){}};window.Notification.permission=\"default\";window.Notification.requestPermission=()=>Promise.resolve(\"denied\");return 1})()"},{"click":"role:switch:Notifications"},{"wait":300},{"eval":"localStorage.getItem(\"yard.notifications\")||\"off\"","equals":"off"},{"expect":"css:.notify-hint","text":"blocked"}]'
```

### notifications-from-sessions
Viewports: desktop
A focused window on the session that is working says nothing. Once the window
loses focus, an approval request, a finished turn and a failure each notify,
named after the session; the notification opens that session.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"TEST-start"}' --wait '{"op":"created"}' --save note_d=sessionId
yv drive 'session:{{note_d}}' --viewport desktop --steps '[{"eval":"(()=>{window.__n=[];window.Notification=class{constructor(t,o){this.title=t;this.o=o||{};window.__n.push(this)}close(){}};window.Notification.permission=\"granted\";window.Notification.requestPermission=()=>Promise.resolve(\"granted\");return 1})()"},{"click":"role:switch:Notifications"},{"eval":"localStorage.getItem(\"yard.notifications\")||\"off\"","equals":"on"},{"eval":"document.hasFocus=()=>true"},{"fill":"label:Message","value":"[cmd] TEST-focused"},{"click":"role:button:Send"},{"expect":"role:button:Allow once"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it."},{"wait":800},{"eval":"window.__n.length","equals":0},{"eval":"document.hasFocus=()=>false"},{"fill":"label:Message","value":"[cmd] TEST-away"},{"click":"role:button:Send"},{"expect":"role:button:Allow once"},{"wait":800},{"eval":"window.__n.length","equals":1},{"click":"role:button:Allow once"},{"wait":1500},{"fill":"label:Message","value":"[fail] TEST-away"},{"click":"role:button:Send"},{"wait":1500},{"eval":"window.__n.map((n)=>n.title+\": \"+n.o.body)","equals":["TEST-start: Waiting for your approval","TEST-start: Finished its turn","TEST-start: Failed"]},{"click":"role:button:New session"},{"eval":"window.__n[0].onclick()"},{"expect":"css:.thread","text":"TEST-focused"}]'
```

### notifications-from-sessions-mobile
Viewports: mobile
The same at 390 px.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"TEST-start"}' --wait '{"op":"created"}' --save note_m=sessionId
yv drive 'session:{{note_m}}' --viewport mobile --steps '[{"eval":"(()=>{window.__n=[];window.Notification=class{constructor(t,o){this.title=t;this.o=o||{};window.__n.push(this)}close(){}};window.Notification.permission=\"granted\";window.Notification.requestPermission=()=>Promise.resolve(\"granted\");return 1})()"},{"click":"role:switch:Notifications"},{"eval":"localStorage.getItem(\"yard.notifications\")||\"off\"","equals":"on"},{"eval":"document.hasFocus=()=>true"},{"fill":"label:Message","value":"[cmd] TEST-focused"},{"click":"role:button:Send"},{"expect":"role:button:Allow once"},{"click":"role:button:Allow once"},{"expect":"css:.thread","text":"Ran it."},{"wait":800},{"eval":"window.__n.length","equals":0},{"eval":"document.hasFocus=()=>false"},{"fill":"label:Message","value":"[cmd] TEST-away"},{"click":"role:button:Send"},{"expect":"role:button:Allow once"},{"wait":800},{"eval":"window.__n.length","equals":1},{"click":"role:button:Allow once"},{"wait":1500},{"fill":"label:Message","value":"[fail] TEST-away"},{"click":"role:button:Send"},{"wait":1500},{"eval":"window.__n.map((n)=>n.title+\": \"+n.o.body)","equals":["TEST-start: Waiting for your approval","TEST-start: Finished its turn","TEST-start: Failed"]},{"click":"role:button:New session"},{"eval":"window.__n[0].onclick()"},{"expect":"css:.thread","text":"TEST-focused"}]'
```

### notifications-notify-op
Viewports: desktop
A `notify` op sent while the window is open shows one notification.

```sh
(sleep 5; yv api '{"op":"notify","title":"TEST-Loop failed","body":"TEST-patrol did not start"}') &
yv drive new --viewport desktop --steps '[{"eval":"(()=>{window.__n=[];window.Notification=class{constructor(t,o){this.title=t;this.o=o||{};window.__n.push(this)}close(){}};window.Notification.permission=\"granted\";window.Notification.requestPermission=()=>Promise.resolve(\"granted\");return 1})()"},{"click":"role:switch:Notifications"},{"eval":"document.hasFocus=()=>true"},{"wait":9000},{"eval":"window.__n.map((n)=>n.title+\": \"+n.o.body)","equals":["TEST-Loop failed: TEST-patrol did not start"]}]'
wait
```

## Gotchas
- The recorder stands in for the browser's permission prompt and the OS: the
  real prompt and the real banner are not exercised here.
