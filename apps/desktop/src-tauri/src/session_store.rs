// ============================================================================
// Sprint Z (post-field-test) — Gap C: persistenza "last session" PC sala
// ============================================================================
//
// Obiettivo: dopo un riavvio del PC sala (crash, blackout, restart) tornare
// esattamente sulla session/presentation/slide che era live, senza dover
// passare dal menu mDNS, evitando il "buco nero" sullo schermo durante un
// evento dal vivo.
//
// File: `<data_root>/last-session.json`. Atomico (tmp + rename), JSON pretty
// per ispezione manuale, schema versionato per migrazioni future.
//
// Idempotenza: la lettura non lancia mai errore — ritorna None su NotFound /
// JSON corrotto / schema mismatch (in quei casi la SPA fa fallback al
// bootstrap normale, comportamento attuale pre-Sprint-Z).
//
// Sicurezza:
//   - file leggibile/scrivibile solo dall'utente Windows owner del processo
//     Tauri (no chmod custom: ereditiamo l'ACL della directory).
//   - NESSUN segreto sensibile salvato qui (il `device_token` plain e' gia'
//     in `device.json` Sprint M1, qui salviamo solo gli ID di stato runtime).
//
// NB: questo modulo NON tocca il backend Rust (axum). E' usato esclusivamente
// dai due Tauri command `cmd_get_last_session` / `cmd_save_last_session` per
// far parlare la SPA con il filesystem locale dentro lo stesso processo.
// ============================================================================

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

const SCHEMA_VERSION: u32 = 1;
const FILE_NAME: &str = "last-session.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastSession {
    /// Schema version: incrementare quando si rompe la compatibilita' indietro.
    pub schema: u32,
    /// device_token plain (serve solo a verificare che il rejoin sia per LO
    /// STESSO device pairizzato; se il device.json e' stato cancellato nel
    /// frattempo, il restore fallisce e la SPA va su /pair).
    pub device_token: String,
    pub event_id: String,
    pub room_id: Option<String>,
    pub current_presentation_id: Option<String>,
    pub current_session_id: Option<String>,
    pub current_slide_index: Option<i32>,
    pub current_slide_total: Option<i32>,
    /// Timestamp ISO-8601 dell'ultimo save (utile per scartare snapshot vecchi
    /// es. "ultima session > 24h fa, fai bootstrap fresco").
    pub saved_at: String,
}

pub fn write(data_root: &Path, payload: &LastSession) -> std::io::Result<()> {
    if payload.schema != SCHEMA_VERSION {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            format!(
                "session_store: schema {} non supportato (atteso {})",
                payload.schema, SCHEMA_VERSION
            ),
        ));
    }
    std::fs::create_dir_all(data_root)?;
    let path = file_path(data_root);
    let bytes = serde_json::to_vec_pretty(payload).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &path)?;
    info!(
        path = %path.display(),
        event_id = %payload.event_id,
        room_id = ?payload.room_id,
        "last-session.json persistito"
    );
    Ok(())
}

pub fn read(data_root: &Path) -> Option<LastSession> {
    let path = file_path(data_root);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            warn!(?e, "lettura last-session.json fallita");
            return None;
        }
    };
    match serde_json::from_slice::<LastSession>(&bytes) {
        Ok(d) if d.schema == SCHEMA_VERSION => Some(d),
        Ok(d) => {
            warn!(
                schema = d.schema,
                expected = SCHEMA_VERSION,
                "last-session.json schema diverso, ignoro"
            );
            None
        }
        Err(e) => {
            warn!(?e, "last-session.json non parsabile");
            None
        }
    }
}

/// Cancella `last-session.json`. Chiamato da `cmd_clear_device_pairing` per
/// non lasciare orfani quando l'utente esce dall'evento. NotFound = no-op.
pub fn clear(data_root: &Path) -> std::io::Result<()> {
    let path = file_path(data_root);
    match std::fs::remove_file(&path) {
        Ok(_) => {
            info!(path = %path.display(), "last-session.json rimosso");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn file_path(data_root: &Path) -> PathBuf {
    data_root.join(FILE_NAME)
}
