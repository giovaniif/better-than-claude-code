import { afterEach, describe, expect, test } from "bun:test";
import { notify } from "./notify";

// A stand-in for yardd's `notify` op: answers with whatever the test says.
function fakeYardd(reply: (msg: any) => object) {
  const got: any[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: (req, s) => (s.upgrade(req) ? undefined : new Response("no")),
    websocket: {
      message(ws, data) {
        const msg = JSON.parse(String(data));
        got.push(msg);
        ws.send(JSON.stringify(reply(msg)));
      },
    },
  });
  process.env.YV_NOTIFY_PORT = String(server.port);
  return { got, server };
}

let open: { server: { stop(): void } } | null = null;
afterEach(() => {
  open?.server.stop();
  open = null;
  delete process.env.YV_NOTIFY_PORT;
});

describe("notify", () => {
  test("sends the op and succeeds when a window showed it", async () => {
    open = fakeYardd(() => ({ op: "notify.sent", windows: 2 }));
    const r = await notify("#7 needs you", { title: "T", click: "https://github.com/o/r/pull/7" });
    expect(r.sent).toBe(true);
    expect((open as any).got[0]).toEqual({ op: "notify", title: "T", body: "#7 needs you", url: "https://github.com/o/r/pull/7" });
  });
  test("says so when no window is open", async () => {
    open = fakeYardd(() => ({ op: "notify.sent", windows: 1 }));
    const r = await notify("x");
    expect(r.sent).toBe(false);
    expect(r.why).toMatch(/no Switchyard window/);
  });
  test("an older yardd is reported plainly, with no fallback", async () => {
    open = fakeYardd(() => ({ op: "error", for: "notify", message: "unknown op `notify`" }));
    const r = await notify("x");
    expect(r.sent).toBe(false);
    expect(r.why).toMatch(/too old/);
  });
  test("a yardd that is not running", async () => {
    process.env.YV_NOTIFY_PORT = "1";
    const r = await notify("x");
    expect(r.sent).toBe(false);
    expect(r.why).toMatch(/cannot reach/);
  });
});
