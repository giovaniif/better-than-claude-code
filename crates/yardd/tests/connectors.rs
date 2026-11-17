//! Connectors (MCP servers and their sign-ins) and MCP Apps widgets, end to
//! end against the scripted engines: the fake Codex's MCP methods and the fake
//! Claude sidecar's `connectors` mode, both backed by verify/fakes/mcp-chart.

mod common;

use std::fs;

use common::*;
use serde_json::{json, Value};

fn row<'a>(status: &'a Value, name: &str) -> &'a Value {
    status["servers"]
        .as_array()
        .and_then(|l| l.iter().find(|s| s["name"] == name))
        .unwrap_or_else(|| panic!("no server {name} in {status}"))
}

async fn status(c: &mut Client, engine: &str) -> Value {
    let from = c.mark();
    c.send(json!({ "op": "mcp.status", "engine": engine })).await;
    c.wait_after(from, "an `mcp` status", |m| m["op"] == "mcp" && m["engine"] == engine).await
}

async fn auth_state(c: &mut Client, from: usize, server: &str, state: &str) -> Value {
    let what = format!("mcp.auth {state} for {server}");
    c.wait_after(from, &what, |m| m["op"] == "mcp.auth" && m["server"] == server && m["state"] == state).await
}

/// The redirect_uri query parameter of a sign-in link, decoded.
fn redirect_of(url: &str) -> String {
    let enc = url.split("redirect_uri=").nth(1).unwrap().split('&').next().unwrap();
    enc.replace("%3A", ":").replace("%2F", "/")
}

#[tokio::test]
async fn codex_servers_are_listed_and_a_pasted_redirect_signs_one_in() {
    let sb = Sandbox::new("mcp-codex");
    let d = sb.start();
    let mut c = d.client().await;

    let st = status(&mut c, "codex").await;
    assert_eq!(st["account"], "default");
    let chart = row(&st, "chart");
    assert_eq!((chart["status"].as_str(), chart["tools"].as_u64(), chart["appTools"].as_u64()), (Some("connected"), Some(3), Some(2)));
    let oauth = row(&st, "fake-oauth");
    assert_eq!((oauth["status"].as_str(), oauth["origin"].as_str()), (Some("needs-auth"), Some("https://mcp.fake-oauth.example")));
    let app = row(&st, "GitHub");
    assert_eq!((app["status"].as_str(), app["installUrl"].as_str(), app["source"].as_str()), (Some("needs-auth"), Some("https://chatgpt.com/apps/github"), Some("chatgpt")));

    let from = c.mark();
    c.send(json!({ "op": "mcp.auth", "engine": "codex", "server": "fake-oauth" })).await;
    let open = auth_state(&mut c, from, "fake-oauth", "open").await;
    assert_eq!(open["paste"], true);
    let redirect = redirect_of(open["url"].as_str().unwrap());
    assert!(redirect.starts_with("http://127.0.0.1:"), "{redirect}");

    // Anything but the sign-in's own loopback page is refused.
    let from = c.mark();
    c.send(json!({ "op": "mcp.callback", "engine": "codex", "server": "fake-oauth", "url": "http://evil.example:80/callback?code=x" })).await;
    let failed = auth_state(&mut c, from, "fake-oauth", "failed").await;
    assert!(failed["error"].as_str().unwrap().contains("not the sign-in's own page"), "{failed}");

    // The address the browser could not open, pasted: yardd delivers it on this host.
    let from = c.mark();
    c.send(json!({ "op": "mcp.callback", "engine": "codex", "server": "fake-oauth", "url": format!("{redirect}?code=TEST-code&state=s1") })).await;
    auth_state(&mut c, from, "fake-oauth", "done").await;
    let after = c.wait_after(from, "the status after the sign-in", |m| m["op"] == "mcp" && m["engine"] == "codex").await;
    assert_eq!(row(&after, "fake-oauth")["status"], "connected");
    assert!(sb.codex_log().contains("mcp oauth callback code=TEST-code"));
}

#[tokio::test]
async fn claude_connectors_sign_in_and_running_sessions_dial_again() {
    let sb = Sandbox::new("mcp-claude");
    let sidecar = fake_bin().join("yard-claude");
    let d = sb.start_with(&[("YARD_SIDECAR", sidecar.to_str().unwrap())]);
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "TEST-hello", json!({ "engine": "claude", "model": "claude-haiku-5-5", "effort": "low" })).await;
    c.wait_turn_done(&sid, 0).await;

    let st = status(&mut c, "claude").await;
    assert_eq!(row(&st, "claude.ai Datadog")["status"], "needs-auth");
    assert_eq!(row(&st, "plugin:engineering:gmail")["error"], "No URL configured for this server");
    assert_eq!(row(&st, "chart")["appTools"], 2);
    let log = fs::read_to_string(sb.fake_state().join("sidecar.log")).unwrap();
    assert!(log.contains(&format!("cwd={}", sb.home().display())), "runs in the home folder: {log}");

    // A claude.ai connector: its page, then done once claude.ai has it; the
    // running session is told to dial it again.
    let from = c.mark();
    c.send(json!({ "op": "mcp.auth", "engine": "claude", "server": "claude.ai Datadog" })).await;
    let open = auth_state(&mut c, from, "claude.ai Datadog", "open").await;
    assert_eq!((open["url"].as_str(), open["paste"].as_bool()), (Some("https://claude.ai/fake-connect/datadog"), Some(false)));
    auth_state(&mut c, from, "claude.ai Datadog", "done").await;
    let after = c.wait_after(from, "the status after the sign-in", |m| m["op"] == "mcp" && m["engine"] == "claude").await;
    assert_eq!(row(&after, "claude.ai Datadog")["status"], "connected");
    // The sidecar logs the line when it reads it, a moment after yardd sends it.
    let mut log = String::new();
    for _ in 0..50 {
        log = fs::read_to_string(sb.fake_state().join("sidecar.log")).unwrap();
        if log.contains("reconnect claude.ai Datadog") {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(log.contains("reconnect claude.ai Datadog"), "{log}");

    // A server whose redirect lands on this host: the pasted address finishes it.
    let from = c.mark();
    c.send(json!({ "op": "mcp.auth", "engine": "claude", "server": "plugin:engineering:sentry" })).await;
    assert_eq!(auth_state(&mut c, from, "plugin:engineering:sentry", "open").await["paste"], true);
    let from = c.mark();
    c.send(json!({ "op": "mcp.callback", "engine": "claude", "server": "plugin:engineering:sentry", "url": "http://localhost:39999/callback" })).await;
    let failed = auth_state(&mut c, from, "plugin:engineering:sentry", "failed").await;
    assert!(failed["error"].as_str().unwrap().contains("missing authorization code"), "{failed}");
    let from = c.mark();
    c.send(json!({ "op": "mcp.callback", "engine": "claude", "server": "plugin:engineering:sentry", "url": "http://localhost:39999/callback?code=TEST" })).await;
    auth_state(&mut c, from, "plugin:engineering:sentry", "done").await;

    // An unknown account is refused before anything starts.
    let from = c.mark();
    c.send(json!({ "op": "mcp.status", "engine": "claude", "account": "nope" })).await;
    c.wait_error(from, "mcp.status").await;
}

/// `widget.get` / `widget.call` with a ref, and the reply that answers it.
async fn ask(c: &mut Client, mut msg: Value) -> Value {
    let r = format!("r{}", c.mark());
    msg["ref"] = json!(r);
    let from = c.mark();
    c.send(msg).await;
    c.wait_after(from, "a widget reply", |m| m["ref"] == r.as_str()).await
}

async fn chart_turn(c: &mut Client, sid: &str) -> String {
    let done = c.wait_event(sid, "tool_completed", 0).await;
    let app = &done["app"];
    assert_eq!((app["server"].as_str(), app["tool"].as_str()), (Some("chart"), Some("show_chart")), "{done}");
    assert!(app["html"].is_null(), "the log keeps only the id: {done}");
    assert_eq!(done["ok"], true);
    app["id"].as_str().unwrap().to_string()
}

async fn check_widget(c: &mut Client, sid: &str, id: &str, refused: &str) {
    let got = ask(c, json!({ "op": "widget.get", "sessionId": sid, "id": id })).await;
    let w = &got["widget"];
    assert!(w["html"].as_str().unwrap().contains("ui/initialize"), "{got}");
    assert_eq!(w["prefersBorder"], true);
    assert_eq!(w["input"]["metric"], "p95 latency");
    assert_eq!(w["result"]["structuredContent"]["data"].as_array().unwrap().len(), 8);

    let more = ask(c, json!({ "op": "widget.call", "sessionId": sid, "id": id, "tool": "refresh_chart", "arguments": { "metric": "p95 latency", "points": 12 } })).await;
    assert_eq!(more["result"]["structuredContent"]["data"].as_array().map(Vec::len), Some(12), "{more}");
    let no = ask(c, json!({ "op": "widget.call", "sessionId": sid, "id": id, "tool": "delete_everything", "arguments": {} })).await;
    assert!(no["error"].as_str().unwrap_or("").contains(refused), "{no}");
    let none = ask(c, json!({ "op": "widget.get", "sessionId": sid, "id": "../../yard" })).await;
    assert!(none["error"].is_string(), "{none}");
}

#[tokio::test]
async fn a_codex_chart_is_kept_served_and_can_load_more_after_a_restart() {
    let sb = Sandbox::new("widget-codex");
    let d = sb.start();
    let mut c = d.client().await;
    let sid = c.create(&sb.folder("proj"), "[chart] TEST-show p95", json!({})).await;
    let id = chart_turn(&mut c, &sid).await;
    c.wait_turn_done(&sid, 0).await;
    check_widget(&mut c, &sid, &id, "only read-only tools").await;
    assert_eq!(fs::read_dir(sb.data().join("widgets")).unwrap().count(), 1);

    // After a restart the thread still shows it, and its button resumes the thread.
    d.stop();
    let d = sb.start();
    let mut c = d.client().await;
    let more = ask(&mut c, json!({ "op": "widget.call", "sessionId": sid, "id": id, "tool": "refresh_chart", "arguments": { "points": 4 } })).await;
    assert_eq!(more["result"]["structuredContent"]["data"].as_array().map(Vec::len), Some(4), "{more}");
    // A widget of another session is not served here.
    let other = c.create(&sb.folder("other"), "TEST-plain", json!({})).await;
    let got = ask(&mut c, json!({ "op": "widget.get", "sessionId": other, "id": id })).await;
    assert!(got["error"].as_str().unwrap().contains("has no widget"), "{got}");
}

#[tokio::test]
async fn a_claude_chart_calls_back_through_the_sidecar_even_after_a_restart() {
    let sb = Sandbox::new("widget-claude");
    let sidecar = fake_bin().join("yard-claude");
    let env = [("YARD_SIDECAR", sidecar.to_str().unwrap())];
    let d = sb.start_with(&env);
    let mut c = d.client().await;
    let claude = json!({ "engine": "claude", "model": "claude-haiku-5-5", "effort": "low" });
    let sid = c.create(&sb.folder("proj"), "[chart] TEST-show p95", claude).await;
    let id = chart_turn(&mut c, &sid).await;
    c.wait_turn_done(&sid, 0).await;
    check_widget(&mut c, &sid, &id, "haven't granted it").await;

    d.stop();
    let d = sb.start_with(&env);
    let mut c = d.client().await;
    let more = ask(&mut c, json!({ "op": "widget.call", "sessionId": sid, "id": id, "tool": "refresh_chart", "arguments": { "points": 5 } })).await;
    assert_eq!(more["result"]["structuredContent"]["data"].as_array().map(Vec::len), Some(5), "{more}");
    let log = fs::read_to_string(sb.fake_state().join("sidecar.log")).unwrap();
    assert!(log.contains("resume=fake-claude-"), "a sidecar resumed the conversation for the call: {log}");
}

async fn change(c: &mut Client, msg: Value) -> Value {
    let from = c.mark();
    let name = msg["name"].as_str().or(msg["server"].as_str()).unwrap().to_string();
    c.send(msg).await;
    c.wait_after(from, "an mcp.change", |m| m["op"] == "mcp.change" && m["name"] == name.as_str()).await
}

#[tokio::test]
async fn linear_is_added_to_each_engine_signed_in_and_removed() {
    let sb = Sandbox::new("mcp-add");
    let sidecar = fake_bin().join("yard-claude");
    let d = sb.start_with(&[("YARD_SIDECAR", sidecar.to_str().unwrap())]);
    let mut c = d.client().await;
    let linear = "https://mcp.linear.app/mcp";

    // Codex: added through `codex mcp add`, then signed in through the pasted loopback redirect.
    let done = change(&mut c, json!({ "op": "mcp.add", "engine": "codex", "name": "linear", "url": linear })).await;
    assert_eq!(done["state"], "done", "{done}");
    let st = status(&mut c, "codex").await;
    assert_eq!((row(&st, "linear")["status"].as_str(), row(&st, "linear")["origin"].as_str()), (Some("needs-auth"), Some("https://mcp.linear.app")));
    let from = c.mark();
    c.send(json!({ "op": "mcp.auth", "engine": "codex", "server": "linear" })).await;
    let open = auth_state(&mut c, from, "linear", "open").await;
    let redirect = redirect_of(open["url"].as_str().unwrap());
    let from = c.mark();
    c.send(json!({ "op": "mcp.callback", "engine": "codex", "server": "linear", "url": format!("{redirect}?code=TEST&state=s1") })).await;
    auth_state(&mut c, from, "linear", "done").await;
    assert_eq!(row(&status(&mut c, "codex").await, "linear")["status"], "connected");
    // The same name again is the CLI's refusal, shown as is.
    let again = change(&mut c, json!({ "op": "mcp.add", "engine": "codex", "name": "linear", "url": linear })).await;
    assert_eq!(again["state"], "failed");
    assert!(again["error"].as_str().unwrap().contains("already has a server named linear"), "{again}");
    assert!(sb.codex_log().contains(r#"config write mcp_servers.linear {"url":"https://mcp.linear.app/mcp"}"#));

    // Claude: `claude mcp add --scope user`, then a pasted address.
    let done = change(&mut c, json!({ "op": "mcp.add", "engine": "claude", "name": "linear", "url": linear })).await;
    assert_eq!(done["state"], "done", "{done}");
    assert_eq!(row(&status(&mut c, "claude").await, "linear")["status"], "needs-auth");
    let from = c.mark();
    c.send(json!({ "op": "mcp.auth", "engine": "claude", "server": "linear" })).await;
    assert_eq!(auth_state(&mut c, from, "linear", "open").await["paste"], true);
    let from = c.mark();
    c.send(json!({ "op": "mcp.callback", "engine": "claude", "server": "linear", "url": "http://localhost:39998/callback?code=TEST" })).await;
    auth_state(&mut c, from, "linear", "done").await;
    assert_eq!(row(&status(&mut c, "claude").await, "linear")["status"], "connected");

    let gone = change(&mut c, json!({ "op": "mcp.remove", "engine": "codex", "server": "linear" })).await;
    assert_eq!(gone["state"], "done", "{gone}");
    assert!(status(&mut c, "codex").await["servers"].as_array().unwrap().iter().all(|s| s["name"] != "linear"));
    let gone = change(&mut c, json!({ "op": "mcp.remove", "engine": "claude", "server": "linear" })).await;
    assert_eq!(gone["state"], "done", "{gone}");
    let st = status(&mut c, "claude").await;
    assert!(st["servers"].as_array().unwrap().iter().all(|s| s["name"] != "linear"), "{st}");

    // Not a name or not https: refused before any CLI runs.
    let from = c.mark();
    c.send(json!({ "op": "mcp.add", "engine": "codex", "name": "--evil", "url": linear })).await;
    assert!(c.wait_error(from, "mcp.add").await.contains("Name it"));
    let from = c.mark();
    c.send(json!({ "op": "mcp.add", "engine": "codex", "name": "x", "url": "http://plain.example/mcp" })).await;
    assert!(c.wait_error(from, "mcp.add").await.contains("https://"));
}

#[tokio::test]
async fn every_claude_account_has_its_limits_without_running_a_turn() {
    let sb = Sandbox::new("claude-usage");
    let sidecar = fake_bin().join("yard-claude");
    let d = sb.start_with(&[("YARD_SIDECAR", sidecar.to_str().unwrap()), ("YARD_CLAUDE_USAGE_EVERY_MS", "600000")]);
    let mut c = d.client().await;
    let from = c.mark();
    c.send(json!({ "op": "account.add", "engine": "claude", "name": "Work" })).await;
    let accounts = c.wait_after(from, "the accounts list", |m| m["op"] == "accounts" && m["accounts"].as_array().is_some_and(|l| !l.is_empty())).await;
    let id = accounts["accounts"][0]["id"].as_str().unwrap().to_string();

    // No session exists: both limits come from the usage report alone.
    let got = c
        .wait_for("both accounts' limits", |m| {
            m["op"] == "usage" && m["usage"]["claude"]["windows"]["five_hour"]["utilization"] == 0.47 && m["usage"]["accounts"][id.as_str()]["windows"]["five_hour"]["utilization"] == 0.91
        })
        .await;
    assert_eq!(got["usage"]["accounts"][id.as_str()]["windows"]["seven_day"]["utilization"], 0.4);
    assert!(c.log.iter().all(|m| m["op"] != "event"), "no turn ran");
    let log = fs::read_to_string(sb.fake_state().join("sidecar.log")).unwrap();
    assert!(log.contains(&format!("usage config={}", sb.data().join("accounts").join(&id).display())), "{log}");

    // A login reads the account's limits again, and still reports the login:
    // the login runs on a plain thread, and starting the read from there once
    // killed it before it said so.
    let reads = |sb: &Sandbox| fs::read_to_string(sb.fake_state().join("sidecar.log")).unwrap().matches(&format!("usage config={}", sb.data().join("accounts").join(&id).display())).count();
    let before = reads(&sb);
    let from = c.mark();
    c.send(json!({ "op": "login.start", "engine": "claude", "account": id })).await;
    c.wait_after(from, "the sign-in link", |m| m["op"] == "login" && m["account"] == id.as_str() && m["state"] == "url").await;
    c.send(json!({ "op": "login.code", "engine": "claude", "account": id, "code": "good-code" })).await;
    c.wait_after(from, "the login done", |m| m["op"] == "login" && m["account"] == id.as_str() && m["state"] == "done").await;
    c.wait_after(from, "the account logged in", |m| m["op"] == "engines" && m["accounts"][id.as_str()]["loggedIn"] == true).await;
    for _ in 0..50 {
        if reads(&sb) > before {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    assert!(reads(&sb) > before, "the login read the account's limits again");
}
