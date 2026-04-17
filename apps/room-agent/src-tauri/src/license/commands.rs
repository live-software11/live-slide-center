//! Comandi Tauri esposti al frontend (feature `license`).
//!
//! GEMELLO con `apps/agent/src-tauri/src/license/commands.rs`.

use super::manager;
use super::types::LicenseStatus;

#[tauri::command]
pub async fn license_activate(key: String) -> Result<LicenseStatus, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("Inserire la chiave licenza".to_string());
    }
    manager::activate(trimmed).await
}

#[tauri::command]
pub async fn license_verify() -> Result<LicenseStatus, String> {
    manager::verify_online().await
}

#[tauri::command]
pub async fn license_deactivate(reason: Option<String>) -> Result<(), String> {
    let r = reason.unwrap_or_else(|| "pc_change".to_string());
    let r = r.trim();
    let r = if r.is_empty() { "pc_change" } else { r };
    manager::deactivate(r).await
}

#[tauri::command]
pub fn license_status() -> LicenseStatus {
    manager::get_status_sync()
}

#[tauri::command]
pub async fn license_fingerprint() -> Result<String, String> {
    manager::fingerprint_for_support().await
}
