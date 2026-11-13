# Switchyard agent guide

One UI for Claude Code and Codex sessions. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything: it holds the decisions and what is already built.

- `crates/yardd`: Rust daemon. Owns agent processes, the event log, terminals, host stats. Serves the UI and a WebSocket.
- `sidecar/yard-claude`: Bun/TypeScript bridge to the Claude Agent SDK, one process per Claude session.
- `ui`: React + Vite. Talks only to yardd over the WebSocket.
- `app/src-tauri`: Tauri window that starts yardd and loads its page.

## Build and run

- Rust is not on `PATH` on this Mac: `export PATH=/opt/homebrew/opt/rustup/bin:$PATH` before any `cargo`.
- `CARGO_BUILD_JOBS=2 cargo build -p yardd`. Keep the job cap: the machine has 8 cores, 16 GB and other work running.
- UI: `cd ui && bun install && bunx vite build`. Sidecar: `cd sidecar/yard-claude && bun install`.
- Use Bun. `pnpm` is broken here. Never run `tsc` in any form.
- Test daemon, from the repo root: `YARD_PORT=<port> ./target/debug/yardd`. It serves `ui/dist` and finds the sidecar relative to the current directory (`YARD_ROOT` overrides).
- `/bin/bash` is 3.2. Put multi-step shell logic in a script file, not a long one-liner.

## Hard rules

- A yardd is usually running on port 47717 with the user's live sessions, started by the desktop app. Never stop it. No `pkill yardd`: kill only the PIDs you started. Never test on port 47717.
- Tests must not write under `~/.yard`. Point any data directory setting at a temp folder.
- Ports 4510-4559 belong to LocalStack. Stay out of them.
- Live agent turns spend the user's subscriptions. Test with Codex on `gpt-5.6-luna`, effort `low`, with tiny prompts. Claude weekly usage is nearly exhausted: no Claude turns unless the task says so.
- Do not push, open pull requests, or touch other repositories.
- yardd binds loopback only and checks the WebSocket `Origin`. Keep both.

## Code

- Message and event shapes live in `ui/src/protocol.ts` and in yardd. Change both together.
- Both engines are normalized to the same events. Add an event type only when no existing one fits.
- Agent output is untrusted: render it as React elements, never as HTML.
- Comments say why, not what. Match the surrounding style. Add a dependency only when it earns its place.

## Verifying

- Compiling is not proof. Drive the feature through the WebSocket with a Bun script (`new WebSocket("ws://127.0.0.1:<port>/ws")`, no `Origin` header is sent, which yardd allows) and check the messages that come back.
- Say plainly what you did not verify.
