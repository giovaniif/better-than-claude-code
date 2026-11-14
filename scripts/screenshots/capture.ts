// Drives the demo hub on :47820 (see run.sh): makes four sessions over the
// WebSocket, adds the "build-box" remote, then screenshots the UI.
import { chromium, type Page } from "playwright";

const [outDir, home, remoteHome] = process.argv.slice(2);
const HUB = "http://127.0.0.1:47820";

const ws = new WebSocket("ws://127.0.0.1:47820/ws");
const log: any[] = [];
ws.onmessage = (e) => log.push(JSON.parse(String(e.data)));
await new Promise((r) => (ws.onopen = r));
const send = (msg: object) => ws.send(JSON.stringify(msg));
async function waitFor(what: string, pred: (m: any) => boolean, ms = 20000): Promise<any> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = log.find(pred);
    if (hit) return hit;
    await Bun.sleep(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function create(input: object): Promise<string> {
  const from = log.length;
  send({ op: "session.create", worktree: true, ...input });
  const created = await waitFor("created", (m) => log.indexOf(m) >= from && (m.op === "created" || m.op === "error"));
  if (created.op === "error") throw new Error(created.message);
  return created.sessionId;
}
const turnDone = (sid: string) =>
  waitFor(`turn of ${sid}`, (m) => m.op === "event" && m.sessionId === sid && m.event?.type === "turn_completed");

// Oldest first: the sidebar lists the newest at the top.
const migration = await create({
  engine: "codex",
  model: "gpt-6.1-terra",
  effort: "medium",
  cwd: `${home}/code/invoices-service`,
  text: "Write the migration that adds a due date to invoices, then run it against the local database.",
});
const rateLimit = await create({
  engine: "claude",
  model: "claude-opus-5-5",
  effort: "high",
  permission: "acceptEdits",
  cwd: `${home}/code/storefront`,
  text: "Add rate limiting to the public API: 120 requests a minute per API key.",
});
await turnDone(rateLimit);
send({ op: "host.add", name: "build-box", kind: "direct", url: "ws://127.0.0.1:47821/ws" });
const hosts = await waitFor("build-box", (m) => m.op === "hosts" && m.hosts?.some((h: any) => h.status === "connected"));
const box = hosts.hosts[0].id;
await waitFor("build-box snapshot", (m) => m.op === "host.snapshot" && m.hostId === box);
await create({
  engine: "codex",
  model: "gpt-6-astra",
  effort: "high",
  host: box,
  cwd: `${remoteHome}/code/pdf-renderer`,
  text: "Profile the PDF export and find what makes it slow for large invoices.",
});
const flaky = await create({
  engine: "codex",
  model: "gpt-6.1-sol",
  effort: "high",
  cwd: `${home}/code/payments-api`,
  text: "The retry test in payments is flaky on CI. Find out why and fix it.",
});
await turnDone(flaky);
ws.close();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(HUB);
await page.evaluate((h) => {
  localStorage.setItem("yard.permission", "ask");
  localStorage.setItem("yard.cwd", `${h}/code/payments-api`);
}, home);
await page.reload();
await page.waitForTimeout(800);

const shot = async (name: string) => {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`${name}.png`);
};
const open = async (p: Page, title: RegExp) => {
  await p.locator(".session-row", { hasText: title }).first().click();
  await p.waitForTimeout(1200);
};

await open(page, /retry test/);
// Start of the conversation: the prompt, the failing run and the fix.
await page.evaluate(() => document.querySelector(".thread .scroll")?.scrollTo({ top: 0 }));
await shot("session");
await open(page, /rate limiting/);
await shot("claude-session");
await open(page, /migration/);
await shot("approval");
await page.locator(".session-row", { hasText: /PDF export/ }).first().click();
await page.waitForTimeout(3500);
await shot("remote-session");

await page.getByRole("button", { name: "New session" }).click();
await page.waitForTimeout(600);
await page.getByLabel("Message").fill("Upgrade the payment provider SDK to v5 and fix what breaks");
await shot("new-session");
await page.locator(".new-chips .chip").nth(1).click();
await shot("folder-picker");
await page.keyboard.press("Escape");
await page.locator(".permission").first().click();
await shot("permission-modes");
await page.keyboard.press("Escape");

await page.locator(".host-row").first().click();
await page.waitForTimeout(1500);
await shot("hosts");
await browser.close();
