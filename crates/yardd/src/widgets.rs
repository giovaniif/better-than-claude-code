//! MCP Apps widgets: the chart (or form, or map) an MCP tool declares with
//! `_meta.ui.resourceUri`, shown in the thread under the tool call.
//!
//! An engine reports a widget on `tool_completed` as `app` with the HTML, its
//! CSP and the call's input and result. Before the event is logged, `take`
//! saves that to `<data dir>/widgets/<id>.json` and leaves `app: { id, server,
//! tool }`, so the log stays small and a reload still shows the chart.
//!
//! Ops, routed by `sessionId` like any session op:
//! - `widget.get { sessionId, id, ref }` -> `widget.data { ref, widget | error }`
//! - `widget.call { sessionId, id, tool, arguments, ref }` -> `widget.result { ref, result | error }`:
//!   a tool call the widget makes, only to its own server. Claude decides it
//!   like the model's own call (read-only tools run, others ask in the thread);
//!   Codex has no such check, so only read-only tools run there.
//!
//! The HTML is untrusted: the UI runs it in a sandboxed frame with no access
//! to the page, the socket or the network beyond what its CSP names.

use std::{sync::Arc, time::Duration};

use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::state::{App, Backend};

/// A widget record larger than this is not kept: the tool call shows as a
/// plain call instead.
const MAX_RECORD: usize = 8 * 1024 * 1024;
const CALL_TIMEOUT: Duration = Duration::from_secs(120);

fn dir() -> std::path::PathBuf {
    crate::store::data_dir().join("widgets")
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Called by `App::emit` before a `tool_completed` is logged.
pub fn take(app: &App, event: &mut Value) {
    if event["type"] != "tool_completed" || !event["app"]["html"].is_string() {
        return;
    }
    let full = event["app"].take();
    let id = app.id("w");
    let record = json!({
        "server": full["server"],
        "tool": full["tool"],
        "uri": full["uri"],
        "html": full["html"],
        "csp": full["csp"],
        "permissions": full["permissions"],
        "prefersBorder": full["prefersBorder"],
        "input": full["input"],
        "result": full["result"],
    });
    let text = record.to_string();
    let saved = text.len() <= MAX_RECORD
        && std::fs::create_dir_all(dir()).is_ok()
        && std::fs::write(dir().join(format!("{id}.json")), &text).is_ok();
    if let Some(obj) = event.as_object_mut() {
        if saved {
            obj.insert("app".into(), json!({ "id": id, "server": full["server"], "tool": full["tool"] }));
        } else {
            obj.remove("app");
        }
    }
}

/// The record, if the session's own log names it.
fn load(app: &App, sid: &str, id: &str) -> Result<Value> {
    if !valid_id(id) {
        bail!("no such widget");
    }
    let known = {
        let map = app.sessions.lock().unwrap();
        let s = map.get(sid).context("no such session")?;
        s.events.iter().any(|e| e["type"] == "tool_completed" && e["app"]["id"] == id)
    };
    if !known {
        bail!("this session has no widget {id}");
    }
    let text = std::fs::read_to_string(dir().join(format!("{id}.json"))).context("the widget is gone")?;
    serde_json::from_str(&text).context("the widget record is damaged")
}

pub async fn handle(app: &Arc<App>, direct: &mpsc::UnboundedSender<String>, msg: &Value) -> Result<()> {
    let sid = msg["sessionId"].as_str().context("missing `sessionId`")?;
    let id = msg["id"].as_str().context("missing `id`")?;
    match msg["op"].as_str().unwrap_or("") {
        "widget.get" => {
            let mut reply = match load(app, sid, id) {
                Ok(w) => json!({ "op": "widget.data", "sessionId": sid, "id": id, "widget": w }),
                Err(e) => json!({ "op": "widget.data", "sessionId": sid, "id": id, "error": format!("{e:#}") }),
            };
            reply["ref"] = msg["ref"].clone();
            let _ = direct.send(reply.to_string());
        }
        "widget.call" => {
            let tool = msg["tool"].as_str().filter(|t| !t.is_empty()).context("missing `tool`")?.to_string();
            let args = if msg["arguments"].is_object() { msg["arguments"].clone() } else { json!({}) };
            let (app, direct, msg) = (app.clone(), direct.clone(), msg.clone());
            let (sid, id) = (sid.to_string(), id.to_string());
            // A call can wait on an approval in the thread: never hold the socket's loop.
            tokio::spawn(async move {
                let mut reply = match call(&app, &sid, &id, &tool, args).await {
                    Ok(result) => json!({ "op": "widget.result", "sessionId": sid, "result": result }),
                    Err(e) => json!({ "op": "widget.result", "sessionId": sid, "error": format!("{e:#}") }),
                };
                reply["ref"] = msg["ref"].clone();
                let _ = direct.send(reply.to_string());
            });
        }
        other => bail!("unknown op `{other}`"),
    }
    Ok(())
}

async fn call(app: &Arc<App>, sid: &str, id: &str, tool: &str, args: Value) -> Result<Value> {
    let record = load(app, sid, id)?;
    let server = record["server"].as_str().context("the widget names no server")?.to_string();
    let meta = app.meta(sid).context("no such session")?;
    if meta.engine == "claude" {
        crate::claude::ensure(app, sid)?;
        let r = app.id("wc");
        let tx = match app.sessions.lock().unwrap().get(sid).map(|s| &s.backend) {
            Some(Backend::Claude { tx, .. }) => tx.clone(),
            _ => bail!("the Claude sidecar is not running"),
        };
        tx.send(json!({ "type": "mcp_call", "ref": r, "server": server, "tool": tool, "arguments": args }).to_string())
            .map_err(|_| anyhow::anyhow!("the Claude sidecar is not running"))?;
        return app.mcp.wait(&r, CALL_TIMEOUT).await;
    }
    let thread_id = crate::codex::thread_for_widget(app, sid).await?;
    let c = crate::codex::client(app, &meta.account).await?;
    let status = c
        .request("mcpServerStatus/list", json!({ "detail": "toolsAndAuthOnly", "serverName": server, "threadId": thread_id }))
        .await?;
    let entry = status["data"].as_array().and_then(|l| l.iter().find(|s| s["name"] == server.as_str())).context("the widget's server is gone")?;
    let t = &entry["tools"][tool];
    if t.is_null() {
        bail!("{server} has no tool {tool}");
    }
    if !visible_to_widget(&t["_meta"]) {
        bail!("{tool} is not offered to widgets");
    }
    if t["annotations"]["readOnlyHint"] != true {
        bail!("Switchyard lets a Codex widget run only read-only tools; {tool} is not marked read-only");
    }
    let res = tokio::time::timeout(
        CALL_TIMEOUT,
        c.request("mcpServer/tool/call", json!({ "threadId": thread_id, "server": server, "tool": tool, "arguments": args })),
    )
    .await
    .context("the tool did not answer in time")??;
    Ok(res)
}

/// Who may call a tool: no `visibility` means the model and widgets.
fn visible_to_widget(meta: &Value) -> bool {
    match meta["ui"]["visibility"].as_array() {
        Some(list) => list.iter().any(|v| v == "app"),
        None => true,
    }
}

/// A Codex `mcpToolCall` that finished. With a widget, the resource is read
/// before `tool_completed` goes out, so this runs as a task; without one it
/// is emitted at once.
pub fn codex_completed(app: &Arc<App>, sid: &str, item: &Value) {
    let event = codex_event(item);
    let uri = item["mcpAppUi"]["resourceUri"]
        .as_str()
        .or_else(|| item["mcpAppResourceUri"].as_str())
        .filter(|u| u.starts_with("ui://"))
        .map(str::to_string);
    let Some(uri) = uri.filter(|_| event["ok"] == true) else {
        app.emit(sid, event);
        return;
    };
    let (app, sid, item) = (app.clone(), sid.to_string(), item.clone());
    tokio::spawn(async move {
        let mut event = event;
        if let Ok(widget) = codex_widget(&app, &sid, &item, &uri).await {
            event["app"] = widget;
        }
        app.emit(&sid, event);
    });
}

fn codex_event(item: &Value) -> Value {
    let ok = item["status"] == "completed" && item["error"].is_null();
    let text: Vec<&str> = item["result"]["content"]
        .as_array()
        .map(|c| c.iter().filter_map(|b| if b["type"] == "text" { b["text"].as_str() } else { None }).collect())
        .unwrap_or_default();
    let output = if ok { text.join("\n") } else { item["error"]["message"].as_str().unwrap_or("").to_string() };
    let output: String = output.chars().take(4000).collect();
    json!({ "type": "tool_completed", "itemId": item["id"], "ok": ok, "output": if output.is_empty() { Value::Null } else { json!(output) } })
}

async fn codex_widget(app: &Arc<App>, sid: &str, item: &Value, uri: &str) -> Result<Value> {
    let server = item["server"].as_str().context("no server")?;
    let account = app.meta(sid).context("no such session")?.account;
    let c = crate::codex::client(app, &account).await?;
    let thread_id = crate::codex::thread_for_widget(app, sid).await.ok();
    let res = tokio::time::timeout(
        Duration::from_secs(8),
        c.request("mcpServer/resource/read", json!({ "threadId": thread_id, "originCallId": item["id"], "server": server, "uri": uri })),
    )
    .await
    .context("the widget did not load in time")??;
    let content = res["contents"]
        .as_array()
        .and_then(|l| l.iter().find(|c| c["mimeType"].as_str().unwrap_or("text/html").starts_with("text/html") && c["text"].is_string()))
        .context("the server sent no HTML for the widget")?;
    let ui = &content["_meta"]["ui"];
    Ok(json!({
        "server": server,
        "tool": item["tool"],
        "uri": uri,
        "html": content["text"],
        "csp": ui["csp"],
        "permissions": ui["permissions"],
        "prefersBorder": ui["prefersBorder"],
        "input": item["arguments"],
        "result": item["result"],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_cannot_leave_the_folder() {
        assert!(valid_id("w-12ab"));
        assert!(!valid_id("../yard.db"));
        assert!(!valid_id("a/b"));
        assert!(!valid_id(""));
    }

    #[test]
    fn a_codex_call_reports_its_text_and_failure() {
        let ok = codex_event(&json!({ "id": "c1", "status": "completed", "error": null, "result": { "content": [{ "type": "text", "text": "p95: 8 points" }] } }));
        assert_eq!((ok["ok"].as_bool(), ok["output"].as_str()), (Some(true), Some("p95: 8 points")));
        let failed = codex_event(&json!({ "id": "c1", "status": "failed", "error": { "message": "denied" }, "result": null }));
        assert_eq!((failed["ok"].as_bool(), failed["output"].as_str()), (Some(false), Some("denied")));
    }

    #[test]
    fn widget_visibility_defaults_to_both() {
        assert!(visible_to_widget(&json!(null)));
        assert!(visible_to_widget(&json!({ "ui": { "visibility": ["app"] } })));
        assert!(!visible_to_widget(&json!({ "ui": { "visibility": ["model"] } })));
    }
}
