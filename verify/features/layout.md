# Layout

Switchyard is laid out for a desktop window: sessions sidebar, the session in
the middle, and the workspace pane (Changes, Terminal, Pull request) on the
right, hidden below 1100 px. The web version is also opened from phones over
the tailnet, so the main column must stay usable at 390 px: below 700 px the
sidebar is a drawer over the page, opened by the menu button ("Open sessions")
first in each page's bar, and closed by picking anything in it, tapping the
backdrop, or Escape.

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

### desktop-three-columns
Viewports: desktop
Sidebar, session and workspace pane are all visible at 1440 px.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"expect":"role:navigation:Sessions"},{"expect":"role:heading:[edit] TEST-fix the greeting"},{"expect":"role:region:Workspace"},{"shot":"desktop"}]'
```

### narrow-hides-pane
Viewports: mobile
Below 1100 px the workspace pane is hidden and the composer stays on screen.

```sh
yv drive 'session:{{sid_edit}}' --viewport mobile --steps '[{"expect":"role:region:Workspace","visible":false},{"expect":"label:Message","inViewport":true}]'
```

### mobile-main-column-usable
Viewports: mobile
At 390 px the session column must be at least 300 px wide, so prompts and
answers are readable.

```sh
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"eval":"Math.round(document.querySelector(\".main\").getBoundingClientRect().width) >= 300","equals":true}]'
```

### mobile-hosts-page
Viewports: mobile
At 390 px the Hosts heading and the host card's stats must be readable.

```sh
yv drive hosts --viewport mobile --steps '[{"expect":"role:heading:Hosts","inViewport":true},{"eval":"Math.round(document.querySelector(\".host-card\").getBoundingClientRect().width) >= 300","equals":true}]'
```

### mobile-drawer-opens-and-closes
Viewports: mobile
At 390 px the sidebar starts closed. The menu button opens it on screen;
Escape closes it, a tap on the backdrop beside it closes it, and picking a
session opens that session and closes it, leaving the session the full width.

```sh
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"expect":"role:navigation:Sessions","visible":false},{"click":"role:button:Open sessions"},{"wait":400},{"expect":"role:navigation:Sessions","inViewport":true},{"expect":"role:button:New session","inViewport":true},{"shot":"drawer-open"},{"press":"Escape"},{"expect":"role:navigation:Sessions","visible":false},{"click":"role:button:Open sessions"},{"wait":400},{"eval":"document.elementFromPoint(370, 400).className","equals":"drawer-backdrop"},{"eval":"document.elementFromPoint(370, 400).click() ?? 1","equals":1},{"expect":"role:navigation:Sessions","visible":false},{"click":"role:button:Open sessions"},{"click":{"css":".session-row","hasText":"[edit] TEST-fix the greeting"}},{"expect":"role:heading:[edit] TEST-fix the greeting"},{"expect":"role:navigation:Sessions","visible":false},{"eval":"Math.round(document.querySelector(\".main\").getBoundingClientRect().width)","equals":390},{"shot":"session-after-pick"}]'
```

### mobile-menu-on-every-page
Viewports: mobile
The menu button is on screen on the new-session, Hosts and Automations pages too.

```sh
yv drive new --viewport mobile --steps '[{"expect":"role:button:Open sessions","inViewport":true},{"goto":"hosts"},{"expect":"role:button:Open sessions","inViewport":true},{"click":"role:button:Open sessions"},{"click":"role:button:Automations"},{"expect":"role:heading:Automations"},{"expect":"role:button:Open sessions","inViewport":true}]'
```

### mobile-delete-confirm-fits-the-bar
Viewports: mobile
At 390 px, Delete on a session with its own worktree arms two choices in the
bar. Each stays on one line inside the bar (nothing spills over the thread or
off the screen), and the first click still only arms them.

```sh
yv drive 'session:{{sid_edit}}' --viewport mobile --steps '[{"click":{"role":"button","name":"Delete","exact":true}},{"expect":{"css":".main header.bar .btn-text"},"count":2},{"eval":"(() => { const bar = document.querySelector(\".main header.bar\").getBoundingClientRect(); return [...document.querySelectorAll(\".main header.bar button\")].filter((b) => b.getClientRects().length > 0).every((b) => { const r = document.createRange(); r.selectNodeContents(b); const box = r.getBoundingClientRect(); return new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top))).size === 1 && box.bottom <= bar.bottom && box.right <= window.innerWidth; }); })()","equals":true},{"shot":"delete-armed"}]'
yv state --expect '{"sessions":[{"id":"{{sid_edit}}"}]}'
```

### send-stays-at-the-right
At 390 px the reply box's tools (attach, dictate, voice mode, model, permission)
fill the row, so Send moves to a second line. It stays at the right edge of
the box there, where it sits on one line and on the New session box.

```sh
yv drive 'session:{{sid_echo}}' --viewport mobile --steps '[{"expect":"label:Message"},{"eval":"(() => { const row = document.querySelector(\".composer-row\").getBoundingClientRect(); const send = document.querySelector(\".composer-row .send\").getBoundingClientRect(); return Math.round(row.right - send.right); })()","equals":0},{"shot":"reply-send"}]'
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"expect":"label:Message"},{"eval":"(() => { const row = document.querySelector(\".composer-row\").getBoundingClientRect(); const send = document.querySelector(\".composer-row .send\").getBoundingClientRect(); return Math.round(row.right - send.right); })()","equals":0}]'
yv drive new --steps '[{"expect":"label:Message"},{"eval":"(() => { const row = document.querySelector(\".composer-row\").getBoundingClientRect(); const send = document.querySelector(\".composer-row .send\").getBoundingClientRect(); return Math.round(row.right - send.right); })()","equals":0}]'
```

### desktop-sidebar-is-a-column
Viewports: desktop
At 1440 px nothing changes: no menu button, and the sidebar is a 248 px column
beside the session, not a drawer.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"expect":"role:button:Open sessions","visible":false},{"expect":"role:navigation:Sessions","inViewport":true},{"eval":"[Math.round(document.querySelector(\".sidebar\").getBoundingClientRect().width), getComputedStyle(document.querySelector(\".sidebar\")).position, Math.round(document.querySelector(\".main\").getBoundingClientRect().left)]","equals":[248,"static",248]}]'
```

## Gotchas
- Below 700 px the sidebar is a closed drawer, so a recipe that clicks or reads something in it at mobile opens it first (`{"click":"role:button:Open sessions"}`); `yv drive`'s routes do that themselves. At both viewports with one step list, split the recipe per viewport: the menu button is hidden on desktop.
- Fixed 2026-11-16 (#8): there was no layout below ~700 px; the 248 px sidebar left the session column about 140 px wide at 390 px.
