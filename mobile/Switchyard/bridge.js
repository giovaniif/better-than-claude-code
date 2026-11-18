// Adapt Apple's recognizer to the same voice state machine used by the web UI.
(() => {
  const post = (body) => window.webkit.messageHandlers.switchyard.postMessage(body);
  // Existing hosts predate the explicit UI handshake. Observe their own hub
  // snapshot so installing the phone app does not require updating the host.
  const Socket = window.WebSocket;
  window.WebSocket = class extends Socket {
    constructor(...args) {
      super(...args);
      const url = new URL(this.url);
      if (url.protocol !== "wss:" || url.pathname !== "/ws") return;
      url.protocol = "https:";
      if (url.origin !== window.location.origin) return;
      this.addEventListener("message", (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message?.op === "snapshot" && Array.isArray(message.sessions)) post({ op: "connected" });
        } catch { /* Ignore non-protocol frames as the host UI does. */ }
      });
    }
  };
  let next = 0;
  const recognitions = new Map();
  const utterances = new Map();
  const permissions = new Map();
  class Recognition {
    continuous = true;
    interimResults = true;
    lang = "";
    start() {
      if (this.id) throw new Error("Recognition already started");
      this.id = ++next;
      recognitions.set(this.id, this);
      post({ op: "listen", id: this.id, lang: this.lang || navigator.language });
    }
    stop() { if (this.id) post({ op: "stop", id: this.id }); }
    abort() { if (this.id) post({ op: "abort", id: this.id }); }
  }
  class Utterance {
    constructor(text) { this.text = text; this.lang = navigator.language; this.rate = 1; }
  }
  const synth = {
    speak(u) {
      const id = ++next;
      utterances.set(id, u);
      post({ op: "speak", id, text: u.text, lang: u.lang, rate: u.rate });
    },
    cancel() {
      utterances.clear();
      post({ op: "hush" });
    },
    getVoices() { return []; },
  };
  window.SpeechRecognition = Recognition;
  window.SpeechSynthesisUtterance = Utterance;
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SwitchyardMobile = Object.freeze({
    version: 1,
    connected() { post({ op: "connected" }); },
    requestNotifications() {
      return new Promise((resolve) => {
        const id = ++next;
        permissions.set(id, resolve);
        post({ op: "notification-permission", id });
      });
    },
    notify(note) { post({ op: "notify", note }); },
    receive(event) {
      if (event.type === "notification-permission") {
        permissions.get(event.id)?.(!!event.granted);
        permissions.delete(event.id);
        return;
      }
      if (event.type === "notification-open") {
        window.dispatchEvent(new CustomEvent("yard:notification", { detail: event.note }));
        return;
      }
      const r = recognitions.get(event.id);
      if (r) {
        if (event.type === "result") {
          const result = Object.assign([{ transcript: event.text, confidence: 1 }], { isFinal: !!event.final });
          r.onresult?.({ resultIndex: 0, results: [result] });
        } else if (event.type === "error") r.onerror?.({ error: event.error });
        else if (event.type === "end") {
          recognitions.delete(event.id);
          r.id = null;
          r.onend?.();
        }
        return;
      }
      const u = utterances.get(event.id);
      if (!u) return;
      if (event.type === "spoken" || event.type === "speech-error") {
        utterances.delete(event.id);
        if (event.type === "spoken") u.onend?.();
        else u.onerror?.({ error: event.error });
      }
    },
  });
})();
