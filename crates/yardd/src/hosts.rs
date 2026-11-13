//! Host stats: CPU, load, memory and disk, sampled every few seconds.

use std::{sync::Arc, time::Duration};

use serde_json::json;
use sysinfo::{Disks, System};

use crate::state::App;

const SAMPLE_SECS: u64 = 3;
/// One hour of CPU history.
const HISTORY: usize = (3600 / SAMPLE_SECS) as usize;

pub async fn run(app: Arc<App>) {
    let mut sys = System::new();
    sys.refresh_cpu();
    loop {
        tokio::time::sleep(Duration::from_secs(SAMPLE_SECS)).await;
        sys.refresh_cpu();
        sys.refresh_memory();

        let cpu = sys.global_cpu_info().cpu_usage();
        let cores = sys.cpus().len();
        let load = System::load_average().one;
        let mem_total = sys.total_memory();
        // `available_memory()` reads 0 on macOS, which would show 100% used.
        let mem_used = sys.used_memory().min(mem_total);

        // The data volume on macOS, the root volume elsewhere.
        let disks = Disks::new_with_refreshed_list();
        let disk = disks
            .iter()
            .find(|d| d.mount_point().to_str() == Some("/System/Volumes/Data"))
            .or_else(|| disks.iter().find(|d| d.mount_point().to_str() == Some("/")));
        let (disk_total, disk_used) = disk
            .map(|d| (d.total_space(), d.total_space().saturating_sub(d.available_space())))
            .unwrap_or((0, 0));

        let history: Vec<f32> = {
            let mut h = app.cpu_history.lock().unwrap();
            h.push_back(cpu);
            while h.len() > HISTORY {
                h.pop_front();
            }
            h.iter().copied().collect()
        };

        let host = json!({
            "id": "local",
            "name": "This Mac",
            "cpu": cpu,
            "cores": cores,
            "load": load,
            "memUsed": mem_used,
            "memTotal": mem_total,
            "diskUsed": disk_used,
            "diskTotal": disk_total,
            "cpuHistory": history,
        });
        *app.host.lock().unwrap() = host.clone();
        app.broadcast(json!({ "op": "host", "host": host }));
    }
}
