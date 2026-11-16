// The CLI's own tests: the pure parts that decide pass or fail.
// Run with `cd verify && bun test`, or `verify/yv selftest`.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMedia } from "./assets";
import { parseTarget } from "./browser";
import { matches, parseArgs, pick, sha256File } from "./common";
import { addedLines, lint } from "./design";
import { type Bundle, type Proof, verifyBundle } from "./evidence";
import { humanReplies, latestVerdict, AGENT_MARK } from "./gh";
import { recipesDeclaredRemoved, scanFiles, type PrFile } from "./land";
import { parseArea } from "./map";
import { _test as loopTest } from "./loop";

describe("args and json helpers", () => {
  test("flags, bools and positionals", () => {
    const a = parseArgs(["run", "x", "--iso", "n", "--all", "--k=v", "--", "--raw"], ["all"]);
    expect(a.pos).toEqual(["run", "x", "--raw"]);
    expect(a.flags).toEqual({ iso: "n", all: true, k: "v" });
  });
  test("pick walks paths and filters arrays", () => {
    const v = { sessions: [{ id: "a", title: "one" }, { id: "b", title: "TEST-two" }] };
    expect(pick(v, "sessions.1.id")).toBe("b");
    expect(pick(v, "sessions[title*=two].id")).toBe("b");
    expect(pick(v, "sessions[title=one].id")).toBe("a");
    expect(pick(v, "sessions[title^=TEST].id")).toBe("b");
    expect(pick(v, "nope.x")).toBeUndefined();
  });
  test("matches is partial, arrays need each wanted element, ~ is substring", () => {
    const got = { op: "hosts", hosts: [{ name: "a", status: "error" }, { name: "b", status: "connected" }] };
    expect(matches(got, { op: "hosts", hosts: [{ name: "b", status: "connected" }] })).toBe(true);
    expect(matches(got, { hosts: [{ name: "a", status: "connected" }] })).toBe(false);
    expect(matches({ branch: "yard/x-12" }, { branch: "~yard/" })).toBe(true);
    expect(matches({ n: 1 }, { n: "1" })).toBe(false);
  });
  test("targets parse from the short form", () => {
    expect(parseTarget("role:button:New session")).toEqual({ role: "button", name: "New session" });
    expect(parseTarget("label:Message")).toEqual({ label: "Message" });
    expect(parseTarget("css:.a:b")).toEqual({ css: ".a:b" });
    expect(parseTarget("plain words")).toEqual({ text: "plain words" });
  });
});

describe("feature map parsing", () => {
  const md = `# Area title

What must be true.

## Setup

\`\`\`sh
yv iso up
\`\`\`

## Cleanup

\`\`\`sh
yv iso down
\`\`\`

## Recipes

### first
Needs: REAL_THING
Viewports: desktop
\`\`\`sh
yv shot new
\`\`\`

### second (manual: needs a phone)
Prose only.

## Gotchas
- one trap
`;
  test("sections, recipes, manual and needs", () => {
    const a = parseArea("x", md);
    expect(a.title).toBe("Area title");
    expect(a.setup[0].code).toBe("yv iso up");
    expect(a.cleanup[0].code).toBe("yv iso down");
    expect(a.recipes.map((r) => r.label)).toEqual(["first", "second"]);
    expect(a.recipes[0].needs).toEqual(["REAL_THING"]);
    expect(a.recipes[0].viewports).toBe("desktop");
    expect(a.recipes[1].manual).toBe("needs a phone");
    expect(a.gotchas).toEqual(["one trap"]);
  });
});

const file = (filename: string, patch: string, extra: Partial<PrFile> = {}): PrFile => ({
  filename,
  status: "modified",
  patch,
  additions: patch.split("\n").filter((l) => l.startsWith("+")).length,
  deletions: patch.split("\n").filter((l) => l.startsWith("-")).length,
  ...extra,
});
const codes = (files: PrFile[]) => scanFiles(files).blockers.map((b) => b.code);

describe("land gate scan", () => {
  test("a small UI fix has no blockers", () => {
    const r = scanFiles([file("ui/src/App.tsx", "@@ -1 +1 @@\n-a\n+b")]);
    expect(r.blockers).toEqual([]);
    expect(r.category).toBe("ui-fix-small");
  });
  test("destructive SQL split across lines still counts", () => {
    expect(codes([file("crates/yardd/src/state.rs", '@@\n+conn.execute("DELETE\n+    FROM sessions WHERE 1")')])).toContain("destructive-sql");
    expect(codes([file("crates/yardd/src/x.rs", '@@\n+"ALTER TABLE events\n+ RENAME COLUMN a TO b"')])).toContain("destructive-sql");
    expect(codes([file("crates/yardd/src/x.rs", '@@\n+"DROP TABLE x"')])).toContain("destructive-sql");
  });
  test("the schema file, installers and signing are irreversible", () => {
    expect(codes([file("crates/yardd/src/store.rs", "@@\n+// c")])).toContain("irreversible");
    expect(codes([file("scripts/remote-install.sh", "@@\n+echo")])).toContain("irreversible");
    expect(codes([file("Dockerfile", "@@\n+RUN x")])).toContain("irreversible");
    expect(codes([file(".env.local", "@@\n+A=1")])).toContain("irreversible");
  });
  test("CI, the gate, skills and the fakes are self-or-CI; the feature map is not", () => {
    expect(codes([file(".github/workflows/ci.yml", "@@\n+x")])).toContain("self-or-ci");
    expect(codes([file("verify/src/land.ts", "@@\n+x")])).toContain("self-or-ci");
    expect(codes([file(".claude/skills/verify/SKILL.md", "@@\n+x")])).toContain("self-or-ci");
    expect(codes([file("crates/yardd/tests/fake-codex/codex", "@@\n+x")])).toContain("self-or-ci");
    expect(codes([file("CLAUDE.md", "@@\n+x")])).toContain("self-or-ci");
    expect(codes([file("verify/features/thread.md", "@@\n+- a gotcha")])).toEqual([]);
  });
  test("renames count by their old path too", () => {
    expect(codes([file("docs/ci.yml", "", { status: "renamed", previous_filename: ".github/workflows/ci.yml", additions: 0, deletions: 0 })])).toContain("self-or-ci");
  });
  test("a file without a patch fails closed", () => {
    expect(codes([{ filename: "ui/public/x.png", status: "added", additions: 0, deletions: 0 }])).toContain("unscanned-file");
    expect(codes([{ filename: "ui/src/old.ts", status: "removed", additions: 0, deletions: 3 }])).toEqual([]);
  });
  test("a PR can declare the recipes it removes", () => {
    const body = "## What changed\nx\n\n## Recipes removed\n\n- `stop-holds-the-queue`: Stop now returns the queue (replaced by stop-returns-the-queue).\n\n## Test plan\n- `not-this`";
    expect(recipesDeclaredRemoved(body)).toEqual(["stop-holds-the-queue"]);
    expect(recipesDeclaredRemoved("## What changed\n- `x`")).toEqual([]);
  });
  test("removing a recipe is a blocker", () => {
    expect(codes([file("verify/features/thread.md", "@@\n-### reply-renders\n-x")])).toContain("recipe-removed");
    expect(codes([file("verify/features/thread.md", "@@\n-### reply-renders\n+### reply-renders\n+more")])).toEqual([]);
  });
  test("test code cleaning up after itself is not data loss", () => {
    expect(codes([file("crates/yardd/src/claude.rs", "@@\n+fn run() {}\n+#[cfg(test)]\n+mod tests {\n+    fn t() { let _ = std::fs::remove_dir_all(dir); }\n+}")])).toEqual([]);
    expect(codes([file("crates/yardd/tests/daemon.rs", "@@\n+    std::fs::remove_dir_all(&root).ok();")])).toEqual([]);
    expect(codes([file("crates/yardd/src/git.rs", "@@\n+    std::fs::remove_dir_all(&p)?;\n+#[cfg(test)]\n+mod tests {}")])).toContain("data-loss");
    // A test added to an existing module: git names the module in the hunk header.
    expect(codes([file("crates/yardd/src/git.rs", "@@ -408,6 +452,9 @@ mod tests {\n     }\n+    #[tokio::test]\n+    async fn t() { let _ = std::fs::remove_dir_all(&dir); }\n }")])).toEqual([]);
    // The module ends at its closing brace: code after it in the same hunk is real code.
    expect(codes([file("crates/yardd/src/git.rs", "@@ -408,6 +452,9 @@ mod tests {\n     fn t() {}\n }\n \n+pub fn wipe(p: &Path) { let _ = std::fs::remove_dir_all(p); }")])).toContain("data-loss");
    expect(codes([file("crates/yardd/src/git.rs", "@@ -1,3 +1,4 @@ pub async fn changes(cwd: &str) -> Result<Value> {\n+    std::fs::remove_dir_all(&p)?;")])).toContain("data-loss");
  });
  test("security boundary, data loss and secrets", () => {
    expect(codes([file("crates/yardd/src/ws.rs", '@@\n-    if origin_ok(&o) {\n+    if true || origin_ok(&o) { // Origin')])).toContain("security-boundary");
    expect(codes([file("crates/yardd/src/git.rs", '@@\n+    std::fs::remove_dir_all(&p)?;')])).toContain("data-loss");
    expect(codes([file("ui/src/x.ts", "@@\n+const t = 'ghp_" + "a".repeat(36) + "'")])).toContain("secret");
  });
  test("a fix with its recipe keeps its category", () => {
    expect(scanFiles([file("ui/src/TerminalPane.tsx", "@@\n+x"), file("verify/features/terminal.md", "@@\n+- gotcha")]).category).toBe("ui-fix-small");
    expect(scanFiles([file("verify/features/terminal.md", "@@\n+- gotcha")]).category).toBe("feature-map");
  });
  test("docs-only is its own category", () => {
    expect(scanFiles([file("docs/web.md", "@@\n+x")]).category).toBe("docs");
  });
});

describe("verdicts and human replies", () => {
  const sha = "a".repeat(40);
  test("the newest verdict wins", () => {
    const v = latestVerdict([
      { body: `<!-- land:verdict v=1 sha=${sha} verdict=FAIL -->`, url: "1" },
      { body: `<!-- land:verdict v=1 sha=${sha} verdict=PASS+NOTES -->`, url: "2" },
    ]);
    expect(v).toMatchObject({ sha, verdict: "PASS+NOTES", url: "2" });
  });
  test("agent comments are not human replies; merge and no are recognised", () => {
    const r = humanReplies(
      [
        { author: { login: "me" }, body: `progress ${AGENT_MARK}` },
        { author: { login: "me" }, body: "merge" },
        { author: { login: "me" }, body: "no, this is on purpose" },
        { author: { login: "someone" }, body: "merge" },
      ],
      "me",
    );
    expect(r.map((x) => [x.merge, x.no])).toEqual([
      [true, false],
      [false, true],
    ]);
  });
});

describe("design check", () => {
  const diff = `diff --git a/ui/src/styles.css b/ui/src/styles.css
+++ b/ui/src/styles.css
@@ -3,0 +4,1 @@
+  --new: #123456;
@@ -40,0 +42,3 @@
+.x { color: #ff0000; }
+.y { font-size: 17px; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
+.z { color: var(--ink); }
+++ b/ui/src/App.tsx
@@ -10,0 +11,3 @@
+      <div dangerouslySetInnerHTML={{ __html: text }} />
+      <button onClick={go}>Go</button>
+      <div style={{ marginTop: 12 }} />`;
  const added = addedLines(diff, new Map([["ui/src/styles.css", [[1, 10]] as [number, number][]]]));
  const f = lint(added, new Set(["12px", "13px"]));
  const rules = f.map((x) => `${x.rule}@${x.line}`);
  test("tokens inside :root are fine, colours elsewhere are not", () => {
    expect(rules).not.toContain("hardcoded-color@4");
    expect(rules).toContain("hardcoded-color@42");
  });
  test("shadows warn, off-scale font sizes warn", () => {
    expect(rules).toContain("shadow-color@43");
    expect(rules).toContain("font-size-off-scale@43");
  });
  test("a button whose className is on the next line is not raw", () => {
    const multi = addedLines(`+++ b/ui/src/A.tsx\n@@ -1,0 +1,3 @@\n+    <button\n+      className={\`btn quote-reply\${x}\`}\n+    >`);
    expect(lint(multi, new Set()).map((x) => x.rule)).not.toContain("raw-button");
  });
  test("raw HTML is an error; raw buttons and inline numbers are caught", () => {
    expect(f.find((x) => x.rule === "raw-html")?.severity).toBe("error");
    expect(rules).toContain("raw-button@12");
    expect(rules).toContain("inline-style-number@13");
  });
});

describe("media check", () => {
  test("screenshots in docs are fine, others are not", () => {
    const bad = checkMedia([
      { status: "A", path: "docs/screenshots/a.png" },
      { status: "A", path: "after.png" },
      { status: "D", path: "old.png" },
      { status: "M", path: "ui/public/favicon.png" },
    ]);
    expect(bad.map((b) => b.path)).toEqual(["after.png"]);
  });
});

describe("evidence proof bar", () => {
  const dir = mkdtempSync(join(tmpdir(), "yv-test-"));
  const art = join(dir, "p1-shot.png");
  writeFileSync(art, "png");
  const A = { path: "p1-shot.png", sha256: sha256File(art) };
  const base = "b".repeat(40);
  const head = "c".repeat(40);
  const P = (p: Partial<Proof>): Proof => ({ id: 1, ref: "head", kind: "fix", at: head, dirty: false, viewports: [], artifacts: [A], addedAt: "", ...p });
  const bundle = (proofs: Proof[], ui = true): Bundle => ({ v: 1, claim: "a claim long enough to pass", repo: dir, base, head, changed: [], ui, createdAt: "", proofs });
  const full = [
    P({ ref: "base", kind: "repro", at: base, viewports: ["mobile", "desktop"], failedApi: ["pr: boom"] }),
    P({ kind: "fix", viewports: ["mobile", "desktop"], failedApi: ["pr: boom"] }),
    P({ kind: "test", exit: 0 }),
    P({ ref: "base", kind: "test", at: base, exit: 1 }),
    P({ kind: "design", exit: 0 }),
  ];
  const failed = (b: Bundle, h: string | null = head) =>
    verifyBundle(dir, b, h)
      .filter((c) => !c.ok)
      .map((c) => c.rule);
  test("a complete bundle passes", () => {
    expect(failed(bundle(full))).toEqual([]);
  });
  test("a UI fix needs both viewports", () => {
    const b = bundle(full.map((p) => (p.kind === "fix" ? { ...p, viewports: ["desktop"] } : p)));
    expect(failed(b)).toEqual(["head-fix"]);
    expect(failed({ ...b, ui: false, proofs: b.proofs.filter((p) => p.kind !== "design") })).toEqual([]);
  });
  test("notes stand in for a repro and a failing test", () => {
    const b = bundle([...full.filter((p) => p.ref === "head").map((p) => ({ ...p, failedApi: [] })), P({ ref: "base", kind: "note", text: "no-repro: needs real Claude", artifacts: [] }), P({ ref: "base", kind: "note", text: "no-failing-test: layout only", artifacts: [] })]);
    expect(failed(b)).toEqual([]);
  });
  test("new API failures on head fail; ones base shares do not", () => {
    const b = bundle(full.map((p) => (p.kind === "fix" ? { ...p, failedApi: ["pr: boom", "changes: new"] } : p)));
    expect(failed(b)).toEqual(["api-failures"]);
  });
  test("a test that passed on base proves nothing", () => {
    const b = bundle(full.map((p) => (p.ref === "base" && p.kind === "test" ? { ...p, exit: 0 } : p)));
    expect(failed(b)).toEqual(["failing-test-first"]);
  });
  test("a head-only failing recipe is a regression", () => {
    const b = bundle([...full, P({ kind: "regression", failingRecipes: ["thread/x", "layout/y"] }), P({ ref: "base", kind: "regression", at: base, failingRecipes: ["layout/y"] })]);
    expect(failed(b)).toEqual(["regressions"]);
  });
  test("an edited artifact and a moved checkout fail", () => {
    const other = join(dir, "p9-x.txt");
    writeFileSync(other, "one");
    const b = bundle([...full, P({ kind: "note", text: "x", artifacts: [{ path: "p9-x.txt", sha256: sha256File(other) }] })]);
    writeFileSync(other, "two");
    expect(failed(b, "d".repeat(40))).toEqual(["artifacts", "checkout"]);
  });
  test("UI change without a design check fails", () => {
    expect(failed(bundle(full.filter((p) => p.kind !== "design")))).toEqual(["design-check"]);
  });
});

describe("loop budget", () => {
  const cfg = { budget: { claude: { fiveHourMax: 70, sevenDayMax: 80 }, maxLoadPerCore: 1e9 } };
  const now = Date.now() / 1000;
  test("a current 5-hour figure over the cap skips the run", () => {
    expect(loopTest.skipReason("patrol", "claude", [], { claude: { fiveHour: 0.9, sevenDay: 0.1, resetsAt: now + 600 } }, cfg, false)).toContain("5-hour");
  });
  test("a 5-hour figure whose window already reset is ignored", () => {
    expect(loopTest.skipReason("patrol", "claude", [], { claude: { fiveHour: 0.9, sevenDay: 0.1, resetsAt: now - 600 } }, cfg, false)).toBeNull();
  });
  test("verifier runs ignore the usage cap", () => {
    expect(loopTest.skipReason("verify", "claude", [], { claude: { fiveHour: 0.99, sevenDay: 0.99, resetsAt: now + 600 } }, cfg, false)).toBeNull();
  });
  test("the weekly cap still applies", () => {
    expect(loopTest.skipReason("patrol", "claude", [], { claude: { fiveHour: 0.1, sevenDay: 0.95, resetsAt: now - 600 } }, cfg, false)).toContain("weekly");
  });
});

