//! Switchy has its own conversation, bounded inputs and read-only host evidence.
mod common;
use common::*;
use serde_json::json;

#[tokio::test]
async fn switchy_answers_without_creating_a_sidebar_session_and_survives_restart() {
    let sb = Sandbox::new("switchy");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    c.wait_for("models ready", |m| {
        (m["op"] == "models" || m["op"] == "snapshot")
            && m["models"]["codex"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
    })
    .await;
    c.send(json!({"op":"switchy.send", "text":"What is running?", "engine":"codex", "model":MODEL, "scope":"local", "ref":"ask"})).await;
    let done = c
        .wait_for("Switchy answer", |m| {
            m["op"] == "switchy.state"
                && m["state"]["status"] == "idle"
                && m["state"]["turns"]
                    .as_array()
                    .is_some_and(|t| !t.is_empty())
        })
        .await;
    assert!(done["state"]["turns"][0]["answer"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));
    assert!(!done["state"]["turns"][0]["sources"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(!c.log.iter().any(|m| m["op"] == "session"));
    assert!(sb.turn_inputs()[0][0]["text"].as_str().unwrap().len() <= 32_000);
    drop(c);
    daemon.stop();
    let daemon = sb.start();
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.get"})).await;
    let saved = c
        .wait_for("saved Switchy conversation", |m| m["op"] == "switchy.state")
        .await;
    assert_eq!(saved["state"]["turns"][0]["question"], "What is running?");
    assert!(c.log[0]["sessions"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn context_is_bounded_and_carries_host_provenance() {
    let sb = Sandbox::new("switchy-context");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.context", "query":"services", "ref":"context"}))
        .await;
    let reply = c
        .wait_for("host context", |m| {
            m["op"] == "switchy.context" && m["ref"] == "context"
        })
        .await;
    assert!(reply.to_string().len() < 24_000);
    assert!(reply["sources"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["at"].is_u64() && s["title"].is_string()));
    assert!(reply["hostName"].is_string());
}

#[tokio::test]
async fn invalid_questions_and_models_do_not_start_an_engine_turn() {
    let sb = Sandbox::new("switchy-invalid");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    for (i, text, engine) in [(0, "", "codex"), (1, "hello", "missing")] {
        c.send(json!({"op":"switchy.send", "text":text, "engine":engine, "model":MODEL, "ref":i}))
            .await;
        c.wait_for("validation error", |m| m["op"] == "error" && m["ref"] == i)
            .await;
    }
    assert!(sb.turn_inputs().is_empty());
}

async fn ready(c: &mut Client) {
    c.wait_for("models ready", |m| {
        (m["op"] == "models" || m["op"] == "snapshot")
            && m["models"]["codex"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
    })
    .await;
}

#[tokio::test]
async fn fresh_threads_keep_followups_bounded_and_restrict_tools() {
    let sb = Sandbox::new("switchy-followup");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    ready(&mut c).await;
    for (index, model) in [MODEL, "fake-deep"].iter().enumerate() {
        c.send(json!({"op":"switchy.send", "text":format!("Question {index}: what changed?"), "engine":"codex", "model":model,"scope":"local"})).await;
        c.wait_for("completed answer", |m| {
            m["op"] == "switchy.state"
                && m["state"]["status"] == "idle"
                && m["state"]["turns"]
                    .as_array()
                    .is_some_and(|t| t.len() == index + 1)
        })
        .await;
    }
    let starts: Vec<serde_json::Value> =
        std::fs::read_to_string(sb.fake_state().join("thread-starts.jsonl"))
            .unwrap()
            .lines()
            .map(|s| serde_json::from_str(s).unwrap())
            .collect();
    assert_eq!(starts.len(), 2);
    for start in &starts {
        assert_eq!(start["sandbox"], "read-only");
        assert_eq!(start["approvalPolicy"], "never");
        assert_eq!(start["ephemeral"], true);
        assert_eq!(start["config"]["features.shell_tool"], false);
        assert_eq!(start["config"]["features.apps"], false);
        assert_eq!(start["config"]["features.hooks"], false);
    }
    assert_eq!(starts[1]["model"], "fake-deep");
    let inputs = sb.turn_inputs();
    let second = inputs[1][0]["text"].as_str().unwrap();
    assert!(second.contains("Question 0"));
    assert!(second.contains("scripted Switchy answer"));
    assert!(inputs
        .iter()
        .all(|i| i[0]["text"].as_str().unwrap().len() <= 32_000));
    assert!(sb
        .codex_log()
        .contains("approval=never sandboxPolicy=readOnly"));
}

#[tokio::test]
async fn remote_context_is_scoped_and_unavailable_hosts_are_reported() {
    let remote_sb = Sandbox::new("switchy-remote");
    std::fs::write(
        remote_sb.home().join(".bash_history"),
        "echo UNIQUE_REMOTE_WORK\nTOKEN=must-not-appear\n",
    )
    .unwrap();
    let remote = remote_sb.start();
    let hub_sb = Sandbox::new("switchy-hub");
    let hub = hub_sb.start();
    let mut c = hub.client().await;
    ready(&mut c).await;
    c.send(json!({"op":"host.add", "name":"TEST-box", "kind":"direct", "url":remote.url()}))
        .await;
    let reply = c
        .wait_for("remote connected", |m| {
            m["op"] == "hosts" && m["hosts"][0]["status"] == "connected"
        })
        .await;
    let host = reply["hosts"][0]["id"].as_str().unwrap().to_string();
    c.send(json!({"op":"switchy.send", "text":"What did I do?", "engine":"codex", "model":MODEL,"scope":host})).await;
    let done = c
        .wait_for("remote answer", |m| {
            m["op"] == "switchy.state"
                && m["state"]["status"] == "idle"
                && m["state"]["turns"].as_array().is_some_and(|t| t.len() == 1)
        })
        .await;
    let sources = done["state"]["turns"][0]["sources"].as_array().unwrap();
    assert!(sources.iter().all(|s| s["host"] == host));
    assert!(sources
        .iter()
        .any(|s| s["text"].as_str().unwrap().contains("UNIQUE_REMOTE_WORK")));
    assert!(!done.to_string().contains("must-not-appear"));
    remote.stop();
    c.wait_for("remote disconnected", |m| {
        m["op"] == "hosts" && m["hosts"][0]["status"] != "connected"
    })
    .await;
    c.send(json!({"op":"switchy.send", "text":"Is it still running?", "engine":"codex", "model":MODEL,"scope":host})).await;
    let done = c
        .wait_for("offline answer", |m| {
            m["op"] == "switchy.state"
                && m["state"]["status"] == "idle"
                && m["state"]["turns"].as_array().is_some_and(|t| t.len() == 2)
        })
        .await;
    assert!(done["state"]["turns"][1]["coverage"]
        .to_string()
        .contains("offline"));
    assert!(done["state"]["turns"][1]["sources"]
        .as_array()
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn stop_and_concurrent_send_do_not_leave_switchy_busy() {
    let sb = Sandbox::new("switchy-stop");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    ready(&mut c).await;
    c.send(json!({"op":"switchy.send", "text":"[slow]", "engine":"codex", "model":MODEL,"scope":"local"})).await;
    c.wait_for("answer started", |m| {
        m["op"] == "switchy.state" && m["state"]["status"] == "answering"
    })
    .await;
    c.send(json!({"op":"switchy.send", "text":"another", "engine":"codex", "model":MODEL,"scope":"local", "ref":"duplicate"})).await;
    c.wait_for("duplicate rejected", |m| {
        m["op"] == "error" && m["ref"] == "duplicate"
    })
    .await;
    c.send(json!({"op":"switchy.stop"})).await;
    let stopped = c
        .wait_for("stopped", |m| {
            m["op"] == "switchy.state" && m["state"]["status"] == "idle"
        })
        .await;
    assert_eq!(stopped["state"]["turns"][0]["error"], "Stopped by you.");
    assert!(!c.log.iter().any(|m| m["op"] == "session"));
}

#[tokio::test]
async fn discovers_work_outside_sessions_and_indexes_prior_observations() {
    let sb = Sandbox::new("switchy-external");
    let repo = make_repo(&sb, "TEST-external-api");
    std::fs::write(
        std::path::Path::new(&repo).join("README.md"),
        "The nebula service listens on port 8081.\n",
    )
    .unwrap();
    git(&repo, &["add", "README.md"], &sb.home());
    git(
        &repo,
        &["commit", "-qm", "Document nebula deployment"],
        &sb.home(),
    );
    std::fs::write(
        sb.home().join(".bash_history"),
        "echo FIRST_NEBULA_DEPLOY\n",
    )
    .unwrap();
    let daemon = sb.start_with(&[("YARD_CONTEXT_ROOTS", &repo)]);
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.context", "query":"nebula", "ref":"first"}))
        .await;
    let first = c
        .wait_for("external repository context", |m| {
            m["op"] == "switchy.context" && m["ref"] == "first"
        })
        .await;
    assert!(first.to_string().contains("8081"));
    assert!(first.to_string().contains("FIRST_NEBULA_DEPLOY"));
    assert!(c.log[0]["sessions"].as_array().unwrap().is_empty());
    std::fs::write(
        sb.home().join(".bash_history"),
        "echo SECOND_NEBULA_DEPLOY\n",
    )
    .unwrap();
    c.send(json!({"op":"switchy.context", "query":"nebula", "ref":"second"}))
        .await;
    let second = c
        .wait_for("prior observations", |m| {
            m["op"] == "switchy.context" && m["ref"] == "second"
        })
        .await;
    assert!(second["sources"]
        .as_array()
        .unwrap()
        .iter()
        .any(|s| s["title"] == "Earlier host observations"
            && s["text"].as_str().unwrap().contains("FIRST_NEBULA_DEPLOY")));
}

#[tokio::test]
async fn claude_uses_a_restricted_sidecar_and_handles_engine_failure() {
    let sb = Sandbox::new("switchy-claude");
    let daemon = sb.start_with(&[(
        "YARD_SIDECAR",
        fake_bin().join("yard-claude").to_str().unwrap(),
    )]);
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.send", "text":"What is running?", "engine":"claude", "model":"claude-haiku-5-5", "scope":"local"})).await;
    let done = c
        .wait_for("Claude answer", |m| {
            m["op"] == "switchy.state"
                && m["state"]["status"] == "idle"
                && m["state"]["turns"].as_array().is_some_and(|t| t.len() == 1)
        })
        .await;
    assert_eq!(done["state"]["turns"][0]["status"], "completed");
    assert!(done["state"]["turns"][0]["answer"]
        .as_str()
        .unwrap()
        .contains("Scripted Claude"));
    assert!(std::fs::read_to_string(sb.fake_state().join("sidecar.log"))
        .unwrap()
        .contains("switchy=true"));
    c.send(json!({"op":"switchy.send", "text":"[die]", "engine":"claude", "model":"claude-haiku-5-5", "scope":"local"})).await;
    let failed = c
        .wait_for("Claude failure", |m| {
            m["op"] == "switchy.state"
                && m["state"]["status"] == "idle"
                && m["state"]["turns"].as_array().is_some_and(|t| t.len() == 2)
        })
        .await;
    assert_eq!(failed["state"]["turns"][1]["status"], "failed");
    assert!(failed["state"]["turns"][1]["error"].is_string());
}
