// A WebSocket client for an isolated yardd. No Origin header is sent, which
// yardd allows (it only refuses foreign browser origins).

import { matches, sleep } from "./common";
import { fail } from "./out";

export interface Client {
  ready(): Promise<any>;
  send(msg: object): void;
  /** Every message received so far, in order. */
  log: any[];
  waitFor(what: string, pred: (m: any) => boolean, ms?: number, from?: number): Promise<any>;
  waitEvent(sid: string, type: string, ms?: number, from?: number): Promise<any>;
  create(input: Record<string, unknown>): Promise<string>;
  sessions(): Record<string, any>;
  close(): void;
}

export async function connect(port: number): Promise<Client> {
  const log: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let closed = false;
  ws.onmessage = (e) => {
    try {
      log.push(JSON.parse(String(e.data)));
    } catch {
      log.push({ raw: String(e.data) });
    }
  };
  ws.onclose = () => (closed = true);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error(`cannot connect to ws://127.0.0.1:${port}/ws`));
  }).catch((e) => fail("ws-connect", e.message, "verify/yv iso ls"));

  const waitFor = async (what: string, pred: (m: any) => boolean, ms = 20000, from = 0) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      for (let i = from; i < log.length; i++) if (pred(log[i])) return log[i];
      if (closed) fail("ws-closed", `yardd closed the connection while waiting for ${what}`);
      await sleep(25);
    }
    return fail("timeout", `timed out after ${ms} ms waiting for ${what}`, undefined, { last: log.slice(-5) });
  };

  const client: Client = {
    log,
    ready: () => waitFor("snapshot", (m) => m.op === "snapshot", 10000),
    send: (msg) => ws.send(JSON.stringify(msg)),
    waitFor,
    waitEvent: (sid, type, ms = 20000, from = 0) =>
      waitFor(`${type} in ${sid}`, (m) => m.op === "event" && m.sessionId === sid && m.event?.type === type, ms, from),
    async create(input) {
      const from = log.length;
      client.send({ op: "session.create", ...input });
      const m = await waitFor("session.create reply", (x) => x.op === "created" || (x.op === "error" && x.for === "session.create"), 30000, from);
      if (m.op === "error") fail("api-error", `session.create failed: ${m.message}`);
      return m.sessionId;
    },
    sessions() {
      // The newest snapshot, then every later `session` update.
      const out: Record<string, any> = {};
      for (const m of log) {
        if (m.op === "snapshot") for (const s of m.sessions ?? []) out[s.id] = s;
        // A remote host's sessions arrive with `<hostId>~` ids through the hub.
        if (m.op === "host.snapshot") for (const s of m.sessions ?? []) out[s.id] = s;
        if (m.op === "session" && m.session) out[m.session.id] = m.session;
        if (m.op === "session.deleted" && m.sessionId) delete out[m.sessionId];
      }
      return out;
    },
    close: () => ws.close(),
  };
  return client;
}

export { matches };
