# Switchyard

One UI for Claude Code and Codex sessions on my own subscriptions. Design and decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

Needs `codex` and `claude` installed and logged in, plus Bun and Rust. Run from the repo root.

```bash
(cd sidecar/yard-claude && bun install)
(cd ui && bun install && bunx vite build)
cargo run -p yardd
```

Then open http://127.0.0.1:47717.

`YARD_PORT` changes the port. Sessions live in memory: restarting yardd drops them.

## Desktop app

```bash
(cd app && bun install && bun run build)
open target/debug/bundle/macos/Switchyard.app
```

The app starts yardd if it is not running and opens a window on its UI. Closing the app leaves yardd and its sessions running; `pkill -x yardd` stops them. yardd logs to `~/.yard/yardd.log` when the app starts it.

This is a personal build. The app finds yardd, the UI and the Claude sidecar in the repo it was compiled from, so it only works on this machine and needs `cargo build -p yardd` and the UI build first.

`bun run icon` in `app` redraws the icon set.
