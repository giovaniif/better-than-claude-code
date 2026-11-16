//! Automations: prompts that start a session on a schedule.
//!
//! An automation is saved in `automations.json` in the data dir (like
//! `hosts.json`). A scheduler task fires the due ones; a run is an ordinary
//! `session.create` in a fresh worktree whose metadata carries the
//! automation's id. Each host runs its own automations; the hub only routes
//! the ops (see `remote::route`).

use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{bail, Context, Result};
use chrono::{Datelike, Local, NaiveTime, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::state::{now_ms, App, PERMISSIONS};

const DEFAULT_TICK_MS: u64 = 15_000;

/// When an automation runs, in the host's local time zone.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Schedule {
    /// Every `every` minutes or hours (`unit`), counted from the last slot.
    Interval { every: u32, unit: String },
    /// Every day at `time` (`HH:MM`).
    Daily { time: String },
    /// Every week on `day` (0 = Sunday) at `time`.
    Weekly { day: u8, time: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LastRun {
    pub at: u64,
    /// `started`, `skipped` or `failed`.
    pub outcome: String,
    pub session_id: Option<String>,
    /// Why it was skipped or failed.
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub cwd: String,
    pub engine: String,
    pub model: String,
    pub effort: String,
    #[serde(default = "default_permission")]
    pub permission: String,
    /// The branch runs are cut from; empty is the repository's default branch.
    #[serde(default)]
    pub base: String,
    pub schedule: Schedule,
    #[serde(default = "yes")]
    pub skip_while_running: bool,
    /// Skip a scheduled run while the engine's 5-hour usage is above this percentage.
    #[serde(default)]
    pub max_five_hour: Option<f64>,
    /// The same for the weekly window.
    #[serde(default)]
    pub max_week: Option<f64>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub created_at: u64,
    /// When the next run is due; `None` while disabled. A run missed while
    /// yardd was down is due immediately and fires once.
    #[serde(default)]
    pub next_run: Option<u64>,
    #[serde(default)]
    pub last_run: Option<LastRun>,
}

fn yes() -> bool {
    true
}

fn default_permission() -> String {
    "ask".to_string()
}

fn parse_time(time: &str) -> Result<NaiveTime> {
    let bad = || anyhow::anyhow!("`{time}` is not a valid time (HH:MM)");
    let (h, m) = time.split_once(':').ok_or_else(bad)?;
    if h.len() != 2 || m.len() != 2 {
        return Err(bad());
    }
    NaiveTime::from_hms_opt(h.parse().map_err(|_| bad())?, m.parse().map_err(|_| bad())?, 0).ok_or_else(bad)
}

impl Schedule {
    pub fn validate(&self) -> Result<()> {
        match self {
            Schedule::Interval { every, unit } => {
                if *every < 1 {
                    bail!("the interval must be at least 1");
                }
                if unit != "minutes" && unit != "hours" {
                    bail!("the interval unit must be minutes or hours");
                }
            }
            Schedule::Daily { time } => {
                parse_time(time)?;
            }
            Schedule::Weekly { day, time } => {
                if *day > 6 {
                    bail!("the day must be 0 (Sunday) to 6 (Saturday)");
                }
                parse_time(time)?;
            }
        }
        Ok(())
    }
}

/// The first run strictly after `from` (epoch ms), in `tz`. A daily or weekly
/// time that does not exist that day (a daylight saving gap) runs an hour
/// later; one that happens twice runs the first time.
pub fn next_after<Tz: TimeZone>(schedule: &Schedule, from: u64, tz: &Tz) -> Option<u64> {
    match schedule {
        Schedule::Interval { every, unit } => {
            let step = if unit == "hours" { 3_600_000 } else { 60_000 };
            Some(from + u64::from(*every) * step)
        }
        Schedule::Daily { time } => next_at(from, tz, parse_time(time).ok()?, None),
        Schedule::Weekly { day, time } => next_at(from, tz, parse_time(time).ok()?, Some(*day)),
    }
}

fn next_at<Tz: TimeZone>(from: u64, tz: &Tz, time: NaiveTime, day: Option<u8>) -> Option<u64> {
    let today = tz.timestamp_millis_opt(i64::try_from(from).ok()?).single()?.date_naive();
    // Eight days cover a weekly slot plus a gap day.
    for offset in 0..=8 {
        let date = today + chrono::Days::new(offset);
        if day.is_some_and(|d| date.weekday().num_days_from_sunday() != u32::from(d)) {
            continue;
        }
        let naive = date.and_time(time);
        let local = tz
            .from_local_datetime(&naive)
            .earliest()
            .or_else(|| tz.from_local_datetime(&(naive + chrono::Duration::hours(1))).earliest());
        if let Some(l) = local {
            let ms = l.timestamp_millis();
            if ms > from as i64 {
                return u64::try_from(ms).ok();
            }
        }
    }
    None
}

/// Why a run should not start on usage grounds, from yardd's usage figures.
/// Claude reports fractions, Codex percentages. A window that has already
/// reset is stale (yardd refreshes usage only during turns), not a reason.
pub fn usage_reason(usage: &Value, engine: &str, five: Option<f64>, week: Option<f64>, now_secs: u64) -> Option<String> {
    let live = |reset: &Value| reset.as_u64().map_or(true, |r| now_secs <= r);
    let (name, five_used, week_used) = match engine {
        "codex" => {
            let u = &usage["codex"];
            (
                "Codex",
                u["primary"]["usedPercent"].as_f64().filter(|_| live(&u["primary"]["resetsAt"])),
                u["secondary"]["usedPercent"].as_f64().filter(|_| live(&u["secondary"]["resetsAt"])),
            )
        }
        _ => {
            let u = &usage["claude"];
            (
                "Claude",
                u["fiveHour"].as_f64().map(|f| f * 100.0).filter(|_| live(&u["resetsAt"])),
                u["sevenDay"].as_f64().map(|f| f * 100.0),
            )
        }
    };
    if let (Some(used), Some(max)) = (five_used, five) {
        if used > max {
            return Some(format!("{name} 5-hour usage {used:.0}% is above {max:.0}%"));
        }
    }
    if let (Some(used), Some(max)) = (week_used, week) {
        if used > max {
            return Some(format!("{name} weekly usage {used:.0}% is above {max:.0}%"));
        }
    }
    None
}

pub struct Automations {
    file: PathBuf,
    list: Mutex<Vec<Automation>>,
}

impl Automations {
    pub fn load(dir: PathBuf) -> Self {
        let file = dir.join("automations.json");
        let list = match std::fs::read_to_string(&file) {
            Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
                // Keep the unreadable file for the user instead of overwriting it.
                eprintln!("yardd: {} is unreadable ({e}); starting with no automations", file.display());
                let _ = std::fs::rename(&file, file.with_extension("json.bad"));
                Vec::new()
            }),
            Err(_) => Vec::new(),
        };
        Automations { file, list: Mutex::new(list) }
    }

    pub fn list(&self) -> Value {
        json!(*self.list.lock().unwrap())
    }

    pub fn get(&self, id: &str) -> Option<Automation> {
        self.list.lock().unwrap().iter().find(|a| a.id == id).cloned()
    }

    fn persist(&self, list: &[Automation]) {
        let tmp = self.file.with_extension("json.tmp");
        let write = || -> std::io::Result<()> {
            if let Some(dir) = self.file.parent() {
                std::fs::create_dir_all(dir)?;
            }
            std::fs::write(&tmp, serde_json::to_vec_pretty(list)?)?;
            std::fs::rename(&tmp, &self.file)
        };
        if let Err(e) = write() {
            eprintln!("yardd: cannot save {}: {e}", self.file.display());
        }
    }

    /// Change one automation and save. `None` when it does not exist.
    fn update<R>(&self, id: &str, f: impl FnOnce(&mut Automation) -> R) -> Option<R> {
        let mut list = self.list.lock().unwrap();
        let out = f(list.iter_mut().find(|a| a.id == id)?);
        self.persist(&list);
        Some(out)
    }

    /// Enabled automations that are due: each is moved to its next slot after
    /// `now` before it is returned, so a backlog fires once and a slow run
    /// does not fire again on the next tick.
    fn take_due(&self, now: u64) -> Vec<String> {
        let mut list = self.list.lock().unwrap();
        let mut due = Vec::new();
        for a in list.iter_mut() {
            if a.enabled && a.next_run.is_some_and(|n| n <= now) {
                a.next_run = next_after(&a.schedule, now, &Local);
                due.push(a.id.clone());
            }
        }
        if !due.is_empty() {
            self.persist(&list);
        }
        due
    }
}

fn broadcast(app: &App) {
    app.broadcast(json!({ "op": "automations", "automations": app.automations.list() }));
}

/// Create or change an automation from the UI's fields. An id means a change:
/// fields not sent keep their value, so a switch can send `{ id, enabled }`.
fn save(app: &App, input: &Value) -> Result<Automation> {
    let obj = input.as_object().context("missing `automation`")?;
    let existing = match input["id"].as_str() {
        Some(id) => Some(app.automations.get(id).context("no such automation")?),
        None => None,
    };
    let mut merged = match &existing {
        Some(a) => json!(a),
        None => {
            for key in ["name", "prompt", "cwd", "engine", "model", "effort", "schedule"] {
                if obj.get(key).map_or(true, Value::is_null) {
                    bail!("missing `{key}`");
                }
            }
            json!({ "id": app.id("a"), "createdAt": now_ms() })
        }
    };
    for (k, v) in obj {
        // yardd owns these.
        if !["id", "createdAt", "nextRun", "lastRun"].contains(&k.as_str()) {
            merged[k] = v.clone();
        }
    }
    let mut a: Automation = serde_json::from_value(merged).map_err(|e| anyhow::anyhow!("invalid automation: {e}"))?;
    a.name = a.name.trim().to_string();
    a.prompt = a.prompt.trim().to_string();
    if a.name.is_empty() {
        bail!("the name is empty");
    }
    if a.prompt.is_empty() {
        bail!("the prompt is empty");
    }
    if !std::path::Path::new(&a.cwd).is_dir() {
        bail!("{} is not a folder", a.cwd);
    }
    if a.engine != "claude" && a.engine != "codex" {
        bail!("unknown engine {}", a.engine);
    }
    if !PERMISSIONS.contains(&a.permission.as_str()) {
        bail!("unknown permission mode {}", a.permission);
    }
    for limit in [a.max_five_hour, a.max_week].into_iter().flatten() {
        if !(0.0..=100.0).contains(&limit) {
            bail!("a usage limit is a percentage from 0 to 100");
        }
    }
    a.schedule.validate()?;
    a.next_run = match (&existing, a.enabled) {
        (_, false) => None,
        (Some(old), true) if old.enabled && old.schedule == a.schedule && old.next_run.is_some() => old.next_run,
        _ => next_after(&a.schedule, now_ms(), &Local),
    };
    a.last_run = existing.and_then(|e| e.last_run);

    let mut list = app.automations.list.lock().unwrap();
    match list.iter_mut().find(|x| x.id == a.id) {
        Some(slot) => *slot = a.clone(),
        None => list.push(a.clone()),
    }
    app.automations.persist(&list);
    Ok(a)
}

pub async fn handle(app: &Arc<App>, direct: &mpsc::UnboundedSender<String>, msg: &Value) -> Result<()> {
    let reply = |mut v: Value| {
        if !msg["ref"].is_null() {
            v["ref"] = msg["ref"].clone();
        }
        let _ = direct.send(v.to_string());
    };
    match msg["op"].as_str().unwrap_or("") {
        "automation.list" => reply(json!({ "op": "automations", "automations": app.automations.list() })),
        "automation.save" => {
            let a = save(app, &msg["automation"])?;
            broadcast(app);
            reply(json!({ "op": "automation.saved", "automation": a }));
        }
        "automation.delete" => {
            let id = msg["id"].as_str().context("missing `id`")?;
            let removed = {
                let mut list = app.automations.list.lock().unwrap();
                let before = list.len();
                list.retain(|a| a.id != id);
                app.automations.persist(&list);
                list.len() != before
            };
            if !removed {
                bail!("no such automation");
            }
            // Its runs stay, as ordinary sessions (archived ones in Archived).
            let runs: Vec<String> = app
                .sessions
                .lock()
                .unwrap()
                .values()
                .filter(|s| s.meta.automation.as_deref() == Some(id))
                .map(|s| s.meta.id.clone())
                .collect();
            for sid in runs {
                app.update_meta(&sid, |m| m.automation = None);
            }
            broadcast(app);
        }
        "automation.run" => {
            let id = msg["id"].as_str().context("missing `id`")?;
            // Run now ignores the skip rules; a scheduled-style run keeps them.
            let force = msg["force"].as_bool().unwrap_or(false);
            let last = fire(app, id, force).await?;
            reply(json!({
                "op": "automation.ran",
                "id": id,
                "outcome": last.outcome,
                "sessionId": last.session_id,
                "reason": last.reason,
            }));
        }
        other => bail!("unknown op `{other}`"),
    }
    Ok(())
}

/// Start one run, or record why not. The result is also saved as the
/// automation's last run.
async fn fire(app: &Arc<App>, id: &str, force: bool) -> Result<LastRun> {
    let a = app.automations.get(id).context("no such automation")?;
    let last = match run(app, &a, force).await {
        Ok(Err(reason)) => LastRun { at: now_ms(), outcome: "skipped".into(), session_id: None, reason: Some(reason) },
        Ok(Ok(sid)) => LastRun { at: now_ms(), outcome: "started".into(), session_id: Some(sid), reason: None },
        Err(e) => LastRun { at: now_ms(), outcome: "failed".into(), session_id: None, reason: Some(format!("{e:#}")) },
    };
    app.automations.update(id, |a| a.last_run = Some(last.clone()));
    broadcast(app);
    Ok(last)
}

/// `Ok(Err(reason))` is a skip; `Err` is a run that could not start.
async fn run(app: &Arc<App>, a: &Automation, force: bool) -> Result<std::result::Result<String, String>> {
    if !force {
        if a.skip_while_running {
            let going = app.sessions.lock().unwrap().values().find_map(|s| {
                let m = &s.meta;
                (m.automation.as_deref() == Some(&a.id) && matches!(m.status.as_str(), "running" | "needs_approval" | "queued"))
                    .then(|| m.title.clone())
            });
            if let Some(title) = going {
                return Ok(Err(format!("the previous run is still going: {title}")));
            }
        }
        let usage = app.usage.lock().unwrap().clone();
        let now_secs = now_ms() / 1000;
        if let Some(why) = usage_reason(&usage, &a.engine, a.max_five_hour, a.max_week, now_secs) {
            return Ok(Err(why));
        }
    }
    let base = crate::git::fresh_base(&a.cwd, &a.base).await?;
    let title = format!("{} · {}", a.name, Local::now().format("%Y-%m-%d %H:%M"));
    let mut create = json!({
        "engine": a.engine,
        "model": a.model,
        "effort": a.effort,
        "cwd": a.cwd,
        "text": a.prompt,
        "permission": a.permission,
        "worktree": true,
    });
    if let Some(base) = base {
        create["base"] = json!(base);
    }
    let sid = crate::ws::create_session(app, None, &create, Some(&title), Some(&a.id)).await?;
    Ok(Ok(sid))
}

/// The scheduler: fires due automations, each in its own task.
pub async fn run_scheduler(app: Arc<App>) {
    let tick = std::env::var("YARD_AUTOMATION_TICK_MS")
        .ok()
        .and_then(|t| t.parse().ok())
        .unwrap_or(DEFAULT_TICK_MS);
    loop {
        tokio::time::sleep(Duration::from_millis(tick)).await;
        for id in app.automations.take_due(now_ms()) {
            let app = app.clone();
            tokio::spawn(async move {
                if let Err(e) = fire(&app, &id, false).await {
                    eprintln!("yardd: automation {id}: {e:#}");
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, Utc};

    fn at(tz: &impl TimeZone, y: i32, mo: u32, d: u32, h: u32, mi: u32) -> u64 {
        tz.with_ymd_and_hms(y, mo, d, h, mi, 0).unwrap().timestamp_millis() as u64
    }

    fn daily(t: &str) -> Schedule {
        Schedule::Daily { time: t.into() }
    }

    #[test]
    fn intervals_count_from_the_given_moment() {
        let s = Schedule::Interval { every: 90, unit: "minutes".into() };
        assert_eq!(next_after(&s, 1_000, &Utc), Some(1_000 + 90 * 60_000));
        let s = Schedule::Interval { every: 2, unit: "hours".into() };
        assert_eq!(next_after(&s, 0, &Utc), Some(2 * 3_600_000));
    }

    #[test]
    fn daily_is_the_next_time_strictly_after_now() {
        let utc = Utc;
        // 2026-11-16 is a Monday.
        assert_eq!(next_after(&daily("09:30"), at(&utc, 2026, 11, 16, 8, 0), &utc), Some(at(&utc, 2026, 11, 16, 9, 30)));
        assert_eq!(next_after(&daily("09:30"), at(&utc, 2026, 11, 16, 9, 30), &utc), Some(at(&utc, 2026, 11, 17, 9, 30)));
        assert_eq!(next_after(&daily("09:30"), at(&utc, 2026, 11, 16, 23, 59), &utc), Some(at(&utc, 2026, 11, 17, 9, 30)));
        assert_eq!(next_after(&daily("00:00"), at(&utc, 2026, 12, 31, 12, 0), &utc), Some(at(&utc, 2027, 1, 1, 0, 0)));
    }

    #[test]
    fn the_time_zone_decides_what_9_30_means() {
        let tz = FixedOffset::west_opt(3 * 3600).unwrap(); // UTC-3
        let from = at(&Utc, 2026, 11, 16, 11, 0); // 08:00 local
        assert_eq!(next_after(&daily("09:30"), from, &tz), Some(at(&Utc, 2026, 11, 16, 12, 30)));
        let after = at(&Utc, 2026, 11, 16, 13, 0); // 10:00 local: tomorrow
        assert_eq!(next_after(&daily("09:30"), after, &tz), Some(at(&Utc, 2026, 11, 17, 12, 30)));
        // Late evening UTC is already the next day in UTC+9.
        let east = FixedOffset::east_opt(9 * 3600).unwrap();
        let from = at(&Utc, 2026, 11, 16, 20, 0); // 05:00 on the 17th local
        assert_eq!(next_after(&daily("09:30"), from, &east), Some(at(&east, 2026, 11, 17, 9, 30)));
    }

    #[test]
    fn weekly_waits_for_its_day() {
        let utc = Utc;
        let monday = |d| Schedule::Weekly { day: d, time: "08:00".into() };
        let from = at(&utc, 2026, 11, 16, 9, 0); // Monday 09:00
        assert_eq!(next_after(&monday(1), from, &utc), Some(at(&utc, 2026, 11, 23, 8, 0)), "this Monday's slot is past");
        assert_eq!(next_after(&monday(1), at(&utc, 2026, 11, 16, 7, 0), &utc), Some(at(&utc, 2026, 11, 16, 8, 0)));
        assert_eq!(next_after(&monday(0), from, &utc), Some(at(&utc, 2026, 11, 22, 8, 0)), "Sunday");
        assert_eq!(next_after(&monday(6), from, &utc), Some(at(&utc, 2026, 11, 21, 8, 0)), "Saturday");
    }

    #[test]
    fn schedules_are_validated() {
        assert!(Schedule::Interval { every: 0, unit: "minutes".into() }.validate().is_err());
        assert!(Schedule::Interval { every: 5, unit: "days".into() }.validate().is_err());
        assert!(daily("25:00").validate().is_err());
        assert!(daily("9:30").validate().is_err());
        assert!(daily("09:60").validate().is_err());
        assert!(Schedule::Weekly { day: 7, time: "09:00".into() }.validate().is_err());
        assert!(daily("23:59").validate().is_ok());
    }

    fn sample(next_run: Option<u64>, every: u32) -> Automation {
        Automation {
            id: "a1".into(),
            name: "n".into(),
            prompt: "p".into(),
            cwd: "/".into(),
            engine: "codex".into(),
            model: "m".into(),
            effort: "low".into(),
            permission: "ask".into(),
            base: String::new(),
            schedule: Schedule::Interval { every, unit: "minutes".into() },
            skip_while_running: true,
            max_five_hour: None,
            max_week: None,
            enabled: true,
            created_at: 0,
            next_run,
            last_run: None,
        }
    }

    #[test]
    fn a_backlog_fires_once_and_moves_past_now() {
        let dir = std::env::temp_dir().join(format!("yardd-auto-unit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let store = Automations::load(dir.clone());
        let now = now_ms();
        // Ten slots overdue.
        *store.list.lock().unwrap() = vec![sample(Some(now - 10 * 60 * 60_000), 60), {
            let mut off = sample(Some(now - 1000), 1);
            off.id = "off".into();
            off.enabled = false;
            off
        }];
        assert_eq!(store.take_due(now), ["a1"], "once, and not the disabled one");
        let next = store.get("a1").unwrap().next_run.unwrap();
        assert!(next > now && next <= now + 60 * 60_000 + 1000, "{next}");
        assert!(store.take_due(now + 1000).is_empty(), "not again on the next tick");
        // It was saved: a new load sees the moved slot.
        assert_eq!(Automations::load(dir.clone()).get("a1").unwrap().next_run, Some(next));
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn usage_limits_read_each_engines_figures() {
        let usage = json!({
            "codex": { "primary": { "usedPercent": 62, "resetsAt": 2000 }, "secondary": { "usedPercent": 40, "resetsAt": 9000 } },
            "claude": { "fiveHour": 0.71, "sevenDay": 0.2, "resetsAt": 2000 },
        });
        assert!(usage_reason(&usage, "codex", Some(60.0), None, 1000).unwrap().contains("5-hour usage 62%"));
        assert!(usage_reason(&usage, "codex", Some(70.0), Some(30.0), 1000).unwrap().contains("weekly usage 40%"));
        assert_eq!(usage_reason(&usage, "codex", Some(70.0), Some(50.0), 1000), None);
        assert_eq!(usage_reason(&usage, "codex", None, None, 1000), None, "no limit, no skip");
        assert!(usage_reason(&usage, "claude", Some(70.0), None, 1000).unwrap().contains("Claude 5-hour usage 71%"));
        // The 5-hour window has reset since the figure was taken: stale, not a reason.
        assert_eq!(usage_reason(&usage, "claude", Some(70.0), None, 3000), None);
        assert_eq!(usage_reason(&usage, "codex", Some(60.0), None, 3000), None);
        assert_eq!(usage_reason(&json!({}), "codex", Some(1.0), Some(1.0), 1000), None, "unknown usage does not skip");
    }

    #[test]
    fn claude_limits_read_the_sidecars_windows() {
        // The shape the sidecar reports (src/usage.ts, mergeUsage): one entry per window.
        let usage = json!({
            "claude": { "status": "allowed", "windows": {
                "five_hour": { "utilization": 0.47, "resetsAt": 2000 },
                "seven_day": { "utilization": 0.81, "resetsAt": 9000 },
            } },
        });
        assert!(usage_reason(&usage, "claude", Some(10.0), None, 1000).unwrap().contains("Claude 5-hour usage 47%"));
        assert!(usage_reason(&usage, "claude", Some(50.0), Some(80.0), 1000).unwrap().contains("Claude weekly usage 81%"));
        assert_eq!(usage_reason(&usage, "claude", Some(50.0), Some(90.0), 1000), None);
        // Each window carries its own reset: past it, that figure is stale.
        assert_eq!(usage_reason(&usage, "claude", Some(10.0), None, 3000), None);
        assert_eq!(usage_reason(&usage, "claude", None, Some(80.0), 9500), None);
        assert!(usage_reason(&usage, "claude", None, Some(80.0), 3000).is_some(), "the week has not reset yet");
    }
}
