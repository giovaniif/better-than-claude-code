//! Merged worktrees go away on their own. Every worktree under the worktree
//! root, from any repository, is checked every few minutes; one whose HEAD is
//! the head of a merged pull request is removed with its branch. Each build
//! leaves gigabytes in a worktree, so keeping merged ones fills the disk.
//!
//! A worktree is left alone while anything could still need it: a session
//! working, waiting for approval or queued in it, any process (a terminal, a
//! dev server) whose folder is inside it, or uncommitted or untracked files.
//! "Merged" is GitHub's word through the user's own `gh`: a squash or rebase
//! merge leaves a branch git calls unmerged, and GitHub keeps the PR's head
//! commit, so deleting the branch loses nothing. A repository without a
//! GitHub remote is never swept.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use serde_json::{json, Value};
use sysinfo::{ProcessRefreshKind, System, UpdateKind};
use tokio::process::Command;

use crate::{git::worktree_root, state::App};

const DEFAULT_EVERY: Duration = Duration::from_secs(10 * 60);
const GH_TIMEOUT: Duration = Duration::from_secs(30);

/// `YARD_WORKTREE_SWEEP_SECS` sets the interval (tests use a second);
/// `0` turns the sweep off.
pub async fn run(app: Arc<App>) {
    let every = match std::env::var("YARD_WORKTREE_SWEEP_SECS").ok().and_then(|s| s.parse::<u64>().ok()) {
        Some(0) => return,
        Some(s) => Duration::from_secs(s),
        None => DEFAULT_EVERY,
    };
    // Not at startup: restored sessions and the first host sample come first.
    let mut tick = tokio::time::interval_at(tokio::time::Instant::now() + every.min(Duration::from_secs(60)), every);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tick.tick().await;
        sweep(&app).await;
    }
}

async fn sweep(app: &Arc<App>) {
    let root = canon(&worktree_root());
    let candidates = worktrees(&root);
    if candidates.is_empty() {
        return;
    }
    let busy = busy_folders(app);
    for wt in candidates {
        if busy.iter().any(|b| b.starts_with(&wt)) {
            continue;
        }
        let Some(path) = wt.to_str() else { continue };
        let Some(pr) = merged_pr(path).await else { continue };
        // gh took a while: a turn may have started there since.
        if busy_folders(app).iter().any(|b| b.starts_with(&wt)) {
            continue;
        }
        remove(app, path, pr).await;
    }
}

/// `<root>/<repo>/<branch>` folders that are linked worktrees (`.git` is a
/// file there), never the root or a main checkout.
fn worktrees(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(repos) = std::fs::read_dir(root) else { return out };
    for repo in repos.flatten() {
        let Ok(entries) = std::fs::read_dir(repo.path()) else { continue };
        for wt in entries.flatten() {
            let path = canon(&wt.path());
            if path.starts_with(root) && path != root && path.join(".git").is_file() {
                out.push(path);
            }
        }
    }
    out
}

/// Folders something may still be using: sessions not at rest, and the
/// current folder of every process (terminals, dev servers, agent tools).
/// An idle Claude session keeps its CLI waiting in its folder; that one
/// process does not count, `remove` stops it.
fn busy_folders(app: &App) -> Vec<PathBuf> {
    let (mut busy, resting): (Vec<PathBuf>, Vec<String>) = {
        let map = app.sessions.lock().unwrap();
        let busy = map
            .values()
            .filter(|s| !at_rest(&s.meta.status))
            .map(|s| canon(Path::new(&s.meta.cwd)))
            .collect();
        (busy, map.values().filter(|s| at_rest(&s.meta.status)).map(|s| s.meta.id.clone()).collect())
    };
    let idle_engines: HashSet<u64> = resting
        .iter()
        .flat_map(|sid| app.guard.procs(sid))
        .filter(|p| p["engine"] == true)
        .filter_map(|p| p["pid"].as_u64())
        .collect();
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessRefreshKind::new().with_cwd(UpdateKind::Always));
    busy.extend(
        sys.processes()
            .iter()
            .filter(|(pid, _)| !idle_engines.contains(&(pid.as_u32() as u64)))
            .filter_map(|(_, p)| p.cwd())
            .map(canon),
    );
    busy
}

fn at_rest(status: &str) -> bool {
    !matches!(status, "running" | "needs_approval" | "queued")
}

/// The number of the merged PR whose head is this worktree's HEAD, when the
/// worktree is clean. `None` for anything else, including gh missing,
/// logged out or slow: the next sweep asks again.
async fn merged_pr(wt: &str) -> Option<u64> {
    let (ok, status) = git(wt, &["status", "--porcelain"]).await?;
    if !ok || !status.trim().is_empty() {
        return None;
    }
    let (ok, head) = git(wt, &["rev-parse", "HEAD"]).await?;
    let head = head.trim();
    if !ok || head.len() < 40 {
        return None;
    }
    let child = Command::new("gh")
        .args(["pr", "list", "--state", "merged", "--search", head, "--json", "number,headRefOid", "--limit", "10"])
        .current_dir(wt)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(GH_TIMEOUT, child).await.ok()?.ok()?;
    if !out.status.success() {
        return None;
    }
    pick_merged(&serde_json::from_slice(&out.stdout).ok()?, head)
}

/// The search matches any PR that mentions the commit; only the one whose
/// head it is counts, so a branch with commits after the merge stays.
fn pick_merged(list: &Value, head: &str) -> Option<u64> {
    list.as_array()?.iter().find(|pr| pr["headRefOid"] == head).and_then(|pr| pr["number"].as_u64())
}

async fn remove(app: &Arc<App>, wt: &str, pr: u64) {
    // The main checkout, which owns the worktree: first in the list.
    let Some((true, list)) = git(wt, &["worktree", "list", "--porcelain"]).await else { return };
    let Some(main) = list.lines().next().and_then(|l| l.strip_prefix("worktree ")).map(str::to_string) else { return };
    let branch = git(wt, &["branch", "--show-current"]).await.map(|(_, b)| b.trim().to_string()).unwrap_or_default();
    // An idle Claude session's CLI waits in the folder. Stopped, it keeps
    // the conversation; a later message says the folder is gone.
    let sids = sessions_in(app, wt);
    for sid in &sids {
        crate::claude::kill(app, sid);
    }
    // Never forced: git itself refuses if a file changed since the check.
    if let Err(e) = git_err(&main, &["worktree", "remove", "--", wt]).await {
        eprintln!("yardd: kept merged worktree {wt}: {e}");
        return;
    }
    let mut text = format!("Worktree removed: pull request #{pr} was merged.");
    if !branch.is_empty() {
        // `-D`: after a squash merge git calls the branch unmerged; its tip is the PR head GitHub keeps.
        match git_err(&main, &["branch", "-D", "--", &branch]).await {
            Ok(()) => text = format!("Worktree and branch {branch} removed: pull request #{pr} was merged."),
            Err(e) => eprintln!("yardd: removed merged worktree {wt}, kept branch {branch}: {e}"),
        }
    }
    eprintln!("yardd: {text} ({wt})");
    // The sessions that ran there say why their folder is gone.
    for sid in &sids {
        app.emit(sid, json!({ "type": "note", "text": text }));
    }
}

fn sessions_in(app: &App, wt: &str) -> Vec<String> {
    let root = Path::new(wt);
    app.sessions
        .lock()
        .unwrap()
        .values()
        .filter(|s| canon(Path::new(&s.meta.cwd)).starts_with(root))
        .map(|s| s.meta.id.clone())
        .collect()
}

fn canon(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

async fn git(cwd: &str, args: &[&str]) -> Option<(bool, String)> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().await.ok()?;
    Some((out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()))
}

async fn git_err(cwd: &str, args: &[&str]) -> Result<(), String> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().await.map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEAD: &str = "0123456789abcdef0123456789abcdef01234567";

    #[test]
    fn only_the_pr_whose_head_is_the_worktree_counts() {
        let list = json!([
            { "number": 7, "headRefOid": "ffffffffffffffffffffffffffffffffffffffff" },
            { "number": 9, "headRefOid": HEAD },
        ]);
        assert_eq!(pick_merged(&list, HEAD), Some(9));
        assert_eq!(pick_merged(&json!([{ "number": 7, "headRefOid": "ffff" }]), HEAD), None);
        assert_eq!(pick_merged(&json!([]), HEAD), None);
        assert_eq!(pick_merged(&json!({ "error": "x" }), HEAD), None);
    }
}
