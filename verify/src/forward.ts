// A TCP forwarder for `yv preview`: listens on one address (the tailnet IP)
// and passes bytes to an isolated yardd on loopback. It never touches headers,
// so yardd still checks the page's Origin itself (YARD_ALLOW_ORIGIN names the
// preview URL). Exits when the yardd it serves is gone, so it cannot outlive it.
//   bun forward.ts <listen-host> <listen-port> <target-port> <yardd-pid>
import { connect, createServer } from "node:net";

const [host, port, target, pid] = process.argv.slice(2);
if (!host || !port || !target || !pid) {
  console.error("usage: forward.ts <listen-host> <listen-port> <target-port> <yardd-pid>");
  process.exit(2);
}

const server = createServer((client) => {
  const upstream = connect(Number(target), "127.0.0.1");
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close).on("close", close);
  upstream.on("error", close).on("close", close);
  client.pipe(upstream);
  upstream.pipe(client);
});
server.on("error", (e) => {
  console.error(`forward: ${e.message}`);
  process.exit(1);
});
server.listen(Number(port), host, () => console.log(`forward: ${host}:${port} -> 127.0.0.1:${target}`));

setInterval(() => {
  try {
    process.kill(Number(pid), 0);
  } catch {
    console.log(`forward: yardd ${pid} is gone, stopping`);
    process.exit(0);
  }
}, 5000);
