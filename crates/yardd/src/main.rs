//! yardd: owns agent processes, the per-session event log and host stats.
//! Serves the UI and a WebSocket on 127.0.0.1.

mod claude;
mod codex;
mod git;
mod hosts;
mod pr;
mod pty;
mod state;
mod ws;

use std::{path::PathBuf, sync::Arc};

use axum::{routing::get, Router};
use tower_http::services::ServeDir;

use state::App;

/// Keep in step with `PORT` in app/src-tauri/src/main.rs.
/// Not in 4510-4559: LocalStack publishes that whole range on 0.0.0.0, and a
/// loopback bind next to it succeeds silently.
const DEFAULT_PORT: u16 = 47717;

/// Lets the shell tell yardd apart from anything else on the port.
async fn health() -> &'static str {
    concat!("yardd ", env!("CARGO_PKG_VERSION"))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let port: u16 = std::env::var("YARD_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(DEFAULT_PORT);
    let root: PathBuf = match std::env::var("YARD_ROOT") {
        Ok(p) => PathBuf::from(p),
        Err(_) => std::env::current_dir()?,
    };

    let app = Arc::new(App::new(root.clone(), port));

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

    // Loopback only. Remote access goes through an SSH forward.
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port)).await?;
    eprintln!("yardd: http://127.0.0.1:{port}");
    axum::serve(listener, router).await?;
    Ok(())
}
