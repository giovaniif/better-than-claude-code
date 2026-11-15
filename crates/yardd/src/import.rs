//! Importing Claude Code sessions run outside Switchyard. The sidecar lists
//! them and reads their transcripts through the Agent SDK (never by parsing
//! `~/.claude/projects`); yardd turns one into a session in its own folder,
//! with its history, whose next message resumes the same conversation.

use std::{
    collections::HashSet,
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::{claude, state::App};

const SIDECAR_TIMEOUT: Duration = Duration::from_secs(60);
/// The model and effort an import starts on: the model the session last used
/// (a transcript id like `claude-haiku-5-5-20261001` matches `claude-haiku-5-5`),
/// else the first Claude model, the one the new-session page offers first.
/// The effort is that model's default.
fn pick_model(models: &Value, used: Option<&str>) -> (String, String) {
    let list = models.as_array().cloned().unwrap_or_default();
    let found = used.and_then(|u| list.iter().find(|m| m["id"].as_str().is_some_and(|id| u == id || u.starts_with(&format!("{id}-")))));
    let m = found.or(list.first());
    let id = m.and_then(|m| m["id"].as_str()).unwrap_or("claude-opus-5-5");
    let effort = m.and_then(|m| m["defaultEffort"].as_str()).unwrap_or("high");
    (id.to_string(), effort.to_string())
}
/** A history beyond this many events keeps its most recent part. */
const MAX_EVENTS: usize = 3000;

/// Claude Code sessions being imported right now. Reading a transcript takes
/// a while; a second import of the same one (another window, a retry) waits
/// for the first instead of making a second session on one conversation.
static IMPORTING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Holds one session id in `IMPORTING` until dropped.
struct Importing(String);

impl Importing {
    fn claim(id: &str) -> Option<Importing> {
        let mut set = IMPORTING.lock().unwrap();
        set.get_or_insert_with(HashSet::new).insert(id.to_string()).then(|| Importing(id.to_string()))
    }
}

impl Drop for Importing {
    fn drop(&mut self) {
        if let Some(set) = IMPORTING.lock().unwrap().as_mut() {
            set.remove(&self.0);
        }
    }
}

/// Run the sidecar once and read its one JSON line.
async fn one_shot(app: &App, args: &[&str]) -> Result<Value> {
    let mut cmd = claude::sidecar_command(app)?;
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let out = tokio::time::timeout(SIDECAR_TIMEOUT, cmd.output())
        .await
        .map_err(|_| anyhow::anyhow!("the Claude sidecar did not answer within {} s", SIDECAR_TIMEOUT.as_secs()))?
        .context("could not start the Claude sidecar")?;
    let text = String::from_utf8_lossy(&out.stdout);
    let line = text.lines().rev().find(|l| l.trim_start().starts_with('{')).unwrap_or("");
    let value: Value = serde_json::from_str(line).with_context(|| {
        let err = String::from_utf8_lossy(&out.stderr);
        format!("the Claude sidecar answered nothing readable{}", err.lines().last().map(|l| format!(": {l}")).unwrap_or_default())
    })?;
    if let Some(e) = value["error"].as_str() {
        bail!("{e}");
    }
    Ok(value)
}

/// Our session already holding this Claude Code session, if any.
fn imported_as(app: &App, claude_id: &str) -> Option<String> {
    app.sessions
        .lock()
        .unwrap()
        .values()
        .find(|s| s.meta.engine == "claude" && s.engine_ref.as_deref() == Some(claude_id))
        .map(|s| s.meta.id.clone())
}

pub async fn handle(app: &Arc<App>, direct: &mpsc::UnboundedSender<String>, msg: &Value) -> Result<()> {
    match msg["op"].as_str().unwrap_or("") {
        "claude.sessions" => {
            let reply = match one_shot(app, &["sessions", "--limit", "200"]).await {
                Ok(mut v) => {
                    if let Some(list) = v["sessions"].as_array_mut() {
                        for s in list {
                            let id = s["sessionId"].as_str().unwrap_or("").to_string();
                            s["importedAs"] = json!(imported_as(app, &id));
                        }
                    }
                    json!({ "op": "claude.sessions", "sessions": v["sessions"] })
                }
                Err(e) => json!({ "op": "claude.sessions", "sessions": [], "error": format!("{e:#}") }),
            };
            let _ = direct.send(reply.to_string());
        }
        "session.import" => {
            let claude_id = msg["claudeSessionId"].as_str().context("missing `claudeSessionId`")?;
            // Importing twice would give two sessions writing one conversation:
            // wait out an import of the same session already under way.
            let claim = loop {
                if let Some(sid) = imported_as(app, claude_id) {
                    let _ = direct.send(json!({ "op": "created", "sessionId": sid, "existing": true }).to_string());
                    return Ok(());
                }
                if let Some(claim) = Importing::claim(claude_id) {
                    break claim;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            };
            let v = one_shot(app, &["messages", claude_id]).await?;
            let session = &v["session"];
            let cwd = session["cwd"].as_str().unwrap_or("");
            // Claude Code keeps a transcript by folder: resuming needs the same one.
            if cwd.is_empty() || !Path::new(cwd).is_dir() {
                bail!("this session's folder {} no longer exists", if cwd.is_empty() { "(unknown)" } else { cwd });
            }
            let title: String = session["title"].as_str().unwrap_or("Imported session").chars().take(60).collect();
            let models = app.models.lock().unwrap()["claude"].clone();
            let (model, effort) = pick_model(&models, session["model"].as_str());
            // Permission stays the default, Ask first: the session is new to Switchyard.
            let sid = app.new_session("claude", &model, &effort, cwd, &title, None);
            app.set_engine_ref(&sid, claude_id);
            let mut events = v["events"].as_array().cloned().unwrap_or_default();
            if events.len() > MAX_EVENTS {
                // Start at a prompt, so the kept part opens with a whole turn.
                let cut = events.len() - MAX_EVENTS;
                let start = (cut..events.len()).find(|&i| events[i]["type"] == "user_message").unwrap_or(cut);
                let left = events.drain(..start).filter(|e| e["type"] == "user_message").count();
                let text = format!("The {left} oldest prompts of this Claude Code session were left out of the import; the conversation itself is whole.");
                app.emit(&sid, json!({ "type": "note", "text": text }));
            }
            for event in events {
                app.emit(&sid, event);
            }
            app.emit(
                &sid,
                json!({ "type": "note", "text": format!("Imported from Claude Code ({claude_id}). The next message continues that conversation here.") }),
            );
            let _ = direct.send(json!({ "op": "created", "sessionId": sid }).to_string());
            drop(claim);
        }
        other => bail!("unknown op `{other}`"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn models() -> Value {
        json!([
            { "id": "claude-opus-5-5", "defaultEffort": "high" },
            { "id": "claude-sonnet-5-5", "defaultEffort": "medium" },
            { "id": "claude-haiku-5-5", "defaultEffort": "medium" },
        ])
    }

    #[test]
    fn an_import_keeps_the_model_the_session_last_used() {
        assert_eq!(pick_model(&models(), Some("claude-haiku-5-5")), ("claude-haiku-5-5".into(), "medium".into()));
        assert_eq!(pick_model(&models(), Some("claude-sonnet-5-5-20261101")), ("claude-sonnet-5-5".into(), "medium".into()));
    }

    #[test]
    fn an_unknown_or_missing_model_falls_back_to_the_first() {
        assert_eq!(pick_model(&models(), Some("claude-legacy-3")), ("claude-opus-5-5".into(), "high".into()));
        assert_eq!(pick_model(&models(), None), ("claude-opus-5-5".into(), "high".into()));
        // A prefix of another id is not a match.
        assert_eq!(pick_model(&models(), Some("claude-haiku-5-55")), ("claude-opus-5-5".into(), "high".into()));
    }
}

