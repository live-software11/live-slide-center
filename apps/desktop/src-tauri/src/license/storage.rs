//! Persistenza `license.enc` cifrato AES-256-GCM (Sprint D1).
//!
//! Path: `~/.slidecenter/license.enc`. Cifrato con `crypto::encrypt()`,
//! contenuto JSON serializzato di `types::LicenseData`.

use anyhow::{Context, Result};
use std::fs;
use std::path::PathBuf;

use super::crypto;
use super::types::LicenseData;
use super::{APP_DOTDIR, LICENSE_FILE};

pub fn license_file_path() -> Result<PathBuf> {
    let home = dirs::home_dir().context("home_dir not available")?;
    Ok(home.join(APP_DOTDIR).join(LICENSE_FILE))
}

pub fn save(data: &LicenseData) -> Result<()> {
    let json = serde_json::to_vec(data).context("serialize LicenseData")?;
    let encrypted = crypto::encrypt(&json).context("encrypt license")?;
    let path = license_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("mkdir {}", parent.display()))?;
    }
    fs::write(&path, encrypted)
        .with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

pub fn load() -> Result<Option<LicenseData>> {
    let path = license_file_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let encrypted = fs::read(&path)
        .with_context(|| format!("read {}", path.display()))?;
    let plaintext = crypto::decrypt(&encrypted)
        .with_context(|| format!("decrypt {}", path.display()))?;
    let data: LicenseData = serde_json::from_slice(&plaintext)
        .context("parse LicenseData JSON (file may be from a previous version)")?;
    Ok(Some(data))
}

pub fn delete() -> Result<()> {
    let path = license_file_path()?;
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("remove {}", path.display()))?;
    }
    Ok(())
}
