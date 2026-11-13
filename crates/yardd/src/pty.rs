//! Terminals: one PTY per session, running the user's login shell in the
//! session folder. Output is kept in a ring buffer so a client that attaches
//! later (or reconnects) gets the scrollback.

use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde_json::{json, Value};

use crate::state::App;

const SCROLLBACK_BYTES: usize = 256 * 1024;

/// `total` counts every byte the PTY ever produced. Chunks carry their offset
/// so a client can drop what its scrollback snapshot already covered.
struct Scroll {
    buf: VecDeque<u8>,
    total: u64,
}

struct Term {
    session_id: String,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    scroll: Arc<Mutex<Scroll>>,
}

#[derive(Default)]
pub struct Terms {
    map: Mutex<HashMap<String, Term>>,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(20, 500),
        rows: rows.clamp(5, 300),
        pixel_width: 0,
        pixel_height: 0,
    }
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn opened(session_id: &str, term_id: &str, scroll: &Arc<Mutex<Scroll>>) -> Value {
    let s = scroll.lock().unwrap();
    let bytes: Vec<u8> = s.buf.iter().copied().collect();
    json!({
        "op": "term.opened",
        "sessionId": session_id,
        "termId": term_id,
        "offset": s.total - bytes.len() as u64,
        "data": b64(&bytes),
    })
}

/// Open the session's terminal, or attach to the one it already has.
pub fn open(app: &Arc<App>, session_id: &str, cols: u16, rows: u16) -> Result<Value> {
    {
        let map = app.terms.map.lock().unwrap();
        if let Some((id, term)) = map.iter().find(|(_, t)| t.session_id == session_id) {
            let _ = term.master.resize(size(cols, rows));
            return Ok(opened(session_id, id, &term.scroll));
        }
    }

    let meta = app.meta(session_id).context("no such session")?;
    let pair = native_pty_system().openpty(size(cols, rows))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l");
    cmd.cwd(&meta.cwd);
    cmd.env("TERM", "xterm-256color");
    // yardd may have been started from inside a Claude Code session.
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") || key.starts_with("CLAUDE_AGENT_SDK") {
            cmd.env_remove(&key);
        }
    }

    let child = pair.slave.spawn_command(cmd)?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let writer = pair.master.take_writer()?;

    let term_id = app.id("t");
    let scroll = Arc::new(Mutex::new(Scroll {
        buf: VecDeque::new(),
        total: 0,
    }));
    app.terms.map.lock().unwrap().insert(
        term_id.clone(),
        Term {
            session_id: session_id.to_string(),
            writer,
            master: pair.master,
            child,
            scroll: scroll.clone(),
        },
    );

    // PTY reads block, so they get a plain thread.
    let reader_app = app.clone();
    let reader_id = term_id.clone();
    let reader_scroll = scroll.clone();
    std::thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            let n = match reader.read(&mut chunk) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            let offset = {
                let mut s = reader_scroll.lock().unwrap();
                let offset = s.total;
                s.buf.extend(&chunk[..n]);
                s.total += n as u64;
                let excess = s.buf.len().saturating_sub(SCROLLBACK_BYTES);
                s.buf.drain(..excess);
                offset
            };
            reader_app.broadcast(json!({
                "op": "term.data",
                "termId": reader_id,
                "offset": offset,
                "data": b64(&chunk[..n]),
            }));
        }
        // The shell exited (or the PTY closed).
        if let Some(mut term) = reader_app.terms.map.lock().unwrap().remove(&reader_id) {
            let _ = term.child.kill();
            let _ = term.child.wait();
        }
        reader_app.broadcast(json!({ "op": "term.exit", "termId": reader_id }));
    });

    Ok(opened(session_id, &term_id, &scroll))
}

pub fn input(app: &Arc<App>, term_id: &str, data: &str) -> Result<()> {
    let mut map = app.terms.map.lock().unwrap();
    let term = map.get_mut(term_id).context("terminal is closed")?;
    term.writer.write_all(data.as_bytes())?;
    term.writer.flush()?;
    Ok(())
}

pub fn resize(app: &Arc<App>, term_id: &str, cols: u16, rows: u16) -> Result<()> {
    let map = app.terms.map.lock().unwrap();
    let term = map.get(term_id).context("terminal is closed")?;
    term.master.resize(size(cols, rows))?;
    Ok(())
}

pub fn close(app: &Arc<App>, term_id: &str) -> Result<()> {
    let mut map = app.terms.map.lock().unwrap();
    let term = map.get_mut(term_id).context("terminal is closed")?;
    // The reader thread sees EOF, removes the entry and announces the exit.
    term.child.kill()?;
    Ok(())
}
