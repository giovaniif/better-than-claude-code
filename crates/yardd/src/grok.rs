//! Grok (xAI's Grok Build CLI, `grok`) beyond its sessions, which `acp`
//! drives over `grok agent stdio`: its model list, whether it is logged in,
//! and its login.
//!
//! The login is the CLI's device-code flow (`grok login --device-auth`) in a
//! PTY: it prints a link and a code to enter there, then waits until the code
//! is confirmed and exits 0. Grok keeps the credentials in its own
//! `auth.json` under GROK_HOME; yardd never reads them.

use std::{
    collections::HashMap,
    io::Read,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde_json::{json, Value};
use tokio::process::Command;

use crate::{accounts::DEFAULT, login::report, state::App};

/// Logins in progress, by account: an id (a newer login replaces an older
/// one) and how to stop it.
pub type Logins = Mutex<HashMap<String, (u64, Box<dyn ChildKiller + Send + Sync>)>>;

/// The models `initialize` lists (`_meta.modelState`), with their efforts.
pub fn models_from(info: &Value) -> Vec<Value> {
    let state = &info["_meta"]["modelState"];
    let current = state["currentModelId"].as_str();
    state["availableModels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["modelId"].as_str()?;
            let meta = &m["_meta"];
            const ORDER: [&str; 6] = ["none", "minimal", "low", "medium", "high", "xhigh"];
            let mut efforts: Vec<&str> = meta["reasoningEfforts"].as_array().into_iter().flatten().filter_map(|e| e["value"].as_str()).collect();
            efforts.sort_by_key(|e| ORDER.iter().position(|o| o == e).unwrap_or(ORDER.len()));
            let default = meta["reasoningEfforts"]
                .as_array()
                .and_then(|l| l.iter().find(|e| e["default"] == true))
                .and_then(|e| e["value"].as_str())
                .or(meta["reasoningEffort"].as_str());
            let mut model = json!({ "id": id, "name": m["name"].as_str().unwrap_or(id), "efforts": efforts, "isDefault": Some(id) == current });
            if let Some(d) = default {
                model["defaultEffort"] = json!(d);
            }
            Some(model)
        })
        .collect()
}

/// Grok's models, from Default's agent (started here if it is not running).
/// Added accounts share the list, like Codex's.
pub async fn load_models(app: &Arc<App>) -> Result<()> {
    let c = crate::acp::client(app, "grok", DEFAULT).await?;
    let models = models_from(&c.info.lock().unwrap());
    let all = {
        let mut current = app.models.lock().unwrap();
        current["grok"] = json!(models);
        current.clone()
    };
    app.broadcast(json!({ "op": "models", "models": all }));
    Ok(())
}

/// What the first line of `grok models` says about the login: "You are not
/// authenticated.", "You are using XAI_API_KEY.", or who is signed in.
pub fn login_line(text: &str) -> Value {
    let first = text.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    if first.contains("not authenticated") || first.contains("not logged in") {
        return json!({ "installed": true, "loggedIn": false });
    }
    if first.contains("XAI_API_KEY") {
        return json!({ "installed": true, "loggedIn": true, "account": "API key (XAI_API_KEY)" });
    }
    let who = first.rsplit_once(" as ").map(|(_, who)| who.trim_end_matches('.').trim().to_string()).filter(|w| !w.is_empty());
    json!({ "installed": true, "loggedIn": true, "account": who })
}

pub async fn status(app: &Arc<App>, account: &str) -> Value {
    let mut cmd = Command::new("grok");
    cmd.arg("models").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
    match app.accounts.config_dir("grok", account) {
        Ok(Some(dir)) => {
            cmd.env(crate::accounts::env_var("grok"), dir);
        }
        Ok(None) => {}
        Err(e) => return json!({ "installed": true, "loggedIn": null, "error": e.to_string() }),
    }
    match tokio::time::timeout(Duration::from_secs(30), cmd.output()).await {
        Err(_) => json!({ "installed": true, "loggedIn": null, "error": "`grok models` did not answer" }),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => json!({ "installed": false, "loggedIn": false }),
        Ok(Err(e)) => json!({ "installed": true, "loggedIn": null, "error": e.to_string() }),
        Ok(Ok(out)) => login_line(&String::from_utf8_lossy(&out.stdout)),
    }
}

/// The link and code `grok login --device-auth` prints, once both are there.
pub fn device_prompt(text: &str) -> Option<(String, String)> {
    let start = text.find("https://")?;
    let url: String = text[start..].chars().take_while(|c| !c.is_whitespace()).collect();
    // The link is whole once something follows it.
    if text.len() <= start + url.len() {
        return None;
    }
    let after = text.find("Confirm this code").map(|i| &text[i..]);
    let code = after
        .and_then(|rest| rest.lines().skip(1).map(str::trim).find(|l| !l.is_empty()).map(str::to_string))
        .or_else(|| url.split("user_code=").nth(1).map(|c| c.split('&').next().unwrap_or(c).to_string()))?;
    Some((url, code))
}

pub fn start(app: &Arc<App>, account: &str) -> Result<()> {
    cancel(app, account);
    let pair = native_pty_system().openpty(PtySize { cols: 2000, rows: 40, pixel_width: 0, pixel_height: 0 })?;
    let mut cmd = CommandBuilder::new("grok");
    cmd.args(["login", "--device-auth"]);
    if let Some(home) = std::env::var_os("HOME") {
        cmd.cwd(home);
    }
    cmd.env("TERM", "xterm-256color");
    if let Some(dir) = app.accounts.config_dir("grok", account)? {
        cmd.env(crate::accounts::env_var("grok"), dir);
    }
    let mut child = pair.slave.spawn_command(cmd).context("could not start `grok login`: is Grok installed here?")?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let id = app.logins.next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    app.logins.grok.lock().unwrap().insert(account.to_string(), (id, child.clone_killer()));
    report(app, "grok", account, "starting", json!({}));

    let app = app.clone();
    let account = account.to_string();
    let runtime = tokio::runtime::Handle::current();
    std::thread::spawn(move || {
        let _master = pair.master; // the PTY stays open while the login runs
        let mut text = String::new();
        let mut shown = false;
        let mut chunk = [0u8; 8192];
        loop {
            let n = match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            text.push_str(&crate::login::strip_ansi(&String::from_utf8_lossy(&chunk[..n])));
            if !shown {
                if let Some((url, code)) = device_prompt(&text) {
                    shown = true;
                    report(&app, "grok", &account, "code", json!({ "url": url, "code": code }));
                }
            }
        }
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        let current = {
            let mut slot = app.logins.grok.lock().unwrap();
            if slot.get(&account).map(|l| l.0) == Some(id) {
                slot.remove(&account);
                true
            } else {
                false
            }
        };
        if !current {
            return; // replaced or cancelled
        }
        if ok && shown {
            report(&app, "grok", &account, "done", json!({}));
            // An agent started logged out keeps saying so.
            crate::acp::restart_when_idle(&app, "grok", &account);
        } else {
            let error = crate::login::last_line(&text).unwrap_or_else(|| "The login did not finish.".into());
            report(&app, "grok", &account, "failed", json!({ "error": error }));
        }
        runtime.spawn(async move {
            if account == DEFAULT {
                let _ = load_models(&app).await;
            }
            app.broadcast(crate::login::status(&app).await)
        });
    });
    Ok(())
}

pub fn cancel(app: &App, account: &str) {
    if let Some((_, mut killer)) = app.logins.grok.lock().unwrap().remove(account) {
        let _ = killer.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_device_link_and_code_come_out_of_the_cli_output() {
        // As `grok login --device-auth` 1.0.77 prints it.
        let text = "\r\nTo sign in, open this URL in your browser:\r\n\r\n  https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH\r\n\r\n  (Could not open browser automatically — open the URL above manually.)\r\n\r\nConfirm this code in your browser:\r\n\r\n  ABCD-EFGH\r\n\r\nWaiting for authorization...\r\n";
        assert_eq!(
            device_prompt(text),
            Some(("https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH".into(), "ABCD-EFGH".into()))
        );
        assert_eq!(device_prompt("open https://accounts.x.ai/oauth2/dev"), None);
    }

    #[test]
    fn the_login_line_says_who_is_signed_in() {
        assert_eq!(login_line("You are not authenticated.\n\nDefault model: grok-4.6"), json!({ "installed": true, "loggedIn": false }));
        assert_eq!(login_line("You are using XAI_API_KEY.\n")["account"], "API key (XAI_API_KEY)");
        assert_eq!(login_line("You are logged in as me@example.com.\n")["account"], "me@example.com");
    }

    #[test]
    fn models_and_efforts_come_from_initialize() {
        let info = json!({ "_meta": { "modelState": { "currentModelId": "grok-4.6", "availableModels": [
            { "modelId": "grok-4.6", "name": "Grok 4.6", "_meta": { "reasoningEffort": "high", "reasoningEfforts": [
                { "value": "xhigh", "default": false }, { "value": "high", "default": true }, { "value": "low", "default": false } ] } },
            { "modelId": "grok-4.5", "name": "Grok 4.5", "_meta": {} },
        ]}}});
        assert_eq!(
            models_from(&info),
            vec![
                json!({ "id": "grok-4.6", "name": "Grok 4.6", "efforts": ["low", "high", "xhigh"], "defaultEffort": "high", "isDefault": true }),
                json!({ "id": "grok-4.5", "name": "Grok 4.5", "efforts": [], "isDefault": false }),
            ]
        );
    }
}
