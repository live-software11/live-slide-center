//! AES-256-GCM cifratura del file `license.enc` (Sprint D1).
//!
//! Pattern allineato a `apps/agent/src-tauri/src/license/crypto.rs` legacy ma
//! semplificato: niente HMAC esplicito (GCM gia' include autentica AEAD),
//! niente versioning (1 sola versione formato finora).
//!
//! Layout file su disco:
//!   [12 bytes nonce][N bytes ciphertext+tag GCM]
//!
//! Sicurezza:
//!   - Chiave hardcoded `LICENSE_AES_KEY` (ok per anti-trivial-tamper, NON
//!     per anti-state-actor). Per upgrade futuro: storage in OS keychain via
//!     `keyring` crate. Per ora bilanciamo semplicita' / portabilita'.
//!   - Nonce random a ogni save (12 bytes da `OsRng`): no riuso, no nonce
//!     reuse attack.

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use anyhow::{anyhow, Context, Result};
use rand::RngCore;

use super::LICENSE_AES_KEY;

const NONCE_SIZE: usize = 12;

pub fn encrypt(plaintext: &[u8]) -> Result<Vec<u8>> {
    let cipher = Aes256Gcm::new_from_slice(&LICENSE_AES_KEY)
        .map_err(|_| anyhow!("invalid AES key length (expected 32 bytes)"))?;
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| anyhow!("AES-GCM encrypt failed: {e}"))?;
    let mut out = Vec::with_capacity(NONCE_SIZE + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decrypt(blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() <= NONCE_SIZE {
        return Err(anyhow!("ciphertext too short ({} bytes)", blob.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(&LICENSE_AES_KEY)
        .map_err(|_| anyhow!("invalid AES key length"))?;
    let (nonce_bytes, ciphertext) = blob.split_at(NONCE_SIZE);
    let nonce = Nonce::from_slice(nonce_bytes);
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow!("AES-GCM decrypt failed: {e}"))
        .context("license.enc may be corrupted or written by a different app version")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_known_vector() {
        let pt = b"hello slide center desktop license payload";
        let ct = encrypt(pt).expect("encrypt");
        assert_ne!(ct.as_slice(), pt);
        assert!(ct.len() > NONCE_SIZE);
        let pt2 = decrypt(&ct).expect("decrypt");
        assert_eq!(pt2.as_slice(), pt);
    }

    #[test]
    fn tampered_ciphertext_rejected() {
        let pt = b"important payload";
        let mut ct = encrypt(pt).expect("encrypt");
        let last = ct.len() - 1;
        ct[last] ^= 0xFF;
        assert!(decrypt(&ct).is_err());
    }
}
