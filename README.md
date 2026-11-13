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

`YARD_PORT` changes the port. Sessions are saved in `~/.yard/yard.db` (`YARD_DATA_DIR` moves it) and survive a restart.

Limits, all optional: `YARD_SESSION_MEM_CAP_GB` (default 8, `0` off) stops a session whose processes use more; `YARD_MIN_FREE_GB` (default 2) is the free memory below which new sessions queue.

## Desktop app

```bash
(cd app && bun install && bun run build)
open target/debug/bundle/macos/Switchyard.app
```

The app starts yardd if it is not running and opens a window on its UI. Closing the app leaves yardd and its sessions running; `pkill -x yardd` stops them. yardd logs to `~/.yard/yardd.log` when the app starts it.

This is a personal build. The app finds yardd, the UI and the Claude sidecar in the repo it was compiled from, so it only works on this machine and needs `cargo build -p yardd` and the UI build first.

`bun run icon` in `app` redraws the icon set.

## Remote host

Sessions can run on another machine, such as a Linux box on your Tailscale network. The same yardd runs there; the yardd on your Mac reaches it through an SSH tunnel it starts itself. The remote yardd stays on loopback, so nothing new is exposed.

1. On the box, install `codex`, `claude`, Bun, Rust and git, clone this repo, and build:

   ```bash
   (cd sidecar/yard-claude && bun install)
   (cd ui && bun install && bunx vite build)
   cargo build --release -p yardd
   ```

2. Keep yardd running with a systemd user unit, `~/.config/systemd/user/yardd.service`:

   ```ini
   [Unit]
   Description=Switchyard daemon

   [Service]
   WorkingDirectory=%h/switchyard
   ExecStart=%h/switchyard/target/release/yardd
   Environment=PATH=%h/.local/bin:%h/.bun/bin:%h/.cargo/bin:/usr/local/bin:/usr/bin:/bin
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```

   Then `systemctl --user enable --now yardd` and `loginctl enable-linger $USER`, so it keeps running when you are logged out. Adjust the paths to where you cloned the repo and where `codex`, `claude` and `bun` live.

3. Log the engines in without a browser: `claude setup-token` and `codex login --device-auth`.

4. Make `ssh <destination>` work from your Mac with no prompt: Tailscale SSH (`tailscale up --ssh` on the box) or a key in `~/.ssh/authorized_keys`. Check with `ssh -o BatchMode=yes <destination> true`. Accept the host key once by hand first.

5. In Switchyard, open Hosts, fill in Add host (name, SSH destination such as `devbox` or `user@100.x.y.z`, remote port `47717`), and add it. Its sessions appear in the sidebar with a cloud icon, and the new-session page lets you pick where a session runs.

Hosts are saved in `hosts.json` in yardd's data folder (`~/.yard`).
