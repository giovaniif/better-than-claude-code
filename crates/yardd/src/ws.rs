//! WebSocket API for the UI.

use std::{path::Path, sync::Arc};

use anyhow::{bail, Context, Result};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc};

use crate::{
    claude, codex, git, pty,
    state::{App, Worktree},
};

pub async fn handler(ws: WebSocketUpgrade, headers: HeaderMap, State(app): State<Arc<App>>) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok()).unwrap_or("none");
    if !origin_ok(&headers, app.port) {
        eprintln!("yardd: refused client, origin {origin}");
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    let agent = headers.get("user-agent").and_then(|v| v.to_str().ok()).unwrap_or("none");
    eprintln!("yardd: client connected, origin {origin}, agent {agent}");
    ws.on_upgrade(move |socket| client(socket, app))
}

/// This socket can run commands, so a web page in the user's browser must not
/// be able to open it. Browsers always send Origin; allow only our own page
/// and the Tauri window. Non-browser local clients send none.
fn origin_ok(headers: &HeaderMap, port: u16) -> bool {
    let Some(origin) = headers.get("origin").and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let origin = origin.trim_end_matches('/');
    if origin == format!("http://127.0.0.1:{port}") || origin == format!("http://localhost:{port}") {
        return true;
    }
    if origin == "tauri://localhost" || origin == "http://tauri.localhost" {
        return true;
    }
    matches!(std::env::var("YARD_ALLOW_ORIGIN"), Ok(extra) if extra == origin)
}

async fn client(socket: WebSocket, app: Arc<App>) {
    let (mut sink, mut stream) = socket.split();
    let mut rx = app.tx.subscribe();
    // Replies meant for this client only.
    let (direct, mut direct_rx) = mpsc::unbounded_channel::<String>();
    let _ = direct.send(app.snapshot().to_string());

    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(text) => {
                    if sink.send(Message::Text(text)).await.is_err() { break; }
                }
                // Fell behind: resync from a fresh snapshot.
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let _ = direct.send(app.snapshot().to_string());
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            Some(text) = direct_rx.recv() => {
                if sink.send(Message::Text(text)).await.is_err() { break; }
            }
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    let app = app.clone();
                    let direct = direct.clone();
                    tokio::spawn(async move {
                        let msg: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                        if let Err(e) = handle(&app, &direct, &msg).await {
                            let _ = direct.send(
                                json!({ "op": "error", "message": format!("{e:#}"), "for": msg["op"] }).to_string(),
                            );
                        }
                    });
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            }
        }
    }
}

fn str_field<'a>(msg: &'a Value, key: &str) -> Result<&'a str> {
    msg[key].as_str().with_context(|| format!("missing `{key}`"))
}

fn dim(msg: &Value, key: &str, fallback: u16) -> u16 {
    msg[key].as_u64().and_then(|n| u16::try_from(n).ok()).unwrap_or(fallback)
}

async fn handle(app: &Arc<App>, direct: &mpsc::UnboundedSender<String>, msg: &Value) -> Result<()> {
    match msg["op"].as_str().unwrap_or("") {
        "session.create" => {
            let engine = str_field(msg, "engine")?;
            let model = str_field(msg, "model")?;
            let effort = str_field(msg, "effort")?;
            let cwd = str_field(msg, "cwd")?;
            let text = str_field(msg, "text")?.trim();
            if text.is_empty() {
                bail!("the task is empty");
            }
            if !Path::new(cwd).is_dir() {
                bail!("{cwd} is not a folder");
            }
            if engine != "claude" && engine != "codex" {
                bail!("unknown engine {engine}");
            }
            let title: String = text.lines().next().unwrap_or("").chars().take(60).collect();

            // The worktree comes first: if it cannot be made, no session exists.
            let (cwd, worktree) = if msg["worktree"].as_bool().unwrap_or(false) {
                let unique = app.id("");
                let suffix = &unique[unique.len().saturating_sub(4)..];
                let wt = git::add_worktree(cwd, msg["branch"].as_str(), &title, suffix).await?;
                (wt.cwd, Some(Worktree { branch: wt.branch, repo: wt.repo }))
            } else {
                (cwd.to_string(), None)
            };
            let sid = app.new_session(engine, model, effort, &cwd, &title, worktree);
            let _ = direct.send(json!({ "op": "created", "sessionId": sid }).to_string());

            let started = match engine {
                "codex" => codex::create(app, &sid).await,
                _ => claude::create(app, &sid).await,
            };
            if let Err(e) = started {
                app.emit(&sid, json!({ "type": "user_message", "text": text }));
                fail_turn(app, &sid, &e);
                return Ok(());
            }
            send_turn(app, &sid, text).await;
        }
        "session.open" => {
            let sid = str_field(msg, "sessionId")?;
            let _ = direct.send(app.history(sid).to_string());
        }
        "session.send" => {
            let sid = str_field(msg, "sessionId")?;
            let text = str_field(msg, "text")?.trim();
            if text.is_empty() {
                bail!("the message is empty");
            }
            let meta = app.meta(sid).context("no such session")?;
            if meta.status == "running" || meta.status == "needs_approval" {
                bail!("a turn is already running");
            }
            send_turn(app, sid, text).await;
        }
        "session.setModel" => {
            let sid = str_field(msg, "sessionId")?;
            let model = str_field(msg, "model")?;
            let effort = str_field(msg, "effort")?;
            let meta = app.meta(sid).context("no such session")?;
            if meta.engine == "claude" && meta.model != model {
                claude::set_model(app, sid, model)?;
            }
            app.update_meta(sid, |m| {
                m.model = model.to_string();
                m.effort = effort.to_string();
            });
        }
        "session.interrupt" => {
            let sid = str_field(msg, "sessionId")?;
            let meta = app.meta(sid).context("no such session")?;
            match meta.engine.as_str() {
                "codex" => codex::interrupt(app, sid).await?,
                _ => claude::interrupt(app, sid)?,
            }
        }
        "session.approve" => {
            let sid = str_field(msg, "sessionId")?;
            let request_id = str_field(msg, "requestId")?;
            let decision = str_field(msg, "decision")?;
            let meta = app.meta(sid).context("no such session")?;
            match meta.engine.as_str() {
                "codex" => codex::approve(app, request_id, decision).await?,
                _ => claude::approve(app, sid, request_id, decision)?,
            }
            app.emit(
                sid,
                json!({ "type": "approval_resolved", "requestId": request_id, "decision": decision }),
            );
        }
        "session.delete" => {
            let sid = str_field(msg, "sessionId")?;
            let meta = app.meta(sid).context("no such session")?;
            if meta.engine == "codex" {
                codex::forget(app, sid).await;
            }
            pty::close_session(app, sid);
            app.remove_session(sid);
        }
        "changes.get" => {
            let sid = str_field(msg, "sessionId")?;
            let meta = app.meta(sid).context("no such session")?;
            let changes = match git::changes(&meta.cwd).await {
                Ok(c) => c,
                Err(e) => json!({ "error": format!("{e:#}") }),
            };
            let _ = direct.send(json!({ "op": "changes", "sessionId": sid, "changes": changes }).to_string());
        }
        "term.open" => {
            let sid = str_field(msg, "sessionId")?;
            let opened = pty::open(app, sid, dim(msg, "cols", 80), dim(msg, "rows", 24))?;
            let _ = direct.send(opened.to_string());
        }
        "term.input" => pty::input(app, str_field(msg, "termId")?, str_field(msg, "data")?)?,
        "term.resize" => pty::resize(app, str_field(msg, "termId")?, dim(msg, "cols", 80), dim(msg, "rows", 24))?,
        "term.close" => pty::close(app, str_field(msg, "termId")?)?,
        other => bail!("unknown op `{other}`"),
    }
    Ok(())
}

async fn send_turn(app: &Arc<App>, sid: &str, text: &str) {
    app.emit(sid, json!({ "type": "user_message", "text": text }));
    app.emit(sid, json!({ "type": "turn_started" }));
    let engine = app.meta(sid).map(|m| m.engine).unwrap_or_default();
    let sent = match engine.as_str() {
        "codex" => codex::send(app, sid, text).await,
        _ => claude::send(app, sid, text),
    };
    if let Err(e) = sent {
        fail_turn(app, sid, &e);
    }
}

fn fail_turn(app: &Arc<App>, sid: &str, error: &anyhow::Error) {
    app.emit(sid, json!({ "type": "error", "message": format!("{error:#}") }));
    app.emit(sid, json!({ "type": "turn_completed", "status": "failed" }));
}
