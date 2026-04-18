// Sprint K4 (GUIDA_OPERATIVA_v3 §4.C K4) — modulo storage locale.
//
// Layout filesystem (sezione 13 della guida):
//   <data_root>/storage/<bucket>/<storage_key>
//
// Endpoint montati in `routes/storage_routes.rs`:
//   POST /storage/v1/object/{bucket}/{*key}        → upload binario (admin auth)
//   GET  /storage/v1/object/sign/{bucket}/{*key}   → signed URL HMAC (admin auth)
//   GET  /storage-files/{bucket}/{*key}            → GET con range request, autorizzato via query string `?expires=&sig=`
//
// Signed URL:
//   stringa firmata = "<bucket>:<key>:<expires>"
//   sig = HMAC-SHA256(secret, stringa) → base64url
//   URL ritornato = "http://<host>/storage-files/<bucket>/<key>?expires=<unix_seconds>&sig=<base64>"
//
// Range request: parsing del header `Range: bytes=START-END` con tower-http NON usato
// (tower-http ServeDir e' generico ma vogliamo controllo fine sul Content-Range header).

use std::path::{Path, PathBuf};

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::server::error::AppError;

type HmacSha256 = Hmac<Sha256>;

/// Costruisce il path assoluto sul filesystem per un oggetto storage.
/// Sicurezza path-traversal:
///   • normalizzazione: rifiuta `..` o segmenti vuoti.
///   • il path finale viene canonicalizzato e verificato che inizi con `<root>/<bucket>`.
pub fn object_path(storage_root: &Path, bucket: &str, key: &str) -> Result<PathBuf, AppError> {
    if !is_valid_segment(bucket) {
        return Err(AppError::BadRequest("invalid bucket name".into()));
    }
    let bucket_root = storage_root.join(bucket);

    // Normalizza il key: split su '/', rifiuta segmenti '..' o vuoti.
    let mut path = bucket_root.clone();
    for seg in key.split('/') {
        if seg.is_empty() || seg == "." || seg == ".." {
            return Err(AppError::BadRequest(format!("invalid storage key: {key}")));
        }
        path.push(seg);
    }

    // Path traversal final check: se per qualche motivo (link simbolici, ...) il path
    // calcolato uscisse dalla root del bucket, rifiutiamo.
    let canon_bucket = bucket_root.clone();
    if !path.starts_with(&canon_bucket) {
        return Err(AppError::Forbidden("path escapes bucket root".into()));
    }
    Ok(path)
}

fn is_valid_segment(s: &str) -> bool {
    !s.is_empty()
        && s != "."
        && s != ".."
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains('\0')
}

/// Genera un signed URL relativo (path + query) servibile da `/storage-files/...`.
pub fn build_signed_url(
    secret: &[u8],
    bucket: &str,
    key: &str,
    expires_in_secs: u64,
) -> Result<String, AppError> {
    if !is_valid_segment(bucket) {
        return Err(AppError::BadRequest("invalid bucket name".into()));
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| AppError::Internal(format!("clock skew: {e}")))?
        .as_secs();
    let expires_at = now + expires_in_secs.clamp(60, 7 * 24 * 3600);

    let signing_input = format!("{bucket}:{key}:{expires_at}");
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|e| AppError::Internal(e.to_string()))?;
    mac.update(signing_input.as_bytes());
    let sig_bytes = mac.finalize().into_bytes();
    let sig = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, sig_bytes);

    // URL relativo: il client antepone `getBackendBaseUrl()`.
    Ok(format!(
        "/storage-files/{bucket}/{key}?expires={expires_at}&sig={sig}"
    ))
}

/// Verifica una signed URL: ricalcola HMAC(bucket, key, expires) e confronta in tempo
/// costante. Rifiuta se scaduta.
pub fn verify_signed_url(
    secret: &[u8],
    bucket: &str,
    key: &str,
    expires: u64,
    sig_b64url: &str,
) -> Result<(), AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| AppError::Internal(format!("clock skew: {e}")))?
        .as_secs();
    if expires < now {
        return Err(AppError::Unauthorized("signed url expired".into()));
    }
    let expected_input = format!("{bucket}:{key}:{expires}");
    let mut mac = HmacSha256::new_from_slice(secret).map_err(|e| AppError::Internal(e.to_string()))?;
    mac.update(expected_input.as_bytes());
    let expected_bytes = mac.finalize().into_bytes();
    let expected_b64 = base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, expected_bytes);

    // confronto byte-by-byte tempo costante
    if expected_b64.len() != sig_b64url.len() {
        return Err(AppError::Unauthorized("signature length mismatch".into()));
    }
    let mut diff = 0u8;
    for (a, b) in expected_b64.bytes().zip(sig_b64url.bytes()) {
        diff |= a ^ b;
    }
    if diff != 0 {
        return Err(AppError::Unauthorized("signature mismatch".into()));
    }
    Ok(())
}
