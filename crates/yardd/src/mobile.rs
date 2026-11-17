//! A phone is set up only after its UI has received the hub's snapshot.
use std::{path::PathBuf, sync::Mutex};

use anyhow::Result;
use serde_json::{json, Value};

pub struct Mobile {
    data: PathBuf,
    configured: Mutex<bool>,
}

impl Mobile {
    pub fn load(data: PathBuf) -> Self {
        let configured = std::fs::read(data.join("mobile.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .is_some_and(|v| v["configured"] == true);
        Self { data, configured: Mutex::new(configured) }
    }

    pub fn status(&self) -> Value {
        json!({ "configured": *self.configured.lock().unwrap(), "testFlightUrl": std::env::var("YARD_TESTFLIGHT_URL").ok() })
    }

    pub fn connected(&self) -> Result<()> {
        let mut configured = self.configured.lock().unwrap();
        if !*configured {
            std::fs::create_dir_all(&self.data)?;
            let tmp = self.data.join("mobile.json.tmp");
            std::fs::write(&tmp, r#"{"configured":true}"#)?;
            std::fs::rename(tmp, self.data.join("mobile.json"))?;
            *configured = true;
        }
        Ok(())
    }
}

