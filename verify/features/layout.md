# Layout

Switchyard is laid out for a desktop window: sessions sidebar, the session in
the middle, and the workspace pane (Changes, Terminal, Pull request) on the
right, hidden below 1100 px. The web version is also opened from phones over
the tailnet, so the main column must stay usable at 390 px.

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

## Gotchas
- Product gap (2026-11-15): there is no layout below ~700 px. The sidebar keeps its 248 px, so at 390 px the session column is about 140 px wide, words wrap one per line, and the Hosts heading is pushed out of view. mobile-main-column-usable and mobile-hosts-page fail until the app gets a narrow layout (e.g. the sidebar as a drawer). Queued as a finding.
