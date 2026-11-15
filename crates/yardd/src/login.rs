//! Engine logins from the app, so a server or the web version never needs a
//! terminal for them. Codex logs in through its own app-server (device code:
//! a link and a code to enter). Claude Code has no such API, so
//! `claude auth login` runs in a PTY: its sign-in link is shown in the app,
//! and the code the page gives back is typed into it.

use std::{
    io::{Read, Write},
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{bail, Context, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde_json::{json, Value};
use tokio::process::Command;

use crate::state::{App, Backend};

struct ClaudeLogin {
    id: u64,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default)]
pub struct Logins {
    claude: Mutex<Option<ClaudeLogin>>,
    codex: Mutex<Option<String>>,
    next: std::sync::atomic::AtomicU64,
}

fn report(app: &App, engine: &str, state: &str, extra: Value) {
    let mut msg = json!({ "op": "login", "engine": engine, "state": state });
    if let (Some(m), Some(e)) = (msg.as_object_mut(), extra.as_object()) {
        m.extend(e.clone());
    }
    app.broadcast(msg);
}

/// Whether each engine is installed and logged in, for the app to offer a login.
pub async fn status(app: &Arc<App>) -> Value {
    let (claude, codex) = tokio::join!(claude_status(), codex_status(app));
    json!({ "op": "engines", "engines": { "claude": claude, "codex": codex } })
}

async fn claude_status() -> Value {
    let mut cmd = Command::new("claude");
    cmd.args(["auth", "status"]).kill_on_drop(true);
    strip_claude_env_tokio(&mut cmd);
    match tokio::time::timeout(Duration::from_secs(20), cmd.output()).await {
        Err(_) => json!({ "installed": true, "loggedIn": null, "error": "`claude auth status` did not answer" }),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => json!({ "installed": false, "loggedIn": false }),
        Ok(Err(e)) => json!({ "installed": true, "loggedIn": null, "error": e.to_string() }),
        Ok(Ok(out)) => {
            // Logged out exits 1 but still prints the JSON.
            let v: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
            match v["loggedIn"].as_bool() {
                Some(logged_in) => json!({
                    "installed": true,
                    "loggedIn": logged_in,
                    "account": v["email"].as_str().or_else(|| v["account"]["email"].as_str()),
                }),
                None => json!({ "installed": true, "loggedIn": null, "error": "could not read `claude auth status`" }),
            }
        }
    }
}

async fn codex_status(app: &Arc<App>) -> Value {
    let client = match crate::codex::client(app).await {
        Ok(c) => c,
        Err(_) => return json!({ "installed": false, "loggedIn": false }),
    };
    match client.request("account/read", json!({})).await {
        Ok(res) => {
            let account = &res["account"];
            json!({
                "installed": true,
                "loggedIn": !account.is_null(),
                "account": account["email"].as_str(),
            })
        }
        Err(e) => json!({ "installed": true, "loggedIn": null, "error": format!("{e:#}") }),
    }
}

pub async fn start(app: &Arc<App>, engine: &str) -> Result<()> {
    match engine {
        "codex" => start_codex(app).await,
        "claude" => start_claude(app),
        _ => bail!("unknown engine {engine}"),
    }
}

async fn start_codex(app: &Arc<App>) -> Result<()> {
    let client = crate::codex::client(app).await.context("Codex is not installed here")?;
    let old = app.logins.codex.lock().unwrap().take();
    if let Some(old) = old {
        let _ = client.request("account/login/cancel", json!({ "loginId": old })).await;
    }
    let res = client
        .request("account/login/start", json!({ "type": "chatgptDeviceCode" }))
        .await?;
    let login_id = res["loginId"].as_str().context("Codex sent no login id")?.to_string();
    *app.logins.codex.lock().unwrap() = Some(login_id);
    report(app, "codex", "code", json!({ "url": res["verificationUrl"], "code": res["userCode"] }));
    Ok(())
}

/// `account/login/completed` from the Codex app-server.
pub fn codex_completed(app: &Arc<App>, p: &Value) {
    let ours = {
        let mut current = app.logins.codex.lock().unwrap();
        let ours = current.as_deref().is_some_and(|id| p["loginId"].as_str().map_or(true, |got| got == id));
        if ours {
            *current = None;
        }
        ours
    };
    if !ours {
        return;
    }
    if p["success"].as_bool() == Some(true) {
        report(app, "codex", "done", json!({}));
        let app = app.clone();
        tokio::spawn(async move {
            // Models and limits depend on the account.
            let _ = crate::codex::load_models(&app).await;
            app.broadcast(status(&app).await);
        });
    } else {
        let error = p["error"].as_str().unwrap_or("The login did not finish.");
        report(app, "codex", "failed", json!({ "error": error }));
    }
}

fn start_claude(app: &Arc<App>) -> Result<()> {
    cancel_claude(app);
    // Wide, so the link is never wrapped.
    let pair = native_pty_system().openpty(PtySize { cols: 2000, rows: 40, pixel_width: 0, pixel_height: 0 })?;
    let mut cmd = CommandBuilder::new("claude");
    cmd.args(["auth", "login"]);
    if let Some(home) = std::env::var_os("HOME") {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") || key.starts_with("CLAUDE_AGENT_SDK") {
            cmd.env_remove(&key);
        }
    }
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .context("could not start `claude auth login`: is Claude Code installed here?")?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;
    let id = app.logins.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    *app.logins.claude.lock().unwrap() = Some(ClaudeLogin { id, writer, killer: child.clone_killer() });
    report(app, "claude", "starting", json!({}));

    let app = app.clone();
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        let _master = pair.master; // the PTY stays open while the login runs
        let mut text = String::new();
        let mut url_sent = false;
        let mut chunk = [0u8; 8192];
        loop {
            let n = match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            text.push_str(&strip_ansi(&String::from_utf8_lossy(&chunk[..n])));
            if !url_sent {
                if let Some(url) = sign_in_url(&text) {
                    url_sent = true;
                    report(&app, "claude", "url", json!({ "url": url }));
                }
            }
            // A wrong code leaves it prompting again; say so and stop.
            if text.contains("Invalid code") {
                let _ = app.logins.claude.lock().unwrap().as_mut().map(|l| l.killer.kill());
                break;
            }
        }
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        let current = {
            let mut slot = app.logins.claude.lock().unwrap();
            if slot.as_ref().map(|l| l.id) == Some(id) {
                slot.take();
                true
            } else {
                false
            }
        };
        if !current {
            return; // replaced or cancelled
        }
        if ok && !text.contains("Invalid code") {
            report(&app, "claude", "done", json!({}));
            restart_idle_claude(&app);
        } else {
            let error = if text.contains("Invalid code") {
                "That code was not accepted. Start again and paste the whole code.".to_string()
            } else {
                last_line(&text).unwrap_or_else(|| "The login did not finish.".into())
            };
            report(&app, "claude", "failed", json!({ "error": error }));
        }
        runtime.spawn(async move { app.broadcast(status(&app).await) });
    });
    Ok(())
}

/// The code from the sign-in page, typed into `claude auth login`.
pub fn code(app: &Arc<App>, engine: &str, code: &str) -> Result<()> {
    if engine != "claude" {
        bail!("only Claude Code takes a code");
    }
    let code = code.trim();
    if code.is_empty() || code.contains(['\r', '\n']) {
        bail!("paste the code from the sign-in page");
    }
    let mut slot = app.logins.claude.lock().unwrap();
    let login = slot.as_mut().context("no Claude login is running; start again")?;
    login.writer.write_all(code.as_bytes())?;
    login.writer.write_all(b"\r")?;
    login.writer.flush()?;
    drop(slot);
    report(app, "claude", "checking", json!({}));
    Ok(())
}

pub async fn cancel(app: &Arc<App>, engine: &str) -> Result<()> {
    match engine {
        "claude" => cancel_claude(app),
        "codex" => {
            let old = app.logins.codex.lock().unwrap().take();
            if let (Some(id), Some(client)) = (old, app.codex.get()) {
                let _ = client.request("account/login/cancel", json!({ "loginId": id })).await;
            }
        }
        _ => bail!("unknown engine {engine}"),
    }
    report(app, engine, "cancelled", json!({}));
    Ok(())
}

fn cancel_claude(app: &Arc<App>) {
    if let Some(mut old) = app.logins.claude.lock().unwrap().take() {
        let _ = old.killer.kill();
    }
}

/// A sidecar started while logged out keeps failing, so idle Claude sessions
/// get a fresh one with their next message.
fn restart_idle_claude(app: &Arc<App>) {
    let mut map = app.sessions.lock().unwrap();
    for s in map.values_mut() {
        if matches!(s.backend, Backend::Claude { .. }) && s.meta.status == "idle" {
            s.backend = Backend::Pending;
        }
    }
}

fn strip_claude_env_tokio(cmd: &mut Command) {
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") || key.starts_with("CLAUDE_AGENT_SDK") {
            cmd.env_remove(key);
        }
    }
}

/// Drop terminal escapes: CSI (`ESC [ … final`) and OSC (`ESC ] … BEL` or
/// `ESC ] … ESC \`), which is how the CLI wraps its link.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('[') => {
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            Some(']') => {
                while let Some(c) = chars.next() {
                    if c == '\x07' || (c == '\x1b' && chars.next_if_eq(&'\\').is_some()) {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn sign_in_url(text: &str) -> Option<String> {
    let start = text.find("https://")?;
    let url: String = text[start..].chars().take_while(|c| !c.is_whitespace()).collect();
    // The whole link has arrived once something follows it.
    (text.len() > start + url.len() && url.contains("oauth")).then_some(url)
}

fn last_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("Paste code"))
        .last()
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_sign_in_link_in_the_cli_output() {
        let raw = "Opening browser to sign in…\r\nIf the browser didn't open, visit: \x1b]8;;https://claude.com/cai/oauth/authorize?code=true&state=abc\x07https://claude.com/cai/oauth/authorize?code=true&state=abc\x1b]8;;\x07\r\nPaste code here if prompted > ";
        let text = strip_ansi(raw);
        assert!(text.contains("visit: https://claude.com/cai/oauth/authorize?code=true&state=abc\r\n"));
        assert_eq!(sign_in_url(&text).as_deref(), Some("https://claude.com/cai/oauth/authorize?code=true&state=abc"));
        // Half a link is not a link yet.
        assert_eq!(sign_in_url("visit: https://claude.com/cai/oau"), None);
    }
}
