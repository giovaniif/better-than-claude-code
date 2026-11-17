//! `pr.peek`, the hover card on a PR link: validation, the per-URL cache that
//! keeps a list of links from forking a gh per hover, and routing to the host
//! where the session lives. `gh` is the fake in `verify/fakes/gh` (needs Bun).

mod common;

use std::{fs, os::unix::fs::symlink};

use common::*;
use serde_json::{json, Value};

const URL: &str = "https://github.com/test-owner/test-demo-app/pull/4242";

/// A daemon whose `gh` is the fake, answering PR #4242 after `delay_ms`.
fn start(sb: &Sandbox, delay_ms: u64) -> Daemon {
    let bin = sb.root.join("bin");
    fs::create_dir_all(&bin).unwrap();
    symlink(repo_root().join("verify/fakes/gh"), bin.join("gh")).unwrap();
    let view = json!({
        "number": 4242, "title": "TEST-fix the greeting", "url": URL, "state": "OPEN", "isDraft": false,
        "author": { "login": "test-author" }, "baseRefName": "main", "headRefName": "test-fix",
        "reviewDecision": "REVIEW_REQUIRED", "mergeStateStatus": "BLOCKED", "additions": 12, "deletions": 3,
        "updatedAt": "2026-11-16T10:00:00Z",
        "statusCheckRollup": [
            { "__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "SUCCESS" },
            { "__typename": "CheckRun", "name": "lint", "status": "COMPLETED", "conclusion": "FAILURE" },
        ],
    });
    fs::write(sb.fake_state().join("gh-pr.json"), json!({ "view": view, "peekDelayMs": delay_ms }).to_string()).unwrap();
    let path = format!("{}:{}:{}", bin.display(), fake_bin().display(), std::env::var("PATH").unwrap_or_default());
    sb.start_with(&[("PATH", &path)])
}

/// How many times gh was asked about a PR by URL.
fn peeks_run(sb: &Sandbox) -> usize {
    let log = fs::read_to_string(sb.fake_state().join("gh.log")).unwrap_or_default();
    log.lines().filter(|l| l.starts_with("pr view https://")).count()
}

async fn peek(c: &mut Client, sid: &str, url: &str, r: &str) -> Value {
    let from = c.mark();
    c.send(json!({ "op": "pr.peek", "sessionId": sid, "url": url, "ref": r })).await;
    c.wait_after(from, "the pr.peek reply", |m| m["ref"] == r).await
}

#[tokio::test]
async fn a_pr_link_peeks_once_per_url_and_refuses_anything_else() {
    let sb = Sandbox::new("peek");
    let d = start(&sb, 600);
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "hi", json!({})).await;

    // Three hovers while the first gh is still running share it, the /files tab too.
    let from = c.mark();
    for (r, url) in [("a", URL), ("b", URL), ("c", &format!("{URL}/files#diff")[..])] {
        c.send(json!({ "op": "pr.peek", "sessionId": sid, "url": url, "ref": r })).await;
    }
    for r in ["a", "b", "c"] {
        let reply = c.wait_after(from, "a pr.peek reply", |m| m["op"] == "pr.peek" && m["ref"] == r).await;
        assert_eq!(reply["sessionId"], sid);
        assert_eq!(reply["url"], URL);
        let pr = &reply["pr"];
        assert_eq!(pr["number"], 4242, "{reply}");
        assert_eq!(pr["repo"], "test-owner/test-demo-app");
        assert_eq!(pr["author"], "test-author");
        assert_eq!(pr["additions"], 12);
        assert_eq!(pr["checks"], json!({ "passed": 1, "failed": 1, "running": 0, "failing": ["lint"] }));
    }
    assert_eq!(peeks_run(&sb), 1);

    // Asked again within the minute: the cached answer.
    assert_eq!(peek(&mut c, &sid, URL, "d").await["pr"]["number"], 4242);
    assert_eq!(peeks_run(&sb), 1);

    // Not a PR link: refused before gh, so user text never becomes an argument.
    for (r, url) in [("e", "--help"), ("f", "https://github.com/o/r/issues/1"), ("g", "https://evil.example/o/r/pull/1")] {
        let reply = peek(&mut c, &sid, url, r).await;
        assert_eq!(reply["error"], "not a GitHub pull request link", "{url}");
        assert!(reply["pr"].is_null());
    }
    assert_eq!(peeks_run(&sb), 1);

    // A PR gh cannot find says so, in the reply rather than as an `error` op.
    let missing = peek(&mut c, &sid, "https://github.com/test-owner/test-demo-app/pull/9999", "h").await;
    assert_eq!(missing["op"], "pr.peek");
    assert_eq!(missing["error"], "no such pull request, or no access to it");

    // An unknown session is an ordinary refusal, carrying the ref.
    let none = peek(&mut c, "nope", URL, "i").await;
    assert_eq!(none["op"], "error");
    assert_eq!(none["for"], "pr.peek");
}

#[tokio::test]
async fn a_remote_session_peeks_with_its_own_hosts_gh() {
    let remote_sb = Sandbox::new("peek-remote");
    let remote = start(&remote_sb, 0);
    let hub_sb = Sandbox::new("peek-hub");
    // The hub's gh would answer too; only the remote's may be asked.
    let hub = start(&hub_sb, 0);
    let mut c = hub.client().await;
    c.send(json!({ "op": "host.add", "name": "box", "kind": "direct", "url": remote.url() })).await;
    let hosts = c
        .wait_for("the direct host to connect", |m| {
            m["op"] == "hosts" && m["hosts"].as_array().is_some_and(|h| h.iter().any(|h| h["status"] == "connected"))
        })
        .await;
    let host = hosts["hosts"][0]["id"].as_str().unwrap().to_string();
    c.wait_for("the host's snapshot", |m| m["op"] == "host.snapshot" && m["hostId"] == host).await;
    let sid = c.create(&remote_sb.folder("proj"), "hi", json!({ "host": host })).await;
    assert!(sid.starts_with(&format!("{host}~")));

    let reply = peek(&mut c, &sid, URL, "r1").await;
    assert_eq!(reply["op"], "pr.peek");
    assert_eq!(reply["sessionId"], sid);
    assert_eq!(reply["pr"]["number"], 4242, "{reply}");
    assert_eq!(peeks_run(&remote_sb), 1);
    assert_eq!(peeks_run(&hub_sb), 0);
}
