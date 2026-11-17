# Navigation

Command-K opens a searchable session and page palette. On macOS, Settings and
Import live in the Switchyard app menu; browsers retain their sidebar rows.

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

### command-k-navigation
Viewports: both
Open from the composer, search sessions and pages, select with arrows and Enter,
and dismiss an empty search with Escape while restoring focus.

```sh
yv drive 'session:{{sid_echo}}' --steps '[{"click":"label:Message"},{"fill":"label:Message","value":"TEST-unsent navigation draft"},{"press":"Meta+k"},{"expect":"role:dialog:Go to session or page"},{"expect":"role:combobox:Search sessions and pages"},{"eval":"window.__firstOption = document.querySelector(\"[role=option][aria-selected=true]\").id; true","equals":true},{"press":"ArrowDown"},{"eval":"document.querySelector(\"[role=option][aria-selected=true]\").id !== window.__firstOption","equals":true},{"press":"ArrowUp"},{"press":"Tab"},{"eval":"document.activeElement.getAttribute(\"aria-label\")","equals":"Close"},{"press":"Tab"},{"eval":"document.activeElement.getAttribute(\"role\")","equals":"combobox"},{"press":"Escape"},{"eval":"document.activeElement.getAttribute(\"aria-label\")","equals":"Message"},{"expect":"label:Message","value":"TEST-unsent navigation draft"},{"press":"Meta+k"},{"shot":"palette"},{"fill":"role:combobox:Search sessions and pages","value":"TEST-hello from Claude"},{"expect":"role:option","count":1},{"press":"Enter"},{"expect":"css:.thread","text":"Echo: TEST-hello from Claude"},{"press":"Meta+k"},{"fill":"role:combobox:Search sessions and pages","value":"settings"},{"press":"Enter"},{"expect":"role:heading:Settings"},{"press":"Meta+k"},{"fill":"role:combobox:Search sessions and pages","value":"connectors"},{"press":"Enter"},{"expect":"role:heading:Connectors"},{"press":"Meta+k"},{"fill":"role:combobox:Search sessions and pages","value":"automations"},{"press":"Enter"},{"expect":"role:heading:Automations"},{"press":"Meta+k"},{"fill":"role:combobox:Search sessions and pages","value":"no-such-destination-xyz"},{"expect":"role:status","text":"No sessions or pages match."},{"shot":"empty"},{"press":"Escape"},{"expect":"role:dialog:Go to session or page","visible":false}]'
```

### native-app-menu
Viewports: both
Model the Mac shell capability and its DOM events. The sidebar rows disappear,
while Settings, Import and Go to remain accessible through the menu bridge.

```sh
yv drive new --steps '[{"eval":"window.__SWITCHYARD_APP_MENU__ = true; true","equals":true},{"eval":"window.dispatchEvent(new CustomEvent(\"switchyard:navigate\", {detail: \"settings\"})); true","equals":true},{"expect":"role:heading:Settings"},{"eval":"[...document.querySelectorAll(\".sidebar-top button\")].map(e => e.textContent.trim())","equals":["New session","Automations","Connectors"]},{"shot":"mac-sidebar"},{"eval":"window.dispatchEvent(new CustomEvent(\"switchyard:navigate\", {detail: \"import\"})); true","equals":true},{"expect":"role:dialog:Import from Claude Code"},{"shot":"menu-import"},{"press":"Escape"},{"eval":"window.dispatchEvent(new CustomEvent(\"switchyard:navigate\", {detail: \"navigation\"})); true","equals":true},{"expect":"role:dialog:Go to session or page"},{"fill":"role:combobox:Search sessions and pages","value":"import"},{"press":"Enter"},{"expect":"role:dialog:Import from Claude Code"}]'
```
