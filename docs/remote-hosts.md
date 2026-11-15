# Remote hosts

Sessions can run on another machine, such as a Linux server on your Tailscale network, and show up in the same sidebar with a cloud icon. The machine runs its own yardd on `127.0.0.1:47717`. The yardd on your Mac reaches it through an `ssh -N -L` tunnel it starts and restarts itself, so nothing new listens on the network.

## From the app (recommended)

1. Make `ssh <destination>` work from your Mac without a prompt: a key in `~/.ssh/authorized_keys` or Tailscale SSH (`tailscale up --ssh` on the server). Accept the host key once by hand: `ssh <destination> true`.
2. In Switchyard, open **Hosts → Add host** and enter the destination, such as `me@devbox` or `me@devbox.tailnet.ts.net`.
3. If Switchyard isn't on that machine yet, the host card says so and offers **Install Switchyard on devbox**. It runs [scripts/remote-install.sh](../scripts/remote-install.sh) over SSH:
   - downloads the Linux build (x64 or arm64) from the [latest release](https://github.com/giovaniif/better-than-claude-code/releases/latest) into `~/.local/share/switchyard`;
   - runs yardd as a systemd user service with lingering, so it keeps running after you log out (or in the background where there is no user systemd);
   - checks that it answers, then reports whether `claude` and `codex` are installed and logged in there, with the command to run for each one that isn't.
4. Log the engines in on the server once, over SSH, if the card asks: `claude setup-token` (or run `claude` and log in) and `codex login --device-auth`.

A connected SSH host also offers **Update Switchyard**, which installs the latest build and restarts yardd. Sessions there survive the restart.

Hosts are saved in `hosts.json` in yardd's data folder (`~/.yard`).

## By hand

The installer also works on its own:

```bash
curl -fsSL https://raw.githubusercontent.com/giovaniif/better-than-claude-code/main/scripts/remote-install.sh | bash -s -- 47717
```

Or build from a checkout on the server with `scripts/install-host.sh` (needs Rust, Bun and git). It installs to the same place and writes the same service.

Logs: `journalctl --user -u yardd`. Stop it: `systemctl --user stop yardd`.

## Also in a browser, as your own user

The [web version](web.md) runs in a container as its own user, with its own logins and none of your tools. To use a server from a browser as your normal user instead, keep this install and put your reverse proxy in front of it:

- `YARD_BIND` takes a comma-separated list. Keep loopback, so SSH hosts still work, and add one address the proxy can reach, such as the gateway of the proxy's Docker network: `YARD_BIND=127.0.0.1,10.0.1.1`.
- `YARD_ALLOW_ORIGIN` names the page's URL, as in the container.
- Put both in a drop-in, such as `~/.config/systemd/user/yardd.service.d/web.conf`, so **Update Switchyard** (which rewrites `yardd.service`) keeps them.
- yardd has no sign-in, and it now runs as you. Firewall the port so only loopback and the proxy reach it: on Linux, any container can reach the host's address on a Docker network.

## What the host card tells you

| The card says | What it means |
|---|---|
| Can't find `devbox` | The name doesn't resolve from your Mac. Use the full Tailscale name. |
| SSH refused the login | `ssh` needs a password or the key isn't accepted. Fix it in Terminal first. |
| The host key is not trusted yet | Run `ssh <destination>` once and accept the key. |
| SSH works, but Switchyard isn't running | Install it from the card. |
| Connection lost. Reconnecting… | The tunnel dropped; it retries with backoff up to 30 s. |
