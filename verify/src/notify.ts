// `notify`: a push to the owner's phone through the homelab's ntfy topic.
// GitHub never notifies you of your own comments, and agents post as the
// owner, so a PR comment alone reaches nobody.

import { existsSync, readFileSync } from "node:fs";
import { type Args, run, str } from "./common";
import { fail, Usage, type Result } from "./out";

function topic(): string | null {
  if (process.env.YV_NTFY_TOPIC) return process.env.YV_NTFY_TOPIC;
  // /etc/homelab-notify.env is root-only; passwordless sudo reads it.
  const r = existsSync("/etc/homelab-notify.env") ? run(["sudo", "-n", "cat", "/etc/homelab-notify.env"]) : null;
  const text = r && r.code === 0 ? r.out : existsSync("/etc/homelab-notify.env") ? "" : "";
  return text.match(/^NTFY_TOPIC=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "") || null;
}

export async function notify(message: string, opts: { title?: string; priority?: number; click?: string } = {}): Promise<{ sent: boolean; why?: string }> {
  // The owner found the ntfy pushes annoying (2026-11-15): they stay off
  // until OS notifications through Switchyard replace them.
  if (!process.env.YV_NTFY) return { sent: false, why: "ntfy is off; OS notifications through Switchyard replace it" };
  if (process.env.YV_NO_NOTIFY) return { sent: false, why: "YV_NO_NOTIFY is set" };
  const t = topic();
  if (!t) return { sent: false, why: "no ntfy topic (YV_NTFY_TOPIC or /etc/homelab-notify.env)" };
  const headers: Record<string, string> = { Title: opts.title ?? "Switchyard agents", Priority: String(opts.priority ?? 3), Tags: "robot" };
  if (opts.click) headers.Click = opts.click;
  const r = await fetch(`https://ntfy.sh/${t}`, { method: "POST", body: message, headers, signal: AbortSignal.timeout(10000) }).catch((e) => ({ ok: false, status: String(e) }) as any);
  return r.ok ? { sent: true } : { sent: false, why: `ntfy answered ${r.status}` };
}

export async function notifyCmd(a: Args): Promise<Result> {
  const msg = a.pos.join(" ").trim();
  if (!msg) throw new Usage('notify "<message>" [--title t] [--priority 1-5] [--click url]');
  const r = await notify(msg, { title: str(a, "title"), priority: Number(str(a, "priority", "3")), click: str(a, "click") });
  return { ok: true, sent: r.sent, why: r.why, hint: r.sent ? undefined : "nobody was pinged: say it in the PR or the session instead" };
}

export const _test = { readFileSync };
