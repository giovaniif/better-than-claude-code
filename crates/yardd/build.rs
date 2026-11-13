//! Stamps a build id into yardd so the desktop shell can tell whether the
//! daemon already running is the one it bundles. Keep in step with
//! app/src-tauri/build.rs, which stamps the shell the same way.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    let text = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn main() {
    println!("cargo:rerun-if-env-changed=YARD_BUILD_ID");
    // Rebuild when the checked-out commit moves.
    for path in [git(&["rev-parse", "--git-path", "HEAD"]), git(&["rev-parse", "--git-path", "packed-refs"])]
        .into_iter()
        .flatten()
    {
        println!("cargo:rerun-if-changed={path}");
    }
    if let Some(head_ref) = git(&["rev-parse", "--symbolic-full-name", "HEAD"]) {
        if let Some(path) = git(&["rev-parse", "--git-path", &head_ref]) {
            println!("cargo:rerun-if-changed={path}");
        }
    }

    let id = std::env::var("YARD_BUILD_ID")
        .ok()
        .filter(|s| !s.is_empty())
        .or_else(|| git(&["rev-parse", "--short", "HEAD"]))
        .unwrap_or_else(|| "dev".to_string());
    println!("cargo:rustc-env=YARD_BUILD_ID={id}");
}
