//! The engines Switchyard drives, in one place, so the rest of yardd asks
//! "is this an engine, what is it called, what can it do" instead of
//! assuming there are two.

/// Every engine, in the order the UI lists them.
pub const ALL: [&str; 2] = ["claude", "codex"];

pub fn is_engine(engine: &str) -> bool {
    ALL.contains(&engine)
}

/// The name a person reads: "Handed off to Codex".
pub fn name(engine: &str) -> &'static str {
    match engine {
        "codex" => "Codex",
        "claude" => "Claude",
        _ => "an unknown engine",
    }
}

/// Whether a message sent mid-turn can join the running turn at its next
/// step. Engines that cannot take it get it as the next turn.
pub fn can_steer(engine: &str) -> bool {
    matches!(engine, "claude" | "codex")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_engine_has_a_name() {
        for engine in ALL {
            assert!(is_engine(engine));
            assert_ne!(name(engine), "an unknown engine", "{engine}");
        }
        assert!(!is_engine("gpt"));
    }
}
