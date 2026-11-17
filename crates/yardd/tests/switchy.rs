//! Switchy has its own conversation, bounded inputs and read-only host evidence.
mod common;
use common::*;
use serde_json::{json, Value};

#[tokio::test]
async fn switchy_answers_without_creating_a_sidebar_session_and_survives_restart() {
    let sb = Sandbox::new("switchy");
    let mut daemon = sb.start();
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.send", "text":"What is running?", "engine":"codex", "model":MODEL, "scope":"local", "ref":"ask"})).await;
    let done = c.wait_for("Switchy answer", |m| m["op"] == "switchy.state" && m["state"]["status"] == "idle" && m["state"]["turns"].as_array().is_some_and(|t| !t.is_empty())).await;
    assert!(done["state"]["turns"][0]["answer"].as_str().is_some_and(|s| !s.is_empty()));
    assert!(!done["state"]["turns"][0]["sources"].as_array().unwrap().is_empty());
    assert!(!c.log.iter().any(|m| m["op"] == "session"));
    assert!(sb.turn_inputs()[0][0]["text"].as_str().unwrap().len() <= 32_000);
    drop(c);
    daemon.stop();
    let daemon = sb.start();
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.get"})).await;
    let saved = c.wait_for("saved Switchy conversation", |m| m["op"] == "switchy.state").await;
    assert_eq!(saved["state"]["turns"][0]["question"], "What is running?");
    assert!(c.log[0]["sessions"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn context_is_bounded_and_carries_host_provenance() {
    let sb = Sandbox::new("switchy-context");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    c.send(json!({"op":"switchy.context", "query":"services", "ref":"context"})).await;
    let reply = c.wait_for("host context", |m| m["op"] == "switchy.context" && m["ref"] == "context").await;
    assert!(reply.to_string().len() < 24_000);
    assert!(reply["sources"].as_array().unwrap().iter().all(|s| s["at"].is_u64() && s["title"].is_string()));
    assert!(reply["hostName"].is_string());
}

#[tokio::test]
async fn invalid_questions_and_models_do_not_start_an_engine_turn() {
    let sb = Sandbox::new("switchy-invalid");
    let daemon = sb.start();
    let mut c = daemon.client().await;
    for (i, text, engine) in [(0, "", "codex"), (1, "hello", "missing")] {
        c.send(json!({"op":"switchy.send", "text":text, "engine":engine, "model":MODEL, "ref":i})).await;
        c.wait_for("validation error", |m| m["op"] == "error" && m["ref"] == i).await;
    }
    assert!(sb.turn_inputs().is_empty());
}
