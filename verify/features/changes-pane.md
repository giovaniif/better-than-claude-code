# Changes pane

The Changes tab shows the session folder's `git diff` (tracked and untracked),
file by file, refreshed when a turn ends or on Refresh. The workspace pane is
hidden below 1100 px, so these recipes run at desktop only.

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

### shows-diff
Viewports: desktop
The edit session lists src/lib.rs with +1 −0 and the added line.

```sh
yv drive 'session:{{sid_edit}}' --viewport desktop --steps '[{"expect":{"role":"button","name":"Changes","exact":true}},{"expect":{"role":"region","name":"Workspace"},"text":"src/lib.rs"},{"expect":{"role":"region","name":"Workspace"},"text":"+1 −0"},{"expect":{"role":"region","name":"Workspace"},"text":"fn added() {}"},{"shot":"changes"}]'
```

### empty-folder
Viewports: desktop
A session that changed nothing says so.

```sh
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"expect":"text:No changes in this folder."}]'
```

### refresh-picks-up-new-file
Viewports: desktop
A file written outside the agent shows after Refresh changes, as untracked.

```sh
yv state --save echo_cwd='sessions[id={{sid_echo}}].cwd'
echo "TEST-written outside" > "$(v echo_cwd)/TEST-outside.txt"
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"role":"region","name":"Workspace"},"text":"TEST-outside.txt"}]'
```

### new-file-shows-its-content
Viewports: desktop
A file the agent created is untracked, so `git diff` leaves it out. The pane
still shows its lines, as a new file, and a binary one as "No text diff"
(finding #43).

```sh
yv state --save echo_cwd='sessions[id={{sid_echo}}].cwd'
printf 'TEST-first line\nTEST-second line\n' > "$(v echo_cwd)/TEST-new-file.txt"
printf 'TEST\000binary' > "$(v echo_cwd)/TEST-new-blob.bin"
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"css":".card","hasText":"TEST-new-file.txt"},"text":"+TEST-second line"},{"expect":{"css":".card","hasText":"TEST-new-blob.bin"},"text":"No text diff."},{"shot":"new-file"}]'
```

## Gotchas
- Below 1100 px the pane is hidden (`@media (max-width: 1100px)`): no Changes, Terminal or Pull request on mobile.
