//! Claude adapter: one `yard-claude` sidecar per session, JSON lines over stdio.
//! The sidecar already speaks normalized events, so this only relays.

use std::{process::Stdio, sync::Arc};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
};

use crate::state::{App, Backend};

pub async fn create(app: &Arc<App>, sid: &str) -> Result<()> {
    spawn(app, sid, None)
}

/// Start the sidecar. `resume` is a Claude Code session id to continue.
fn spawn(app: &Arc<App>, sid: &str, resume: Option<String>) -> Result<()> {
    let meta = app.meta(sid).context("no such session")?;
    // The desktop app bundles a compiled sidecar and points YARD_SIDECAR at
    // it, so it needs no Bun. Without it, run the script from the repo.
    let mut cmd = match std::env::var_os("YARD_SIDECAR").filter(|s| !s.is_empty()) {
        Some(binary) => Command::new(binary),
        None => {
            let script = app.root.join("sidecar/yard-claude/src/main.ts");
            if !script.exists() {
                bail!("sidecar not found at {}", script.display());
            }
            let mut cmd = Command::new("bun");
            cmd.arg("run").arg(&script);
            cmd
        }
    };
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true);
    // yardd may itself be started from inside a Claude Code session.
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") || key.starts_with("CLAUDE_AGENT_SDK") {
            cmd.env_remove(key);
        }
    }
    let mut child = cmd
        .spawn()
        .context("could not start the Claude sidecar (YARD_SIDECAR unset: is `bun` on PATH?)")?;
    // The sidecar's tree (sidecar, CLI, tool commands) is this session's usage.
    let pid = child.id();
    if let Some(pid) = pid {
        app.guard.set_sidecar(sid, pid);
    }
    let mut stdin = child.stdin.take().context("sidecar stdin")?;
    let stdout = child.stdout.take().context("sidecar stdout")?;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            if stdin.write_all(line.as_bytes()).await.is_err() {
                break;
            }
            if stdin.write_all(b"\n").await.is_err() {
                break;
            }
            let _ = stdin.flush().await;
        }
    });

    let (stop, mut stopped) = oneshot::channel::<()>();
    let reader_app = app.clone();
    let reader_sid = sid.to_string();
    tokio::spawn(async move {
        let mut child = child;
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let line = tokio::select! {
                line = lines.next_line() => line,
                // The session was deleted.
                _ = &mut stopped => {
                    let _ = child.kill().await;
                    break;
                }
            };
            let Ok(Some(line)) = line else { break };
            let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            match msg["type"].as_str() {
                Some("event") => reader_app.emit(&reader_sid, msg["event"].clone()),
                Some("usage") => reader_app.set_usage("claude", msg["usage"].clone()),
                Some("session") => {
                    if let Some(id) = msg["claudeSessionId"].as_str() {
                        reader_app.set_engine_ref(&reader_sid, id);
                    }
                }
                _ => {}
            }
        }
        let _ = child.wait().await;
        if let Some(pid) = pid {
            reader_app.guard.clear_sidecar(&reader_sid, pid);
        }
        // The sidecar is gone: close out whatever turn was open.
        let running = reader_app
            .meta(&reader_sid)
            .map(|m| m.status != "idle")
            .unwrap_or(false);
        if running {
            reader_app.emit(
                &reader_sid,
                json!({ "type": "error", "message": "The Claude sidecar exited." }),
            );
            reader_app.emit(&reader_sid, json!({ "type": "turn_completed", "status": "failed" }));
        }
    });

    let _ = tx.send(
        json!({
            "type": "start",
            "cwd": meta.cwd,
            "model": meta.model,
            "effort": meta.effort,
            "resume": resume,
        })
        .to_string(),
    );
    if let Some(s) = app.sessions.lock().unwrap().get_mut(sid) {
        s.backend = Backend::Claude { tx, _stop: stop };
    }
    Ok(())
}

fn line(app: &Arc<App>, sid: &str, msg: Value) -> Result<()> {
    let map = app.sessions.lock().unwrap();
    match map.get(sid).map(|s| &s.backend) {
        Some(Backend::Claude { tx, .. }) => tx
            .send(msg.to_string())
            .map_err(|_| anyhow::anyhow!("the Claude sidecar is not running")),
        _ => bail!("session has no Claude sidecar"),
    }
}

/// The sidecar reads image attachments from disk and builds the content
/// blocks itself; yardd only passes the records.
pub fn send(app: &Arc<App>, sid: &str, text: &str, attachments: &[Value]) -> Result<()> {
    // A session restored after a restart gets a fresh sidecar that resumes
    // the saved Claude Code session.
    if let Some(claude_session) = app.resumable(sid) {
        spawn(app, sid, Some(claude_session))?;
    }
    line(app, sid, json!({ "type": "user", "text": text, "attachments": attachments }))
}

pub fn set_model(app: &Arc<App>, sid: &str, model: &str) -> Result<()> {
    line(app, sid, json!({ "type": "set_model", "model": model }))
}

pub fn interrupt(app: &Arc<App>, sid: &str) -> Result<()> {
    line(app, sid, json!({ "type": "interrupt" }))
}

pub fn approve(app: &Arc<App>, sid: &str, request_id: &str, decision: &str) -> Result<()> {
    line(
        app,
        sid,
        json!({ "type": "permission", "requestId": request_id, "decision": decision }),
    )
}
