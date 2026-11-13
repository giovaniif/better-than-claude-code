//! Switchyard shell: a window on yardd's UI.
//!
//! The shell holds no agent state. It starts yardd if nothing is listening,
//! then loads yardd's page. yardd is not a child that dies with the window:
//! sessions keep running after the app is closed.
//!
//! Personal build: yardd, the UI and the Claude sidecar are found in the repo
//! this binary was compiled from. Nothing is bundled into the .app yet.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Keep in step with `DEFAULT_PORT` in crates/yardd/src/main.rs.
const PORT: u16 = 47717;

fn repo_root() -> PathBuf {
    // app/src-tauri -> repo root
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// True only if yardd itself answers. A bare TCP connect is not enough:
/// another program can hold the port (LocalStack did, on 4517).
fn yardd_up() -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], PORT));
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.1 200") && response.contains("yardd ")
}

/// Apps opened from Finder get a bare PATH with no `codex`, `claude` or `bun`.
/// Ask the user's login shell for theirs.
fn login_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let out = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then_some(path)
}

fn start_yardd() -> Result<(), String> {
    let root = repo_root();
    let binary = ["target/release/yardd", "target/debug/yardd"]
        .iter()
        .map(|p| root.join(p))
        .find(|p| p.exists())
        .ok_or_else(|| format!("yardd is not built. Run `cargo build -p yardd` in {}", root.display()))?;

    let home = std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?;
    let log_dir = PathBuf::from(home).join(".yard");
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("yardd.log"))
        .map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(binary);
    cmd.current_dir(&root)
        .env("YARD_ROOT", &root)
        .env("YARD_PORT", PORT.to_string())
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(log_err);
    if let Some(path) = login_path() {
        cmd.env("PATH", path);
    }
    // Do not hand a parent Claude Code session's markers down to agents.
    for (key, _) in std::env::vars() {
        if key == "CLAUDECODE" || key.starts_with("CLAUDE_CODE_") || key.starts_with("CLAUDE_AGENT_SDK") {
            cmd.env_remove(key);
        }
    }
    // Spawned and not waited on: yardd outlives this process on purpose.
    cmd.spawn().map_err(|e| format!("could not start yardd: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if yardd_up() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err("yardd did not start listening within 10 seconds. See ~/.yard/yardd.log".to_string())
}

fn main() {
    let problem = if yardd_up() { None } else { start_yardd().err() };
    if let Some(message) = &problem {
        eprintln!("switchyard: {message}");
    }

    tauri::Builder::default()
        .setup(move |app| {
            let url = format!("http://127.0.0.1:{PORT}/")
                .parse()
                .expect("static url");
            let title = match &problem {
                Some(message) => format!("Switchyard: {message}"),
                None => "Switchyard".to_string(),
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title(title)
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Switchyard");
}
