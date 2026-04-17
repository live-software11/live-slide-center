//! Orchestrazione licenze: stato, persistenza, attivazione/verifica/disattivazione.
//!
//! GEMELLO con `apps/room-agent/src-tauri/src/license/manager.rs`. Tieni i file
//! allineati: l'unica differenza ammessa e' implicita nelle costanti
//! `PRODUCT_ID`/`APP_DATA_DIR`/`LICENSE_AES_KEY` esposte da `mod.rs`.

use chrono::{DateTime, Duration, Utc};
use std::fs;
use std::path::PathBuf;

use super::api::{post_activate, post_deactivate, post_verify};
use super::crypto::{decrypt_bytes, decrypt_json, encrypt_bytes, encrypt_json};
use super::fingerprint::{compute_fingerprint, FingerprintResult};
use super::types::{
    ActivateRequest, DeactivateRequest, LicenseData, LicenseStatus, PendingActivation,
    VerifyRequest,
};
use super::{APP_DATA_DIR, LICENSE_FILE, PENDING_FILE, PRODUCT_ID};

/// Soglia di tolleranza dopo `verify_before_date` durante la quale l'app resta
/// utilizzabile anche senza connettivita' internet. Allineata a Live 3d Ledwall.
const OFFLINE_GRACE_DAYS: i64 = 30;

fn app_dir() -> Result<PathBuf, String> {
    let base = dirs::data_local_dir().ok_or_else(|| "LOCALAPPDATA non disponibile".to_string())?;
    let dir = base.join(APP_DATA_DIR);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn license_path() -> Result<PathBuf, String> {
    Ok(app_dir()?.join(LICENSE_FILE))
}

fn pending_path() -> Result<PathBuf, String> {
    Ok(app_dir()?.join(PENDING_FILE))
}

pub fn load_license() -> Result<Option<LicenseData>, String> {
    let path = license_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(decrypt_json(&bytes)?))
}

pub fn save_license(data: &LicenseData) -> Result<(), String> {
    let enc = encrypt_json(data)?;
    fs::write(license_path()?, enc).map_err(|e| e.to_string())?;
    clear_pending()?;
    Ok(())
}

pub fn delete_license() -> Result<(), String> {
    let p = license_path()?;
    if p.exists() {
        fs::remove_file(&p).map_err(|e| e.to_string())?;
    }
    clear_pending()?;
    Ok(())
}

fn save_pending(key: &str, fp: &str) -> Result<(), String> {
    let p = PendingActivation {
        license_key: key.to_string(),
        fingerprint: fp.to_string(),
    };
    let json = serde_json::to_vec(&p).map_err(|e| e.to_string())?;
    let enc = encrypt_bytes(&json)?;
    fs::write(pending_path()?, enc).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_pending() -> Result<Option<PendingActivation>, String> {
    let path = pending_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read(&path).map_err(|e| e.to_string())?;
    let plain = decrypt_bytes(&raw)?;
    serde_json::from_slice(&plain)
        .map_err(|e| e.to_string())
        .map(Some)
}

fn clear_pending() -> Result<(), String> {
    let path = pending_path()?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Esegue il fingerprint hardware fuori dal runtime tokio (WMI usa COM e
/// blocca: non puo' girare su un worker async).
async fn fingerprint_async() -> Result<FingerprintResult, String> {
    tokio::task::spawn_blocking(compute_fingerprint)
        .await
        .map_err(|e| format!("Fingerprint task: {}", e))?
}

pub fn fingerprint_matches(data: &LicenseData, fp: &FingerprintResult) -> bool {
    data.fingerprint == fp.fingerprint_hex
}

/// Verifica se la licenza e' ancora utilizzabile offline (entro grace).
pub fn offline_grace_ok(data: &LicenseData) -> bool {
    let now = Utc::now();
    if !data.expires_at.is_empty() {
        if let Ok(exp) = DateTime::parse_from_rfc3339(&data.expires_at) {
            if now > exp.with_timezone(&Utc) {
                return false;
            }
        }
    }
    if data.verify_before.is_empty() {
        return false;
    }
    if let Ok(vb) = DateTime::parse_from_rfc3339(&data.verify_before) {
        let deadline = vb.with_timezone(&Utc) + Duration::days(OFFLINE_GRACE_DAYS);
        if now > deadline {
            return false;
        }
    }
    true
}

pub async fn activate(license_key: &str) -> Result<LicenseStatus, String> {
    let fp = fingerprint_async().await?;
    let body = ActivateRequest {
        license_key,
        hardware_fingerprint: &fp.fingerprint_hex,
        hardware_details: Some(&fp.hardware_details),
        product_id: PRODUCT_ID,
        app_version: app_version(),
    };
    let parsed = post_activate(&body).await?;

    if parsed.pending_approval {
        save_pending(license_key, &fp.fingerprint_hex)?;
        return Ok(LicenseStatus::PendingApproval {
            message: parsed
                .error
                .unwrap_or_else(|| "In attesa approvazione amministratore".to_string()),
        });
    }

    if !parsed.success {
        clear_pending().ok();
        return Err(parsed
            .error
            .unwrap_or_else(|| "Attivazione non riuscita".to_string()));
    }

    let token = parsed
        .token
        .ok_or_else(|| "Server: token assente".to_string())?;
    let expires_at = parsed
        .expires_at
        .ok_or_else(|| "Server: expiresAt assente".to_string())?;
    let verify_before = parsed
        .verify_before_date
        .unwrap_or_else(|| expires_at.clone());

    let data = LicenseData {
        license_key: license_key.to_string(),
        token,
        fingerprint: fp.fingerprint_hex.clone(),
        expires_at,
        verify_before,
        customer_name: parsed.customer_name,
        product_ids: parsed.product_ids,
        hardware_details: Some(fp.hardware_details),
    };
    save_license(&data)?;
    Ok(LicenseStatus::Licensed {
        customer_name: data.customer_name.clone(),
    })
}

pub async fn verify_online() -> Result<LicenseStatus, String> {
    let fp = fingerprint_async().await?;

    if let Some(pending) = load_pending()? {
        if pending.fingerprint == fp.fingerprint_hex {
            return Box::pin(activate(&pending.license_key)).await;
        }
    }

    let mut data = load_license()?.ok_or_else(|| "Nessuna licenza salvata".to_string())?;
    if !fingerprint_matches(&data, &fp) {
        return Ok(LicenseStatus::WrongMachine);
    }

    let body = VerifyRequest {
        license_key: &data.license_key,
        hardware_fingerprint: &fp.fingerprint_hex,
        token: if data.token.is_empty() {
            None
        } else {
            Some(data.token.as_str())
        },
        product_id: PRODUCT_ID,
        app_version: app_version(),
    };
    let parsed = post_verify(&body).await?;

    if parsed.pending_approval {
        save_pending(&data.license_key, &fp.fingerprint_hex)?;
        delete_license().ok();
        return Ok(LicenseStatus::PendingApproval {
            message: parsed
                .error
                .unwrap_or_else(|| "In attesa approvazione".to_string()),
        });
    }

    if !parsed.valid {
        return Ok(LicenseStatus::Expired {
            message: parsed
                .error
                .unwrap_or_else(|| "Licenza non valida".to_string()),
        });
    }

    if let Some(nt) = parsed.new_token {
        data.token = nt;
    }
    if let Some(e) = parsed.expires_at {
        data.expires_at = e;
    }
    if let Some(nv) = parsed.next_verify_date {
        data.verify_before = nv;
    }
    save_license(&data)?;
    Ok(LicenseStatus::Licensed {
        customer_name: data.customer_name.clone(),
    })
}

pub async fn deactivate(reason: &str) -> Result<(), String> {
    let fp = fingerprint_async().await?;
    let data = match load_license()? {
        Some(d) => d,
        None => {
            clear_pending().ok();
            return Ok(());
        }
    };
    if data.token.is_empty() || !fingerprint_matches(&data, &fp) {
        delete_license()?;
        return Ok(());
    }
    let body = DeactivateRequest {
        license_key: &data.license_key,
        hardware_fingerprint: &fp.fingerprint_hex,
        token: &data.token,
        reason,
    };
    post_deactivate(&body).await;
    delete_license()?;
    Ok(())
}

/// Versione sync per `--deactivate` chiamato da NSIS pre-uninstall.
/// Costruisce un mini runtime tokio dedicato.
pub fn run_deactivate_uninstall() {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(r) => r,
        Err(_) => return,
    };
    let _ = rt.block_on(deactivate("uninstall"));
}

pub async fn fingerprint_for_support() -> Result<String, String> {
    Ok(fingerprint_async().await?.fingerprint_hex)
}

/// Stato sincrono (no rete): usato all'avvio per decidere se mostrare la UI di
/// attivazione o consentire l'app. Se serve verify online, ritorna
/// `NeedsOnlineVerify` e la UI scatena `verify_online()`.
pub fn get_status_sync() -> LicenseStatus {
    let fp = match compute_fingerprint() {
        Ok(f) => f,
        Err(e) => return LicenseStatus::Error { message: e },
    };

    if let Ok(Some(pending)) = load_pending() {
        if pending.fingerprint == fp.fingerprint_hex {
            return LicenseStatus::PendingApproval {
                message: "In attesa approvazione amministratore".to_string(),
            };
        }
    }

    let data = match load_license() {
        Ok(d) => d,
        Err(e) => return LicenseStatus::Error { message: e },
    };

    let Some(data) = data else {
        return LicenseStatus::NotActivated;
    };

    if !fingerprint_matches(&data, &fp) {
        return LicenseStatus::WrongMachine;
    }

    if data.token.is_empty() {
        return LicenseStatus::PendingApproval {
            message: "In attesa approvazione amministratore".to_string(),
        };
    }

    if offline_grace_ok(&data) {
        return LicenseStatus::Licensed {
            customer_name: data.customer_name.clone(),
        };
    }

    LicenseStatus::NeedsOnlineVerify
}
