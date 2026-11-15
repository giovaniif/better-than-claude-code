use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot, OnceCell};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub title: String,
    pub engine: String,
    pub model: String,
    pub effort: String,
    pub cwd: String,
    pub status: String,
    pub host: String,
    /// Set when yardd created a worktree for this session.
    pub branch: Option<String>,
    /// The checkout the worktree was cut from.
    pub repo: Option<String>,
    /// The session this one was handed off from. Rows saved before hand-off
    /// existed have no such key.
    #[serde(default)]
    pub parent: Option<String>,
    /// How much the engine may do unasked: `ask`, `acceptEdits`, `plan` or
    /// `full`. Rows saved before modes existed ran as `ask`.
    #[serde(default = "default_permission")]
    pub permission: String,
    /// Kept at the top of the sidebar.
    #[serde(default)]
    pub pinned: bool,
    /// Moved out of the list into Archived; still there to open or restore.
    #[serde(default)]
    pub archived: bool,
    /// Messages sent while a turn ran, oldest first: `{ id, text,
    /// attachments, at }`. The next one starts when a turn completes; Stop
    /// or a failed turn leaves them waiting.
    #[serde(default)]
    pub pending: Vec<Value>,
    pub created_at: u64,
    pub updated_at: u64,
}

fn default_permission() -> String {
    "ask".to_string()
}

pub const PERMISSIONS: [&str; 4] = ["ask", "acceptEdits", "plan", "full"];

/// Where a new session runs when it gets its own worktree.
pub struct Worktree {
    pub branch: String,
    pub repo: String,
}

pub enum Backend {
    Pending,
    Codex {
        thread_id: String,
        turn_id: Option<String>,
    },
    Claude {
        tx: mpsc::UnboundedSender<String>,
        /// Dropping this (with the session) kills the sidecar.
        _stop: oneshot::Sender<()>,
    },
}

pub struct Session {
    pub meta: Meta,
    pub events: Vec<Value>,
    pub backend: Backend,
    /// The engine's own id for this conversation (Codex thread id, Claude Code
    /// session id). Saved so a session restored after a restart can resume.
    pub engine_ref: Option<String>,
}

pub struct App {
    pub root: PathBuf,
    pub port: u16,
    pub tx: broadcast::Sender<String>,
    pub sessions: Mutex<HashMap<String, Session>>,
    pub codex: OnceCell<Arc<crate::codex::Client>>,
    pub models: Mutex<Value>,
    pub usage: Mutex<Value>,
    pub host: Mutex<Value>,
    pub cpu_history: Mutex<VecDeque<f32>>,
    pub terms: crate::pty::Terms,
    pub guard: crate::guard::Guard,
    pub store: crate::store::Store,
    pub remotes: crate::remote::Remotes,
    pub logins: crate::login::Logins,
    /// Sessions whose turn completed with messages waiting; drained by a task
    /// in main (emit cannot start a turn itself).
    next_turns: mpsc::UnboundedSender<String>,
    next_turns_rx: Mutex<Option<mpsc::UnboundedReceiver<String>>>,
    next: AtomicU64,
}

impl App {
    pub fn new(root: PathBuf, port: u16, store: crate::store::Store) -> Self {
        let (tx, _) = broadcast::channel(2048);
        let (next_turns, next_turns_rx) = mpsc::unbounded_channel();
        App {
            root,
            port,
            tx,
            sessions: Mutex::new(HashMap::new()),
            codex: OnceCell::new(),
            models: Mutex::new(json!({ "claude": claude_models(), "codex": [] })),
            usage: Mutex::new(json!({})),
            host: Mutex::new(Value::Null),
            cpu_history: Mutex::new(VecDeque::new()),
            terms: crate::pty::Terms::default(),
            guard: crate::guard::Guard::default(),
            store,
            remotes: crate::remote::Remotes::new(crate::store::data_dir()),
            logins: crate::login::Logins::default(),
            next_turns,
            next_turns_rx: Mutex::new(Some(next_turns_rx)),
            next: AtomicU64::new(1),
        }
    }

    /// The queue of sessions ready for their next pending message. Taken once, by main.
    pub fn take_next_turns(&self) -> mpsc::UnboundedReceiver<String> {
        self.next_turns_rx.lock().unwrap().take().expect("next_turns taken twice")
    }

    /// Queue a message sent while a turn runs.
    pub fn queue_message(&self, sid: &str, text: &str, attachments: &[Value]) -> String {
        let id = self.id("q");
        let item = json!({ "id": id, "text": text, "attachments": attachments, "at": now_ms() });
        self.update_meta(sid, |m| m.pending.push(item));
        id
    }

    /// Take a queued message back. Unknown ids are ignored: it may have just started.
    pub fn unqueue_message(&self, sid: &str, id: &str) {
        self.update_meta(sid, |m| m.pending.retain(|p| p["id"] != id));
    }

    /// The oldest queued message, removed from the queue, if the session is idle.
    pub fn next_pending(&self, sid: &str) -> Option<Value> {
        {
            let map = self.sessions.lock().unwrap();
            let s = map.get(sid)?;
            if s.meta.status != "idle" || s.meta.pending.is_empty() {
                return None;
            }
        }
        let mut taken = None;
        self.update_meta(sid, |m| {
            if m.status == "idle" && !m.pending.is_empty() {
                taken = Some(m.pending.remove(0));
            }
        });
        taken
    }

    /// A short id that is unique within this yardd run.
    pub fn id(&self, prefix: &str) -> String {
        let n = self.next.fetch_add(1, Ordering::Relaxed);
        format!("{prefix}{:x}{:x}", now_ms(), n)
    }

    pub fn broadcast(&self, msg: Value) {
        let _ = self.tx.send(msg.to_string());
    }

    pub fn new_session(
        &self,
        engine: &str,
        model: &str,
        effort: &str,
        cwd: &str,
        title: &str,
        worktree: Option<Worktree>,
    ) -> String {
        self.insert_session(engine, model, effort, cwd, title, worktree, false)
            .expect("a non-exclusive insert cannot be refused")
    }

    /// Like `new_session`, but refused while another session in the same
    /// folder is working. The check and the insert share one lock, so two
    /// creates at once cannot both get in.
    pub fn new_session_exclusive(
        &self,
        engine: &str,
        model: &str,
        effort: &str,
        cwd: &str,
        title: &str,
    ) -> anyhow::Result<String> {
        self.insert_session(engine, model, effort, cwd, title, None, true)
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_session(
        &self,
        engine: &str,
        model: &str,
        effort: &str,
        cwd: &str,
        title: &str,
        worktree: Option<Worktree>,
        exclusive: bool,
    ) -> anyhow::Result<String> {
        let id = self.id("s");
        let now = now_ms();
        let (branch, repo) = match worktree {
            Some(w) => (Some(w.branch), Some(w.repo)),
            None => (None, None),
        };
        let meta = Meta {
            id: id.clone(),
            title: title.to_string(),
            engine: engine.to_string(),
            model: model.to_string(),
            effort: effort.to_string(),
            cwd: cwd.to_string(),
            status: "running".to_string(),
            host: "local".to_string(),
            branch,
            repo,
            parent: None,
            permission: default_permission(),
            pinned: false,
            archived: false,
            pending: Vec::new(),
            created_at: now,
            updated_at: now,
        };
        {
            let mut map = self.sessions.lock().unwrap();
            if exclusive {
                let here = same_folder_key(cwd);
                let busy = map.values().any(|s| {
                    matches!(s.meta.status.as_str(), "running" | "needs_approval" | "queued")
                        && same_folder_key(&s.meta.cwd) == here
                });
                if busy {
                    anyhow::bail!("Another session is working in this folder. Stop it first, or tick New worktree.");
                }
            }
            self.store.meta(&meta);
            map.insert(
                id.clone(),
                Session {
                    meta: meta.clone(),
                    events: Vec::new(),
                    backend: Backend::Pending,
                    engine_ref: None,
                },
            );
        }
        self.broadcast(json!({ "op": "session", "session": meta }));
        Ok(id)
    }

    pub fn meta(&self, sid: &str) -> Option<Meta> {
        self.sessions.lock().unwrap().get(sid).map(|s| s.meta.clone())
    }

    /// Change session fields and tell every client.
    pub fn update_meta(&self, sid: &str, f: impl FnOnce(&mut Meta)) {
        let meta = {
            let mut map = self.sessions.lock().unwrap();
            let Some(s) = map.get_mut(sid) else { return };
            f(&mut s.meta);
            s.meta.updated_at = now_ms();
            self.store.meta(&s.meta);
            s.meta.clone()
        };
        self.broadcast(json!({ "op": "session", "session": meta }));
    }

    /// Append a normalized event to the session log and fan it out.
    /// Session status is derived here so both engines behave the same.
    pub fn emit(&self, sid: &str, mut event: Value) {
        // Turn boundaries carry the time, so the UI can say how long one took.
        if matches!(event["type"].as_str(), Some("turn_started") | Some("turn_completed")) && event["at"].is_null() {
            event["at"] = json!(now_ms());
        }
        let status = match event["type"].as_str() {
            Some("turn_started") | Some("approval_resolved") => Some("running"),
            Some("approval_request") => Some("needs_approval"),
            Some("queued") => Some("queued"),
            Some("turn_completed") => Some("idle"),
            Some("fatal") => Some("error"),
            _ => None,
        };
        // Only a turn that completed sends the next queued message: after
        // Stop or a failure the user decides.
        let completed = event["type"] == "turn_completed" && event["status"] == "completed";
        let (msg, changed, next) = {
            let mut map = self.sessions.lock().unwrap();
            let Some(s) = map.get_mut(sid) else { return };
            let seq = s.events.len();
            // Sent under the lock so the disk sees events in log order.
            self.store.event(sid, &event);
            s.events.push(event.clone());
            s.meta.updated_at = now_ms();
            let mut changed = None;
            if let Some(st) = status {
                if s.meta.status != st {
                    s.meta.status = st.to_string();
                    self.store.meta(&s.meta);
                    changed = Some(s.meta.clone());
                }
            }
            let next = completed && !s.meta.pending.is_empty();
            (
                json!({ "op": "event", "sessionId": sid, "seq": seq, "event": event }),
                changed,
                next,
            )
        };
        self.broadcast(msg);
        if let Some(meta) = changed {
            self.broadcast(json!({ "op": "session", "session": meta }));
        }
        if next {
            let _ = self.next_turns.send(sid.to_string());
        }
    }

    /// Remember the engine's id for this session, here and on disk.
    pub fn set_engine_ref(&self, sid: &str, engine_ref: &str) {
        let mut map = self.sessions.lock().unwrap();
        let Some(s) = map.get_mut(sid) else { return };
        if s.engine_ref.as_deref() != Some(engine_ref) {
            s.engine_ref = Some(engine_ref.to_string());
            self.store.engine_ref(sid, engine_ref);
        }
    }

    /// The saved engine id, but only while no engine is attached: that is a
    /// session restored from disk that has not resumed yet.
    pub fn resumable(&self, sid: &str) -> Option<String> {
        let map = self.sessions.lock().unwrap();
        let s = map.get(sid)?;
        match s.backend {
            Backend::Pending => s.engine_ref.clone(),
            _ => None,
        }
    }

    /// Put sessions read from disk back in memory. A turn that was open when
    /// yardd died can never finish, so it is closed out as failed. A queued
    /// session never started, so it goes back in the queue.
    pub fn restore(&self, loaded: Vec<crate::store::Loaded>) {
        let mut interrupted = Vec::new();
        let mut queued = Vec::new();
        {
            let mut map = self.sessions.lock().unwrap();
            for l in loaded {
                if l.meta.status == "queued" {
                    queued.push((l.meta.created_at, l.meta.id.clone(), queued_reason(&l.events)));
                } else if l.meta.status != "idle" {
                    interrupted.push(l.meta.id.clone());
                }
                map.insert(
                    l.meta.id.clone(),
                    Session {
                        meta: l.meta,
                        events: l.events,
                        backend: Backend::Pending,
                        engine_ref: l.engine_ref,
                    },
                );
            }
        }
        queued.sort();
        for (_, sid, reason) in queued {
            self.guard.enqueue(&sid, &reason);
        }
        for sid in interrupted {
            self.emit(&sid, json!({ "type": "error", "message": "yardd restarted during this turn." }));
            self.emit(&sid, json!({ "type": "turn_completed", "status": "failed" }));
        }
    }

    /// Forget a session here and on disk. Dropping its backend stops a Claude
    /// sidecar; the caller handles Codex and the terminal.
    pub fn remove_session(&self, sid: &str) -> bool {
        let removed = {
            let mut map = self.sessions.lock().unwrap();
            let removed = map.remove(sid);
            if removed.is_some() {
                self.store.delete(sid);
            }
            removed
        };
        if removed.is_none() {
            return false;
        }
        drop(removed);
        self.broadcast(json!({ "op": "session.deleted", "sessionId": sid }));
        true
    }

    pub fn history(&self, sid: &str) -> Value {
        let map = self.sessions.lock().unwrap();
        let events = map.get(sid).map(|s| s.events.clone()).unwrap_or_default();
        json!({ "op": "history", "sessionId": sid, "events": events })
    }

    pub fn set_usage(&self, engine: &str, value: Value) {
        let all = {
            let mut usage = self.usage.lock().unwrap();
            usage[engine] = value;
            usage.clone()
        };
        self.broadcast(json!({ "op": "usage", "usage": all }));
    }

    pub fn snapshot(&self) -> Value {
        let mut sessions: Vec<Meta> = self
            .sessions
            .lock()
            .unwrap()
            .values()
            .map(|s| s.meta.clone())
            .collect();
        sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        json!({
            "op": "snapshot",
            "sessions": sessions,
            "models": self.models.lock().unwrap().clone(),
            "usage": self.usage.lock().unwrap().clone(),
            "host": self.host.lock().unwrap().clone(),
            "home": std::env::var("HOME").unwrap_or_default(),
            "workspace": workspace(),
            "hosts": self.remotes.list(),
        })
    }
}

/// Where new sessions start and the folder picker opens: YARD_WORKSPACE
/// (the container's project folder), else the home folder.
pub fn workspace() -> String {
    std::env::var("YARD_WORKSPACE")
        .ok()
        .filter(|w| !w.is_empty())
        .or_else(|| std::env::var("HOME").ok())
        .unwrap_or_default()
}

/// One spelling per folder, so `~/x`, `~/x/` and a symlinked path compare equal.
fn same_folder_key(cwd: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(cwd);
    std::fs::canonicalize(p).unwrap_or_else(|_| p.components().collect())
}

/// The reason and prompt a queued session recorded when it was queued.
pub fn queued_event(events: &[Value]) -> Option<&Value> {
    events.iter().rev().find(|e| e["type"] == "queued")
}

fn queued_reason(events: &[Value]) -> String {
    queued_event(events)
        .and_then(|e| e["reason"].as_str())
        .unwrap_or("waiting for room on the host")
        .to_string()
}

fn claude_models() -> Value {
    let efforts = json!(["low", "medium", "high", "xhigh", "max"]);
    json!([
        { "id": "claude-opus-5-5", "name": "Opus 5.5", "efforts": efforts, "defaultEffort": "high" },
        { "id": "claude-sonnet-5-5", "name": "Sonnet 5.5", "efforts": efforts, "defaultEffort": "medium" },
        { "id": "claude-haiku-5-5", "name": "Haiku 5.5", "efforts": efforts, "defaultEffort": "medium" },
    ])
}
