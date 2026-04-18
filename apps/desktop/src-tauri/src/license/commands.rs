//! Tauri commands esposti alla SPA React (Sprint D1).
//!
//! Tutti i comandi tornano `Result<serde_json::Value, String>`: il caller
//! React riceve `{kind: "active" | "notBound" | ...}` per status e
//! `{ok: true}` per le mutation, oppure stringa di errore.

use serde_json::{json, Value};

use super::manager::LicenseManager;

/// `cmd_license_status()` → JSON tagged union (`LicenseStatus`).
#[tauri::command]
pub fn cmd_license_status() -> Result<Value, String> {
    let mgr = LicenseManager::new().map_err(|e| format!("init manager: {e}"))?;
    let status = mgr.current_status();
    serde_json::to_value(status).map_err(|e| format!("serialize status: {e}"))
}

/// `cmd_license_bind(magicLink, deviceName?)` → bind il PC al tenant cloud.
#[tauri::command]
pub async fn cmd_license_bind(
    magic_link: String,
    device_name: Option<String>,
) -> Result<Value, String> {
    let mgr = LicenseManager::new().map_err(|e| format!("init manager: {e}"))?;
    mgr.bind(magic_link.trim(), device_name)
        .await
        .map_err(|e| format!("{e}"))?;
    Ok(json!({ "ok": true }))
}

/// `cmd_license_verify_now()` → heartbeat ad-hoc + aggiorna license.enc.
#[tauri::command]
pub async fn cmd_license_verify_now() -> Result<Value, String> {
    let mgr = LicenseManager::new().map_err(|e| format!("init manager: {e}"))?;
    mgr.verify_now().await.map_err(|e| format!("{e}"))?;
    let status = mgr.current_status();
    Ok(json!({
        "ok": true,
        "status": serde_json::to_value(status).unwrap_or_else(|_| json!({}))
    }))
}

/// `cmd_license_reset()` → cancella `license.enc`. Usato da UI "scollega"
/// e da uninstaller (--reset CLI flag, futuro).
#[tauri::command]
pub fn cmd_license_reset() -> Result<Value, String> {
    super::storage::delete().map_err(|e| format!("delete license.enc: {e}"))?;
    Ok(json!({ "ok": true }))
}
