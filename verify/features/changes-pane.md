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

### changed-binary-says-binary
Viewports: desktop
A tracked binary file that changed is listed as "binary", not `+0 −0`
(git counts no lines for it, which read as nothing changed; finding #111).
Its own session, so the other recipes keep their folders.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"TEST-binary edit"}' --wait '{"op":"created"}' --save bin_sid=sessionId
yv state --save bin_cwd='sessions[id={{bin_sid}}].cwd'
printf 'TEST\000one' > "$(v bin_cwd)/TEST-logo.bin"
git -C "$(v bin_cwd)" add TEST-logo.bin
git -C "$(v bin_cwd)" -c user.name=TEST -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm "TEST-binary"
printf 'TEST\000two, longer' > "$(v bin_cwd)/TEST-logo.bin"
yv drive 'session:{{bin_sid}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"css":".file-row","hasText":"TEST-logo.bin"},"text":"binary"},{"expect":{"css":".card","hasText":"TEST-logo.bin"},"text":"No text diff."},{"shot":"binary"}]'
```

### renamed-file-shows-old-and-new-name
Viewports: desktop
A staged rename (`git mv`, then an edit) is listed as `old → new`, not git's
brace form `{old => new}` (finding #114). Its own session, so the other
recipes keep their folders.

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}","worktree":true,"text":"TEST-rename"}' --wait '{"op":"created"}' --save ren_sid=sessionId
yv state --save ren_cwd='sessions[id={{ren_sid}}].cwd'
mkdir -p "$(v ren_cwd)/TEST-src"
printf 'one\ntwo\nthree\nfour\n' > "$(v ren_cwd)/TEST-src/greet.txt"
git -C "$(v ren_cwd)" add TEST-src/greet.txt
git -C "$(v ren_cwd)" -c user.name=TEST -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm "TEST-greet"
git -C "$(v ren_cwd)" mv TEST-src/greet.txt TEST-src/hello.txt
printf 'one\ntwo\nthree\nfive\n' > "$(v ren_cwd)/TEST-src/hello.txt"
yv drive 'session:{{ren_sid}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"css":".file-row","hasText":"TEST-src/greet.txt → TEST-src/hello.txt"},"text":"+1 −1"},{"expect":{"css":".file-row","hasText":"=>"},"count":0},{"shot":"rename"}]'
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
(finding #43). With a dozen more files the cards still show their lines: the
pane scrolls, the cards do not shrink to their headers.

```sh
yv state --save echo_cwd='sessions[id={{sid_echo}}].cwd'
printf 'TEST-first line\nTEST-second line\n' > "$(v echo_cwd)/TEST-new-file.txt"
printf 'TEST\000binary' > "$(v echo_cwd)/TEST-new-blob.bin"
for i in 01 02 03 04 05 06 07 08 09 10 11 12; do echo "TEST-more $i" > "$(v echo_cwd)/TEST-more-$i.txt"; done
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"css":".card","hasText":"TEST-new-file.txt"},"text":"+TEST-second line"},{"expect":{"css":".card","hasText":"TEST-new-blob.bin"},"text":"No text diff."},{"eval":"[...document.querySelectorAll(\".pane-body .card\")].filter((c)=>c.scrollHeight>c.clientHeight+1).length","equals":0},{"shot":"new-file"}]'
```

### non-ascii-file-names
Viewports: desktop
A file name with accents is listed as written, not as git's quoted octal
(`"TEST-configura\303\247\303\243o.md"`, finding #45).

```sh
yv state --save echo_cwd='sessions[id={{sid_echo}}].cwd'
echo "TEST-olá" > "$(v echo_cwd)/TEST-configuração.md"
yv drive 'session:{{sid_echo}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"css":".file-row","hasText":"TEST-configuração.md"},"text":"new"},{"shot":"non-ascii"}]'
```

### subfolder-session-names-files-from-the-root
Viewports: desktop
A session started in a subfolder (`src/`) lists an edit, a new file inside
the subfolder and a new file outside it, all from the repository root:
`src/TEST-inside.txt`, not `TEST-inside.txt`, and `TEST-outside.txt` is not
dropped (finding #108).

```sh
yv api '{"op":"session.create","engine":"codex","model":"fake-fast","effort":"low","cwd":"{{repo}}/src","worktree":true,"text":"TEST-in a subfolder"}' --wait '{"op":"created"}' --save sub_sid=sessionId
yv state --save sub_cwd='sessions[id={{sub_sid}}].cwd'
echo "TEST-inside" > "$(v sub_cwd)/TEST-inside.txt"
echo "TEST-outside" > "$(v sub_cwd)/../TEST-outside.txt"
echo "// TEST-edit" >> "$(v sub_cwd)/lib.rs"
yv drive 'session:{{sub_sid}}' --viewport desktop --steps '[{"click":"role:button:Refresh changes"},{"expect":{"css":".file-row","hasText":"src/lib.rs"},"text":"+1 −0"},{"expect":{"css":".file-row","hasText":"src/TEST-inside.txt"},"text":"new"},{"expect":{"css":".file-row","hasText":"TEST-outside.txt"},"text":"new"},{"expect":{"css":".card","hasText":"TEST-outside.txt"},"text":"+TEST-outside"},{"shot":"subfolder"}]'
```

## Gotchas
- Below 1100 px the pane is hidden (`@media (max-width: 1100px)`): no Changes, Terminal or Pull request on mobile.
