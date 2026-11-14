#!/bin/bash
# Regenerates the README screenshots in docs/screenshots with scripted
# engines (bin/codex, bin/demo-claude): no account, no model calls. Starts two
# throwaway yardds (a hub and a "build-box" remote) on ports 47820-47821
# with their own HOME and data, captures with Playwright, then stops them.
#   scripts/screenshots/run.sh   (needs bun, git and a built target/debug/yardd)
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
work="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  rm -rf "$work"
}
trap cleanup EXIT

repo() { # name, then files as path=content pairs
  local dir="$1"; shift
  mkdir -p "$dir"
  for pair in "$@"; do
    mkdir -p "$dir/$(dirname "${pair%%=*}")"
    printf '%s' "${pair#*=}" > "$dir/${pair%%=*}"
  done
  git -C "$dir" init -q -b main
  git -C "$dir" add -A
  git -C "$dir" -c user.name=Demo -c user.email=demo@example.com commit -qm "Initial commit"
}

home="$work/home"
remote_home="$work/remote-home"
repo "$home/code/payments-api" \
  "Cargo.toml=[package]
name = \"payments\"
version = \"0.4.0\"
edition = \"2021\"
" \
  "src/lib.rs=pub mod retry;
" \
  "src/retry.rs=use std::time::Duration;

use rand::Rng;

/// Exponential backoff with jitter for calls to the payment provider.
pub struct Backoff {
    base: Duration,
    max: Duration,
}

impl Backoff {
    pub fn new(base: Duration, max: Duration) -> Self {
        Backoff { base, max }
    }

    /// The delay before attempt \`n\`, counting from 0.
    pub fn delay(&self, n: u32) -> Duration {
        let exp = self.base.saturating_mul(2u32.saturating_pow(n));
        let jitter = rand::thread_rng().gen_range(0..=self.base.as_millis() as u64 / 4);
        (exp + Duration::from_millis(jitter)).min(self.max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backs_off_exponentially() {
        let backoff = Backoff::new(Duration::from_millis(100), Duration::from_secs(5));
        assert_eq!(backoff.delay(2), Duration::from_millis(400));
    }
}
"
repo "$home/code/storefront" \
  "package.json={ \"name\": \"storefront\", \"private\": true }
" \
  "src/server.ts=import express from \"express\";
import { routes } from \"./routes\";
import { internal } from \"./internal\";

const app = express();
app.use(express.json());
app.use(\"/api\", routes);
app.use(\"/internal\", internal);

app.listen(Number(process.env.PORT ?? 3000));
" \
  "src/middleware/README.md=Express middleware.
"
repo "$home/code/invoices-service" "package.json={ \"name\": \"invoices-service\", \"private\": true }
" "migrations/README.md=SQL migrations, applied in order.
"
repo "$remote_home/code/pdf-renderer" "package.json={ \"name\": \"pdf-renderer\", \"private\": true }
"

start() { # port, home, host name
  mkdir -p "$2/.yard"
  (cd "$root" && HOME="$2" YARD_PORT="$1" YARD_DATA_DIR="$2/.yard" YARD_ROOT="$root" YARD_HOST_NAME="$3" \
    YARD_SIDECAR="$here/bin/demo-claude" PATH="$here/bin:$PATH" SHELL=/bin/bash \
    exec ./target/debug/yardd >"$work/yardd-$1.log" 2>&1) &
  pids+=($!)
}
start 47820 "$home" "This Mac"
start 47821 "$remote_home" "build-box"
for port in 47820 47821; do
  for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break; sleep 0.25; done
done

(cd "$here" && bun install --silent && bun capture.ts "$root/docs/screenshots" "$home" "$remote_home")
echo "Wrote $root/docs/screenshots"
