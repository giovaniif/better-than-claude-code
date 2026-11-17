//! The PR pane: the GitHub pull request for a session folder's branch.
//!
//! Read-only. Everything goes through the user's own `gh` login, run in the
//! session folder, so yardd never holds a GitHub token.

use std::{sync::Arc, time::Duration};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::{process::Command, sync::mpsc};

use crate::state::App;

const GH_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_CHECKS: usize = 100;
const MAX_THREADS: usize = 100;
const MAX_COMMENTS: usize = 20;
const MAX_BODY_CHARS: usize = 4_000;

const PR_FIELDS: &str =
    "number,title,url,state,isDraft,baseRefName,headRefName,reviewDecision,mergeable,mergeStateStatus,statusCheckRollup";

const THREADS_QUERY: &str = "query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          isResolved isOutdated path line originalLine
          comments(first: 20) { nodes { author { login } body url } }
        }
      }
    }
  }
}";

/// Entry point for every `pr.*` op, dispatched from `ws::handle`.
pub async fn handle(app: &Arc<App>, direct: &mpsc::UnboundedSender<String>, msg: &Value) -> Result<()> {
    match msg["op"].as_str().unwrap_or("") {
        "pr.get" => {
            let sid = msg["sessionId"].as_str().context("missing `sessionId`")?;
            let meta = app.meta(sid).context("no such session")?;
            let pr = match get(&meta.cwd).await {
                Ok(pr) => pr,
                Err(e) => json!({ "error": format!("{e:#}") }),
            };
            let _ = direct.send(json!({ "op": "pr", "sessionId": sid, "pr": pr }).to_string());
        }
        other => bail!("unknown op `{other}`"),
    }
    Ok(())
}

async fn get(cwd: &str) -> Result<Value> {
    crate::git::ensure_folder(cwd)?;
    let (is_repo, _) = git(cwd, &["rev-parse", "--is-inside-work-tree"]).await?;
    if !is_repo {
        bail!("not a git repository");
    }
    // Past this point the folder is a repository, so the pane can still offer
    // a review (it reads `git diff`, not GitHub) when the PR cannot be read.
    // That review needs a base this repository has; a repo with no origin
    // has no origin/HEAD.
    match get_in_repo(cwd).await {
        Ok(pr) => Ok(pr),
        Err(e) => Ok(json!({
            "error": format!("{e:#}"),
            "repo": true,
            "defaultBranch": crate::git::local_base(cwd).await,
        })),
    }
}

async fn get_in_repo(cwd: &str) -> Result<Value> {
    let (_, branch) = git(cwd, &["branch", "--show-current"]).await?;
    let branch = branch.trim().to_string();
    if branch.is_empty() {
        bail!("no branch is checked out");
    }

    let view = match gh(cwd, &["pr", "view", "--json", PR_FIELDS]).await? {
        Ok(out) => out,
        Err(stderr) if stderr.contains("no pull requests found") => {
            return Ok(json!({
                "none": true,
                "branch": branch,
                "defaultBranch": crate::git::local_base(cwd).await,
            }));
        }
        Err(stderr) => bail!("{}", short_gh_error(&stderr)),
    };
    let pr: Value = serde_json::from_str(&view).context("gh returned something that is not JSON")?;

    let rollup = pr["statusCheckRollup"].as_array().cloned().unwrap_or_default();
    let checks: Vec<Value> = rollup.iter().take(MAX_CHECKS).map(check).collect();

    let mut out = json!({
        "number": pr["number"],
        "title": pr["title"],
        "url": pr["url"],
        "state": pr["state"],
        "isDraft": pr["isDraft"],
        "base": pr["baseRefName"],
        "head": pr["headRefName"],
        "reviewDecision": pr["reviewDecision"],
        "mergeable": pr["mergeable"],
        "mergeState": pr["mergeStateStatus"],
        "checks": checks,
        "checksTruncated": rollup.len() > MAX_CHECKS,
        "threads": [],
    });

    // Threads are a second call; a failure there should not hide the PR.
    match threads(cwd, &pr).await {
        Ok(t) => out["threads"] = t,
        Err(e) => out["threadsError"] = json!(format!("{e:#}")),
    }
    Ok(out)
}

/// One row of `statusCheckRollup`, either a CheckRun or a commit StatusContext,
/// reduced to what the pane shows.
fn check(c: &Value) -> Value {
    let (name, url, result) = if c["__typename"] == "StatusContext" {
        let result = match c["state"].as_str().unwrap_or("") {
            "SUCCESS" => "passed",
            "FAILURE" | "ERROR" => "failed",
            _ => "running",
        };
        (&c["context"], &c["targetUrl"], result)
    } else {
        let result = if c["status"].as_str() != Some("COMPLETED") {
            "running"
        } else {
            match c["conclusion"].as_str().unwrap_or("") {
                "SUCCESS" => "passed",
                "SKIPPED" => "skipped",
                "NEUTRAL" => "neutral",
                _ => "failed",
            }
        };
        (&c["name"], &c["detailsUrl"], result)
    };
    json!({ "name": name, "workflow": c["workflowName"], "result": result, "url": url })
}

async fn threads(cwd: &str, pr: &Value) -> Result<Value> {
    // The PR may live on the upstream of a fork, so take owner/name from its URL.
    let url = pr["url"].as_str().context("the PR has no URL")?;
    let parts: Vec<&str> = url.trim_end_matches('/').rsplit('/').collect();
    let (Some(number), Some(name), Some(owner)) = (parts.first(), parts.get(2), parts.get(3)) else {
        bail!("cannot read the repository from {url}");
    };
    let out = gh(
        cwd,
        &[
            "api",
            "graphql",
            "-f",
            &format!("query={THREADS_QUERY}"),
            "-f",
            &format!("owner={owner}"),
            "-f",
            &format!("name={name}"),
            "-F",
            &format!("number={number}"),
        ],
    )
    .await?
    .map_err(|stderr| anyhow::anyhow!("{}", short_gh_error(&stderr)))?;
    let data: Value = serde_json::from_str(&out).context("gh returned something that is not JSON")?;
    let nodes = data["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let threads: Vec<Value> = nodes
        .iter()
        .take(MAX_THREADS)
        .map(|t| {
            let comments: Vec<Value> = t["comments"]["nodes"]
                .as_array()
                .map(|cs| {
                    cs.iter()
                        .take(MAX_COMMENTS)
                        .map(|c| {
                            json!({
                                // A deleted account has no author.
                                "author": c["author"]["login"].as_str().unwrap_or("ghost"),
                                "body": cap(c["body"].as_str().unwrap_or("")),
                                "url": c["url"],
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            json!({
                "path": t["path"],
                // Outdated threads lose `line`; the original still says where it was.
                "line": if t["line"].is_null() { t["originalLine"].clone() } else { t["line"].clone() },
                "resolved": t["isResolved"].as_bool().unwrap_or(false),
                "outdated": t["isOutdated"].as_bool().unwrap_or(false),
                "comments": comments,
            })
        })
        .collect();
    Ok(json!(threads))
}

fn cap(body: &str) -> String {
    if body.chars().count() <= MAX_BODY_CHARS {
        return body.to_string();
    }
    let mut s: String = body.chars().take(MAX_BODY_CHARS).collect();
    s.push_str(" [cut]");
    s
}

/// gh's own messages are long and point at flags the user never typed.
fn short_gh_error(stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    if lower.contains("gh auth login") || lower.contains("not logged") || lower.contains("authentication") {
        return "gh is not logged in".into();
    }
    if lower.contains("none of the git remotes") || lower.contains("no git remotes") {
        return "no GitHub remote".into();
    }
    let first = stderr.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("gh failed");
    first.chars().take(200).collect()
}

/// Outer error: gh could not run at all. Inner: gh ran and failed, with stderr.
async fn gh(cwd: &str, args: &[&str]) -> Result<std::result::Result<String, String>> {
    let child = Command::new("gh")
        .args(args)
        .current_dir(cwd)
        .env("GH_PROMPT_DISABLED", "1")
        .env("GH_NO_UPDATE_NOTIFIER", "1")
        .env("NO_COLOR", "1")
        .kill_on_drop(true)
        .output();
    let out = match tokio::time::timeout(GH_TIMEOUT, child).await {
        Err(_) => bail!("gh did not answer within {} s", GH_TIMEOUT.as_secs()),
        Ok(Err(e)) if e.kind() == std::io::ErrorKind::NotFound => bail!("gh is not installed"),
        Ok(Err(e)) => return Err(e).context("could not run gh"),
        Ok(Ok(out)) => out,
    };
    if out.status.success() {
        Ok(Ok(String::from_utf8_lossy(&out.stdout).into_owned()))
    } else {
        Ok(Err(String::from_utf8_lossy(&out.stderr).into_owned()))
    }
}

async fn git(cwd: &str, args: &[&str]) -> Result<(bool, String)> {
    let out = Command::new("git").arg("-C").arg(cwd).args(args).output().await?;
    Ok((out.status.success(), String::from_utf8_lossy(&out.stdout).into_owned()))
}
