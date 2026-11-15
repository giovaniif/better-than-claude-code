// `notify`: reach the owner through Switchyard itself. The live yardd gets a
// `notify` op and every connected window (the Mac app, the web page) shows it
// as an OS notification. GitHub never notifies you of your own comments, and
// agents post as the owner, so a PR comment alone reaches nobody.
//
// This is the one op allowed on the live daemon (port 47717). No Origin header
// is sent, which yardd allows for non-browser local clients.

import { type Args, str } from "./common";
import { fail, Usage, type Result } from "./out";

const livePort = () => Number(process.env.YV_NOTIFY_PORT || 47717);

export async function notify(message: string, opts: { title?: string; priority?: number; click?: string } = {}): Promise<{ sent: boolean; why?: string }> {
  if (process.env.YV_NO_NOTIFY) return { sent: false, why: "YV_NO_NOTIFY is set" };
  const note: Record<string, unknown> = { op: "notify", title: opts.title ?? "Switchyard agents", body: message };
  if (opts.click && /^https?:\/\//.test(opts.click)) note.url = opts.click;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { sent: boolean; why?: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(r);
    };
    const ws = new WebSocket(`ws://127.0.0.1:${livePort()}/ws`);
    const timer = setTimeout(() => finish({ sent: false, why: "yardd did not answer in 8 s" }), 8000);
    ws.onerror = () => finish({ sent: false, why: `cannot reach yardd on port ${livePort()}` });
    ws.onopen = () => ws.send(JSON.stringify(note));
    ws.onmessage = (e) => {
      let m: any;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (m.op === "notify.sent") {
        // The count includes this connection.
        return finish(m.windows > 1 ? { sent: true } : { sent: false, why: "yardd got it, but no Switchyard window is open to show it" });
      }
      if (m.op === "error" && m.for === "notify") {
        const unknown = /unknown op/.test(String(m.message));
        finish({ sent: false, why: unknown ? "this yardd is too old to know `notify`: update Switchyard on the server (nothing was sent)" : `yardd refused it: ${m.message}` });
      }
    };
  });
}

export async function notifyCmd(a: Args): Promise<Result> {
  const msg = a.pos.join(" ").trim();
  if (!msg) throw new Usage('notify "<message>" [--title t] [--click url]');
  const r = await notify(msg, { title: str(a, "title"), click: str(a, "click") });
  if (!r.sent) fail("not-sent", r.why ?? "not sent");
  return { ok: true, sent: true };
}
