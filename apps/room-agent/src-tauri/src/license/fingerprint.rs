//! Fingerprint hardware Windows via WMI.
//!
//! `SHA256(MB_SERIAL | CPU_ID | DISK_SERIAL)` esadecimale 64 char.
//! Stessa formula di `Live 3d Ledwall Render`, `Live Speaker Timer`, e di tutti
//! i prodotti che integrano Live WORKS APP. Mantenere allineata.
//!
//! GEMELLO con `apps/agent/src-tauri/src/license/fingerprint.rs`.

use sha2::{Digest, Sha256};

#[cfg(target_os = "windows")]
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use wmi::{COMLibrary, Variant, WMIConnection};

#[derive(Debug, Clone)]
pub struct FingerprintResult {
    pub fingerprint_hex: String,
    pub hardware_details: String,
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(target_os = "windows")]
fn wmi_first_string(query: &str, field: &str) -> Result<String, String> {
    let com = COMLibrary::new().map_err(|e| format!("WMI COM: {}", e))?;
    let wmi = WMIConnection::new(com).map_err(|e| format!("WMI: {}", e))?;
    let rows: Vec<HashMap<String, Variant>> = wmi
        .raw_query(query)
        .map_err(|e| format!("WMI query: {}", e))?;
    let row = rows
        .first()
        .ok_or_else(|| format!("WMI: nessun risultato per {}", field))?;
    let v = row
        .get(field)
        .ok_or_else(|| format!("WMI: campo {} assente", field))?;
    let s = match v {
        Variant::String(s) => s.trim().to_string(),
        _ => format!("{:?}", v).trim().to_string(),
    };
    if s.is_empty() {
        return Err(format!("WMI: {} vuoto", field));
    }
    Ok(s)
}

#[cfg(target_os = "windows")]
pub fn compute_fingerprint() -> Result<FingerprintResult, String> {
    let mb = wmi_first_string("SELECT SerialNumber FROM Win32_BaseBoard", "SerialNumber")
        .map_err(|e| format!("Fingerprint: MB serial non disponibile - {e}"))?;
    let cpu = wmi_first_string("SELECT ProcessorId FROM Win32_Processor", "ProcessorId")
        .map_err(|e| format!("Fingerprint: CPU ID non disponibile - {e}"))?;
    let disk = wmi_first_string(
        "SELECT SerialNumber FROM Win32_DiskDrive WHERE Index=0",
        "SerialNumber",
    )
    .map_err(|e| format!("Fingerprint: Disk serial non disponibile - {e}"))?;

    let pipe = format!("{}|{}|{}", mb, cpu, disk);
    let mut hasher = Sha256::new();
    hasher.update(pipe.as_bytes());
    let digest = hasher.finalize();

    Ok(FingerprintResult {
        fingerprint_hex: hex_digest(&digest),
        hardware_details: format!("MB:{}|CPU:{}|DISK:{}", mb, cpu, disk),
    })
}

#[cfg(not(target_os = "windows"))]
pub fn compute_fingerprint() -> Result<FingerprintResult, String> {
    Err("Attivazione licenza: fingerprint hardware disponibile solo su Windows.".to_string())
}

#[cfg(test)]
mod tests {
    use super::hex_digest;

    #[test]
    fn hex_digest_lowercase_64_chars_for_sha256() {
        let out = hex_digest(&[0xAB, 0xCD, 0xEF, 0x01]);
        assert_eq!(out, "abcdef01");
    }
}
