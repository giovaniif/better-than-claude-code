// For the fake engines: a JSON-RPC client to verify/fakes/mcp-chart, the MCP
// server with a chart widget, started on first use. Lets the fakes report the
// same tools, widget HTML and results a real engine would get from it.

const SERVER = new URL("../../../../verify/fakes/mcp-chart", import.meta.url).pathname;

let child = null;
let next = 1;
const pending = new Map();

function start() {
  child = Bun.spawn([SERVER], { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
  (async () => {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of child.stdout) {
      buf += dec.decode(chunk);
      let n;
      while ((n = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(n + 1);
        try {
          const msg = JSON.parse(line);
          const p = pending.get(msg.id);
          if (!p) continue;
          pending.delete(msg.id);
          msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
        } catch {}
      }
    }
  })();
}

export function rpc(method, params = {}) {
  if (!child) start();
  return new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    child.stdin.flush();
  });
}

export const CHART_URI = "ui://chart/view.html";

/** What a `[chart]` turn's tool call returns, with the widget it declares. */
export async function chartCall(args) {
  const result = await rpc("tools/call", { name: "show_chart", arguments: args });
  const read = await rpc("resources/read", { uri: CHART_URI });
  const content = read.contents[0];
  return { result, html: content.text, ui: content._meta?.ui ?? {} };
}
