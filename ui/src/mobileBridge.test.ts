import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function bridge() {
  const sent: any[] = [];
  class Socket {
    listeners: ((event: any) => void)[] = [];
    constructor(public url: string) {}
    addEventListener(type: string, listener: (event: any) => void) { if (type === "message") this.listeners.push(listener); }
    message(data: string) { for (const listener of this.listeners) listener({ data }); }
  }
  const window: any = { WebSocket: Socket, location: { origin: "https://yard.test" }, webkit: { messageHandlers: { switchyard: { postMessage: (m: any) => sent.push(m) } } }, dispatchEvent() {} };
  runInNewContext(readFileSync(new URL("../../mobile/Switchyard/bridge.js", import.meta.url), "utf8"), { window, URL, navigator: { language: "en-US" }, CustomEvent: class {} });
  return { window, sent, receive: window.SwitchyardMobile.receive };
}

test("older hosts acknowledge a real hub snapshot without needing updated host JavaScript", () => {
  const { window, sent } = bridge();
  for (const url of ["wss://other.test/ws", "wss://yard.test:444/ws", "wss://yard.test/terminal", "ws://yard.test/ws"]) {
    new window.WebSocket(url).message(JSON.stringify({ op: "snapshot", sessions: [] }));
  }
  const socket = new window.WebSocket("wss://yard.test/ws");
  for (const data of ["bad json", "null", JSON.stringify({ op: "host.snapshot", sessions: [] }), JSON.stringify({ op: "snapshot" })]) socket.message(data);
  expect(sent).toEqual([]);
  socket.message(JSON.stringify({ op: "snapshot", sessions: [] }));
  expect(sent).toEqual([{ op: "connected" }]);
});

test("native recognition gives the shared voice hook interim and final results and isolates generations", () => {
  const { window, sent, receive } = bridge();
  const r = new window.SpeechRecognition();
  const results: any[] = [];
  let ended = 0;
  let error = "";
  r.onresult = (e: any) => results.push(e.results[0]);
  r.onend = () => ended++;
  r.onerror = (e: any) => error = e.error;
  r.start();
  const id = sent[0].id;
  expect(sent[0].lang).toBe("en-US");
  receive({ id, type: "result", text: "hello", final: false });
  receive({ id, type: "result", text: "hello world", final: true });
  expect(results.map((v) => [v[0].transcript, v.isFinal])).toEqual([["hello", false], ["hello world", true]]);
  r.stop();
  expect(sent[1].op).toBe("stop");
  receive({ id, type: "end" });
  r.start();
  receive({ id, type: "error", error: "network" });
  expect(error).toBe("");
  expect(ended).toBe(1);
  receive({ id: sent[2].id, type: "error", error: "not-allowed" });
  expect(error).toBe("not-allowed");
});

test("native speech completion is matched to its utterance and cancel drops stale callbacks", () => {
  const { window, sent, receive } = bridge();
  let done = 0;
  for (const text of ["first", "second"]) {
    const u = new window.SpeechSynthesisUtterance(text);
    u.onend = () => done++;
    window.speechSynthesis.speak(u);
  }
  receive({ id: sent[0].id, type: "spoken" });
  expect(done).toBe(1);
  window.speechSynthesis.cancel();
  receive({ id: sent[1].id, type: "spoken" });
  expect(done).toBe(1);
  expect(sent[2].op).toBe("hush");
});

test("native notification permissions resolve only for their request", async () => {
  const { window, sent, receive } = bridge();
  const allowed = window.SwitchyardMobile.requestNotifications();
  receive({ id: sent[0].id, type: "notification-permission", granted: true });
  expect(await allowed).toBe(true);
  window.SwitchyardMobile.connected();
  expect(sent[1].op).toBe("connected");
});
