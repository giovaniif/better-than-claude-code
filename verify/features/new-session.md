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

### folder-picker-lists-folders (manual: the Finder dialog only exists in the desktop app)
"Choose in Finder…" opens the macOS dialog through Tauri. The typed-path
browsing is covered by worktree-note.

## Gotchas
- The default model is Claude Opus 5.5 even when only Codex is logged in; the fakes log both in.
- The folder field browses as you type (`fs.dirs`); press Enter to pick the typed path.
