# New session

The page a user lands on: a centered prompt box with the model, effort and
permission pickers, the host and folder buttons under it, and a note that says
whether the session gets a worktree. Sending creates a session, opens it, and
the first turn runs. Send is disabled while the prompt is empty.

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

### page-renders
Expect at both viewports: the heading "What should we work on?", the Message
box, Send disabled, the host button "iso-host". No console, page or API errors.

```sh
yv drive new --steps '[{"expect":"role:heading:What should we work on?"},{"expect":"label:Message"},{"expect":{"role":"button","name":"Send"},"enabled":false},{"expect":"role:button:iso-host"},{"shot":"new-session"}]'
```

### send-creates-session
Pick a Codex model, type a prompt in the seeded repository and send. Expect the
session page with the prompt as the heading and the fake's reply "Echo: …".
Read back: the daemon lists the session as idle, with a `yard/` branch.

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:Opus 5.5 High"},{"click":{"css":".picker-fold"}},{"click":{"role":"button","name":"Fake Fast","exact":true}},{"press":"Escape"},{"click":"role:button:work"},{"fill":"label:Folder","value":"{{repo}}"},{"press":"Enter"},{"fill":"label:Message","value":"TEST-new from the page"},{"click":"role:button:Send"},{"expect":"role:heading:TEST-new from the page"},{"expect":"css:.thread","text":"Echo: TEST-new from the page"}]'
yv state --expect '{"sessions":[{"title":"TEST-new from the page","status":"idle","engine":"codex","branch":"~yard/"}]}'
```

### empty-prompt-cannot-send
Expect Send disabled with nothing typed, enabled after typing, disabled again
after clearing.

```sh
yv drive new --steps '[{"expect":{"role":"button","name":"Send"},"enabled":false},{"fill":"label:Message","value":"x"},{"expect":{"role":"button","name":"Send"},"enabled":true},{"fill":"label:Message","value":""},{"expect":{"role":"button","name":"Send"},"enabled":false}]'
```

### worktree-note
The note under the prompt says what happens to the folder: in a repository a
new worktree, in a plain folder "Works in the folder itself".

```sh
yv drive new --viewport desktop --steps '[{"click":"role:button:work"},{"fill":"label:Folder","value":"{{plain}}"},{"press":"Enter"},{"expect":"text:Works in the folder itself"}]'
```

### base-branch-picker
Viewports: desktop
In a repository the folder row gets a branch chip, labelled with the current
branch. Its menu lists the branches with "current" beside the checked-out
one and filters as you type; picking another branch cuts the new worktree from
it. Read back: the session's worktree holds the file only that branch has.

```sh
R="$(v repo)"
git -C "$R" branch -D TEST-base >/dev/null 2>&1 || true
git -C "$R" worktree add -q -b TEST-base "$R-TEST-base-wt" >/dev/null
echo base > "$R-TEST-base-wt/TEST-base-only.txt"
git -C "$R-TEST-base-wt" add TEST-base-only.txt
git -C "$R-TEST-base-wt" -c user.name=TEST -c user.email=test@example.com commit -q -m "TEST-base only"
git -C "$R" worktree remove --force "$R-TEST-base-wt"
CUR="$(git -C "$R" branch --show-current)"
yv drive new --viewport desktop --steps '[{"click":"role:button:work"},{"fill":"label:Folder","value":"{{repo}}"},{"press":"Enter"},{"expect":"css:button[title=\"Branch the worktree starts from\"]","text":"'"$CUR"'"},{"click":"css:button[title=\"Branch the worktree starts from\"]"},{"expect":{"css":".menu-item","hasText":"'"$CUR"'"},"text":"current"},{"fill":"label:Base branch","value":"TEST-ba"},{"expect":"css:.menu-item","count":1},{"click":{"css":".menu-item","hasText":"TEST-base"}},{"expect":"css:button[title=\"Branch the worktree starts from\"]","text":"TEST-base"},{"click":"role:button:Opus 5.5 High"},{"click":{"css":".picker-fold"}},{"click":{"role":"button","name":"Fake Fast","exact":true}},{"press":"Escape"},{"fill":"label:Message","value":"TEST-from the base branch"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-from the base branch"}]'
yv state --expect '{"sessions":[{"title":"TEST-from the base branch","status":"idle","branch":"~yard/"}]}'
WT="$(yv state | jq -er '.sessions[] | select(.title=="TEST-from the base branch") | .cwd')"
test -f "$WT/TEST-base-only.txt"
```

### typed-path-with-no-match-says-so
Viewports: both
A typed path whose last part matches no folder (a typo, or a folder that does
not exist yet) says so under the field instead of leaving the list blank, and
Enter does not take it: the chip keeps the folder it had.

```sh
yv drive new --steps '[{"click":"role:button:work"},{"fill":"label:Folder","value":"{{work}}/TEST-no-such-folder"},{"expect":"css:.picker-empty","text":"No folder in"},{"expect":"css:.picker-empty","text":"TEST-no-such-folder"},{"shot":"no-match"},{"press":"Enter"},{"expect":"css:.picker-empty","text":"TEST-no-such-folder"},{"press":"Escape"},{"expect":{"role":"button","name":"work","exact":true}}]'
```

### folder-picker-lists-folders (manual: the Finder dialog only exists in the desktop app)
"Choose in Finder…" opens the macOS dialog through Tauri. The typed-path
browsing is covered by worktree-note.

## Gotchas
- The default model is Claude Opus 5.5 even when only Codex is logged in; the fakes log both in.
- The folder field browses as you type (`fs.dirs`); press Enter to pick the typed path. A path that names no folder is not taken; the list says so.
- `label:Folder` is not exact: once a session whose title contains "folder" exists (as in an iso you have been exploring), the sidebar row's button matches first and `fill` fails with "Element is not an <input>". Target the field by `placeholder:Search folders, or type a path` there.
