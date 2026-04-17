//! Tipi DTO per licenze Live SLIDE CENTER.
//!
//! GEMELLO con `apps/agent/src-tauri/src/license/types.rs`. Tieni i due
//! allineati. Schema di riferimento: `Live WORKS APP/functions/src/types/index.ts`
//! (ActivateRequest, ActivateResponse, VerifyRequest, VerifyResponse,
//! DeactivateRequest).

use serde::{Deserialize, Serialize};

/// Dato persistito su disco (cifrato AES-256-GCM in `license.enc`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseData {
    pub license_key: String,
    pub token: String,
    pub fingerprint: String,
    pub expires_at: String,
    pub verify_before: String,
    #[serde(default)]
    pub customer_name: Option<String>,
    #[serde(default)]
    pub product_ids: Option<Vec<String>>,
    #[serde(default)]
    pub hardware_details: Option<String>,
}

/// Stato pending activation, persistito cifrato per polling background
/// del primo bind hardware in attesa di approvazione admin.
#[derive(Debug, Serialize, Deserialize)]
pub struct PendingActivation {
    pub license_key: String,
    pub fingerprint: String,
}

/// Body POST `/activate`. Schema camelCase compatibile con Live WORKS APP
/// `functions/src/api/activate.ts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateRequest<'a> {
    pub license_key: &'a str,
    pub hardware_fingerprint: &'a str,
    pub hardware_details: Option<&'a str>,
    pub product_id: &'a str,
    pub app_version: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivateResponse {
    pub success: bool,
    #[serde(default)]
    pub pending_approval: bool,
    pub error: Option<String>,
    pub token: Option<String>,
    pub expires_at: Option<String>,
    pub verify_before_date: Option<String>,
    pub product_ids: Option<Vec<String>>,
    pub customer_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyRequest<'a> {
    pub license_key: &'a str,
    pub hardware_fingerprint: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token: Option<&'a str>,
    pub product_id: &'a str,
    pub app_version: &'a str,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyResponse {
    pub valid: bool,
    #[serde(default)]
    pub pending_approval: bool,
    pub error: Option<String>,
    pub expires_at: Option<String>,
    pub next_verify_date: Option<String>,
    pub new_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeactivateRequest<'a> {
    pub license_key: &'a str,
    pub hardware_fingerprint: &'a str,
    pub token: &'a str,
    pub reason: &'a str,
}

/// Stato licenza esposto al frontend Tauri (serializzato come tagged union).
/// Allineato a `Live 3d Ledwall Render`.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LicenseStatus {
    /// Nessun file `license.enc` ne' pending.
    NotActivated,
    /// Activate in attesa di approvazione admin (vedi dashboard Live WORKS APP).
    PendingApproval { message: String },
    /// Licenza attiva valida (eventualmente in offline grace).
    Licensed { customer_name: Option<String> },
    /// Licenza scaduta o revocata.
    Expired { message: String },
    /// Fingerprint hardware non corrisponde (es. nuova scheda madre).
    WrongMachine,
    /// Offline grace scaduta: serve verify online entro la prossima sessione.
    NeedsOnlineVerify,
    /// Errore tecnico (WMI, IO, parsing JSON, ecc.).
    Error { message: String },
}
