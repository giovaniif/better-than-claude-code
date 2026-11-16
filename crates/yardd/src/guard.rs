//! Resource guard: what each session's processes use, and a queue that holds
//! new sessions while the host is busy. Nothing running is ever stopped for
//! its size: a per-session memory cap was tried and removed (2026-11-15).

use std::{
    collections::{HashMap, HashSet, VecDeque},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::{json, Value};
use sysinfo::{Pid, System};

use crate::{pty, sessions, state::App};

const GB: f64 = 1024.0 * 1024.0 * 1024.0;

struct Limits {
    min_free: u64,
    /// `YARD_FORCE_PRESSURE=1`, for testing the queue.
    forced: bool,
}

fn gb_env(key: &str, default: f64) -> u64 {
    let gb = std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(default);
    (gb * GB) as u64
}

/// `8` or `0.2`: whole numbers without a decimal.
fn gb_text(bytes: u64) -> String {
    let gb = bytes as f64 / GB;
    if (gb - gb.round()).abs() < 0.05 {
        format!("{:.0}", gb.round())
    } else {
        format!("{gb:.1}")
    }
}

/// A Codex command between `item/started` and `item/completed`.
#[derive(Clone)]
struct Command {
    cwd: PathBuf,
    /// Seconds since the epoch, comparable with a process start time.
    since: u64,
}

#[derive(Default)]
struct Inner {
    /// Claude session -> its sidecar.
    sidecars: HashMap<String, u32>,
    /// Each account's `codex app-server`. It cannot be split by session, but
    /// the commands it runs are its children and can.
    codex_servers: HashMap<String, u32>,
    /// Codex session -> running command item.
    commands: HashMap<String, HashMap<String, Command>>,
    /// Session id and why it waits, oldest first.
    queue: VecDeque<(String, String)>,
    /// From the last sample; None when the host is fine.
    pressure: Option<String>,
}

pub struct Guard {
    limits: Limits,
    inner: Mutex<Inner>,
}

impl Default for Guard {
    fn default() -> Self {
        Guard {
            limits: Limits {
                min_free: gb_env("YARD_MIN_FREE_GB", 2.0),
                forced: std::env::var("YARD_FORCE_PRESSURE").is_ok_and(|v| v == "1"),
            },
            inner: Mutex::default(),
        }
    }
}

impl Guard {
    pub fn set_sidecar(&self, sid: &str, pid: u32) {
        self.inner.lock().unwrap().sidecars.insert(sid.to_string(), pid);
    }

    /// Only if it is still this sidecar: a resumed session may have a newer one.
    pub fn clear_sidecar(&self, sid: &str, pid: u32) {
        let mut inner = self.inner.lock().unwrap();
        if inner.sidecars.get(sid) == Some(&pid) {
            inner.sidecars.remove(sid);
        }
    }

    pub fn set_codex_server(&self, account: &str, pid: u32) {
        self.inner.lock().unwrap().codex_servers.insert(account.to_string(), pid);
    }

    pub fn command_started(&self, sid: &str, item: &str, cwd: &str) {
        let command = Command {
            cwd: std::fs::canonicalize(cwd).unwrap_or_else(|_| PathBuf::from(cwd)),
            since: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };
        let mut inner = self.inner.lock().unwrap();
        inner.commands.entry(sid.to_string()).or_default().insert(item.to_string(), command);
    }

    pub fn command_done(&self, sid: &str, item: &str) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(items) = inner.commands.get_mut(sid) {
            items.remove(item);
            if items.is_empty() {
                inner.commands.remove(sid);
            }
        }
    }

    /// A finished turn has no commands left, whatever events were missed.
    pub fn turn_done(&self, sid: &str) {
        self.inner.lock().unwrap().commands.remove(sid);
    }

    /// The session is being deleted.
    pub fn forget(&self, sid: &str) {
        let mut inner = self.inner.lock().unwrap();
        inner.sidecars.remove(sid);
        inner.commands.remove(sid);
        inner.queue.retain(|(id, _)| id != sid);
    }

    fn pressure(&self, inner: &Inner) -> Option<String> {
        if self.limits.forced {
            return Some("pressure is forced on (YARD_FORCE_PRESSURE=1)".to_string());
        }
        inner.pressure.clone()
    }

    /// Why a new session has to wait, or None to start it now. Sessions that
    /// are already waiting go first.
    pub fn admit(&self) -> Option<String> {
        let inner = self.inner.lock().unwrap();
        if let Some(reason) = self.pressure(&inner) {
            return Some(reason);
        }
        match inner.queue.len() {
            0 => None,
            1 => Some("1 queued session starts first".to_string()),
            n => Some(format!("{n} queued sessions start first")),
        }
    }

    pub fn enqueue(&self, sid: &str, reason: &str) {
        let mut inner = self.inner.lock().unwrap();
        if !inner.queue.iter().any(|(id, _)| id == sid) {
            inner.queue.push_back((sid.to_string(), reason.to_string()));
        }
    }

    /// Remove the session from the queue. True if it was there, so exactly
    /// one caller gets to start it.
    pub fn take(&self, sid: &str) -> bool {
        let mut inner = self.inner.lock().unwrap();
        let before = inner.queue.len();
        inner.queue.retain(|(id, _)| id != sid);
        inner.queue.len() != before
    }
}

/// Every process below `root`, and `root` itself, children before parents.
fn tree(children: &HashMap<Pid, Vec<Pid>>, root: Pid, out: &mut Vec<Pid>, seen: &mut HashSet<Pid>) {
    if !seen.insert(root) {
        return;
    }
    if let Some(kids) = children.get(&root) {
        for &kid in kids {
            tree(children, kid, out, seen);
        }
    }
    out.push(root);
}

#[derive(Default)]
struct SessionUse {
    cpu: f32,
    mem: u64,
}

/// Called by the host sampler after it refreshed `sys` (memory and processes).
/// Measures each session, enforces the cap, starts one queued session if the
/// host has room, and returns the fields it adds to the `host` message.
pub fn sample(app: &Arc<App>, sys: &System, load: f64, cores: usize, mem_free: u64) -> Value {
    let guard = &app.guard;
    let limits = &guard.limits;

    let mut reasons = Vec::new();
    if load > cores as f64 {
        reasons.push(format!("load {load:.1} is above {cores} cores"));
    }
    if mem_free < limits.min_free {
        reasons.push(format!(
            "{:.1} GB of memory free, needs {} GB",
            mem_free as f64 / GB,
            gb_text(limits.min_free)
        ));
    }

    let (sidecars, codex_servers, commands) = {
        let mut inner = guard.inner.lock().unwrap();
        inner.pressure = (!reasons.is_empty()).then(|| reasons.join("; "));
        (inner.sidecars.clone(), inner.codex_servers.values().copied().collect::<Vec<u32>>(), inner.commands.clone())
    };

    let procs = sys.processes();
    let mut children: HashMap<Pid, Vec<Pid>> = HashMap::new();
    for (pid, p) in procs {
        // On Linux sysinfo also lists every thread, with its process as the
        // parent and the process's whole memory as its own. Counted, a CLI
        // with 30 threads looked 30 times its size; killed, a thread id takes
        // the whole process down, which is how the cap killed Claude Code.
        if p.thread_kind().is_some() {
            continue;
        }
        if let Some(parent) = p.parent() {
            children.entry(parent).or_default().push(*pid);
        }
    }

    let mut usage: HashMap<String, SessionUse> = HashMap::new();
    for (sid, pid) in &sidecars {
        // The whole sidecar tree: the sidecar, the CLI and what it runs.
        let root = Pid::from_u32(*pid);
        let mut all = Vec::new();
        tree(&children, root, &mut all, &mut HashSet::new());
        let u = usage.entry(sid.clone()).or_default();
        for p in all.iter().filter_map(|pid| procs.get(pid)) {
            u.cpu += p.cpu_usage();
            u.mem += p.memory();
        }
    }
    let mut add = |sid: &str, root: u32| {
        let u = usage.entry(sid.to_string()).or_default();
        let mut pids = Vec::new();
        tree(&children, Pid::from_u32(root), &mut pids, &mut HashSet::new());
        for pid in pids {
            let Some(p) = procs.get(&pid) else { continue };
            u.cpu += p.cpu_usage();
            u.mem += p.memory();
        }
    };
    // Codex reports an id of its own as `processId`, not an OS pid. So each
    // child of the app-server goes to the session with a running command in
    // that folder (or above it, for a shell that ran `cd`) that started no
    // later than the process did, the latest when several match. Helpers the
    // server keeps for itself match no command. Two sessions running
    // commands in one folder at the same moment can be mixed up.
    for server in codex_servers {
        for child in children.get(&Pid::from_u32(server)).into_iter().flatten() {
            let Some(p) = procs.get(child) else { continue };
            let Some(cwd) = p.cwd() else { continue };
            let cwd = std::fs::canonicalize(cwd).unwrap_or_else(|_| cwd.to_path_buf());
            let owner = commands
                .iter()
                .flat_map(|(sid, items)| items.values().map(move |c| (sid, c)))
                .filter(|(_, c)| cwd.starts_with(&c.cwd) && c.since <= p.start_time() + 2)
                .max_by_key(|(_, c)| c.since)
                .map(|(sid, _)| sid.clone());
            if let Some(sid) = owner {
                add(&sid, child.as_u32());
            }
        }
    }
    for (sid, pid) in pty::shell_pids(app) {
        add(&sid, pid);
    }

    // One per sample, so a burst of starts cannot push the host straight
    // back under pressure.
    let next = {
        let mut inner = guard.inner.lock().unwrap();
        if guard.pressure(&inner).is_none() {
            inner.queue.pop_front().map(|(sid, _)| sid)
        } else {
            None
        }
    };
    if let Some(sid) = next {
        let app = app.clone();
        tokio::spawn(async move { sessions::start_queued(&app, &sid).await });
    }

    let mut rows: Vec<(String, SessionUse)> = usage.into_iter().collect();
    rows.sort_by(|a, b| b.1.mem.cmp(&a.1.mem));
    let rows: Vec<Value> = rows
        .iter()
        .map(|(sid, u)| json!({ "id": sid, "cpuCores": u.cpu / 100.0, "memBytes": u.mem }))
        .collect();
    let inner = guard.inner.lock().unwrap();
    let queued: Vec<Value> = inner
        .queue
        .iter()
        .map(|(sid, reason)| json!({ "id": sid, "reason": reason }))
        .collect();
    json!({
        "sessions": rows,
        "queued": queued,
        "pressure": guard.pressure(&inner),
        "limits": {
            "minFreeBytes": limits.min_free,
            "forced": limits.forced,
        },
    })
}
