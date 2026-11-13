//! Sessions on disk: one SQLite file, `yard.db`, in the data directory.
//!
//! Writes go through a channel to one writer thread that batches them into
//! transactions, so emitting an event never waits on the disk. A crash can
//! lose the last few milliseconds of writes; streamed deltas are never written
//! because the final `assistant_message` carries the full text.

use std::{
    path::{Path, PathBuf},
    sync::mpsc,
    time::Duration,
};

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde_json::Value;

use crate::state::Meta;

/// `$YARD_DATA_DIR`, else `~/.yard`.
pub fn data_dir() -> PathBuf {
    match std::env::var("YARD_DATA_DIR") {
        Ok(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".yard"),
    }
}

/// A session as read back at startup.
pub struct Loaded {
    pub meta: Meta,
    pub engine_ref: Option<String>,
    pub events: Vec<Value>,
}

enum Op {
    Meta(Meta),
    EngineRef(String, String),
    Event(String, Value),
    Delete(String),
    Flush(mpsc::Sender<()>),
}

pub struct Store {
    tx: mpsc::Sender<Op>,
}

const SCHEMA: &str = "
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        meta TEXT NOT NULL,
        engine_ref TEXT
    );
    CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        event TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS events_session ON events (session_id, id);
";

/// Open (or create) the database, read every session back, and start the writer.
pub fn open(dir: &Path) -> Result<(Store, Vec<Loaded>)> {
    std::fs::create_dir_all(dir).with_context(|| format!("could not create {}", dir.display()))?;
    let path = dir.join("yard.db");
    let conn = Connection::open(&path).with_context(|| format!("could not open {}", path.display()))?;
    conn.execute_batch(SCHEMA)?;
    let loaded = load(&conn)?;

    let (tx, rx) = mpsc::channel::<Op>();
    std::thread::Builder::new()
        .name("yard-store".into())
        .spawn(move || writer(conn, rx))?;
    Ok((Store { tx }, loaded))
}

fn load(conn: &Connection) -> Result<Vec<Loaded>> {
    let mut sessions = Vec::new();
    let mut stmt = conn.prepare("SELECT meta, engine_ref FROM sessions")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)))?;
    for row in rows {
        let (meta, engine_ref) = row?;
        match serde_json::from_str::<Meta>(&meta) {
            Ok(meta) => sessions.push(Loaded { meta, engine_ref, events: Vec::new() }),
            Err(e) => eprintln!("yardd: skipping an unreadable session row: {e}"),
        }
    }
    let mut stmt = conn.prepare("SELECT event FROM events WHERE session_id = ?1 ORDER BY id")?;
    for s in &mut sessions {
        let rows = stmt.query_map([&s.meta.id], |r| r.get::<_, String>(0))?;
        for row in rows {
            if let Ok(event) = serde_json::from_str(&row?) {
                s.events.push(event);
            }
        }
    }
    Ok(sessions)
}

fn writer(mut conn: Connection, rx: mpsc::Receiver<Op>) {
    while let Ok(first) = rx.recv() {
        let mut batch = vec![first];
        while batch.len() < 1000 {
            match rx.try_recv() {
                Ok(op) => batch.push(op),
                Err(_) => break,
            }
        }
        let mut flushed = Vec::new();
        if let Err(e) = write(&mut conn, batch, &mut flushed) {
            eprintln!("yardd: could not save sessions: {e:#}");
        }
        for done in flushed {
            let _ = done.send(());
        }
    }
}

fn write(conn: &mut Connection, batch: Vec<Op>, flushed: &mut Vec<mpsc::Sender<()>>) -> Result<()> {
    let txn = conn.transaction()?;
    for op in batch {
        match op {
            Op::Meta(meta) => {
                txn.execute(
                    "INSERT INTO sessions (id, meta) VALUES (?1, ?2)
                     ON CONFLICT(id) DO UPDATE SET meta = excluded.meta",
                    params![meta.id, serde_json::to_string(&meta)?],
                )?;
            }
            Op::EngineRef(sid, engine_ref) => {
                txn.execute("UPDATE sessions SET engine_ref = ?2 WHERE id = ?1", params![sid, engine_ref])?;
            }
            Op::Event(sid, event) => {
                txn.execute(
                    "INSERT INTO events (session_id, event) VALUES (?1, ?2)",
                    params![sid, event.to_string()],
                )?;
            }
            Op::Delete(sid) => {
                txn.execute("DELETE FROM events WHERE session_id = ?1", [&sid])?;
                txn.execute("DELETE FROM sessions WHERE id = ?1", [&sid])?;
            }
            Op::Flush(done) => flushed.push(done),
        }
    }
    txn.commit()?;
    Ok(())
}

impl Store {
    pub fn meta(&self, meta: &Meta) {
        let _ = self.tx.send(Op::Meta(meta.clone()));
    }

    pub fn engine_ref(&self, sid: &str, engine_ref: &str) {
        let _ = self.tx.send(Op::EngineRef(sid.to_string(), engine_ref.to_string()));
    }

    pub fn event(&self, sid: &str, event: &Value) {
        if event["type"] == "assistant_delta" {
            return;
        }
        let _ = self.tx.send(Op::Event(sid.to_string(), event.clone()));
    }

    pub fn delete(&self, sid: &str) {
        let _ = self.tx.send(Op::Delete(sid.to_string()));
    }

    /// Wait until everything sent so far is on disk, or the timeout passes.
    pub fn flush(&self, timeout: Duration) {
        let (done, wait) = mpsc::channel();
        if self.tx.send(Op::Flush(done)).is_ok() {
            let _ = wait.recv_timeout(timeout);
        }
    }
}
