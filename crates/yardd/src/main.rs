//! yardd: owns agent processes, the per-session event log and host stats.
//! Serves the UI and a WebSocket on 127.0.0.1 by default.

mod attachments;
mod claude;
mod codex;
mod git;
mod handoff;
mod guard;
mod hosts;
mod import;
mod login;
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
    // through an SSH forward. The container image sets YARD_BIND=0.0.0.0, so
    // its published port or reverse proxy can reach it. A list lets a yardd on
    // a server keep loopback for SSH hosts and add the one address a reverse
    // proxy can reach, such as a Docker network's gateway.
    let binds = parse_binds(&std::env::var("YARD_BIND").unwrap_or_default())?;
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

    // A turn completed with messages queued behind it: start the next one.
    let mut next_turns = app.take_next_turns();
    let runner = app.clone();
    tokio::spawn(async move {
        while let Some(sid) = next_turns.recv().await {
            let app = runner.clone();
            tokio::spawn(async move { sessions::send_next(&app, &sid).await });
        }
    });

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

    if let Some(bind) = binds.iter().find(|b| !b.is_loopback()) {
        if ws::allowed_origins().is_empty() {
            eprintln!(
                "yardd: WARNING: listening on {bind} with no YARD_ALLOW_ORIGIN. Browsers on any address other than \
                 http://127.0.0.1:{port} will be refused. Set YARD_ALLOW_ORIGIN to the URL you open, such as https://yard.example.com"
            );
        }
    }
    // Bind every address before serving any, so a bad one fails the start
    // instead of leaving a yardd that answers on some addresses only.
    let mut listeners = Vec::new();
    for bind in &binds {
        let addr = std::net::SocketAddr::new(*bind, port);
        listeners.push(tokio::net::TcpListener::bind(addr).await.with_context(|| format!("cannot listen on {addr}"))?);
        eprintln!("yardd: http://{addr}");
    }
    let mut servers = tokio::task::JoinSet::new();
    for listener in listeners {
        let router = router.clone();
        servers.spawn(async move { axum::serve(listener, router).await });
    }
    // A server only returns on error; one that stops takes yardd down with it.
    if let Some(done) = servers.join_next().await {
        done??;
    }
    Ok(())
}

/// `YARD_BIND`: one IP address or a comma-separated list. Empty is loopback.
fn parse_binds(list: &str) -> anyhow::Result<Vec<std::net::IpAddr>> {
    let mut binds = Vec::new();
    for b in list.split(',').map(str::trim).filter(|b| !b.is_empty()) {
        let ip: std::net::IpAddr = b.parse().with_context(|| format!("YARD_BIND `{b}` is not an IP address"))?;
        if !binds.contains(&ip) {
            binds.push(ip);
        }
    }
    if binds.is_empty() {
        binds.push(std::net::Ipv4Addr::LOCALHOST.into());
    }
    Ok(binds)
}

#[cfg(test)]
mod tests {
    use super::parse_binds;

    #[test]
    fn bind_list() {
        assert_eq!(parse_binds("").unwrap(), vec!["127.0.0.1".parse::<std::net::IpAddr>().unwrap()]);
        assert_eq!(parse_binds(" 0.0.0.0 ").unwrap(), vec!["0.0.0.0".parse::<std::net::IpAddr>().unwrap()]);
        let two = parse_binds("127.0.0.1, 10.0.1.1,127.0.0.1").unwrap();
        assert_eq!(two, ["127.0.0.1", "10.0.1.1"].map(|a| a.parse::<std::net::IpAddr>().unwrap()));
        assert!(parse_binds("127.0.0.1,yard.example.com").is_err());
    }
}
