mod common;
use common::Sandbox;
use serde_json::json;

#[tokio::test]
async fn a_phone_connection_updates_other_clients_and_survives_restart() {
    let sandbox = Sandbox::new("mobile");
    let daemon = sandbox.start_with(&[("YARD_TESTFLIGHT_URL", "https://testflight.apple.com/join/AbCd1234")]);
    let mut desktop = daemon.client().await;
    let snapshot = desktop.wait_for("snapshot", |m| m["op"] == "snapshot").await;
    assert_eq!(snapshot["mobile"]["configured"], false);
    assert_eq!(snapshot["mobile"]["testFlightUrl"], "https://testflight.apple.com/join/AbCd1234");
    let mut phone = daemon.client().await;
    phone.send(json!({ "op": "mobile.connected" })).await;
    let status = desktop.wait_for("phone connected", |m| m["op"] == "mobile.status").await;
    assert_eq!(status["mobile"]["configured"], true);
    drop(phone);
    drop(desktop);
    daemon.stop();
    let daemon = sandbox.start();
    let snapshot = daemon.client().await.wait_for("restored snapshot", |m| m["op"] == "snapshot").await;
    assert_eq!(snapshot["mobile"]["configured"], true);
}
