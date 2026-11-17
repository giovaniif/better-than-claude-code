//! `session.kill`: stopping one of a session's processes from the Processes
//! tab. yardd checks every pid against the session's process tree read at
//! that moment, so these tests start real processes (a terminal's `sleep`,
//! the scripted Claude sidecar's background `sleep 30`) and kill only those.

mod common;

use std::{
    process::{Command, Stdio},
    time::Duration,
};

use common::*;
use serde_json::{json, Value};

fn alive(pid: u64) -> bool {
    Command::new("kill").args(["-0", &pid.to_string()]).stderr(Stdio::null()).status().is_ok_and(|s| s.success())
}

/// Ask `session.procs` until the list has a process whose command line
/// contains `needle`: the list comes from the host sampler, a few seconds
/// behind.
async fn procs_with(c: &mut Client, sid: &str, needle: &str) -> Vec<Value> {
    for _ in 0..15 {
        let from = c.mark();
        c.send(json!({ "op": "session.procs", "sessionId": sid })).await;
        let reply = c.wait_after(from, "a session.procs reply", |m| m["op"] == "session.procs" && m["sessionId"] == sid).await;
        let procs = reply["procs"].as_array().expect("procs is a list").clone();
        if procs.iter().any(|p| p["cmd"].as_str().is_some_and(|cmd| cmd.contains(needle))) {
            return procs;
        }
        tokio::time::sleep(Duration::from_millis(1000)).await;
    }
    panic!("no process with `{needle}` in the list of {sid}");
}

fn find<'a>(procs: &'a [Value], name: &str, needle: &str) -> &'a Value {
    procs
        .iter()
        .find(|p| p["name"] == name && p["cmd"].as_str().is_some_and(|c| c.contains(needle)))
        .unwrap_or_else(|| panic!("no `{name}` process with `{needle}` in {procs:?}"))
}

/// Send `session.kill` and return its `session.killed` reply. An error reply
/// (an older yardd: "unknown op") fails the test with its message.
async fn kill(c: &mut Client, mut msg: Value) -> Value {
    let from = c.mark();
    let pid = msg["pid"].clone();
    msg["op"] = json!("session.kill");
    c.send(msg).await;
    let reply = c
        .wait_after(from, "the session.killed reply", |m| (m["op"] == "session.killed" && m["pid"] == pid) || (m["op"] == "error" && m["for"] == "session.kill"))
        .await;
    assert_eq!(reply["op"], "session.killed", "{reply}");
    reply
}

/// A Codex session with a terminal open, and the terminal's id.
async fn session_with_terminal(c: &mut Client, sb: &Sandbox) -> (String, String) {
    let sid = c.create(&sb.folder("proj"), "hi", json!({})).await;
    c.wait_turn_done(&sid, 0).await;
    let from = c.mark();
    c.send(json!({ "op": "term.open", "sessionId": sid, "cols": 80, "rows": 24 })).await;
    let opened = c.wait_after(from, "term.opened", |m| m["op"] == "term.opened").await;
    (sid, opened["termId"].as_str().unwrap().to_string())
}

#[tokio::test]
async fn stopping_a_command_in_the_sessions_terminal_ends_it() {
    let sb = Sandbox::new("kill-term");
    let d = sb.start();
    let mut c = d.client().await;
    let (sid, term) = session_with_terminal(&mut c, &sb).await;
    c.send(json!({ "op": "term.input", "termId": term, "data": "sleep 300\n" })).await;

    let procs = procs_with(&mut c, &sid, "sleep 300").await;
    let sleep = find(&procs, "sleep", "sleep 300");
    assert_eq!(sleep["engine"], false);
    let pid = sleep["pid"].as_u64().unwrap();
    assert!(sleep["start"].as_u64().is_some(), "{sleep}");

    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": pid, "start": sleep["start"], "signal": "term", "ref": "r1" })).await;
    assert_eq!(reply["result"], "killed", "{reply}");
    assert_eq!(reply["sessionId"], sid);
    assert_eq!(reply["signal"], "term");
    // The tab waits on its own request.
    assert_eq!(reply["ref"], "r1");
    assert_eq!(reply["running"], json!([]));
    assert!(!alive(pid), "pid {pid} still runs");

    // The next list leaves it out at once, not a sample later.
    let from = c.mark();
    c.send(json!({ "op": "session.procs", "sessionId": sid })).await;
    let after = c.wait_after(from, "a session.procs reply", |m| m["op"] == "session.procs").await;
    assert!(!after["procs"].as_array().unwrap().iter().any(|p| p["pid"] == pid), "{after}");
    // The terminal's shell is untouched.
    assert!(after["procs"].as_array().unwrap().iter().any(|p| p["origin"] == "terminal"), "{after}");
}

#[tokio::test]
async fn a_process_that_ignores_sigterm_is_still_running_until_force_killed() {
    let sb = Sandbox::new("kill-force");
    let d = sb.start();
    let mut c = d.client().await;
    let (sid, term) = session_with_terminal(&mut c, &sb).await;
    // SIGTERM stays ignored across the exec.
    c.send(json!({ "op": "term.input", "termId": term, "data": "sh -c 'trap \"\" TERM; exec sleep 301'\n" })).await;

    let procs = procs_with(&mut c, &sid, "sleep 301").await;
    let sleep = find(&procs, "sleep", "sleep 301");
    let pid = sleep["pid"].as_u64().unwrap();

    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": pid, "start": sleep["start"], "signal": "term" })).await;
    assert_eq!(reply["result"], "running", "{reply}");
    assert_eq!(reply["running"], json!([pid]));
    assert!(alive(pid));

    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": pid, "start": sleep["start"], "signal": "kill" })).await;
    assert_eq!(reply["result"], "killed", "{reply}");
    assert_eq!(reply["signal"], "kill");
    assert!(!alive(pid), "pid {pid} survived SIGKILL");
}

#[tokio::test]
async fn stopping_with_children_ends_the_whole_subtree() {
    let sb = Sandbox::new("kill-tree");
    let d = sb.start();
    let mut c = d.client().await;
    let (sid, term) = session_with_terminal(&mut c, &sb).await;
    c.send(json!({ "op": "term.input", "termId": term, "data": "sh -c 'sleep 302 & wait'\n" })).await;

    let procs = procs_with(&mut c, &sid, "sleep 302").await;
    let parent = find(&procs, "sh", "sleep 302 & wait");
    let child = find(&procs, "sleep", "sleep 302");
    assert_eq!(child["ppid"], parent["pid"]);
    let (ppid, cpid) = (parent["pid"].as_u64().unwrap(), child["pid"].as_u64().unwrap());

    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": ppid, "start": parent["start"], "signal": "term", "tree": true })).await;
    assert_eq!(reply["result"], "killed", "{reply}");
    assert_eq!(reply["tree"], true);
    assert!(!alive(ppid) && !alive(cpid), "the parent or its child still runs");
}

#[tokio::test]
async fn refuses_a_pid_that_is_not_the_sessions() {
    let sb = Sandbox::new("kill-refuse");
    let d = sb.start();
    let mut c = d.client().await;
    let (sid, term) = session_with_terminal(&mut c, &sb).await;
    c.send(json!({ "op": "term.input", "termId": term, "data": "sleep 303\n" })).await;
    let procs = procs_with(&mut c, &sid, "sleep 303").await;
    let sleep = find(&procs, "sleep", "sleep 303");
    let pid = sleep["pid"].as_u64().unwrap();

    // A process of this test's own, outside any session.
    let mut outsider = Command::new("sleep").arg("30").spawn().unwrap();
    let opid = outsider.id() as u64;
    let refused = |reply: &Value, why: &str| {
        assert_eq!(reply["result"], "refused", "{reply}");
        assert!(reply["reason"].as_str().is_some_and(|r| r.contains(why)), "{reply}");
    };
    for signal in ["term", "kill"] {
        let reply = kill(&mut c, json!({ "sessionId": sid, "pid": opid, "signal": signal })).await;
        refused(&reply, "not one of this session's processes");
        let reply = kill(&mut c, json!({ "sessionId": sid, "pid": opid, "signal": signal, "tree": true })).await;
        refused(&reply, "not one of this session's processes");
    }
    assert!(alive(opid), "the outside process was killed");
    let _ = outsider.kill();
    let _ = outsider.wait();

    refused(&kill(&mut c, json!({ "sessionId": sid, "pid": 1, "signal": "kill" })).await, "system");
    let own = d.pid() as u64;
    refused(&kill(&mut c, json!({ "sessionId": sid, "pid": own, "signal": "kill" })).await, "own daemon");
    assert!(alive(own));
    // A start time that is not the listed one: the pid was reused.
    let start = sleep["start"].as_u64().unwrap() + 1000;
    refused(&kill(&mut c, json!({ "sessionId": sid, "pid": pid, "start": start, "signal": "term" })).await, "different process");
    assert!(alive(pid));

    // Another session cannot stop this session's process.
    let other = c.create(&sb.folder("other"), "hi", json!({})).await;
    c.wait_turn_done(&other, 0).await;
    refused(&kill(&mut c, json!({ "sessionId": other, "pid": pid, "signal": "term" })).await, "not one of this session's processes");
    assert!(alive(pid));

    // Malformed requests are errors, not kills.
    for bad in [json!({ "sessionId": sid, "pid": pid, "signal": "hup" }), json!({ "sessionId": sid, "pid": pid }), json!({ "sessionId": "nope", "pid": pid, "signal": "term" })] {
        let from = c.mark();
        let mut msg = bad.clone();
        msg["op"] = json!("session.kill");
        c.send(msg).await;
        c.wait_after(from, "an error", |m| m["op"] == "error" && m["for"] == "session.kill").await;
    }
    assert!(alive(pid));
}

#[tokio::test]
async fn the_agents_own_process_is_refused_and_its_commands_are_not() {
    let sb = Sandbox::new("kill-agent");
    let sidecar = fake_bin().join("yard-claude");
    let d = sb.start_with(&[("YARD_SIDECAR", sidecar.to_str().unwrap())]);
    let mut c = d.client().await;
    let extra = json!({ "engine": "claude", "model": "claude-haiku-5-5" });
    // The scripted sidecar leaves a `sleep 30` running under itself.
    let sid = c.create(&sb.folder("proj"), "[subagent] look around", extra).await;
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");

    let procs = procs_with(&mut c, &sid, "sleep 30").await;
    let agent = procs.iter().find(|p| p["cmd"].as_str().is_some_and(|c| c.contains("yard-claude"))).expect("the sidecar is listed");
    assert_eq!(agent["engine"], true, "{agent}");
    let apid = agent["pid"].as_u64().unwrap();
    for (signal, tree) in [("term", false), ("kill", false), ("kill", true)] {
        let reply = kill(&mut c, json!({ "sessionId": sid, "pid": apid, "start": agent["start"], "signal": signal, "tree": tree })).await;
        assert_eq!(reply["result"], "refused", "{reply}");
        assert!(reply["reason"].as_str().unwrap().contains("agent"), "{reply}");
    }
    assert!(alive(apid), "the sidecar was killed");

    // What the agent started is the session's to stop.
    let sleep = find(&procs, "sleep", "sleep 30");
    assert_eq!(sleep["engine"], false);
    let pid = sleep["pid"].as_u64().unwrap();
    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": pid, "start": sleep["start"], "signal": "term" })).await;
    assert_eq!(reply["result"], "killed", "{reply}");
    assert!(!alive(pid));

    // The session still takes a turn.
    let next = c.next_seq(&sid);
    c.send(json!({ "op": "session.send", "sessionId": sid, "text": "still there?" })).await;
    assert_eq!(c.wait_turn_done(&sid, next).await["status"], "completed");
}

#[tokio::test]
async fn session_kill_goes_through_the_hub() {
    let sidecar = fake_bin().join("yard-claude");
    let remote_sb = Sandbox::new("kill-remote");
    let remote = remote_sb.start_with(&[("YARD_SIDECAR", sidecar.to_str().unwrap())]);
    let hub_sb = Sandbox::new("kill-hub");
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

    let extra = json!({ "host": host, "engine": "claude", "model": "claude-haiku-5-5" });
    let sid = c.create(&remote_sb.folder("proj"), "[subagent] look around", extra).await;
    assert!(sid.starts_with(&format!("{host}~")));
    assert_eq!(c.wait_turn_done(&sid, 0).await["status"], "completed");

    let procs = procs_with(&mut c, &sid, "sleep 30").await;
    let agent = procs.iter().find(|p| p["engine"] == true).expect("the sidecar is listed");
    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": agent["pid"], "signal": "kill" })).await;
    assert_eq!(reply["result"], "refused", "{reply}");

    let sleep = find(&procs, "sleep", "sleep 30");
    let pid = sleep["pid"].as_u64().unwrap();
    let reply = kill(&mut c, json!({ "sessionId": sid, "pid": pid, "start": sleep["start"], "signal": "term" })).await;
    // The reply carries the hub's id for the session, like every session op.
    assert_eq!(reply["sessionId"], sid);
    assert_eq!(reply["result"], "killed", "{reply}");
    assert!(!alive(pid));
}
