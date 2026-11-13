//! Starting sessions and turns. Shared by everything that can begin work:
//! the new-session page today, hand-off and the queue next.

use std::sync::Arc;

use serde_json::json;

use crate::{claude, codex, state::App};

/// Start the engine for a session that was just registered with
/// `App::new_session`, then run its first turn. Failures become events in the
/// session rather than errors, so the session shows what went wrong.
///
/// While the host is under pressure the session is queued instead: it keeps
/// its prompt, and the host sampler starts it once there is room.
pub async fn begin(app: &Arc<App>, sid: &str, text: &str) {
    if let Some(reason) = app.guard.admit() {
        app.emit(sid, json!({ "type": "user_message", "text": text }));
        app.emit(sid, json!({ "type": "queued", "reason": reason, "text": text }));
        app.guard.enqueue(sid, &reason);
        return;
    }
    if let Err(e) = start_engine(app, sid).await {
        app.emit(sid, json!({ "type": "user_message", "text": text }));
        fail_turn(app, sid, &e);
        return;
    }
    send_turn(app, sid, text).await;
}

/// Start a session taken off the queue, with the prompt it was queued with.
/// Its `user_message` is already in the log.
pub async fn start_queued(app: &Arc<App>, sid: &str) {
    let text = {
        let map = app.sessions.lock().unwrap();
        map.get(sid)
            .and_then(|s| crate::state::queued_event(&s.events))
            .and_then(|e| e["text"].as_str())
            .map(str::to_string)
    };
    let Some(text) = text else {
        fail_turn(app, sid, &anyhow::anyhow!("the queued prompt was lost"));
        return;
    };
    if let Err(e) = start_engine(app, sid).await {
        fail_turn(app, sid, &e);
        return;
    }
    start_turn(app, sid, &text).await;
}

async fn start_engine(app: &Arc<App>, sid: &str) -> anyhow::Result<()> {
    let engine = app.meta(sid).map(|m| m.engine).unwrap_or_default();
    match engine.as_str() {
        "codex" => codex::create(app, sid).await,
        _ => claude::create(app, sid).await,
    }
}

/// Record the user's message and hand it to the session's engine.
pub async fn send_turn(app: &Arc<App>, sid: &str, text: &str) {
    app.emit(sid, json!({ "type": "user_message", "text": text }));
    start_turn(app, sid, text).await;
}

async fn start_turn(app: &Arc<App>, sid: &str, text: &str) {
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

pub fn fail_turn(app: &Arc<App>, sid: &str, error: &anyhow::Error) {
    app.emit(sid, json!({ "type": "error", "message": format!("{error:#}") }));
    app.emit(sid, json!({ "type": "turn_completed", "status": "failed" }));
}
