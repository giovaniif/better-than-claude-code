# Sidebar

Pinned sessions, then ungrouped ones newest first, then one collapsible
section per group, each row with title, model and status. A row's … menu (or
right-click) pins, moves to a group, archives or restores, and deletes after one
confirmation; a worktree session also offers to remove its worktree. A group
exists only while a session is in it; its header menu renames or ungroups all
of them. Pinned, archived and group live in yardd, so every window agrees;
which groups are collapsed is per browser. The Archived header is pinned to the
bottom of the session area and never scrolls away.

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

### rows-show-status
Expect at both viewports: every seeded session has a row; the approval one
says "Needs approval".

```sh
yv drive new --steps '[{"expect":{"css":".session-row","hasText":"TEST-say hello"}},{"expect":{"css":".session-row","hasText":"[cmd] TEST-run the migration"},"text":"Needs approval"},{"expect":{"role":"navigation","name":"Sessions"},"text":"TEST-hello from Claude"},{"shot":"sidebar"}]'
```

### pin-and-unpin
Pin moves the row under "Pinned"; the daemon stores it.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for TEST-say hello"},{"click":"role:menuitem:Pin"},{"expect":"css:.list-head","text":"Pinned"}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","pinned":true}]}'
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for TEST-say hello"},{"click":"role:menuitem:Unpin"},{"expect":"text:Pinned","visible":false}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","pinned":false}]}'
```

### archive-and-restore
Archive moves the row into the collapsed Archived section; Restore brings it back.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for [think] TEST-plan"},{"click":"role:menuitem:Archive"},{"expect":"role:button:Archived"}]'
yv state --expect '{"sessions":[{"id":"{{sid_think}}","archived":true}]}'
yv drive new --viewport desktop --steps '[{"click":"role:button:Archived"},{"click":"role:button:Actions for [think] TEST-plan"},{"click":"role:menuitem:Restore"},{"expect":"role:button:Archived","visible":false}]'
yv state --expect '{"sessions":[{"id":"{{sid_think}}","archived":false}]}'
```

### delete-keeps-worktree
"Delete…" then "Delete, keep the worktree" removes the session and leaves its folder.

```sh
yv state --save fail_cwd='sessions[id={{sid_fail}}].cwd'
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for [fail] TEST-failing turn"},{"click":"role:menuitem:Delete…"},{"click":"role:menuitem:Delete, keep the worktree"},{"expect":{"css":".session-row","hasText":"[fail] TEST-failing turn"},"visible":false}]'
test -d "$(v fail_cwd)"
```

### group-new
"Move to group…", "New group…" and a name put the session under a header with the name and a count.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for TEST-say hello"},{"click":"role:menuitem:Move to group…"},{"click":"role:menuitem:New group…"},{"fill":"label:Group name","value":"Release"},{"press":"Enter"},{"expect":{"css":".group-head","hasText":"Release"},"text":"1"}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","group":"Release"}]}'
```

### group-move-to-existing
The menu lists the existing group; choosing it joins the section.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for [think] TEST-plan"},{"click":"role:menuitem:Move to group…"},{"click":"role:menuitem:Release"},{"expect":{"css":".group-head","hasText":"Release"},"text":"2"}]'
yv state --expect '{"sessions":[{"id":"{{sid_think}}","group":"Release"}]}'
```

### group-collapse-persists
Clicking the header hides the group's rows; the choice survives a reload (kept in this browser).

```sh
yv drive new --viewport desktop --steps '[{"click":{"css":".group-toggle","hasText":"Release"}},{"expect":{"css":".session-row","hasText":"TEST-say hello"},"visible":false},{"reload":true},{"goto":"new"},{"expect":{"css":".group-head","hasText":"Release"}},{"expect":{"css":".session-row","hasText":"TEST-say hello"},"visible":false},{"click":{"css":".group-toggle","hasText":"Release"}},{"expect":{"css":".session-row","hasText":"TEST-say hello"}}]'
```

### group-rename
Rename in the header menu changes the group of every session in it.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for group Release"},{"click":"role:menuitem:Rename"},{"fill":"label:Group name","value":"Shipping"},{"press":"Enter"},{"expect":{"css":".group-head","hasText":"Shipping"},"text":"2"},{"expect":{"css":".group-head","hasText":"Release"},"visible":false}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","group":"Shipping"},{"id":"{{sid_think}}","group":"Shipping"}]}'
```

### group-remove-from-group
"Remove from group" takes one session out; the group keeps the rest.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for [think] TEST-plan"},{"click":"role:menuitem:Remove from group"},{"expect":{"css":".group-head","hasText":"Shipping"},"text":"1"}]'
yv state --expect '{"sessions":[{"id":"{{sid_think}}","group":null},{"id":"{{sid_echo}}","group":"Shipping"}]}'
```

### group-ungroup
Ungroup empties the group: the header is gone and the sessions are ungrouped.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Actions for group Shipping"},{"click":"role:menuitem:Ungroup"},{"expect":"css:.group-head","visible":false},{"expect":{"css":".session-row","hasText":"TEST-say hello"}}]'
yv state --expect '{"sessions":[{"id":"{{sid_echo}}","group":null}]}'
```

### archived-header-stays-at-bottom
With many sessions the list scrolls, but the Archived header stays at the bottom of the session list, just above the sidebar's footer (usage meters, Notifications, host rows), and opening it expands upward with its own scroll.

```sh
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"permission":"ask","text":"TEST-many '$i'"}' > /dev/null; done
yv api '{"op":"session.update","sessionId":"{{sid_think}}","archived":true}'
yv drive new --viewport desktop --steps '[{"eval":"(document.querySelector(\".session-list\").scrollTop = 9999, document.querySelector(\".session-list\").scrollHeight > document.querySelector(\".session-list\").clientHeight)","equals":true},{"expect":"role:button:Archived","inViewport":true},{"eval":"Math.abs(document.querySelector(\".archived-dock\").getBoundingClientRect().bottom - document.querySelector(\".archived-dock\").nextElementSibling.getBoundingClientRect().top) < 2","equals":true},{"click":"role:button:Archived"},{"expect":{"css":".session-row","hasText":"[think] TEST-plan"},"inViewport":true},{"eval":"Math.abs(document.querySelector(\".archived-dock\").getBoundingClientRect().bottom - document.querySelector(\".archived-dock\").nextElementSibling.getBoundingClientRect().top) < 2","equals":true}]'
```

## Gotchas
- Row menus render on document.body (a portal), so find menu items by role, not inside the row.
