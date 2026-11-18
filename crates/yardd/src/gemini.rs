//! Gemini CLI keeps its own Google login. ACP exposes models on session/new,
//! rather than initialize; a short-lived, prompt-free session discovers them
//! and checks authentication without spending a model turn. Browser login is
//! left to the CLI's interactive terminal flow, including on remote hosts.

use std::{sync::Arc, time::Duration};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::state::App;

pub fn models_from(answer: &Value) -> Vec<Value> {
    let models = &answer["models"];
    models["availableModels"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|m| {
            let id = m["modelId"].as_str()?;
            Some(json!({ "id": id, "name": m["name"].as_str().unwrap_or(id), "efforts": [], "isDefault": models["currentModelId"] == id }))
        })
        .collect()
}

pub fn publish_models(app: &App, answer: &Value) {
    let models = models_from(answer);
    if models.is_empty() {
        return;
    }
    let all = {
        let mut all = app.models.lock().unwrap();
        if all["gemini"] == json!(models) {
            return;
        }
        all["gemini"] = json!(models);
        all.clone()
    };
    app.broadcast(json!({ "op": "models", "models": all }));
}

/// A private probe process never shares an active session's agent. Dropping
/// it kills it, including on timeout, so a login check cannot stop a turn.
async fn probe(app: &Arc<App>, account: &str) -> Result<Value> {
    let mut cmd = crate::acp::agent_command("gemini")?;
    if let Some(dir) = app.accounts.config_dir("gemini", account)? {
        cmd.env(crate::accounts::env_var("gemini"), dir);
    }
    let cwd = crate::store::data_dir().join("gemini-probe");
    std::fs::create_dir_all(&cwd)?;
    cmd.current_dir(&cwd);
    let mut child = cmd.spawn()?;
    let mut input = child.stdin.take().context("Gemini stdin")?;
    let mut output = BufReader::new(child.stdout.take().context("Gemini stdout")?).lines();
    // No prompt is sent: session/new initializes a chat but runs no inference.
    let requests = [
        ("initialize", json!({ "protocolVersion": 1, "clientCapabilities": {}, "clientInfo": { "name": "switchyard", "version": env!("CARGO_PKG_VERSION") } })),
        ("session/new", json!({ "cwd": cwd, "mcpServers": [] })),
    ];
    let mut answer = Value::Null;
    for (n, (method, params)) in requests.into_iter().enumerate() {
        let id = n + 1;
        input.write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })).as_bytes()).await?;
        input.flush().await?;
        loop {
            let line = output.next_line().await?.context("Gemini stopped before answering the login check")?;
            let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
            if msg["id"] == id && msg["method"].is_null() {
                if !msg["error"].is_null() {
                    return Ok(json!({ "error": msg["error"] }));
                }
                answer = msg["result"].clone();
                break;
            }
            // We offer no client capabilities. Refuse unexpected requests.
            if !msg["id"].is_null() && msg["method"].is_string() {
                input.write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": msg["id"], "error": { "code": -32601, "message": "not supported by Switchyard" } })).as_bytes()).await?;
                input.flush().await?;
            }
        }
    }
    Ok(answer)
}

pub async fn status(app: &Arc<App>, account: &str) -> Value {
    match tokio::time::timeout(Duration::from_secs(30), probe(app, account)).await {
        Err(_) => json!({ "installed": true, "loggedIn": null, "error": "Gemini's login check timed out. Run gemini in a terminal on this host to check its login." }),
        Ok(Err(e)) => {
            if e.downcast_ref::<std::io::Error>().is_some_and(|e| e.kind() == std::io::ErrorKind::NotFound) {
                return json!({ "installed": false, "loggedIn": false });
            }
            json!({ "installed": true, "loggedIn": null, "error": format!("{e:#}") })
        }
        Ok(Ok(answer)) => {
            if !answer["error"].is_null() {
                let message = answer["error"]["message"].as_str().unwrap_or("Gemini could not check its login");
                let lower = message.to_lowercase();
                let needs_login = ["authentication", "authenticate", "api key", "log in", "login"].iter().any(|s| lower.contains(s));
                // The picker can offer Gemini and its login before it is authenticated.
                if needs_login && app.models.lock().unwrap()["gemini"].as_array().is_none_or(|l| l.is_empty()) {
                    publish_models(app, &json!({ "models": { "currentModelId": "auto", "availableModels": [{ "modelId": "auto", "name": "Auto (Gemini)" }] } }));
                }
                return json!({ "installed": true, "loggedIn": if needs_login { json!(false) } else { Value::Null }, "error": message });
            }
            publish_models(app, &answer);
            json!({ "installed": true, "loggedIn": true })
        }
    }
}

pub async fn start(app: &Arc<App>, account: &str) -> Result<()> {
    crate::login::report(app, "gemini", account, "starting", json!({}));
    let status = status(app, account).await;
    if status["loggedIn"] == true {
        crate::acp::restart_when_idle(app, "gemini", account);
        crate::login::report(app, "gemini", account, "done", json!({}));
        app.broadcast(crate::login::status(app).await);
        return Ok(());
    }
    if status["installed"] == false {
        bail!("Gemini CLI is not installed on this host. Run npm i -g @google/gemini-cli first.");
    }
    let command = match app.accounts.config_dir("gemini", account)? {
        Some(dir) => format!("GEMINI_CLI_HOME='{}' gemini", dir.display().to_string().replace('\'', "'\\''")),
        None => "gemini".to_string(),
    };
    crate::login::report(app, "gemini", account, "terminal", json!({ "command": command, "instructions": status["error"] }));
    Ok(())
}
