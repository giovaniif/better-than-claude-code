use std::{
    collections::{HashMap, VecDeque},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, OnceCell};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Clone, Serialize)]
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
    pub created_at: u64,
    pub updated_at: u64,
}

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
    },
}

pub struct Session {
    pub meta: Meta,
    pub events: Vec<Value>,
    pub backend: Backend,
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
    next: AtomicU64,
}

impl App {
    pub fn new(root: PathBuf, port: u16) -> Self {
        let (tx, _) = broadcast::channel(2048);
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
            next: AtomicU64::new(1),
        }
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
            created_at: now,
            updated_at: now,
        };
        self.sessions.lock().unwrap().insert(
            id.clone(),
            Session {
                meta: meta.clone(),
                events: Vec::new(),
                backend: Backend::Pending,
            },
        );
        self.broadcast(json!({ "op": "session", "session": meta }));
        id
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
            s.meta.clone()
        };
        self.broadcast(json!({ "op": "session", "session": meta }));
    }

    /// Append a normalized event to the session log and fan it out.
    /// Session status is derived here so both engines behave the same.
    pub fn emit(&self, sid: &str, event: Value) {
        let status = match event["type"].as_str() {
            Some("turn_started") | Some("approval_resolved") => Some("running"),
            Some("approval_request") => Some("needs_approval"),
            Some("turn_completed") => Some("idle"),
            Some("fatal") => Some("error"),
            _ => None,
        };
        let (msg, changed) = {
            let mut map = self.sessions.lock().unwrap();
            let Some(s) = map.get_mut(sid) else { return };
            let seq = s.events.len();
            s.events.push(event.clone());
            s.meta.updated_at = now_ms();
            let mut changed = None;
            if let Some(st) = status {
                if s.meta.status != st {
                    s.meta.status = st.to_string();
                    changed = Some(s.meta.clone());
                }
            }
            (
                json!({ "op": "event", "sessionId": sid, "seq": seq, "event": event }),
                changed,
            )
        };
        self.broadcast(msg);
        if let Some(meta) = changed {
            self.broadcast(json!({ "op": "session", "session": meta }));
        }
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
        })
    }
}

fn claude_models() -> Value {
    let efforts = json!(["low", "medium", "high", "xhigh", "max"]);
    json!([
        { "id": "claude-opus-5-5", "name": "Opus 5.5", "efforts": efforts, "defaultEffort": "high" },
        { "id": "claude-sonnet-5-5", "name": "Sonnet 5.5", "efforts": efforts, "defaultEffort": "medium" },
        { "id": "claude-haiku-5-5", "name": "Haiku 5.5", "efforts": efforts, "defaultEffort": "medium" },
    ])
}
