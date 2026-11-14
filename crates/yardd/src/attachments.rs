//! Files and images attached to a prompt.
//!
//! The UI uploads each file over the WebSocket (`attach.put`) to the yardd
//! that runs the session, which may be a remote host behind the hub, so the
//! bytes end up where the agent can read them. Each one is saved as
//! `<data dir>/attachments/<id>/<name>` with a `.meta.json` beside it, and a
//! prompt then refers to it by id. Session events carry only the metadata;
//! `attach.get` fetches the bytes back for thumbnails.

use std::{fs, path::PathBuf};

use anyhow::{bail, Context, Result};
use base64::Engine as _;
use serde_json::{json, Value};

use crate::state::App;

/// Largest file accepted. With base64 and the JSON around it, one upload
/// stays well under `WS_MAX_MESSAGE` on both hops (UI -> hub -> remote).
pub const MAX_BYTES: usize = 10 * 1024 * 1024;
/// Message and frame limit for every WebSocket yardd speaks, server and hub
/// client alike. tungstenite's default 16 MiB frame limit is too close to a
/// full-size upload once base64 is added.
pub const WS_MAX_MESSAGE: usize = 32 * 1024 * 1024;
/// Attachments on one prompt.
pub const MAX_PER_MESSAGE: usize = 20;

/// Images both engines take inline. Anything else is mentioned by path only.
const INLINE_IMAGES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];

fn root() -> PathBuf {
    crate::store::data_dir().join("attachments")
}

/// A file name that is safe as one path component: the last segment of
/// whatever was sent, no control characters, and no leading dot or dash, so
/// it can be neither hidden, nor `..`, nor read as an option by a tool.
pub fn sanitize(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).find(|s| !s.trim().is_empty()).unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control())
        .map(|c| if c == ':' { '_' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches(['.', '-', ' ']);
    let mut out: String = cleaned.chars().take(120).collect();
    // Keep the extension when a long name is cut, so the type still shows.
    if cleaned.chars().count() > 120 {
        if let Some(ext) = cleaned.rsplit_once('.').map(|(_, e)| e).filter(|e| e.len() <= 10 && !e.is_empty()) {
            out = format!("{}.{ext}", out.chars().take(119 - ext.len()).collect::<String>());
        }
    }
    if out.is_empty() {
        "file".to_string()
    } else {
        out
    }
}

/// The image type the bytes really are, if one the engines take inline.
fn sniff(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// The browser's type for the file, trusted only as far as it can hurt: an
/// inline image type must match the bytes, since the engines decode it.
fn mime_for(claimed: &str, bytes: &[u8]) -> String {
    if let Some(real) = sniff(bytes) {
        return real.to_string();
    }
    let claimed = claimed.trim().to_ascii_lowercase();
    let well_formed = claimed.len() <= 100
        && claimed.split_once('/').is_some_and(|(a, b)| {
            let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
            ok(a) && ok(b)
        });
    if !well_formed || INLINE_IMAGES.contains(&claimed.as_str()) {
        return "application/octet-stream".to_string();
    }
    claimed
}

pub fn is_inline_image(attachment: &Value) -> bool {
    attachment["mime"].as_str().is_some_and(|m| INLINE_IMAGES.contains(&m))
}

fn over_cap(name: &str, size: usize) -> anyhow::Error {
    anyhow::anyhow!(
        "{name} is too large to attach ({}). The limit is {}.",
        human_size(size as u64),
        human_size(MAX_BYTES as u64)
    )
}

pub fn human_size(bytes: u64) -> String {
    if bytes < 1024 {
        format!("{bytes} B")
    } else if bytes < 1024 * 1024 {
        format!("{:.0} KB", bytes as f64 / 1024.0)
    } else {
        format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
    }
}

/// `attach.put`: save one upload and describe it.
pub fn put(app: &App, msg: &Value) -> Result<Value> {
    let name = sanitize(msg["name"].as_str().unwrap_or(""));
    let data = msg["data"].as_str().context("missing `data`")?;
    // Refuse before decoding: the decoded size is known from the length.
    let approx = data.len() / 4 * 3;
    if approx > MAX_BYTES + 3 {
        return Err(over_cap(&name, approx));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .context("the file data is not valid base64")?;
    if bytes.len() > MAX_BYTES {
        return Err(over_cap(&name, bytes.len()));
    }
    let mime = mime_for(msg["mime"].as_str().unwrap_or(""), &bytes);
    let id = app.id("a");
    let dir = root().join(&id);
    fs::create_dir_all(&dir).with_context(|| format!("could not create {}", dir.display()))?;
    let path = dir.join(&name);
    fs::write(&path, &bytes).with_context(|| format!("could not write {}", path.display()))?;
    let attachment = json!({
        "id": id,
        "name": name,
        "mime": mime,
        "size": bytes.len(),
        "path": path.to_string_lossy(),
    });
    // The name cannot start with a dot, so this never collides with the file.
    fs::write(dir.join(".meta.json"), attachment.to_string()).context("could not save the attachment's details")?;
    Ok(attachment)
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn load(id: &str) -> Result<Value> {
    if !valid_id(id) {
        bail!("bad attachment id");
    }
    let dir = root().join(id);
    let text = fs::read_to_string(dir.join(".meta.json")).with_context(|| format!("no attachment {id} on this host"))?;
    let mut meta: Value = serde_json::from_str(&text).context("unreadable attachment details")?;
    // Rebuilt from our own folder, never taken from the file.
    let name = sanitize(meta["name"].as_str().unwrap_or(""));
    let path = dir.join(&name);
    if !path.is_file() {
        bail!("attachment {id} is gone from this host");
    }
    meta["id"] = json!(id);
    meta["name"] = json!(name);
    meta["path"] = json!(path.to_string_lossy());
    Ok(meta)
}

/// The `attachments` of a `session.create` or `session.send`: ids from
/// `attach.put`, turned into the records events and engines use.
pub fn resolve(list: &Value) -> Result<Vec<Value>> {
    let ids = match list {
        Value::Null => return Ok(Vec::new()),
        Value::Array(ids) => ids,
        _ => bail!("`attachments` must be a list of ids"),
    };
    if ids.len() > MAX_PER_MESSAGE {
        bail!("at most {MAX_PER_MESSAGE} attachments per message");
    }
    ids.iter()
        .map(|v| {
            // The UI sends ids; a full record is accepted for its id alone.
            let id = v.as_str().or_else(|| v["id"].as_str()).context("bad attachment id")?;
            load(id)
        })
        .collect()
}

/// The prompt text an engine sees: the user's text, then where each
/// attachment is on disk, so the agent can open or copy it.
pub fn prompt_text(text: &str, attachments: &[Value]) -> String {
    if attachments.is_empty() {
        return text.to_string();
    }
    let mut out = text.trim_end().to_string();
    if !out.is_empty() {
        out.push_str("\n\n");
    }
    out.push_str("Attached files:");
    for a in attachments {
        out.push_str(&format!(
            "\n- {} ({}, {})",
            a["path"].as_str().unwrap_or(""),
            a["mime"].as_str().unwrap_or(""),
            human_size(a["size"].as_u64().unwrap_or(0)),
        ));
    }
    out
}

/// `attach.get`: an attachment's bytes, for a thumbnail in the thread. Only
/// attachments that a prompt of this session carries can be read.
pub fn get(app: &App, sid: &str, id: &str) -> Result<Value> {
    let known = {
        let map = app.sessions.lock().unwrap();
        let s = map.get(sid).context("no such session")?;
        s.events.iter().any(|e| {
            e["type"] == "user_message"
                && e["attachments"].as_array().is_some_and(|l| l.iter().any(|a| a["id"] == id))
        })
    };
    if !known {
        bail!("this session has no attachment {id}");
    }
    let meta = load(id)?;
    let bytes = fs::read(meta["path"].as_str().unwrap_or("")).context("could not read the attachment")?;
    Ok(json!({
        "op": "attach.data",
        "sessionId": sid,
        "id": id,
        "mime": meta["mime"],
        "data": base64::engine::general_purpose::STANDARD.encode(bytes),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_one_safe_path_component() {
        assert_eq!(sanitize("../../etc/passwd"), "passwd");
        assert_eq!(sanitize("..\\..\\boot.ini"), "boot.ini");
        assert_eq!(sanitize(".."), "file");
        assert_eq!(sanitize("../"), "file");
        assert_eq!(sanitize(".bashrc"), "bashrc");
        assert_eq!(sanitize("--rf.txt"), "rf.txt");
        assert_eq!(sanitize(""), "file");
        assert_eq!(sanitize("a\nb\u{0}.png"), "ab.png");
        assert_eq!(sanitize("screen shot.png"), "screen shot.png");
        let long = format!("{}.png", "x".repeat(300));
        let cut = sanitize(&long);
        assert!(cut.ends_with(".png") && cut.chars().count() <= 120, "{cut}");
    }

    #[test]
    fn inline_image_types_must_match_the_bytes() {
        assert_eq!(mime_for("image/png", b"\x89PNG\r\n\x1a\n...."), "image/png");
        assert_eq!(mime_for("application/octet-stream", b"\x89PNG\r\n\x1a\n"), "image/png");
        assert_eq!(mime_for("image/png", b"not a png"), "application/octet-stream");
        assert_eq!(mime_for("text/plain", b"hello"), "text/plain");
        assert_eq!(mime_for("text/<script>", b"hello"), "application/octet-stream");
        assert_eq!(mime_for("", b"hello"), "application/octet-stream");
    }

    #[test]
    fn the_prompt_lists_attachment_paths() {
        let a = json!({ "path": "/d/attachments/a1/notes.txt", "mime": "text/plain", "size": 2048 });
        assert_eq!(prompt_text("hi", &[]), "hi");
        assert_eq!(prompt_text("hi", &[a.clone()]), "hi\n\nAttached files:\n- /d/attachments/a1/notes.txt (text/plain, 2 KB)");
        assert_eq!(prompt_text("", &[a]), "Attached files:\n- /d/attachments/a1/notes.txt (text/plain, 2 KB)");
    }
}
