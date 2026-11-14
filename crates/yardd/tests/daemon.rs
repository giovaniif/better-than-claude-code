//! yardd end to end: the built daemon, driven over its WebSocket, with the
//! scripted fake Codex in `tests/fake-codex` instead of the real CLI.

mod common;

use std::{
    fs,
    path::Path,
    time::{Duration, Instant},
};

use base64::Engine as _;
use common::*;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::HeaderValue};

#[tokio::test]
async fn snapshot_has_its_shape_and_the_fake_models() {
    let sb = Sandbox::new("snapshot");
    let d = sb.start();
    let mut c = d.client().await;

    let snap = c.log[0].clone();
    assert_eq!(snap["op"], "snapshot");
    assert_eq!(snap["sessions"], json!([]));
    assert_eq!(snap["hosts"], json!([]));
    assert_eq!(snap["home"], sb.home().to_str().unwrap());
    assert!(snap["usage"].is_object());
    let claude: Vec<&str> = snap["models"]["claude"].as_array().unwrap().iter().map(|m| m["id"].as_str().unwrap()).collect();
    assert!(claude.contains(&"claude-opus-5-5"), "{claude:?}");

    // The model list comes from the fake, either in the snapshot or right after it.
    let codex = c
        .wait_for("codex models from the fake", |m| {
            let models = if m["op"] == "snapshot" || m["op"] == "models" { &m["models"]["codex"] } else { &Value::Null };
            models.as_array().is_some_and(|l| !l.is_empty())
        })
        .await["models"]["codex"]
        .clone();
    assert_eq!(
        codex,
        json!([
            { "id": "fake-fast", "name": "Fake Fast", "efforts": ["low", "high"], "defaultEffort": "low", "isDefault": true },
            { "id": "fake-deep", "name": "Fake Deep", "efforts": ["medium", "xhigh"], "defaultEffort": "medium", "isDefault": false },
        ])
    );
    let usage = c
        .wait_for("codex usage from the fake", |m| {
            (m["op"] == "usage" || m["op"] == "snapshot") && !m["usage"]["codex"].is_null()
        })
        .await;
    assert_eq!(usage["usage"]["codex"]["primary"]["usedPercent"], 12);
}

#[tokio::test]
async fn a_plain_turn_streams_then_completes() {
    let sb = Sandbox::new("plain");
    let d = sb.start();
    let mut c = d.client().await;
    let cwd = sb.folder("proj");

    let sid = c.create(&cwd, "say hello", json!({})).await;
    let done = c.wait_turn_done(&sid, 0).await;
    assert_eq!(done["status"], "completed");
    c.wait_status(&sid, "idle").await;

    let session = c.wait_for("the session's metadata", |m| m["op"] == "session" && m["session"]["id"] == sid).await;
    assert_eq!(session["session"]["engine"], "codex");
    assert_eq!(session["session"]["model"], MODEL);
    assert_eq!(session["session"]["cwd"], cwd);
    assert_eq!(session["session"]["title"], "say hello");

    let events = c.events(&sid);
    assert_eq!(
        types(&events),
        [
            "user_message",
            "turn_started",
            "assistant_delta",
            "assistant_delta",
            "assistant_delta",
            "assistant_message",
            "turn_completed"
        ]
    );
    assert_eq!(events[0]["text"], "say hello");
    let streamed: String = events.iter().filter(|e| e["type"] == "assistant_delta").map(|e| e["text"].as_str().unwrap()).collect();
    assert_eq!(streamed, "Echo: say hello");
    assert_eq!(events[5]["text"], "Echo: say hello");
    assert_eq!(events[2]["itemId"], events[5]["itemId"], "deltas and the final message share an item");
    assert_eq!(c.statuses(&sid), ["running", "idle"]);

    // A follow-up in the same thread.
    let next = c.next_seq(&sid);
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "again" })).await;
    c.wait_turn_done(&sid, next).await;
    let last = c.events(&sid);
    assert_eq!(last[last.len() - 2]["text"], "Echo: again");
    assert_eq!(sb.codex_log().matches("req thread/start").count(), 1);
    assert!(sb.codex_log().contains("req thread/start sandbox=workspace-write"), "{}", sb.codex_log());
}

#[tokio::test]
async fn the_codex_sandbox_can_be_set() {
    let sb = Sandbox::new("sandbox");
    let d = sb.start_with(&[("YARD_CODEX_SANDBOX", "danger-full-access")]);
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "hi", json!({})).await;
    c.wait_turn_done(&sid, 0).await;
    assert!(sb.codex_log().contains("req thread/start sandbox=danger-full-access"), "{}", sb.codex_log());
}

#[tokio::test]
async fn approval_allow_runs_the_command() {
    let sb = Sandbox::new("allow");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[cmd] run it", json!({})).await;

    let req = c.wait_event(&sid, "approval_request", 0).await;
    assert_eq!(req["kind"], "command");
    assert_eq!(req["title"], "echo approved", "the shell wrapper is stripped");
    assert_eq!(req["detail"], "needs to run a command");
    c.wait_status(&sid, "needs_approval").await;

    c.send(json!({ "op": "session.approve", "sessionId": sid, "requestId": req["requestId"], "decision": "allow" }))
        .await;
    let resolved = c.wait_event(&sid, "approval_resolved", 0).await;
    assert_eq!(resolved["decision"], "allow");
    let tool = c.wait_event(&sid, "tool_completed", 0).await;
    assert_eq!(tool["ok"], true);
    assert_eq!(tool["output"], "approved\n");
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");
    c.wait_status(&sid, "idle").await;
    assert_eq!(c.statuses(&sid), ["running", "needs_approval", "running", "idle"]);
    let started = c.wait_event(&sid, "tool_started", 0).await;
    assert_eq!(started["detail"], "echo approved");
}

#[tokio::test]
async fn approval_deny_declines_the_command() {
    let sb = Sandbox::new("deny");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[cmd] run it", json!({})).await;

    let req = c.wait_event(&sid, "approval_request", 0).await;
    c.send(json!({ "op": "session.approve", "sessionId": sid, "requestId": req["requestId"], "decision": "deny" }))
        .await;
    let tool = c.wait_event(&sid, "tool_completed", 0).await;
    assert_eq!(tool["ok"], false);
    assert_eq!(tool["note"], "declined");
    assert_eq!(c.wait_event(&sid, "assistant_message", 0).await["text"], "Skipped it.");
    c.wait_turn_done(&sid, 0).await;
    c.wait_status(&sid, "idle").await;

    // The request is answered; a second answer is refused.
    let from = c.mark();
    c.send(json!({ "op": "session.approve", "sessionId": sid, "requestId": req["requestId"], "decision": "allow" }))
        .await;
    assert!(c.wait_error(from, "session.approve").await.contains("no longer pending"));
}

#[tokio::test]
async fn a_file_change_carries_its_diff_with_relative_paths() {
    let sb = Sandbox::new("edit");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[edit] add a function", json!({})).await;

    let change = c.wait_event(&sid, "file_change", 0).await;
    let files = change["files"].as_array().unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0]["path"], "src/lib.rs");
    assert_eq!(files[0]["kind"], "update");
    assert!(files[0]["diff"].as_str().unwrap().contains("+fn added() {}"));
    c.wait_turn_done(&sid, 0).await;
}

#[tokio::test]
async fn interrupt_ends_a_slow_turn_and_a_second_send_is_refused() {
    let sb = Sandbox::new("interrupt");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[slow] think hard", json!({})).await;
    c.wait_event(&sid, "assistant_delta", 0).await;

    let from = c.mark();
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "and another" })).await;
    assert_eq!(c.wait_error(from, "session.send").await, "a turn is already running");

    c.send(json!({ "op": "session.interrupt", "sessionId": sid })).await;
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "interrupted");
    c.wait_status(&sid, "idle").await;
    assert_eq!(c.event_types(&sid).iter().filter(|t| *t == "user_message").count(), 1, "the refused message was not logged");
}

#[tokio::test]
async fn an_error_turn_reports_and_fails() {
    let sb = Sandbox::new("error");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[fail] please", json!({})).await;

    let err = c.wait_event(&sid, "error", 0).await;
    assert_eq!(err["message"], "fake failure: the model is unavailable");
    let done = c.wait_turn_done(&sid, 0).await;
    assert_eq!(done["status"], "failed");
    assert!(err["seq"].as_u64() < done["seq"].as_u64());
    c.wait_status(&sid, "idle").await;
}

#[tokio::test]
async fn sessions_survive_a_restart_and_resume_their_thread() {
    let sb = Sandbox::new("persist");
    let cwd = sb.folder("proj");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&cwd, "remember me", json!({})).await;
    c.wait_turn_done(&sid, 0).await;
    c.wait_status(&sid, "idle").await;
    d.stop();

    let d = sb.start();
    let mut c = d.client().await;
    let snap = c.log[0].clone();
    let restored = snap["sessions"].as_array().unwrap().iter().find(|s| s["id"] == sid).expect("session is back");
    assert_eq!(restored["status"], "idle");
    assert_eq!(restored["cwd"], cwd);
    let history = c.history(&sid).await;
    assert_eq!(types(&history), ["user_message", "turn_started", "assistant_message", "turn_completed"], "no deltas saved");
    assert_eq!(history[2]["text"], "Echo: remember me");

    // A follow-up reopens the saved thread on the (new) fake.
    let thread = sb.codex_log().lines().find_map(|l| l.strip_prefix("req turn/start ")).unwrap().to_string();
    let next = history.len() as u64;
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "still there?" })).await;
    assert_eq!(c.wait_turn_done(&sid, next).await["status"], "completed");
    assert!(sb.codex_log().contains(&format!("req thread/resume {thread}")), "{}", sb.codex_log());
    assert_eq!(sb.codex_log().matches("req thread/start").count(), 1);

    // Killed in the middle of a turn: back as idle with the restart error.
    let next = c.next_seq(&sid);
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "[slow] long job" })).await;
    c.wait_event(&sid, "assistant_delta", next).await;
    let deadline = Instant::now() + WAIT;
    while saved_status(&sb, &sid).as_deref() != Some("running") {
        assert!(Instant::now() < deadline, "the running status never reached the database");
        std::thread::sleep(Duration::from_millis(10));
    }
    d.kill();

    let d = sb.start();
    let mut c = d.client().await;
    let back = c.log[0]["sessions"].as_array().unwrap().iter().find(|s| s["id"] == sid).unwrap().clone();
    assert_eq!(back["status"], "idle");
    let history = c.history(&sid).await;
    let n = history.len();
    assert_eq!(history[n - 2], json!({ "type": "error", "message": "yardd restarted during this turn." }));
    assert_eq!(history[n - 1], json!({ "type": "turn_completed", "status": "failed" }));
}

#[tokio::test]
async fn resuming_a_thread_the_engine_lost_fails_the_turn() {
    let sb = Sandbox::new("lost");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "hi", json!({})).await;
    c.wait_turn_done(&sid, 0).await;
    c.wait_status(&sid, "idle").await;
    d.stop();
    fs::remove_file(sb.fake_state().join("threads.json")).unwrap();

    let d = sb.start();
    let mut c = d.client().await;
    let next = c.history(&sid).await.len() as u64;
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "hello?" })).await;
    let err = c.wait_event(&sid, "error", next).await;
    assert!(err["message"].as_str().unwrap().contains("no such thread"), "{err}");
    assert_eq!(c.wait_turn_done(&sid, next).await["status"], "failed");
}

#[tokio::test]
async fn delete_removes_a_session_across_a_restart() {
    let sb = Sandbox::new("delete");
    let d = sb.start();
    let mut c = d.client().await;
    let keep = c.create(&sb.folder("a"), "keep me", json!({})).await;
    let gone = c.create(&sb.folder("b"), "delete me", json!({})).await;
    c.wait_turn_done(&keep, 0).await;
    c.wait_turn_done(&gone, 0).await;
    c.send(json!({ "op": "session.delete", "sessionId": gone })).await;
    c.wait_for("session.deleted", |m| m["op"] == "session.deleted" && m["sessionId"] == gone).await;
    d.stop();

    let d = sb.start();
    let mut c = d.client().await;
    let ids: Vec<&str> = c.log[0]["sessions"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [keep.as_str()]);
    assert_eq!(c.history(&gone).await, Vec::<Value>::new());
}

#[tokio::test]
async fn forced_pressure_queues_until_start_now() {
    let sb = Sandbox::new("queue");
    let d = sb.start_with(&[("YARD_FORCE_PRESSURE", "1")]);
    let mut c = d.client().await;
    // The attachment waits in the queue with the prompt.
    let shot = c.upload("shot.png", "image/png", &png(40), json!({})).await.unwrap();
    let sid = c.try_create(&sb.folder("proj"), "wait your turn", json!({ "attachments": [shot["id"]] })).await.unwrap();

    let queued = c.wait_event(&sid, "queued", 0).await;
    assert_eq!(queued["text"], "wait your turn");
    assert_eq!(queued["attachments"][0]["id"], shot["id"]);
    assert!(queued["reason"].as_str().unwrap().contains("YARD_FORCE_PRESSURE"));
    c.wait_status(&sid, "queued").await;
    assert_eq!(c.event_types(&sid), ["user_message", "queued"]);

    // Queued sessions take no messages until started.
    let from = c.mark();
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "now?" })).await;
    assert!(c.wait_error(from, "session.send").await.contains("queued"));
    assert!(!sb.codex_log().contains("req turn/start"), "no turn reached the engine");

    c.send(json!({ "op": "session.startNow", "sessionId": sid })).await;
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");
    let answer = c.wait_event(&sid, "assistant_message", 0).await;
    assert!(answer["text"].as_str().unwrap().starts_with("Echo: wait your turn\n\nAttached files:"), "{answer}");
    assert_eq!(split_input(&sb.turn_inputs()[0]).1, [shot["path"].as_str().unwrap()]);
    c.wait_status(&sid, "idle").await;

    let from = c.mark();
    c.send(json!({ "op": "session.startNow", "sessionId": sid })).await;
    assert_eq!(c.wait_error(from, "session.startNow").await, "this session is not queued");
}

#[tokio::test]
async fn one_writer_per_folder() {
    let sb = Sandbox::new("writer");
    let d = sb.start();
    let mut c = d.client().await;
    let cwd = sb.folder("proj");
    let first = c.create(&cwd, "[slow] busy", json!({})).await;
    c.wait_event(&first, "assistant_delta", 0).await;

    let refused = c.try_create(&cwd, "me too", json!({})).await.unwrap_err();
    assert!(refused.contains("Another session is working in this folder"), "{refused}");
    // The same folder spelled with a trailing slash is still the same folder.
    let refused = c.try_create(&format!("{cwd}/"), "me too", json!({})).await.unwrap_err();
    assert!(refused.contains("Another session is working"), "{refused}");

    c.send(json!({ "op": "session.interrupt", "sessionId": first })).await;
    c.wait_turn_done(&first, 0).await;
    c.wait_status(&first, "idle").await;
    let second = c.create(&cwd, "my turn now", json!({})).await;
    c.wait_turn_done(&second, 0).await;
}

#[tokio::test]
async fn worktree_branches_and_a_session_from_a_base() {
    let sb = Sandbox::new("worktree");
    let repo = make_repo(&sb, "repo");
    let d = sb.start();
    let mut c = d.client().await;

    c.send(json!({ "op": "git.branches", "cwd": repo })).await;
    let branches = c.wait_for("git.branches", |m| m["op"] == "git.branches").await;
    assert_eq!(branches["current"], "main");
    let mut names: Vec<&str> = branches["branches"].as_array().unwrap().iter().map(|b| b.as_str().unwrap()).collect();
    names.sort();
    assert_eq!(names, ["feature", "main"]);

    let sid = c.create(&repo, "work on the feature", json!({ "worktree": true, "base": "feature" })).await;
    let meta = c.wait_for("the worktree session", |m| m["op"] == "session" && m["session"]["id"] == sid).await["session"].clone();
    let branch = meta["branch"].as_str().unwrap();
    assert!(branch.starts_with("yard/work-on-the-feature-"), "{branch}");
    assert_eq!(meta["repo"], repo);
    let wt = meta["cwd"].as_str().unwrap();
    assert!(Path::new(wt).starts_with(sb.data().join("wt")), "{wt}");
    let home = sb.home();
    assert_eq!(git(wt, &["rev-parse", "HEAD"], &home), git(&repo, &["rev-parse", "feature"], &home));
    assert!(Path::new(wt).join("feature.txt").is_file());
    c.wait_turn_done(&sid, 0).await;
    assert_eq!(git(&repo, &["branch", "--show-current"], &home), "main", "the original checkout stays put");

    let refused = c.try_create(&repo, "bad base", json!({ "worktree": true, "base": "nope" })).await.unwrap_err();
    assert!(refused.contains("is not a branch or commit"), "{refused}");
}

#[tokio::test]
async fn a_folder_outside_a_repository_runs_in_place() {
    let sb = Sandbox::new("inplace");
    let plain = sb.folder("plain");
    let d = sb.start();
    let mut c = d.client().await;

    // The UI always asks for a worktree; a folder that cannot have one is
    // not an error, it just runs there.
    let sid = c.create(&plain, "no repo here", json!({ "worktree": true })).await;
    let meta = c.wait_for("the session", |m| m["op"] == "session" && m["session"]["id"] == sid).await["session"].clone();
    assert_eq!(meta["cwd"], plain);
    assert!(meta["branch"].is_null(), "{meta}");
    let note = c.wait_event(&sid, "note", 0).await;
    assert!(note["text"].as_str().unwrap().contains("in the folder itself"), "{note}");
    c.wait_turn_done(&sid, 0).await;
}

#[tokio::test]
async fn folders_are_listed_for_the_picker() {
    let sb = Sandbox::new("dirs");
    let repo = make_repo(&sb, "repo");
    let parent = Path::new(&repo).parent().unwrap().to_str().unwrap().to_string();
    fs::create_dir_all(Path::new(&parent).join(".hidden")).unwrap();
    fs::write(Path::new(&parent).join("a-file.txt"), "not a folder").unwrap();
    let d = sb.start();
    let mut c = d.client().await;

    c.send(json!({ "op": "fs.dirs", "path": parent })).await;
    let reply = c.wait_for("fs.dirs", |m| m["op"] == "fs.dirs").await;
    let dirs = reply["dirs"].as_array().unwrap();
    let repo_entry = dirs.iter().find(|d| d["name"] == "repo").expect("the repo is listed");
    assert_eq!(repo_entry["git"], true);
    assert!(dirs.iter().any(|d| d["name"] == ".hidden"), "hidden folders are sent; the UI filters them");
    assert!(!dirs.iter().any(|d| d["name"] == "a-file.txt"), "files are not folders");

    c.send(json!({ "op": "fs.dirs", "path": "relative/path" })).await;
    let refused = c.wait_for("fs.dirs refusal", |m| m["op"] == "fs.dirs" && m["path"] == "relative/path").await;
    assert!(refused["error"].as_str().unwrap().contains("absolute"), "{refused}");
}

#[tokio::test]
async fn a_failing_worktree_setup_makes_no_session() {
    let sb = Sandbox::new("setup");
    let repo = make_repo(&sb, "repo");
    let home = sb.home();
    fs::create_dir_all(Path::new(&repo).join(".yard")).unwrap();
    fs::write(Path::new(&repo).join(".yard/worktree-setup.sh"), "echo setting up\necho broken >&2\nexit 3\n").unwrap();
    git(&repo, &["add", "."], &home);
    git(&repo, &["commit", "-q", "-m", "setup script"], &home);
    let head = git(&repo, &["rev-parse", "HEAD"], &home);
    let d = sb.start();
    let mut c = d.client().await;

    let refused = c.try_create(&repo, "set me up", json!({ "worktree": true })).await.unwrap_err();
    assert!(refused.contains("worktree setup"), "{refused}");
    assert!(refused.contains("broken"), "the script's output is shown: {refused}");
    assert!(!c.log.iter().any(|m| m["op"] == "session"), "no session was made");

    assert_eq!(git(&repo, &["status", "--porcelain"], &home), "");
    assert_eq!(git(&repo, &["rev-parse", "HEAD"], &home), head);
    assert_eq!(git(&repo, &["branch", "--show-current"], &home), "main");
    assert_eq!(git(&repo, &["branch", "--format=%(refname:short)"], &home), "feature\nmain");
    assert_eq!(git(&repo, &["worktree", "list"], &home).lines().count(), 1);
}

#[tokio::test]
async fn removing_a_dirty_worktree_is_refused() {
    let sb = Sandbox::new("rmwt");
    let repo = make_repo(&sb, "repo");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&repo, "scratch", json!({ "worktree": true })).await;
    c.wait_turn_done(&sid, 0).await;
    c.wait_status(&sid, "idle").await;
    let wt = c.wait_for("the worktree session", |m| m["op"] == "session" && m["session"]["id"] == sid).await["session"]["cwd"]
        .as_str()
        .unwrap()
        .to_string();

    fs::write(Path::new(&wt).join("notes.txt"), "unsaved\n").unwrap();
    let from = c.mark();
    c.send(json!({ "op": "session.delete", "sessionId": sid, "removeWorktree": true })).await;
    let refused = c.wait_error(from, "session.delete").await;
    assert!(refused.contains("uncommitted or untracked"), "{refused}");
    assert!(Path::new(&wt).join("notes.txt").is_file(), "nothing was deleted");

    // Clean again, it goes, with its branch.
    fs::remove_file(Path::new(&wt).join("notes.txt")).unwrap();
    c.send(json!({ "op": "session.delete", "sessionId": sid, "removeWorktree": true })).await;
    let removed = c.wait_for("worktree.removed", |m| m["op"] == "worktree.removed").await;
    assert_eq!(removed["branchDeleted"], true);
    assert!(!Path::new(&wt).exists());
}

#[tokio::test]
async fn handoff_to_the_same_engine_or_mid_turn_is_refused() {
    let sb = Sandbox::new("handoff");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[slow] start", json!({})).await;
    c.wait_event(&sid, "assistant_delta", 0).await;

    // To Claude while a turn runs: refused before any Claude session exists.
    let from = c.mark();
    c.send(json!({ "op": "session.handoff", "sessionId": sid, "engine": "claude", "model": "claude-haiku-5-5", "effort": "low" }))
        .await;
    assert_eq!(c.wait_error(from, "session.handoff").await, "stop the running turn before handing off");

    c.send(json!({ "op": "session.interrupt", "sessionId": sid })).await;
    c.wait_turn_done(&sid, 0).await;
    c.wait_status(&sid, "idle").await;

    let from = c.mark();
    c.send(json!({ "op": "session.handoff", "sessionId": sid, "engine": "codex", "model": "fake-deep", "effort": "medium" }))
        .await;
    assert!(c.wait_error(from, "session.handoff").await.contains("already runs on Codex"));
    assert!(!c.log.iter().any(|m| m["op"] == "created" && m["sessionId"] != sid));
}

#[tokio::test]
async fn terminal_runs_commands_and_replays_its_scrollback() {
    let sb = Sandbox::new("term");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "hi", json!({})).await;

    let from = c.mark();
    c.send(json!({ "op": "term.open", "sessionId": sid, "cols": 80, "rows": 24 })).await;
    let opened = c.wait_after(from, "term.opened", |m| m["op"] == "term.opened").await;
    let term = opened["termId"].as_str().unwrap().to_string();
    assert_eq!(opened["sessionId"], sid);
    assert_eq!(opened["offset"], 0);

    c.send(json!({ "op": "term.input", "termId": term, "data": "echo hi\n" })).await;
    // The typed line echoes back too, so `hi` on a line of its own shows the command ran.
    let output = |c: &Client| -> (u64, Vec<u8>) {
        let mut chunks: Vec<(u64, Vec<u8>)> = c
            .log
            .iter()
            .filter(|m| m["op"] == "term.data" && m["termId"] == term)
            .map(|m| (m["offset"].as_u64().unwrap(), b64(m["data"].as_str().unwrap())))
            .collect();
        chunks.sort_by_key(|(o, _)| *o);
        let mut all = b64(opened["data"].as_str().unwrap());
        for (offset, bytes) in chunks {
            assert_eq!(offset, all.len() as u64, "chunks are contiguous");
            all.extend(bytes);
        }
        (all.len() as u64, all)
    };
    loop {
        let (_, all) = output(&c);
        // bash wraps each command in bracketed-paste toggles (`\e[?2004l\r`),
        // so the last carriage-return segment of a line is what shows.
        let text = String::from_utf8_lossy(&all).into_owned();
        if text.lines().any(|l| l.trim_end_matches('\r').rsplit('\r').next() == Some("hi")) {
            break;
        }
        let from = c.mark();
        c.wait_after(from, "more terminal output with `hi`", |m| m["op"] == "term.data").await;
    }

    // Reattach: the same terminal, its scrollback from offset 0, ending where the stream is.
    let (total, all) = output(&c);
    let from = c.mark();
    c.send(json!({ "op": "term.open", "sessionId": sid, "cols": 100, "rows": 30 })).await;
    let again = c.wait_after(from, "term.opened again", |m| m["op"] == "term.opened").await;
    assert_eq!(again["termId"], term);
    let scroll = b64(again["data"].as_str().unwrap());
    let offset = again["offset"].as_u64().unwrap();
    assert_eq!(offset, 0);
    // The shell may print more (a prompt) between the two reads; never less.
    assert!(offset + scroll.len() as u64 >= total);
    assert_eq!(&scroll[..all.len()], &all[..]);

    // A second client attaching sees the same scrollback.
    let mut other = d.client().await;
    other.send(json!({ "op": "term.open", "sessionId": sid })).await;
    let theirs = other.wait_for("term.opened on a second client", |m| m["op"] == "term.opened").await;
    assert_eq!(theirs["termId"], term);
    assert!(b64(theirs["data"].as_str().unwrap()).starts_with(&all));
}

fn b64(s: &str) -> Vec<u8> {
    base64::engine::general_purpose::STANDARD.decode(s).unwrap()
}

#[tokio::test]
async fn foreign_origins_are_refused() {
    let sb = Sandbox::new("origin");
    let d = sb.start();
    let connect = |origin: &'static str| {
        let mut req = d.url().into_client_request().unwrap();
        req.headers_mut().insert("Origin", HeaderValue::from_str(&origin.replace("PORT", &d.port.to_string())).unwrap());
        tokio_tungstenite::connect_async(req)
    };

    match connect("http://evil.example").await {
        Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => assert_eq!(resp.status(), 403),
        Err(e) => panic!("expected a 403, got {e}"),
        Ok(_) => panic!("a foreign origin was let in"),
    }
    match connect("http://127.0.0.1:PORT.evil.example").await {
        Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => assert_eq!(resp.status(), 403),
        other => panic!("a look-alike origin was not refused: {:?}", other.err()),
    }
    let (_ws, resp) = connect("http://127.0.0.1:PORT").await.expect("own origin is accepted");
    assert_eq!(resp.status(), 101);
    let (_ws, resp) = connect("http://localhost:PORT/").await.expect("localhost origin is accepted");
    assert_eq!(resp.status(), 101);
}

#[tokio::test]
async fn allow_origin_takes_a_list() {
    let sb = Sandbox::new("origins");
    let d = sb.start_with(&[("YARD_ALLOW_ORIGIN", " https://yard.example.com/ , http://100.64.0.9:47717")]);
    let connect = |origin: &'static str| {
        let mut req = d.url().into_client_request().unwrap();
        req.headers_mut().insert("Origin", HeaderValue::from_static(origin));
        tokio_tungstenite::connect_async(req)
    };
    for origin in ["https://yard.example.com", "http://100.64.0.9:47717", "http://100.64.0.9:47717/"] {
        let (_ws, resp) = connect(origin).await.unwrap_or_else(|e| panic!("{origin} was refused: {e}"));
        assert_eq!(resp.status(), 101);
    }
    for origin in ["https://yard.example.com.evil.example", "http://yard.example.com", "http://evil.example"] {
        match connect(origin).await {
            Err(tokio_tungstenite::tungstenite::Error::Http(resp)) => assert_eq!(resp.status(), 403, "{origin}"),
            other => panic!("{origin} was not refused: {:?}", other.err()),
        }
    }
}

#[tokio::test]
async fn the_local_host_carries_its_configured_name() {
    let sb = Sandbox::new("hostname");
    let d = sb.start_with(&[("YARD_HOST_NAME", "yard-box")]);
    let mut c = d.client().await;
    let host = c
        .wait_for("the local host stats", |m| {
            (m["op"] == "host" || m["op"] == "snapshot") && m["host"]["id"] == "local"
        })
        .await;
    assert_eq!(host["host"]["name"], "yard-box");

    // A remote may not take the local host's name.
    c.send(json!({ "op": "host.add", "name": "Yard-Box", "kind": "direct", "url": "ws://127.0.0.1:1/ws" })).await;
    let err = c.wait_for("the duplicate name refused", |m| m["op"] == "error").await;
    assert!(err["message"].as_str().unwrap_or("").contains("already exists"), "{err}");
}

#[tokio::test]
async fn a_hub_runs_sessions_on_a_direct_host() {
    let remote_sb = Sandbox::new("remote");
    let remote = remote_sb.start();
    let hub_sb = Sandbox::new("hub");
    let hub = hub_sb.start();
    let mut c = hub.client().await;

    c.send(json!({ "op": "host.add", "name": "box", "kind": "direct", "url": remote.url() })).await;
    let hosts = c
        .wait_for("the direct host to connect", |m| {
            m["op"] == "hosts" && m["hosts"].as_array().is_some_and(|h| h.iter().any(|h| h["status"] == "connected"))
        })
        .await;
    let host = hosts["hosts"][0]["id"].as_str().unwrap().to_string();
    assert_eq!(hosts["hosts"][0]["name"], "box");
    c.wait_for("the host's snapshot", |m| m["op"] == "host.snapshot" && m["hostId"] == host).await;

    let cwd = remote_sb.folder("proj");
    let sid = c.create(&cwd, "hello remote", json!({ "host": host })).await;
    let (prefix, remote_id) = sid.split_once('~').expect("a prefixed id");
    assert_eq!(prefix, host);
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");
    assert_eq!(c.wait_event(&sid, "assistant_message", 0).await["text"], "Echo: hello remote");
    let meta = c.wait_for("the remote session", |m| m["op"] == "session" && m["session"]["id"] == sid).await;
    assert_eq!(meta["session"]["host"], host);

    // It ran on the remote, under its own id, and the hub has no session of its own.
    let direct = remote.client().await;
    let ids: Vec<&str> = direct.log[0]["sessions"].as_array().unwrap().iter().map(|s| s["id"].as_str().unwrap()).collect();
    assert_eq!(ids, [remote_id]);
    assert!(remote_sb.codex_log().contains("req turn/start"));
    assert!(!hub_sb.codex_log().contains("req turn/start"));
    let hub_snapshot = hub.client().await.log[0].clone();
    assert_eq!(hub_snapshot["sessions"], json!([]));

    // Ops with the prefixed id reach the remote.
    let history = c.history(&sid).await;
    let kept: Vec<&str> = types(&history).into_iter().filter(|t| *t != "assistant_delta").collect();
    assert_eq!(kept, ["user_message", "turn_started", "assistant_message", "turn_completed"]);
}

#[tokio::test]
async fn install_sets_up_yardd_on_an_ssh_host() {
    let sb = Sandbox::new("install");
    // A release folder in the shape CI publishes, holding this very yardd.
    let release = sb.root.join("release");
    let pkg = sb.root.join("pkg/switchyard");
    fs::create_dir_all(pkg.join("bin")).unwrap();
    fs::create_dir_all(pkg.join("ui/dist")).unwrap();
    fs::copy(env!("CARGO_BIN_EXE_yardd"), pkg.join("bin/yardd")).unwrap();
    fs::write(pkg.join("bin/yard-claude"), "#!/bin/sh\nexit 1\n").unwrap();
    fs::write(pkg.join("VERSION"), "test-build\n").unwrap();
    fs::create_dir_all(&release).unwrap();
    let asset = if cfg!(target_arch = "aarch64") { "switchyard-linux-arm64.tar.gz" } else { "switchyard-linux-x64.tar.gz" };
    let tar = std::process::Command::new("tar")
        .args(["-czf", release.join(asset).to_str().unwrap(), "-C", sb.root.join("pkg").to_str().unwrap(), "switchyard"])
        .status()
        .unwrap();
    assert!(tar.success());

    // ssh that runs the remote command here, as the "remote" machine.
    let fake_ssh = sb.root.join("fake-ssh");
    fs::write(&fake_ssh, "#!/bin/bash\nwhile [ \"$1\" != -- ]; do shift; done\nshift 2\n[ $# -gt 0 ] || { echo 'fake ssh: no tunnels' >&2; exit 255; }\nexec bash -c \"$*\"\n").unwrap();
    std::process::Command::new("chmod").args(["+x", fake_ssh.to_str().unwrap()]).status().unwrap();

    let remote_port = free_port();
    let release_url = format!("file://{}", release.display());
    let d = sb.start_with(&[
        ("YARD_SSH", fake_ssh.to_str().unwrap()),
        ("YARD_RELEASE_URL", &release_url),
        ("SWITCHYARD_NO_SYSTEMD", "1"),
    ]);
    let mut c = d.client().await;
    c.send(json!({ "op": "host.add", "name": "box", "kind": "ssh", "destination": "me@box", "remotePort": remote_port })).await;
    let hosts = c.wait_for("the host", |m| m["op"] == "hosts" && m["hosts"].as_array().is_some_and(|h| !h.is_empty())).await;
    let host = hosts["hosts"][0]["id"].as_str().unwrap().to_string();

    c.send(json!({ "op": "host.install", "hostId": host })).await;
    let done = c.wait_for("the install to finish", |m| m["op"] == "host.install" && m["done"] == true).await;
    let lines: Vec<String> = c
        .log
        .iter()
        .filter(|m| m["op"] == "host.install" && m["hostId"] == host.as_str())
        .filter_map(|m| m["line"].as_str().map(str::to_string))
        .collect();
    let installed = sb.home().join(".local/share/switchyard");
    let pid = fs::read_to_string(installed.join("yardd.pid")).unwrap_or_default();
    let stop = || {
        if !pid.trim().is_empty() {
            let _ = std::process::Command::new("kill").arg(pid.trim()).status();
        }
    };
    if done["ok"] != true {
        stop();
        panic!("install failed: {lines:#?}");
    }
    assert!(lines.iter().any(|l| l.starts_with("@@ok yardd ")), "{lines:#?}");
    assert!(lines.iter().any(|l| l.starts_with("@@engine codex ")), "{lines:#?}");
    assert!(lines.iter().any(|l| l == "Installed test-build"), "{lines:#?}");
    let health = http_get(remote_port, "/health");
    stop();
    assert!(health.unwrap_or_default().contains("yardd "), "the installed yardd answers");
}

/// Bytes that pass for a PNG: yardd only checks the signature.
fn png(len: usize) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(len.max(8), 7);
    bytes
}

/// The text and the `localImage` paths of one `turn/start` input.
fn split_input(input: &Value) -> (String, Vec<String>) {
    let items = input.as_array().expect("an input list");
    let text = items.iter().filter(|i| i["type"] == "text").map(|i| i["text"].as_str().unwrap()).collect::<Vec<_>>().join("\n");
    let images = items.iter().filter(|i| i["type"] == "localImage").map(|i| i["path"].as_str().unwrap().to_string()).collect();
    (text, images)
}

#[tokio::test]
async fn attachments_reach_codex_as_a_local_image_and_a_path() {
    let sb = Sandbox::new("attach");
    let d = sb.start();
    let mut c = d.client().await;
    let cwd = sb.folder("proj");

    let shot = c.upload("shot.png", "image/png", &png(300), json!({})).await.unwrap();
    let notes = c.upload("notes.txt", "text/plain", b"remember the milk\n", json!({})).await.unwrap();
    assert_eq!(shot["name"], "shot.png");
    assert_eq!(shot["mime"], "image/png");
    assert_eq!(shot["size"], 300);
    assert!(shot["hostId"].is_null());
    let shot_path = shot["path"].as_str().unwrap();
    let notes_path = notes["path"].as_str().unwrap();
    assert_eq!(Path::new(shot_path), sb.data().join("attachments").join(shot["id"].as_str().unwrap()).join("shot.png"));
    assert_eq!(fs::read(notes_path).unwrap(), b"remember the milk\n");

    let sid = c.create(&cwd, "look at these", json!({ "attachments": [shot["id"], notes["id"]] })).await;
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");

    let inputs = sb.turn_inputs();
    assert_eq!(inputs.len(), 1);
    let (text, images) = split_input(&inputs[0]);
    assert!(text.starts_with("look at these\n\nAttached files:\n"), "{text}");
    assert!(text.contains(&format!("- {notes_path} (text/plain, 18 B)")), "{text}");
    assert!(text.contains(shot_path), "every attachment is named by path: {text}");
    assert_eq!(images, [shot_path]);

    // The event keeps the user's own text and the attachments' details, for the thread.
    let history = c.history(&sid).await;
    let user = &history[0];
    assert_eq!(user["type"], "user_message");
    assert_eq!(user["text"], "look at these");
    let names: Vec<&str> = user["attachments"].as_array().unwrap().iter().map(|a| a["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["shot.png", "notes.txt"]);
    assert_eq!(user["attachments"][0]["path"], shot_path);
    assert_eq!(user["attachments"][1]["size"], 18);

    // Thumbnails: the bytes come back for this session's attachments only.
    assert_eq!(c.fetch(&sid, shot["id"].as_str().unwrap()).await.unwrap(), png(300));
    let stray = c.upload("other.png", "image/png", &png(20), json!({})).await.unwrap();
    let refused = c.fetch(&sid, stray["id"].as_str().unwrap()).await.unwrap_err();
    assert!(refused.contains("no attachment"), "{refused}");

    // A reply can be an attachment alone. The image claimed a wrong type,
    // and goes by what its bytes are.
    let next = c.next_seq(&sid);
    let pic = c.upload("pic", "application/octet-stream", &png(64), json!({ "sessionId": sid })).await.unwrap();
    assert_eq!(pic["mime"], "image/png");
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "", "attachments": [pic["id"]] })).await;
    assert_eq!(c.wait_turn_done(&sid, next).await["status"], "completed");
    let (text, images) = split_input(&sb.turn_inputs()[1]);
    assert_eq!(text, format!("Attached files:\n- {} (image/png, 64 B)", pic["path"].as_str().unwrap()));
    assert_eq!(images, [pic["path"].as_str().unwrap()]);

    // A file that claims to be an image but is not goes by path only.
    let fake = c.upload("fake.png", "image/png", b"not an image", json!({})).await.unwrap();
    assert_eq!(fake["mime"], "application/octet-stream");

    // An unknown or malformed id refuses the message and starts nothing.
    let from = c.mark();
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "x", "attachments": ["anope"] })).await;
    let err = c.wait_error(from, "session.send").await;
    assert!(err.contains("no attachment anope"), "{err}");
    let from = c.mark();
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "x", "attachments": ["../../etc"] })).await;
    let err = c.wait_error(from, "session.send").await;
    assert!(err.contains("bad attachment id"), "{err}");
    assert_eq!(sb.turn_inputs().len(), 2);
}

#[tokio::test]
async fn a_too_large_upload_is_refused_and_the_socket_survives() {
    let sb = Sandbox::new("attach-big");
    let d = sb.start();
    let mut c = d.client().await;

    let err = c.upload("big.bin", "application/octet-stream", &vec![0u8; 10 * 1024 * 1024 + 1], json!({})).await.unwrap_err();
    assert!(err.contains("big.bin is too large to attach (10.0 MB). The limit is 10.0 MB."), "{err}");
    let stored = |sb: &Sandbox| fs::read_dir(sb.data().join("attachments")).map(|d| d.count()).unwrap_or(0);
    assert_eq!(stored(&sb), 0);

    // Exactly at the cap is fine, and the same socket still works.
    let full = c.upload("full.bin", "", &vec![1u8; 10 * 1024 * 1024], json!({})).await.unwrap();
    assert_eq!(full["size"], 10 * 1024 * 1024);
    assert_eq!(full["mime"], "application/octet-stream");
    assert_eq!(stored(&sb), 1);

    let from = c.mark();
    c.send(json!({ "op": "attach.put", "ref": "bad64", "name": "x", "mime": "text/plain", "data": "@@not base64@@" })).await;
    let reply = c.wait_after(from, "the bad upload's reply", |m| m["ref"] == "bad64").await;
    assert!(reply["error"].as_str().unwrap().contains("not valid base64"), "{reply}");
}

#[tokio::test]
async fn upload_names_are_sanitized() {
    let sb = Sandbox::new("attach-names");
    let d = sb.start();
    let mut c = d.client().await;
    let root = sb.data().join("attachments");

    let a = c.upload("../../escape.txt", "text/plain", b"x", json!({})).await.unwrap();
    assert_eq!(a["name"], "escape.txt");
    assert_eq!(Path::new(a["path"].as_str().unwrap()), root.join(a["id"].as_str().unwrap()).join("escape.txt"));
    assert!(!sb.data().join("escape.txt").exists() && !sb.root.join("escape.txt").exists());

    let dots = c.upload("..", "text/plain", b"x", json!({})).await.unwrap();
    assert_eq!(dots["name"], "file");
    let hidden = c.upload(".env", "text/plain", b"x", json!({})).await.unwrap();
    assert_eq!(hidden["name"], "env");
    let dash = c.upload("-rf", "text/plain", b"x", json!({})).await.unwrap();
    assert_eq!(dash["name"], "rf");
    let windows = c.upload("C:\\Users\\me\\report.pdf", "application/pdf", b"%PDF", json!({})).await.unwrap();
    assert_eq!(windows["name"], "report.pdf");
    // Every file stays one level down, in its own folder.
    for att in [&a, &dots, &hidden, &dash, &windows] {
        let p = Path::new(att["path"].as_str().unwrap());
        assert_eq!(p.parent().unwrap().parent().unwrap(), root);
        assert!(p.is_file());
    }
}

#[tokio::test]
async fn attachments_land_on_the_remote_host_through_the_hub() {
    let remote_sb = Sandbox::new("attach-remote");
    let remote = remote_sb.start();
    let hub_sb = Sandbox::new("attach-hub");
    let hub = hub_sb.start();
    let mut c = hub.client().await;

    c.send(json!({ "op": "host.add", "name": "box", "kind": "direct", "url": remote.url() })).await;
    let hosts = c
        .wait_for("the direct host to connect", |m| {
            m["op"] == "hosts" && m["hosts"].as_array().is_some_and(|h| h.iter().any(|h| h["status"] == "connected"))
        })
        .await;
    let host = hosts["hosts"][0]["id"].as_str().unwrap().to_string();
    c.wait_for("the host's snapshot", |m| m["op"] == "host.snapshot" && m["hostId"] == host).await;

    // A full-size image crosses both hops (UI -> hub -> remote) in one message.
    let big = png(10 * 1024 * 1024);
    let shot = c.upload("shot.png", "image/png", &big, json!({ "host": host })).await.unwrap();
    assert_eq!(shot["hostId"], host.as_str());
    let shot_path = shot["path"].as_str().unwrap().to_string();
    assert!(Path::new(&shot_path).starts_with(remote_sb.data().join("attachments")), "{shot_path}");
    assert_eq!(fs::read(&shot_path).unwrap().len(), big.len());
    assert!(!hub_sb.data().join("attachments").exists(), "nothing is stored on the hub");

    let cwd = remote_sb.folder("proj");
    let sid = c.create(&cwd, "remote look", json!({ "host": host, "attachments": [shot["id"]] })).await;
    assert!(sid.starts_with(&format!("{host}~")));
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");
    let (text, images) = split_input(&remote_sb.turn_inputs()[0]);
    assert!(text.contains(&shot_path), "{text}");
    assert_eq!(images, [shot_path.clone()]);
    assert!(hub_sb.turn_inputs().is_empty());

    // A reply on the remote session uploads by session id.
    let next = c.next_seq(&sid);
    let log = c.upload("err.log", "text/plain", b"boom\n", json!({ "sessionId": sid })).await.unwrap();
    assert!(Path::new(log["path"].as_str().unwrap()).starts_with(remote_sb.data().join("attachments")));
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "and this", "attachments": [log["id"]] })).await;
    assert_eq!(c.wait_turn_done(&sid, next).await["status"], "completed");
    let (text, images) = split_input(&remote_sb.turn_inputs()[1]);
    assert!(text.contains(log["path"].as_str().unwrap()), "{text}");
    assert!(images.is_empty());

    // History and thumbnails come back through the hub under the prefixed id.
    let history = c.history(&sid).await;
    assert_eq!(history[0]["attachments"][0]["path"], shot_path.as_str());
    assert_eq!(c.fetch(&sid, shot["id"].as_str().unwrap()).await.unwrap(), big);

    // Over the cap through the hub: refused by the remote, the link stays up.
    let err = c.upload("huge.bin", "", &vec![0u8; 10 * 1024 * 1024 + 1], json!({ "host": host })).await.unwrap_err();
    assert!(err.contains("too large"), "{err}");
    let ok = c.upload("after.txt", "text/plain", b"ok", json!({ "host": host })).await.unwrap();
    assert_eq!(ok["hostId"], host.as_str());
}
