# Attachments

Files go with a prompt: paste, drop or the paperclip. Each uploads at once
(`attach.put`) and shows as a chip; images get a preview. 10 MB per file,
checked in the UI (red chip, Send disabled) and by yardd. Sent images show as
thumbnails in the thread; Codex gets image paths as `localImage` items.

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

### upload-image-and-send
An image picked with the paperclip shows as a chip, goes with the prompt, shows
as a thumbnail, and reaches the engine as a localImage.

```sh
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > "$(v work)/TEST-dot.png"
yv drive new --viewport desktop --steps '[{"click":"role:button:Opus 5.5 High"},{"click":{"role":"button","name":"Fake Fast","exact":true}},{"press":"Escape"},{"click":"role:button:work"},{"fill":"label:Folder","value":"{{repo}}"},{"press":"Enter"},{"upload":"input","files":["{{work}}/TEST-dot.png"]},{"expect":"css:.attachments","text":"TEST-dot.png"},{"fill":"label:Message","value":"TEST-look at this"},{"click":"role:button:Send"},{"expect":"css:.thread","text":"Echo: TEST-look at this"},{"expect":"role:img:TEST-dot.png"}]'
grep -q localImage "$(v fake)/turn-inputs.jsonl"
```

### size-cap
Viewports: desktop
An 11 MB file shows a red chip and Send stays disabled.

```sh
head -c 11000000 /dev/zero > "$(v work)/TEST-big.bin"
yv drive new --viewport desktop --steps '[{"upload":"input","files":["{{work}}/TEST-big.bin"]},{"expect":"css:.attachment-error"},{"fill":"label:Message","value":"TEST-too big"},{"expect":{"role":"button","name":"Send"},"enabled":false}]'
```

### upload-over-api
`attach.put` stores a file and answers with its id.

```sh
yv api '{"op":"attach.put","ref":"r1","name":"TEST-note.txt","mime":"text/plain","data":"VEVTVC1ub3Rl"}' --wait '{"op":"attach.stored","ref":"r1"}' --expect '{"attachment":{"name":"TEST-note.txt"}}' --save att_id=attachment.id
```

### paste-and-drop (manual: clipboard and OS drag events are not scripted)
Pasting an image and dropping a file on the composer add chips the same way.

## Gotchas
- The file input is hidden; the `upload` step sets its files directly.
