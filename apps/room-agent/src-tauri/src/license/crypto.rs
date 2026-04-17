//! Cifratura locale `license.enc` con AES-256-GCM.
//!
//! Schema layout disco: `<nonce 12 byte><ciphertext+tag>`.
//! Niente HMAC esterno: GCM e' AEAD, il tag autentica payload+nonce.
//!
//! GEMELLO con `apps/agent/src-tauri/src/license/crypto.rs`.

use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};

use super::types::LicenseData;
use super::LICENSE_AES_KEY;

const NONCE_LEN: usize = 12;

fn cipher() -> Aes256Gcm {
    Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&LICENSE_AES_KEY))
}

pub fn encrypt_json(data: &LicenseData) -> Result<Vec<u8>, String> {
    let plain = serde_json::to_vec(data).map_err(|e| e.to_string())?;
    encrypt_bytes(&plain)
}

pub fn encrypt_bytes(plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = cipher();
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ct = cipher
        .encrypt(&nonce, plain)
        .map_err(|e| format!("cifratura: {}", e))?;
    let mut out = nonce.to_vec();
    out.extend(ct);
    Ok(out)
}

pub fn decrypt_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    if bytes.len() < NONCE_LEN + 16 {
        return Err("File cifrato corrotto".to_string());
    }
    let (n, ct) = bytes.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(n);
    cipher()
        .decrypt(nonce, ct)
        .map_err(|_| "File cifrato non valido o alterato".to_string())
}

pub fn decrypt_json(bytes: &[u8]) -> Result<LicenseData, String> {
    let plain = decrypt_bytes(bytes)?;
    serde_json::from_slice(&plain).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> LicenseData {
        LicenseData {
            license_key: "LIVE-TEST-1234-5678".into(),
            token: "abc.def.ghi".into(),
            fingerprint: "deadbeef".repeat(8),
            expires_at: "2030-01-01T00:00:00Z".into(),
            verify_before: "2026-12-31T23:59:59Z".into(),
            customer_name: Some("Test Cliente".into()),
            product_ids: Some(vec!["slide-center-room-agent".into()]),
            hardware_details: Some("MB:ABC|CPU:XYZ|DISK:123".into()),
        }
    }

    #[test]
    fn roundtrip_json() {
        let original = sample();
        let bytes = encrypt_json(&original).expect("encrypt");
        assert!(bytes.len() > NONCE_LEN);
        let restored = decrypt_json(&bytes).expect("decrypt");
        assert_eq!(restored.license_key, original.license_key);
        assert_eq!(restored.token, original.token);
        assert_eq!(restored.fingerprint, original.fingerprint);
        assert_eq!(restored.customer_name, original.customer_name);
    }

    #[test]
    fn tampered_payload_rejected() {
        let bytes = encrypt_json(&sample()).expect("encrypt");
        let mut tampered = bytes.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        assert!(decrypt_json(&tampered).is_err());
    }

    #[test]
    fn truncated_payload_rejected() {
        assert!(decrypt_json(b"too-short").is_err());
        assert!(decrypt_bytes(&[0u8; 5]).is_err());
    }

    #[test]
    fn distinct_nonces_per_call() {
        let a = encrypt_json(&sample()).unwrap();
        let b = encrypt_json(&sample()).unwrap();
        assert_ne!(&a[0..NONCE_LEN], &b[0..NONCE_LEN], "nonce must be unique");
    }
}
