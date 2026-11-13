//! Starting sessions and turns. Shared by everything that can begin work:
//! the new-session page today, hand-off and the queue next.

use std::sync::Arc;

use serde_json::json;

use crate::{claude, codex, state::App};

/// Start the engine for a session that was just registered with
/// `App::new_session`, then run its first turn. Failures become events in the
/// session rather than errors, so the session shows what went wrong.
pub async fn begin(app: &Arc<App>, sid: &str, text: &str) {
    let engine = app.meta(sid).map(|m| m.engine).unwrap_or_default();
    let started = match engine.as_str() {
        "codex" => codex::create(app, sid).await,
        _ => claude::create(app, sid).await,
    };
    if let Err(e) = started {
        app.emit(sid, json!({ "type": "user_message", "text": text }));
        fail_turn(app, sid, &e);
        return;
    }
    send_turn(app, sid, text).await;
}

/// Record the user's message and hand it to the session's engine.
pub async fn send_turn(app: &Arc<App>, sid: &str, text: &str) {
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

pub fn fail_turn(app: &Arc<App>, sid: &str, error: &anyhow::Error) {
    app.emit(sid, json!({ "type": "error", "message": format!("{error:#}") }));
    app.emit(sid, json!({ "type": "turn_completed", "status": "failed" }));
}
