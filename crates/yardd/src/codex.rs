//! Codex adapter: one shared `codex app-server` over stdio JSON-RPC.
//! Threads map to sessions; notifications are normalized into session events.

use std::{
    collections::HashMap,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

use anyhow::{anyhow, bail, Context, Result};
use serde_json::{json, Value};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{mpsc, oneshot},
};

use crate::{
    attachments,
    state::{App, Backend},
};

pub struct Client {
    tx: mpsc::UnboundedSender<String>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    next: AtomicU64,
    /// thread id -> session id
    threads: Mutex<HashMap<String, String>>,
    /// our request id -> the JSON-RPC id the server is waiting on
    approvals: Mutex<HashMap<String, Value>>,
}

impl Client {
    async fn start(app: Arc<App>) -> Result<Arc<Client>> {
        let mut child = Command::new("codex")
            .arg("app-server")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("could not start `codex app-server`")?;
        if let Some(pid) = child.id() {
            app.guard.set_codex_server(pid);
        }
        let mut stdin = child.stdin.take().context("codex stdin")?;
        let stdout = child.stdout.take().context("codex stdout")?;

        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn(async move {
            while let Some(line) = rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                let _ = stdin.flush().await;
            }
        });

        let client = Arc::new(Client {
            tx,
            pending: Mutex::new(HashMap::new()),
            next: AtomicU64::new(1),
            threads: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
        });

        let reader = client.clone();
        tokio::spawn(async move {
            let _child = child; // dropped (and killed) when the reader ends
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                reader.on_line(&app, &line);
            }
            eprintln!("yardd: codex app-server exited");
        });

        client
            .request(
                "initialize",
                json!({ "clientInfo": {
                    "name": "switchyard",
                    "title": "Switchyard",
                    "version": env!("CARGO_PKG_VERSION"),
                }}),
            )
            .await?;
        client.send(json!({ "method": "initialized" }));
        Ok(client)
    }

    fn send(&self, msg: Value) {
        let _ = self.tx.send(msg.to_string());
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);
        self.send(json!({ "id": id, "method": method, "params": params }));
        match rx.await {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(anyhow!("codex {method}: {e}")),
            Err(_) => Err(anyhow!("codex {method}: connection closed")),
        }
    }

    fn session_for(&self, params: &Value) -> Option<String> {
        let thread = params["threadId"].as_str()?;
        self.threads.lock().unwrap().get(thread).cloned()
    }

    fn on_line(&self, app: &Arc<App>, line: &str) {
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let has_id = !msg["id"].is_null();
        let method = msg["method"].as_str();

        match (has_id, method) {
            // Response to one of our requests.
            (true, None) => {
                let Some(id) = msg["id"].as_u64() else { return };
                if let Some(tx) = self.pending.lock().unwrap().remove(&id) {
                    let result = if msg["error"].is_null() {
                        Ok(msg["result"].clone())
                    } else {
                        Err(msg["error"]["message"]
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| msg["error"].to_string()))
                    };
                    let _ = tx.send(result);
                }
            }
            // Server asks us something: approvals.
            (true, Some(method)) => self.on_server_request(app, &msg["id"], method, &msg["params"]),
            (false, Some(method)) => self.on_notification(app, method, &msg["params"]),
            _ => {}
        }
    }

    fn on_server_request(&self, app: &Arc<App>, id: &Value, method: &str, p: &Value) {
        let sid = self.session_for(p);
        let (kind, title, detail) = match method {
            "item/commandExecution/requestApproval" => (
                "command",
                clean_command(p["command"].as_str().unwrap_or("")),
                p["reason"].as_str().unwrap_or("").to_string(),
            ),
            "item/fileChange/requestApproval" => (
                "edit",
                "Apply file changes".to_string(),
                p["reason"].as_str().unwrap_or("").to_string(),
            ),
            _ => {
                self.send(json!({ "id": id, "error": { "code": -32601, "message": "not supported" } }));
                return;
            }
        };
        let Some(sid) = sid else {
            self.send(json!({ "id": id, "result": { "decision": "decline" } }));
            return;
        };
        let request_id = format!("codex-{id}");
        self.approvals.lock().unwrap().insert(request_id.clone(), id.clone());
        app.emit(
            &sid,
            json!({
                "type": "approval_request",
                "requestId": request_id,
                "kind": kind,
                "title": title,
                "detail": detail,
                "itemId": p["itemId"],
            }),
        );
    }

    pub fn approve(&self, request_id: &str, decision: &str) -> Result<()> {
        let id = self
            .approvals
            .lock()
            .unwrap()
            .remove(request_id)
            .context("approval is no longer pending")?;
        let decision = match decision {
            "allow" => "accept",
            "allow_always" => "acceptForSession",
            _ => "decline",
        };
        self.send(json!({ "id": id, "result": { "decision": decision } }));
        Ok(())
    }

    fn on_notification(&self, app: &Arc<App>, method: &str, p: &Value) {
        if method == "account/rateLimits/updated" {
            app.set_usage("codex", p["rateLimits"].clone());
            return;
        }
        let Some(sid) = self.session_for(p) else { return };
        match method {
            "turn/started" => set_turn(app, &sid, p["turn"]["id"].as_str()),
            "item/agentMessage/delta" => app.emit(
                &sid,
                json!({ "type": "assistant_delta", "itemId": p["itemId"], "text": p["delta"] }),
            ),
            "item/started" => on_item(app, &sid, true, &p["item"]),
            "item/completed" => on_item(app, &sid, false, &p["item"]),
            "turn/completed" => {
                set_turn(app, &sid, None);
                app.guard.turn_done(&sid);
                let turn = &p["turn"];
                if !turn["error"].is_null() {
                    let message = turn["error"]["message"]
                        .as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| turn["error"].to_string());
                    app.emit(&sid, json!({ "type": "error", "message": message }));
                }
                app.emit(&sid, json!({ "type": "turn_completed", "status": turn["status"] }));
            }
            "error" => {
                let message = p["error"]["message"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| p.to_string());
                app.emit(&sid, json!({ "type": "error", "message": message }));
            }
            _ => {}
        }
    }
}

fn set_turn(app: &Arc<App>, sid: &str, turn: Option<&str>) {
    if let Some(s) = app.sessions.lock().unwrap().get_mut(sid) {
        if let Backend::Codex { turn_id, .. } = &mut s.backend {
            *turn_id = turn.map(str::to_string);
        }
    }
}

fn on_item(app: &Arc<App>, sid: &str, started: bool, item: &Value) {
    let id = &item["id"];
    match item["type"].as_str().unwrap_or("") {
        "agentMessage" if !started => app.emit(
            sid,
            json!({ "type": "assistant_message", "itemId": id, "text": item["text"] }),
        ),
        "commandExecution" => {
            // Lets the resource guard tell this session's commands apart
            // among the app-server's children (see `guard::sample`).
            let item_id = id.as_str().unwrap_or("");
            if started {
                let cwd = item["cwd"].as_str().map(str::to_string);
                let cwd = cwd.or_else(|| app.meta(sid).map(|m| m.cwd)).unwrap_or_default();
                app.guard.command_started(sid, item_id, &cwd);
            } else {
                app.guard.command_done(sid, item_id);
            }
            if started {
                app.emit(
                    sid,
                    json!({
                        "type": "tool_started",
                        "itemId": id,
                        "kind": "command",
                        "title": "Ran",
                        "detail": clean_command(item["command"].as_str().unwrap_or("")),
                    }),
                );
            } else {
                let ok = item["exitCode"].as_i64() == Some(0);
                app.emit(
                    sid,
                    json!({
                        "type": "tool_completed",
                        "itemId": id,
                        "ok": ok,
                        "output": item["aggregatedOutput"],
                        "note": if ok { Value::Null } else { json!(item["status"]) },
                    }),
                );
            }
        }
        // Emitted when the change is proposed, so the diff is on screen
        // before the approval that asks about it.
        "fileChange" if started => {
            let cwd = app.meta(sid).map(|m| m.cwd).unwrap_or_default();
            let prefix = format!("{}/", cwd.trim_end_matches('/'));
            let files: Vec<Value> = item["changes"]
                .as_array()
                .map(|changes| {
                    changes
                        .iter()
                        .map(|c| {
                            let path = c["path"].as_str().unwrap_or("");
                            let path = path.strip_prefix(&prefix).unwrap_or(path);
                            json!({ "path": path, "diff": c["diff"], "kind": c["kind"]["type"] })
                        })
                        .collect()
                })
                .unwrap_or_default();
            app.emit(sid, json!({ "type": "file_change", "itemId": id, "files": files }));
        }
        kind @ ("mcpToolCall" | "webSearch" | "dynamicToolCall") => {
            if started {
                let detail = item["tool"]
                    .as_str()
                    .or_else(|| item["query"].as_str())
                    .unwrap_or("");
                app.emit(
                    sid,
                    json!({
                        "type": "tool_started",
                        "itemId": id,
                        "kind": "other",
                        "title": if kind == "webSearch" { "Searched the web" } else { "Called" },
                        "detail": detail,
                    }),
                );
            } else {
                app.emit(sid, json!({ "type": "tool_completed", "itemId": id, "ok": true }));
            }
        }
        _ => {}
    }
}

/// `/bin/bash -lc 'touch a'` -> `touch a`
fn clean_command(command: &str) -> String {
    for shell in ["/bin/bash -lc ", "/bin/zsh -lc ", "bash -lc ", "zsh -lc "] {
        if let Some(rest) = command.strip_prefix(shell) {
            let rest = rest.trim();
            // Undo the shell quoting Codex wrapped the command in.
            if let Some(inner) = rest.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')) {
                return inner.replace("'\"'\"'", "'");
            }
            if let Some(inner) = rest.strip_prefix('"').and_then(|r| r.strip_suffix('"')) {
                return inner
                    .replace("\\\"", "\"")
                    .replace("\\$", "$")
                    .replace("\\`", "`")
                    .replace("\\\\", "\\");
            }
            return rest.to_string();
        }
    }
    command.to_string()
}

pub async fn client(app: &Arc<App>) -> Result<Arc<Client>> {
    let app2 = app.clone();
    app.codex
        .get_or_try_init(|| async move { Client::start(app2).await })
        .await
        .cloned()
}

/// Ask Codex which models and efforts this account has.
pub async fn load_models(app: &Arc<App>) -> Result<()> {
    let c = client(app).await?;
    let res = c.request("model/list", json!({})).await?;
    let models: Vec<Value> = res["data"]
        .as_array()
        .map(|list| {
            list.iter()
                .map(|m| {
                    let efforts: Vec<Value> = m["supportedReasoningEfforts"]
                        .as_array()
                        .map(|e| e.iter().map(|x| x["reasoningEffort"].clone()).collect())
                        .unwrap_or_default();
                    json!({
                        "id": m["id"],
                        "name": m["displayName"].as_str().or_else(|| m["id"].as_str()),
                        "efforts": efforts,
                        "defaultEffort": m["defaultReasoningEffort"],
                        "isDefault": m["isDefault"],
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let all = {
        let mut current = app.models.lock().unwrap();
        current["codex"] = json!(models);
        current.clone()
    };
    app.broadcast(json!({ "op": "models", "models": all }));

    if let Ok(limits) = c.request("account/rateLimits/read", json!({})).await {
        app.set_usage("codex", limits["rateLimits"].clone());
    }
    Ok(())
}

/// Codex's sandbox for new and resumed threads: `workspace-write` unless
/// YARD_CODEX_SANDBOX says otherwise. The container image sets
/// `danger-full-access`, because Codex's Linux sandbox (bubblewrap) cannot
/// create namespaces in an unprivileged container, so every command would
/// fail; there the container is the boundary.
fn sandbox_mode() -> &'static str {
    match std::env::var("YARD_CODEX_SANDBOX").as_deref().map(str::trim) {
        Ok("read-only") => "read-only",
        Ok("danger-full-access") => "danger-full-access",
        Ok("workspace-write") | Ok("") | Err(_) => "workspace-write",
        Ok(other) => {
            eprintln!("yardd: unknown YARD_CODEX_SANDBOX `{other}`, using workspace-write");
            "workspace-write"
        }
    }
}

/// The approval and sandbox policy for a turn in a session's mode. Codex
/// already edits inside its workspace sandbox without asking, so `ask` and
/// `acceptEdits` are the same here; `plan` can look but not change; `full`
/// drops the sandbox and never asks.
fn turn_policy(permission: &str) -> (Value, Value) {
    let workspace = || match sandbox_mode() {
        "danger-full-access" => json!({ "type": "dangerFullAccess" }),
        "read-only" => json!({ "type": "readOnly", "networkAccess": false }),
        _ => json!({
            "type": "workspaceWrite",
            "writableRoots": [],
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false,
        }),
    };
    match permission {
        "plan" => (json!("on-request"), json!({ "type": "readOnly", "networkAccess": false })),
        "full" => (json!("never"), json!({ "type": "dangerFullAccess" })),
        _ => (json!("on-request"), workspace()),
    }
}

pub async fn create(app: &Arc<App>, sid: &str) -> Result<()> {
    let meta = app.meta(sid).context("no such session")?;
    let c = client(app).await?;
    let res = c
        .request(
            "thread/start",
            json!({
                "cwd": meta.cwd,
                "model": meta.model,
                "sandbox": sandbox_mode(),
                // Sandboxed to the workspace; Codex asks when it needs more.
                // "untrusted" asked before every `cat`, which was unusable.
                "approvalPolicy": "on-request",
            }),
        )
        .await?;
    let thread_id = res["thread"]["id"]
        .as_str()
        .context("thread/start returned no thread id")?
        .to_string();
    attach(app, &c, sid, thread_id);
    Ok(())
}

fn attach(app: &Arc<App>, c: &Client, sid: &str, thread_id: String) {
    c.threads.lock().unwrap().insert(thread_id.clone(), sid.to_string());
    app.set_engine_ref(sid, &thread_id);
    if let Some(s) = app.sessions.lock().unwrap().get_mut(sid) {
        s.backend = Backend::Codex { thread_id, turn_id: None };
    }
}

/// Reopen the saved thread of a session restored after a yardd restart.
async fn resume(app: &Arc<App>, sid: &str, thread_id: String) -> Result<()> {
    let meta = app.meta(sid).context("no such session")?;
    let c = client(app).await?;
    c.request(
        "thread/resume",
        json!({
            "threadId": thread_id,
            "cwd": meta.cwd,
            "model": meta.model,
            "sandbox": sandbox_mode(),
            "approvalPolicy": "on-request",
            // We have our own copy of the history.
            "excludeTurns": true,
        }),
    )
    .await?;
    attach(app, &c, sid, thread_id);
    Ok(())
}

/// Detach a session that is being deleted: stop its turn and drop its thread
/// mapping, so late notifications go nowhere.
pub async fn forget(app: &Arc<App>, sid: &str) {
    let Ok((thread_id, turn_id)) = thread_of(app, sid) else { return };
    let Some(c) = app.codex.get().cloned() else { return };
    if let Some(turn_id) = turn_id {
        let _ = c
            .request("turn/interrupt", json!({ "threadId": thread_id, "turnId": turn_id }))
            .await;
    }
    c.threads.lock().unwrap().remove(&thread_id);
}

fn thread_of(app: &Arc<App>, sid: &str) -> Result<(String, Option<String>)> {
    let map = app.sessions.lock().unwrap();
    match map.get(sid).map(|s| &s.backend) {
        Some(Backend::Codex { thread_id, turn_id }) => Ok((thread_id.clone(), turn_id.clone())),
        _ => bail!("session has no Codex thread"),
    }
}

pub async fn send(app: &Arc<App>, sid: &str, text: &str, attachments: &[Value]) -> Result<()> {
    if let Some(thread_id) = app.resumable(sid) {
        resume(app, sid, thread_id).await?;
    }
    let meta = app.meta(sid).context("no such session")?;
    let (thread_id, _) = thread_of(app, sid)?;
    let c = client(app).await?;
    // Every attachment is named by path in the text; images also go as
    // `localImage` items (codex-cli 0.164 `UserInput`), which the app-server
    // reads from disk itself.
    let mut input = vec![json!({ "type": "text", "text": attachments::prompt_text(text, attachments) })];
    input.extend(
        attachments
            .iter()
            .filter(|a| attachments::is_inline_image(a))
            .map(|a| json!({ "type": "localImage", "path": a["path"] })),
    );
    // Model, effort and permission mode ride on every turn, so switching
    // needs no extra call.
    let (approval, sandbox) = turn_policy(&meta.permission);
    let res = c
        .request(
            "turn/start",
            json!({
                "threadId": thread_id,
                "input": input,
                "model": meta.model,
                "effort": meta.effort,
                "approvalPolicy": approval,
                "sandboxPolicy": sandbox,
            }),
        )
        .await?;
    set_turn(app, sid, res["turn"]["id"].as_str());
    Ok(())
}

pub async fn interrupt(app: &Arc<App>, sid: &str) -> Result<()> {
    let (thread_id, turn_id) = thread_of(app, sid)?;
    let turn_id = turn_id.context("no turn is running")?;
    let c = client(app).await?;
    c.request("turn/interrupt", json!({ "threadId": thread_id, "turnId": turn_id }))
        .await?;
    Ok(())
}

pub async fn approve(app: &Arc<App>, request_id: &str, decision: &str) -> Result<()> {
    client(app).await?.approve(request_id, decision)
}
