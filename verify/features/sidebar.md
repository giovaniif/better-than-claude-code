# Sidebar

One flat list, newest first, each row with title, model and status. A row's
… menu (or right-click) pins, archives or restores, and deletes after one
confirmation; a worktree session also offers to remove its worktree. Pinned
and archived flags live in yardd, so every window agrees.

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

## Gotchas
- Row menus render on document.body (a portal), so find menu items by role, not inside the row.
