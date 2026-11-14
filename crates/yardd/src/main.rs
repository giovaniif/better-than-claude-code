//! yardd: owns agent processes, the per-session event log and host stats.
//! Serves the UI and a WebSocket on 127.0.0.1 by default.

mod claude;
mod codex;
mod git;
mod handoff;
mod guard;
mod hosts;
mod pr;
mod pty;
mod remote;
mod sessions;
mod state;
mod store;
mod ws;

use std::{path::PathBuf, sync::Arc, time::Duration};

use anyhow::Context;
use axum::{routing::get, Router};
use tower_http::services::ServeDir;

use state::App;

/// Keep in step with `PORT` in app/src-tauri/src/main.rs.
/// Not in 4510-4559: LocalStack publishes that whole range on 0.0.0.0, and a
/// loopback bind next to it succeeds silently.
const DEFAULT_PORT: u16 = 47717;

/// Lets the shell tell yardd apart from anything else on the port, and an
/// older yardd from the one it bundles: `yardd <version> <build id>`.
async fn health() -> &'static str {
    concat!("yardd ", env!("CARGO_PKG_VERSION"), " ", env!("YARD_BUILD_ID"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port: u16 = std::env::var("YARD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    // Loopback by default: the desktop app and SSH hosts reach it locally or
    // through an SSH forward. Only the container image sets YARD_BIND=0.0.0.0,
    // so its published port or reverse proxy can reach it.
    let bind: std::net::IpAddr = match std::env::var("YARD_BIND") {
        Ok(b) if !b.trim().is_empty() => b.trim().parse().with_context(|| format!("YARD_BIND `{b}` is not an IP address"))?,
        _ => std::net::Ipv4Addr::LOCALHOST.into(),
    };
    let root: PathBuf = match std::env::var("YARD_ROOT") {
        Ok(p) => PathBuf::from(p),
        Err(_) => std::env::current_dir()?,
    };

    let (store, loaded) = store::open(&store::data_dir())?;
    let app = Arc::new(App::new(root.clone(), port, store));
    app.restore(loaded);
    remote::start(&app);

    // On a normal stop, let the writer finish what is queued before exiting.
    let stopping = app.clone();
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};
        let Ok(mut term) = signal(SignalKind::terminate()) else { return };
        tokio::select! {
            _ = term.recv() => {}
            _ = tokio::signal::ctrl_c() => {}
        }
        stopping.remotes.shutdown();
        stopping.store.flush(Duration::from_secs(2));
        std::process::exit(0);
    });

    tokio::spawn(hosts::run(app.clone()));

    // Start Codex in the background so the model list is ready early.
    let boot = app.clone();
    tokio::spawn(async move {
        if let Err(e) = codex::load_models(&boot).await {
            eprintln!("yardd: codex unavailable: {e:#}");
        }
    });

    let router = Router::new()
        .route("/ws", get(ws::handler))
        .route("/health", get(health))
        .fallback_service(ServeDir::new(root.join("ui/dist")))
        .with_state(app);

    if !bind.is_loopback() && ws::allowed_origins().is_empty() {
        eprintln!(
            "yardd: WARNING: listening on {bind} with no YARD_ALLOW_ORIGIN. Browsers on any address other than \
             http://127.0.0.1:{port} will be refused. Set YARD_ALLOW_ORIGIN to the URL you open, such as https://yard.example.com"
        );
    }
    let listener = tokio::net::TcpListener::bind((bind, port)).await?;
    eprintln!("yardd: http://{}", std::net::SocketAddr::new(bind, port));
    axum::serve(listener, router).await?;
    Ok(())
}
