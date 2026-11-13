//! Git: working-tree changes for the Changes pane, and session worktrees.

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::process::Command;

const MAX_DIFF_BYTES: usize = 400_000;

pub struct NewWorktree {
    /// Where the session runs: the worktree, or the same subfolder inside it.
    pub cwd: String,
    pub branch: String,
    /// The checkout it was cut from.
    pub repo: String,
}

/// `Fix the add function!` -> `fix-the-add-function`
fn slug(text: &str) -> String {
    // Whole words only, so the name never ends mid-word.
    let mut out = String::new();
    for word in text.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).take(5) {
        if out.len() + word.len() + 1 > 32 {
            break;
        }
        if !out.is_empty() {
            out.push('-');
        }
        out.push_str(&word.to_ascii_lowercase());
    }
    if out.is_empty() { "session".to_string() } else { out }
}

/// Cut a new branch and worktree from the folder's current HEAD, under
/// `~/.yard/wt/<repo>/<branch>`. Nothing in the original checkout is touched,
/// and a failed `git worktree add` stops here: the caller must not go on to
/// set anything up.
pub async fn add_worktree(folder: &str, branch: Option<&str>, title: &str, suffix: &str) -> Result<NewWorktree> {
    let (is_repo, top) = git(folder, &["rev-parse", "--show-toplevel"]).await?;
    if !is_repo {
        bail!("{folder} is not a git repository, so it cannot have a worktree");
    }
    let top = top.trim().to_string();
    let (has_head, _) = git(&top, &["rev-parse", "--verify", "HEAD"]).await?;
    if !has_head {
        bail!("the repository has no commits yet, so there is nothing to branch from");
    }
    // The subfolder the session was pointed at, e.g. `apps/web/`.
    let (_, prefix) = git(folder, &["rev-parse", "--show-prefix"]).await?;

    let branch = match branch.map(str::trim).filter(|b| !b.is_empty()) {
        Some(b) => b.to_string(),
        None => format!("yard/{}-{suffix}", slug(title)),
    };
    let (valid, _) = git(&top, &["check-ref-format", "--branch", &branch]).await?;
    if !valid {
        bail!("`{branch}` is not a valid branch name");
    }
    let (exists, _) = git(&top, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{branch}")]).await?;
    if exists {
        bail!("branch `{branch}` already exists");
    }

    let home = std::env::var("HOME").context("HOME is not set")?;
    let repo_name = Path::new(&top)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();
    let path: PathBuf = [&home, ".yard", "wt", &repo_name, &branch.replace('/', "-")].iter().collect();
    if path.exists() {
        bail!("{} already exists", path.display());
    }
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let path_str = path.to_str().context("worktree path is not valid UTF-8")?;

    let out = Command::new("git")
        .arg("-C")
        .arg(&top)
        .args(["worktree", "add", "-b", &branch, path_str, "HEAD"])
        .output()
        .await?;
    if !out.status.success() {
        bail!("git worktree add failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }

    let cwd = path.join(prefix.trim());
    Ok(NewWorktree {
        cwd: cwd.to_str().unwrap_or(path_str).trim_end_matches('/').to_string(),
        branch,
        repo: top,
    })
}

async fn git(cwd: &str, args: &[&str]) -> Result<(bool, String)> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().await?;
    Ok((out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()))
}

pub async fn changes(cwd: &str) -> Result<Value> {
    let (is_repo, _) = git(cwd, &["rev-parse", "--is-inside-work-tree"]).await?;
    if !is_repo {
        bail!("not a git repository");
    }
    // A repo with no commits has no HEAD to diff against.
    let (has_head, _) = git(cwd, &["rev-parse", "--verify", "HEAD"]).await?;
    let base: &[&str] = if has_head { &["HEAD"] } else { &[] };

    let (_, numstat) = git(cwd, &[&["diff", "--numstat"], base].concat()).await?;
    let mut files: Vec<Value> = numstat
        .lines()
        .filter_map(|l| {
            let mut parts = l.splitn(3, '\t');
            let added = parts.next()?;
            let removed = parts.next()?;
            let path = parts.next()?;
            Some(json!({
                "path": path,
                "added": added.parse::<u64>().ok(),
                "removed": removed.parse::<u64>().ok(),
            }))
        })
        .collect();

    let (_, untracked) = git(cwd, &["ls-files", "--others", "--exclude-standard"]).await?;
    for path in untracked.lines().take(200) {
        files.push(json!({ "path": path, "added": null, "removed": null, "untracked": true }));
    }

    let (_, mut diff) = git(cwd, &[&["diff"], base].concat()).await?;
    let truncated = diff.len() > MAX_DIFF_BYTES;
    if truncated {
        let mut cut = MAX_DIFF_BYTES;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
    }

    let (_, branch) = git(cwd, &["branch", "--show-current"]).await?;
    Ok(json!({
        "files": files,
        "diff": diff,
        "truncated": truncated,
        "branch": branch.trim(),
    }))
}
