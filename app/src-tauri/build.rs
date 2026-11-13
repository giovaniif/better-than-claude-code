//! Stamps the build id of the yardd this shell bundles. app/build.sh sets
//! YARD_BUILD_ID for both builds; otherwise both fall back to the git short
//! hash. Keep in step with crates/yardd/build.rs.

use std::process::Command;

fn git(args: &[&str]) -> Option<String> {
    let out = Command::new("git").args(args).output().ok()?;
    let text = String::from_utf8(out.stdout).ok()?.trim().to_string();
    (out.status.success() && !text.is_empty()).then_some(text)
}

fn main() {
    println!("cargo:rerun-if-env-changed=YARD_BUILD_ID");
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

    tauri_build::build()
}
