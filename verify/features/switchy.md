# Switchy

Switchy is one persistent conversation outside the session list. Each question
collects bounded, timestamped host evidence and starts a fresh restricted engine
thread. The host scope and model selectors are separate. Context opens the host
rail; source disclosure shows the evidence used. Stop, reconnect and reload keep
the conversation. The composer uses the same `Composer`, model, effort, access, voice and host-picker components as sessions.

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

### ask-and-reload
Viewports: both
A question runs through the scripted Codex, sources expand, and the answer
survives reloading without creating a session row.

```sh
yv drive switchy --steps '[{"expect":"role:heading:Switchy"},{"expect":"css:.composer .picker > button","enabled":true},{"fill":"label:Message","value":"TEST-What is happening on this host?"},{"click":"role:button:Send"},{"wait":"text:This is a scripted Switchy answer."},{"expect":"css:.assistant-answer","text":"TEST-What is happening on this host?"},{"click":"css:.assistant-source-list > summary"},{"click":"css:.assistant-evidence > summary"},{"expect":"css:.assistant-evidence[open] pre"},{"shot":"switchy-answer"},{"reload":true},{"expect":"css:.assistant-answer","text":"This is a scripted Switchy answer."},{"eval":"getComputedStyle(document.querySelector(\".composer\")).borderRadius","equals":"16px"},{"eval":"getComputedStyle(document.querySelector(\".composer textarea\")).resize","equals":"none"},{"eval":"document.documentElement.scrollWidth <= innerWidth","equals":true}]'
```

### context-and-followup
Viewports: both
The context panel starts closed, opens on demand, and the conversation accepts
a follow-up without changing routes.

```sh
yv drive switchy --steps '[{"click":"role:button:Context"},{"expect":"css:.assistant-context","text":"Saved terminal activity"},{"shot":"switchy-context"},{"click":"role:button:Context"},{"fill":"label:Message","value":"TEST-Which processes are using CPU?"},{"press":"Enter","target":"label:Message"},{"wait":"text:This is a scripted Switchy answer."},{"expect":"css:.assistant-conversation","inViewport":true}]'
```

### removed-host-scope-falls-back
Viewports: both
A question scoped to a remote host saves that scope. Once the host is removed,
the picker reads "All hosts" and the next question is asked of every host and
answered, not refused as an unknown host scope.

```sh
yv api '{"op":"host.add","name":"TEST-scope-gone","kind":"ssh","destination":"test@scope-gone.invalid"}' --wait '{"op":"hosts","hosts":[{"name":"TEST-scope-gone"}]}' --save scope_host='hosts[name=TEST-scope-gone].id'
yv drive switchy --viewport desktop --steps '[{"expect":"role:heading:Switchy"},{"click":"css:.composer-chips .chip"},{"expect":"css:.chip-popover","inViewport":true},{"click":{"css":".chip-popover .menu-item","hasText":"TEST-scope-gone"}},{"fill":"label:Message","value":"TEST-what runs on the scoped host?"},{"click":"role:button:Send"},{"expect":{"css":".assistant-answer","hasText":"TEST-what runs on the scoped host?"},"text":"This is a scripted Switchy answer."}]'
yv api '{"op":"host.remove","hostId":"{{scope_host}}"}'
yv drive switchy --steps '[{"expect":"role:heading:Switchy"},{"expect":"css:.composer-chips .chip","text":"All hosts"},{"fill":"label:Message","value":"TEST-after the host went away"},{"click":"role:button:Send"},{"expect":{"css":".assistant-answer","hasText":"TEST-after the host went away"},"text":"This is a scripted Switchy answer."},{"expect":"css:.assistant-notice","count":0},{"shot":"scope-after-removal"}]'
```

### answer-names-the-model
Viewports: both
Each answer's label names the model the way the picker does ("Fake Fast"),
not by its id ("fake-fast"). It used to show the id (#194). The picker's
name is read from its `aria-label`: its text also holds the provider badge ("CX").

```sh
yv drive switchy --steps '[{"expect":"role:heading:Switchy"},{"fill":"label:Message","value":"TEST-which model answers?"},{"click":"role:button:Send"},{"expect":{"css":".assistant-answer","hasText":"TEST-which model answers?"},"text":"This is a scripted Switchy answer."},{"eval":"(() => { const label = [...document.querySelectorAll(\".assistant-answer-label .muted\")].at(-1).textContent; const picker = document.querySelector(\".composer .picker > button\").getAttribute(\"aria-label\"); return picker === \"Model \" + label && label === \"Fake Fast\"; })()","equals":true},{"shot":"answer-model-name"}]'
```

### refusal-notice-is-red
Viewports: both
A question yardd refuses (here one over 8,000 bytes) is not sent, and the
reason under the composer is red like every other error, not grey like the
disclaimer below it. (`.assistant-notice` used to override `.bad` with the
muted colour.) The refusal is the point, so the run allows that failed call.

```sh
yv drive switchy --allow-errors --steps '[{"expect":"role:heading:Switchy"},{"eval":"(() => { const box = document.querySelector(\"textarea\"); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, \"value\").set; set.call(box, \"TEST-too long \" + \"x\".repeat(8001)); box.dispatchEvent(new Event(\"input\", { bubbles: true })); return true; })()","equals":true},{"click":"role:button:Send"},{"expect":"css:.assistant-notice","text":"at most 8,000 bytes"},{"eval":"(() => { const probe = document.createElement(\"span\"); probe.className = \"bad\"; document.body.append(probe); const same = getComputedStyle(document.querySelector(\".assistant-notice\")).color === getComputedStyle(probe).color; probe.remove(); return same; })()","equals":true},{"shot":"refusal-notice"}]'
```

### stopped-answer-is-quiet
Viewports: both
Pressing Stop while Switchy answers ends the turn with a quiet grey "Stopped by
you.", like a stopped session turn ("Stopped after 4s"), not with the red alert
a real failure gets (`[fail]`: "the model is unavailable"). The stop used to
render through the error path as `.bad` `role="alert"`.

```sh
yv drive switchy --steps '[{"expect":"role:heading:Switchy"},{"fill":"label:Message","value":"[slow] TEST-stop this answer"},{"click":"role:button:Send"},{"expect":{"css":".assistant-answer","hasText":"TEST-stop this answer","nth":-1},"text":"Answering"},{"click":"role:button:Stop"},{"expect":{"css":".assistant-answer","hasText":"TEST-stop this answer","nth":-1},"text":"Stopped by you."},{"eval":"(() => { const turn = [...document.querySelectorAll(\".assistant-answer\")].at(-1); const line = [...turn.querySelectorAll(\"p\")].find((p) => p.textContent === \"Stopped by you.\"); return !!line && !turn.querySelector(\".bad, [role=alert]\") && line.matches(\".muted\"); })()","equals":true},{"shot":"stopped-answer"}]'
```

### all-hosts-chip-icon
Viewports: both
With the scope on All hosts, the chip under the composer shows the same cloud
icon as the menu's All hosts row, not the laptop of this machine's row. It used
to fall through to the laptop, so the closed chip looked scoped to this machine.

```sh
yv drive switchy --steps '[{"expect":"role:heading:Switchy"},{"expect":"css:.composer-chips .chip","text":"All hosts"},{"eval":"window.__chipIcon = document.querySelector(\".composer-chips .chip svg path\").getAttribute(\"d\"); true","equals":true},{"click":"css:.composer-chips .chip"},{"expect":"css:.chip-popover","inViewport":true},{"eval":"(() => { const rows = [...document.querySelectorAll(\".chip-popover .menu-item\")]; const icon = (text) => rows.find((r) => r.textContent.trim() === text).querySelector(\"svg path\").getAttribute(\"d\"); return window.__chipIcon === icon(\"All hosts\") && window.__chipIcon !== icon(\"iso-host\"); })()","equals":true},{"shot":"all-hosts-chip"}]'
```

### shared-composer
Viewports: both
Switchy uses the session composer: one-line auto-growing input, the same
icon send button, dictation control and model picker.

```sh
yv drive switchy --steps '[{"expect":"css:.composer-row .send svg"},{"expect":"css:.composer-row .mic-btn"},{"expect":"css:.composer-row .model-popover","count":0},{"eval":"document.querySelector(\".composer textarea\").rows","equals":1},{"fill":"css:.composer textarea","value":"TEST-one\nTEST-two\nTEST-three\nTEST-four"},{"eval":"document.querySelector(\".composer textarea\").clientHeight > 60","equals":true},{"shot":"shared-composer"}]'
```

### controls-and-approvals
Viewports: both
The host picker sits below the shared composer; voice, effort and access are
visible. Ask first routes a real approval decision through Switchy.

```sh
yv drive switchy --steps '[{"expect":"css:.composer-chips .chip"},{"expect":"css:.bar .chip","count":0},{"expect":"role:button:Voice mode"},{"click":"css:.composer .permission"},{"click":"role:menuitemradio:Ask first"},{"fill":"label:Message","value":"[cmd] TEST-Switchy approval"},{"click":"role:button:Send"},{"wait":"role:button:Allow once"},{"click":"role:button:Allow once"},{"expect":{"css":".assistant-answer","hasText":"TEST-Switchy approval","nth":-1},"text":"Ran it."},{"shot":"switchy-access"}]'
```

### voice-roundtrip
Viewports: both
The shared speech harness dictates a question, sends after silence, speaks the
answer and returns to listening. No microphone or real model is used.

```sh
yv drive switchy --steps '[{"eval":"(()=>{window.__recs=[];window.__said=[];window.__hush=0;window.__speakMs=300;class R{constructor(){this.results=[];this.running=false;window.__recs.push(this)}start(){this.running=true;window.__live=this}stop(){this.running=false;setTimeout(()=>this.onend&&this.onend(),10)}abort(){this.running=false;setTimeout(()=>this.onend&&this.onend(),0)}}window.__say=(t,f)=>{const r=window.__live;if(!r||!r.running)return \"not listening\";const l=r.results[r.results.length-1];if(l&&!l.isFinal)r.results.pop();const x=[{transcript:t}];x.isFinal=!!f;r.results.push(x);r.onresult&&r.onresult({results:r.results});return \"ok\"};window.SpeechRecognition=R;window.webkitSpeechRecognition=R;window.SpeechSynthesisUtterance=class{constructor(t){this.text=t}};Object.defineProperty(window,\"speechSynthesis\",{configurable:true,value:{speak(u){window.__said.push(u.text);setTimeout(()=>u.onend&&u.onend(),window.__speakMs)},cancel(){window.__hush++}}});return 1})()"},{"fill":"label:Message","value":""},{"click":"role:button:Voice mode"},{"wait":600},{"eval":"window.__say(\"TEST-Switchy voice question\",true)","equals":"ok"},{"wait":2500},{"expect":{"css":".assistant-answer","hasText":"TEST-Switchy voice question"},"text":"This is a scripted Switchy answer."},{"eval":"window.__said.some(t=>t.includes(\"scripted Switchy answer\"))","equals":true},{"click":"role:button:Turn off voice mode"},{"expect":"css:.voice-bar","count":0},{"shot":"switchy-voice"}]'
```

## Gotchas

- Model inference is scripted in this map. Live Claude/Codex output is not proven
  by it. Grok and OpenCode are not exposed until their tool restrictions have a
  supported enforcement path.
- Host collectors are read-only, bounded and timeout-limited. Missing systemctl,
  Docker or ss are unavailable sources, never evidence that no services exist.
- Integration tests cover remote scope, offline coverage, stop, concurrent asks,
  restart persistence, fresh threads, bounded follow-ups and enforced policies.
