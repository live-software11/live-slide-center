//! Machine fingerprint per la dashboard admin (Sprint D1).
//!
//! NON e' un anti-tamper, NON blocca lo spostamento di licenza tra PC. Serve
//! solo per:
//!   - mostrare nella UI cloud admin "PC Roma A | PC Roma B" e distinguerli
//!   - far funzionare l'idempotenza del re-bind: se lo stesso PC fisico fa un
//!     secondo bind, il record `desktop_devices` viene aggiornato invece di
//!     creare un duplicato (vedi UNIQUE constraint su tenant_id + machine_fingerprint).
//!
//! Strategia: UUID v4 generato al primo avvio, persistito in
//! `~/.slidecenter/machine-id`, riusato a tutti i bind successivi. Senza
//! claim di immutabilita' hardware: se l'utente cancella il file ottiene un
//! nuovo "PC". Sufficiente per il modello "stesse licenze condivise"
//! (Andrea 18/04/2026).

use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

use super::{APP_DOTDIR, MACHINE_ID_FILE};

/// Ritorna il machine fingerprint (UUID v4 lowercase). Lo crea al primo
/// utilizzo e lo persiste nel file `~/.slidecenter/machine-id`.
pub fn get_or_create_machine_id() -> Result<String> {
    let path = machine_id_path()?;
    if path.exists() {
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("read {}", path.display()))?;
        let trimmed = raw.trim();
        if trimmed.len() == 36 && trimmed.chars().filter(|&c| c == '-').count() == 4 {
            return Ok(trimmed.to_string());
        }
        // File corrotto: lo rigeneriamo (no panic, no crash).
    }
    let new_id = uuid::Uuid::new_v4().to_string();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("mkdir {}", parent.display()))?;
    }
    fs::write(&path, &new_id)
        .with_context(|| format!("write {}", path.display()))?;
    Ok(new_id)
}

/// Hostname OS (fallback "unknown" se IO error). Salvato come `device_name`
/// di default al primo bind. L'utente puo' overridarlo dalla UI bind.
pub fn get_default_device_name() -> String {
    hostname::get()
        .ok()
        .and_then(|os| os.into_string().ok())
        .map(|s| {
            let trimmed = s.trim().to_string();
            if trimmed.is_empty() {
                "Slide Center Server".to_string()
            } else {
                trimmed
            }
        })
        .unwrap_or_else(|| "Slide Center Server".to_string())
}

/// String descrittiva OS + versione (best-effort, usata come metadata).
pub fn get_os_version() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    format!("{} {}", os, arch)
}

fn machine_id_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir not available on this platform")?;
    Ok(home.join(APP_DOTDIR).join(MACHINE_ID_FILE))
}
