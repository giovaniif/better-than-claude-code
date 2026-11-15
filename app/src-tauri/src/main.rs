//! Switchyard shell: a window on yardd's UI.
//!
//! The shell holds no agent state. It starts yardd if nothing is listening,
//! then loads yardd's page. yardd is not a child that dies with the window:
//! sessions keep running after the app is closed.
//!
//! The .app carries a release yardd, the compiled Claude sidecar and the UI
//! under `Contents/Resources/yard` (see app/build.sh). Run from the repo with
//! `cargo run` and those are absent, so it falls back to the repo's builds.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_updater::UpdaterExt;

/// Keep in step with `DEFAULT_PORT` in crates/yardd/src/main.rs.
const DEFAULT_PORT: u16 = 47717;

/// The build id of the yardd bundled with this shell; app/build.sh stamps
/// both with the same one.
const BUILD_ID: &str = env!("YARD_BUILD_ID");

const OLDER_DAEMON: &str = "an older daemon is running, quit it to update";

/// How often a running app looks for a new release, after the check at launch.
const UPDATE_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// `SWITCHYARD_PORT` lets a second copy run next to the real one.
fn port() -> u16 {
    std::env::var("SWITCHYARD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT)
}

/// What to start: the yardd binary, the folder it serves `ui/dist` from, and
/// the compiled sidecar (None: yardd runs the TypeScript one with Bun).
struct Daemon {
    binary: PathBuf,
    root: PathBuf,
    sidecar: Option<PathBuf>,
}

fn bundled(resources: &Path) -> Option<Daemon> {
    let root = resources.join("yard");
    let binary = root.join("bin/yardd");
    let sidecar = root.join("bin/yard-claude");
    let complete = binary.is_file() && sidecar.is_file() && root.join("ui/dist/index.html").is_file();
    complete.then_some(Daemon { binary, root, sidecar: Some(sidecar) })
}

fn from_repo() -> Result<Daemon, String> {
    // app/src-tauri -> repo root
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let binary = ["target/release/yardd", "target/debug/yardd"]
        .iter()
        .map(|p| root.join(p))
        .find(|p| p.exists())
        .ok_or_else(|| format!("yardd is not built. Run `cargo build -p yardd` in {}", root.display()))?;
    Ok(Daemon { binary, root, sidecar: None })
}

/// yardd's `/health` body, or None if nothing or something else answers.
/// A bare TCP connect is not enough: another program can hold the port
/// (LocalStack did, on 4517).
fn health(port: u16) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(300)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    let request = format!("GET /health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    if !response.starts_with("HTTP/1.1 200") {
        return None;
    }
    let body = response.split_once("\r\n\r\n")?.1.trim();
    body.starts_with("yardd ").then(|| body.to_string())
}

/// `yardd <version> <build id>`. A yardd from before build ids has none.
fn build_of(health: &str) -> Option<&str> {
    health.split_whitespace().nth(2)
}

/// Apps opened from Finder get a bare PATH with no `codex` or `claude`.
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

fn start_yardd(daemon: &Daemon, port: u16) -> Result<(), String> {
    // A test copy with its own data folder logs there, not in ~/.yard.
    let data_dir = std::env::var("YARD_DATA_DIR").ok().filter(|d| !d.is_empty());
    let log_dir = match &data_dir {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var("HOME").map_err(|_| "HOME is not set".to_string())?).join(".yard"),
    };
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("yardd.log"))
        .map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&daemon.binary);
    cmd.current_dir(&daemon.root)
        .env("YARD_ROOT", &daemon.root)
        .env("YARD_PORT", port.to_string())
        .stdin(Stdio::null())
        .stdout(log)
        .stderr(log_err);
    match &daemon.sidecar {
        Some(sidecar) => cmd.env("YARD_SIDECAR", sidecar),
        None => cmd.env_remove("YARD_SIDECAR"),
    };
    if let Some(dir) = &data_dir {
        cmd.env("YARD_DATA_DIR", dir);
    }
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
        if health(port).is_some() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(format!("yardd did not start listening within 10 seconds. See {}", log_dir.join("yardd.log").display()))
}

/// Stops the yardd listening on `port` and waits for the port to free up.
/// yardd flushes its log on SIGTERM; sessions come back when it starts again.
fn stop_yardd(port: u16) -> Result<(), String> {
    let out = Command::new("/usr/sbin/lsof")
        .args(["-nP", "-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
        .output()
        .map_err(|e| format!("lsof: {e}"))?;
    let pids: Vec<String> = String::from_utf8_lossy(&out.stdout).split_whitespace().map(str::to_string).collect();
    if pids.is_empty() {
        return Ok(());
    }
    Command::new("/bin/kill").args(&pids).status().map_err(|e| format!("kill: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if health(port).is_none() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err(format!("yardd on port {port} did not stop"))
}

/// Restarts the app, and the background yardd with it, so both run the
/// installed version. Asked first: a running turn stops.
fn ask_restart(app: &AppHandle, port: u16, message: String) {
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title("Switchyard")
        .buttons(MessageDialogButtons::OkCancelCustom("Restart now".into(), "Later".into()))
        .show(move |restart| {
            if !restart {
                return;
            }
            if let Err(e) = stop_yardd(port) {
                eprintln!("switchyard: {e}");
            }
            handle.restart();
        });
}

/// Installs a newer release in place, then offers to restart into it. Only
/// for the packaged app: a build run from the repo has nothing to replace.
async fn check_for_update(app: &AppHandle, port: u16) -> Result<(), String> {
    let Some(update) = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? else {
        return Ok(());
    };
    let version = update.version.clone();
    eprintln!("switchyard: installing {version}");
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    ask_restart(
        app,
        port,
        format!(
            "Switchyard {version} is installed. Restart to use it?\n\n\
             Sessions and their history are kept. A turn that is running now stops."
        ),
    );
    Ok(())
}

/// Make sure our yardd is serving `port`. Returns a problem for the title.
fn ensure_yardd(resources: Option<PathBuf>, port: u16) -> Option<String> {
    // SWITCHYARD_BUILD_ID stands in for the bundled id, to test a mismatch
    // without a second build.
    let expected = std::env::var("SWITCHYARD_BUILD_ID").unwrap_or_else(|_| BUILD_ID.to_string());
    match health(port) {
        Some(body) if build_of(&body) == Some(expected.as_str()) => None,
        // It may hold live sessions: never stop it, just say so.
        Some(body) => {
            eprintln!("switchyard: port {port} has `{body}`, this app bundles build {expected}");
            Some(OLDER_DAEMON.to_string())
        }
        None => {
            let daemon = match resources.as_deref().and_then(bundled) {
                Some(daemon) => Ok(daemon),
                None => from_repo(),
            };
            daemon.and_then(|d| start_yardd(&d, port)).err()
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let port = port();
            let resources = app.path().resource_dir().ok();
            let packaged = resources.as_deref().and_then(bundled).is_some();
            let problem = ensure_yardd(resources, port);
            if let Some(message) = &problem {
                eprintln!("switchyard: {message}");
            }
            let url = format!("http://127.0.0.1:{port}/").parse().expect("static url");
            let title = match &problem {
                Some(message) => format!("Switchyard: {message}"),
                None => "Switchyard".to_string(),
            };
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title(title)
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                // Tauri's own file-drop handler would swallow drops, and the
                // composer attaches files through the page's HTML5 drop events.
                .disable_drag_drop_handler()
                .build()?;

            if packaged {
                // The app was updated while an older yardd kept running (the
                // restart was put off, or this is the first update-aware build).
                if problem.as_deref() == Some(OLDER_DAEMON) {
                    ask_restart(
                        app.handle(),
                        port,
                        "Switchyard was updated, but the background service still runs the old version. \
                         Restart it now?\n\nSessions and their history are kept. A turn that is running now stops."
                            .to_string(),
                    );
                }
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    loop {
                        if let Err(e) = check_for_update(&handle, port).await {
                            eprintln!("switchyard: update check failed: {e}");
                        }
                        tokio::time::sleep(UPDATE_EVERY).await;
                    }
                });
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Switchyard");
}
