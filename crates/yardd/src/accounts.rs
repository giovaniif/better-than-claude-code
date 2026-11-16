//! Accounts: more than one login per engine on this host. Each engine has a
//! Default account (the login the CLI already has, run with the environment
//! yardd was started in) plus added ones, each with its own config folder
//! under `<data dir>/accounts/<id>`: `CLAUDE_CONFIG_DIR` for Claude Code,
//! `CODEX_HOME` for Codex, `XDG_DATA_HOME` for OpenCode (its logins and
//! sessions live in `opencode/` there; its config stays the user's). yardd never reads what is in those folders; the
//! CLIs keep their own login files there. Saved in `accounts.json`.

use std::{
    path::PathBuf,
    sync::Mutex,
};

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The account id of an engine's own, unchanged login.
pub const DEFAULT: &str = "default";

#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub engine: String,
    pub name: String,
}

pub struct Accounts {
    dir: PathBuf,
    file: PathBuf,
    list: Mutex<Vec<Account>>,
}

/// The variable that points an engine's CLI at an account's folder.
pub fn env_var(engine: &str) -> &'static str {
    match engine {
        "codex" => "CODEX_HOME",
        // OpenCode has no variable of its own for this. Commands its agent
        // runs see the moved data folder too.
        "opencode" => "XDG_DATA_HOME",
        _ => "CLAUDE_CONFIG_DIR",
    }
}

impl Accounts {
    pub fn load(data: PathBuf) -> Self {
        let file = data.join("accounts.json");
        let list = match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                eprintln!("yardd: ignoring unreadable {}: {e}", file.display());
                Vec::new()
            }),
            Err(_) => Vec::new(),
        };
        Accounts { dir: data.join("accounts"), file, list: Mutex::new(list) }
    }

    /// The added accounts, for the UI. Default is implicit.
    pub fn list(&self) -> Value {
        json!(*self.list.lock().unwrap())
    }

    pub fn all(&self) -> Vec<Account> {
        self.list.lock().unwrap().clone()
    }

    /// Whether `account` is a real choice for `engine`: Default always is.
    pub fn check(&self, engine: &str, account: &str) -> Result<()> {
        if account == DEFAULT || self.list.lock().unwrap().iter().any(|a| a.id == account && a.engine == engine) {
            return Ok(());
        }
        bail!("no such {engine} account `{account}` on this host")
    }

    /// The folder to run an engine's CLI in for `account`, or `None` for
    /// Default, which runs with yardd's own environment.
    pub fn config_dir(&self, engine: &str, account: &str) -> Result<Option<PathBuf>> {
        if account == DEFAULT {
            return Ok(None);
        }
        self.check(engine, account)?;
        Ok(Some(self.dir.join(account)))
    }

    pub fn add(&self, id: String, engine: &str, name: &str) -> Result<Account> {
        let name = name.trim();
        if !crate::engines::is_engine(engine) {
            bail!("unknown engine {engine}");
        }
        if name.is_empty() {
            bail!("the account needs a name");
        }
        if name.chars().count() > 40 || name.chars().any(char::is_control) {
            bail!("the account name must be at most 40 plain characters");
        }
        let mut list = self.list.lock().unwrap();
        if name.eq_ignore_ascii_case("default") || list.iter().any(|a| a.engine == engine && a.name.eq_ignore_ascii_case(name)) {
            bail!("a {engine} account named {name} already exists");
        }
        let account = Account { id, engine: engine.to_string(), name: name.to_string() };
        let folder = self.dir.join(&account.id);
        std::fs::create_dir_all(&folder).with_context(|| format!("could not create {}", folder.display()))?;
        list.push(account.clone());
        self.save(&list)?;
        Ok(account)
    }

    /// Forget the account and delete its folder, and with it its login.
    pub fn remove(&self, id: &str) -> Result<Account> {
        let mut list = self.list.lock().unwrap();
        let i = list.iter().position(|a| a.id == id).context("no such account")?;
        let account = list.remove(i);
        self.save(&list)?;
        // Ids are `a<hex>`, so this can only be a folder yardd made.
        let _ = std::fs::remove_dir_all(self.dir.join(&account.id));
        Ok(account)
    }

    fn save(&self, list: &[Account]) -> Result<()> {
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_string_pretty(list)?).with_context(|| format!("could not write {}", tmp.display()))?;
        std::fs::rename(&tmp, &self.file).with_context(|| format!("could not write {}", self.file.display()))?;
        Ok(())
    }
}
