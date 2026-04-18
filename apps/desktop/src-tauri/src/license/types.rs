//! DTO licenze (Sprint D1).
//!
//! Schemi allineati a:
//!   - `supabase/functions/desktop-bind-claim/index.ts` (response)
//!   - `supabase/functions/desktop-license-verify/index.ts` (response)
//!   - `supabase/migrations/20260418290000_desktop_devices_licensing.sql` (RPC)

use serde::{Deserialize, Serialize};

/// Dato persistito su disco cifrato AES-256-GCM in `~/.slidecenter/license.enc`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseData {
    /// Pair token plain (32 byte base64url) usato come Bearer per le edge
    /// function. Mai uscire da questo PC: il cloud conserva solo lo sha256.
    pub pair_token: String,
    /// UUID device dal cloud (`desktop_devices.id`).
    pub device_id: String,
    /// Tenant cloud associato.
    pub tenant_id: String,
    /// Nome tenant per UI status.
    #[serde(default)]
    pub tenant_name: Option<String>,
    /// Piano commerciale (`free` | `pro` | `demo` | ...).
    #[serde(default)]
    pub plan: Option<String>,
    /// Scadenza commerciale (ISO 8601 UTC). NULL = nessuna scadenza fissata.
    #[serde(default)]
    pub expires_at: Option<String>,
    /// Timestamp ultimo verify riuscito (ISO 8601 UTC). Se vecchio > 30gg →
    /// blocco funzioni cloud-dipendenti (LAN continua).
    pub last_verified_at: String,
    /// Limite oltre il quale le funzioni cloud vengono disabilitate
    /// (last_verified_at + 30gg). Salvato esplicito per chiarezza.
    pub grace_until: String,
    /// Versione app al momento dell'ultimo bind/verify.
    #[serde(default)]
    pub app_version: Option<String>,
    /// Timestamp del bind iniziale (ISO 8601 UTC).
    pub bound_at: String,
}

/// Body POST `desktop-bind-claim`.
#[derive(Debug, Serialize)]
pub struct BindRequest {
    pub token: String,
    pub pair_token: String,
    pub device_name: String,
    pub machine_fingerprint: String,
    pub app_version: String,
    pub os_version: String,
}

/// Response 200 di `desktop-bind-claim`.
#[derive(Debug, Deserialize)]
pub struct BindResponse {
    pub device_id: String,
    pub tenant_id: String,
    #[serde(default)]
    pub license: Option<LicenseInfo>,
    pub pair_token: String,
}

/// Body POST `desktop-license-verify`.
#[derive(Debug, Serialize)]
pub struct VerifyRequest {
    pub app_version: String,
}

/// Response 200 di `desktop-license-verify`.
///
/// Alcuni campi (`ok`, `device_id`, `device_name`, `verified_at`,
/// `grace_until`, `tenant_id`) sono parsati ma non letti perche' lato client
/// usiamo l'orario locale come fonte di verita' per `last_verified_at` e
/// `grace_until` (semplifica la sincronizzazione clock e la pulizia in
/// modalita offline). Sono mantenuti nel DTO per logging e debug futuri.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct VerifyResponse {
    pub ok: bool,
    pub device_id: String,
    #[serde(default)]
    pub device_name: Option<String>,
    pub tenant_id: String,
    #[serde(default)]
    pub tenant_name: Option<String>,
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    pub verified_at: String,
    pub grace_until: String,
}

/// Subset delle info licenza usato sia dentro BindResponse che in
/// VerifyResponse (campo nested in BindResponse).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct LicenseInfo {
    #[serde(default)]
    pub plan: Option<String>,
    #[serde(default)]
    pub expires_at: Option<String>,
    #[serde(default)]
    pub suspended: Option<bool>,
}

/// Stato licenza esposto al frontend Tauri (tagged union JSON).
///
/// `Revoked` e `TenantSuspended` sono attualmente costruiti solo se
/// `verify_now()` riceve l'errore semantico corrispondente dal cloud (mappato
/// via `LicenseClientError::DeviceRevoked` / `TenantSuspended`); il modulo li
/// dichiara perche' la SPA li gestisce gia' nel banner / pagina licenza.
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LicenseStatus {
    /// Nessun bind ancora effettuato.
    NotBound,
    /// Licenza valida, online e verificata di recente.
    Active {
        tenant_name: Option<String>,
        plan: Option<String>,
        expires_at: Option<String>,
        last_verified_at: String,
    },
    /// Bound ma in grace period (offline > 24h, < 30gg). Funziona ancora.
    GracePeriod {
        tenant_name: Option<String>,
        plan: Option<String>,
        last_verified_at: String,
        grace_until: String,
        days_remaining: i64,
    },
    /// Grace scaduto: blocco funzioni cloud (LAN comunque attiva).
    GraceExpired {
        tenant_name: Option<String>,
        last_verified_at: String,
    },
    /// Device revocato dall'admin cloud.
    Revoked,
    /// Tenant sospeso (mancato pagamento, expired) — rifiutato lato cloud.
    TenantSuspended {
        tenant_name: Option<String>,
    },
    /// Errore tecnico (file corrotto, IO, parse).
    Error { message: String },
}
