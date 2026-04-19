// Sprint N1 (GUIDA_OPERATIVA_v3 §4.F N1) — fan-out HTTP admin → PC sala paired.
//
// Quando il server admin completa `finalize_upload_version_admin` o
// `delete_presentation_admin`, deve notificare i PC sala paired dell'evento.
//
// Architettura:
//   1. Helper `notify_paired_devices(state, event_id, payload)` async.
//   2. Query SQLite locale `paired_devices WHERE event_id = ? AND lan_base_url IS NOT NULL`
//      via `spawn_blocking`.
//   3. Per ogni sala, `tokio::spawn` fire-and-forget HTTP `POST <lan_base_url>/events/file_added`
//      (o `/events/presentation_deleted`) con timeout 5s. Errori solo loggati.
//
// Trade-off: nessun retry server-side. Se il sala e' offline al momento del push,
// perdera' la notifica e dovra' affidarsi al polling 30s safety net (Sprint N3).
// Nessun rischio funzionale: il polling rimane attivo, solo la latenza aumenta.
//
// Performance: con 10 sala paired, fan-out massimo 10*5s = 50s di rete in caso
// di tutti offline. I tokio::spawn parallelizzano: il chiamante (finalize_upload)
// risponde alla SPA admin in <100ms anche se i sala sono giu'.

use std::time::Duration;

use serde_json::{json, Value};
use tracing::{debug, info, warn};

use crate::server::{
    db::LOCAL_TENANT_ID,
    error::AppResult,
    lan_events::LanEventPayload,
    state::AppState,
};

/// Timeout per la singola POST verso il PC sala. Tenuto basso perche' fan-out
/// e' fire-and-forget: se un sala e' giu' non vogliamo bloccare task tokio.
const PUSH_TIMEOUT_SECS: u64 = 5;

/// Notifica un evento file/presentation a tutti i PC sala paired dell'evento.
///
/// Best-effort: non ritorna errore al chiamante. La SPA admin riceve la
/// response del finalize prima che il fan-out finisca.
pub async fn notify_paired_devices(state: &AppState, event_id: String, payload: LanEventPayload) {
    let pool = state.db.clone();
    let event_id_q = event_id.clone();
    let targets = match tokio::task::spawn_blocking(move || -> AppResult<Vec<(String, String)>> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, lan_base_url FROM paired_devices
              WHERE event_id = ?1 AND tenant_id = ?2
                AND lan_base_url IS NOT NULL AND lan_base_url <> ''",
        )?;
        let rows = stmt
            .query_map([&event_id_q, LOCAL_TENANT_ID], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
    .await
    {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => {
            warn!(?e, %event_id, "lan-push: query paired_devices fallita, fan-out skipped");
            return;
        }
        Err(e) => {
            warn!(?e, %event_id, "lan-push: join error, fan-out skipped");
            return;
        }
    };

    if targets.is_empty() {
        debug!(%event_id, "lan-push: nessun PC sala paired con lan_base_url, fan-out no-op");
        return;
    }

    info!(%event_id, count = targets.len(), "lan-push: fan-out file_added/presentation_deleted");

    let client = state.http_client.clone();
    let body = serde_json::to_value(&payload).unwrap_or(Value::Null);
    let kind = match &payload {
        LanEventPayload::FileAdded { .. } => "file_added",
        LanEventPayload::PresentationDeleted { .. } => "presentation_deleted",
        LanEventPayload::FolderCreated { .. } => "folder_created",
        LanEventPayload::FolderRenamed { .. } => "folder_renamed",
        LanEventPayload::FolderDeleted { .. } => "folder_deleted",
        LanEventPayload::PresentationsMovedToFolder { .. } => "presentations_moved_to_folder",
    };

    for (device_id, lan_base_url) in targets {
        let client = client.clone();
        let body = body.clone();
        let kind = kind.to_string();
        tokio::spawn(async move {
            let url = format!("{}/events/{}", lan_base_url.trim_end_matches('/'), kind);
            match client
                .post(&url)
                .timeout(Duration::from_secs(PUSH_TIMEOUT_SECS))
                .json(&body)
                .send()
                .await
            {
                Ok(res) => {
                    if res.status().is_success() {
                        debug!(%device_id, %url, "lan-push: ok");
                    } else {
                        warn!(
                            %device_id, %url, status = %res.status(),
                            "lan-push: sala ha risposto con status non-2xx (sala offline o disabilitato?)"
                        );
                    }
                }
                Err(e) => {
                    warn!(%device_id, %url, ?e, "lan-push: HTTP error (sala offline o LAN giu')");
                }
            }
        });
    }
}

/// Argomenti raggruppati per `build_file_added` — evita too_many_arguments
/// (clippy strict). Tutti i campi sono `String` o `Option<...>` perche'
/// vengono serializzati come JSON al sala.
pub struct FileAddedArgs {
    pub event_id: String,
    pub room_id: Option<String>,
    pub version_id: String,
    pub presentation_id: String,
    pub file_name: String,
    pub file_size_bytes: i64,
    pub mime_type: String,
    pub file_hash_sha256: Option<String>,
    pub storage_key: String,
    pub admin_base_url: Option<String>,
}

/// Helper per costruire payload `FileAdded` da una `presentation_versions` row appena finalizzata.
/// Letta dal DB locale admin in `finalize_upload`.
pub fn build_file_added(args: FileAddedArgs) -> LanEventPayload {
    LanEventPayload::FileAdded {
        event_id: args.event_id,
        room_id: args.room_id,
        version_id: args.version_id,
        presentation_id: args.presentation_id,
        file_name: args.file_name,
        file_size_bytes: args.file_size_bytes,
        mime_type: args.mime_type,
        file_hash_sha256: args.file_hash_sha256,
        storage_key: args.storage_key,
        admin_base_url: args.admin_base_url,
    }
}

/// Helper per costruire payload `PresentationDeleted`.
pub fn build_presentation_deleted(
    event_id: String,
    presentation_id: String,
    version_ids: Vec<String>,
) -> LanEventPayload {
    LanEventPayload::PresentationDeleted {
        event_id,
        presentation_id,
        version_ids,
    }
}

/// Sprint W C3 — Helper per costruire payload `FolderCreated` (File Explorer V2).
pub fn build_folder_created(
    event_id: String,
    folder_id: String,
    parent_id: Option<String>,
    name: String,
) -> LanEventPayload {
    LanEventPayload::FolderCreated { event_id, folder_id, parent_id, name }
}

/// Sprint W C3 — Helper per costruire payload `FolderRenamed`.
pub fn build_folder_renamed(
    event_id: String,
    folder_id: String,
    new_name: String,
) -> LanEventPayload {
    LanEventPayload::FolderRenamed { event_id, folder_id, new_name }
}

/// Sprint W C3 — Helper per costruire payload `FolderDeleted` (cascade).
pub fn build_folder_deleted(
    event_id: String,
    folder_id: String,
    cascade_folder_ids: Vec<String>,
) -> LanEventPayload {
    LanEventPayload::FolderDeleted { event_id, folder_id, cascade_folder_ids }
}

/// Sprint W C3 — Helper per costruire payload `PresentationsMovedToFolder`.
pub fn build_presentations_moved_to_folder(
    event_id: String,
    target_folder_id: Option<String>,
    presentation_ids: Vec<String>,
) -> LanEventPayload {
    LanEventPayload::PresentationsMovedToFolder { event_id, target_folder_id, presentation_ids }
}

/// Helper di logging: serializza payload per audit (best-effort).
#[allow(dead_code)]
pub fn payload_summary(payload: &LanEventPayload) -> String {
    json!({
        "kind": match payload {
            LanEventPayload::FileAdded { .. } => "file_added",
            LanEventPayload::PresentationDeleted { .. } => "presentation_deleted",
            LanEventPayload::FolderCreated { .. } => "folder_created",
            LanEventPayload::FolderRenamed { .. } => "folder_renamed",
            LanEventPayload::FolderDeleted { .. } => "folder_deleted",
            LanEventPayload::PresentationsMovedToFolder { .. } => "presentations_moved_to_folder",
        },
    })
    .to_string()
}
