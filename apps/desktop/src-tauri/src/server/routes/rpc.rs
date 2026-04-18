// Sprint K3 (GUIDA_OPERATIVA_v3 §4.C K3) — RPC mirror Supabase.
//
// Endpoint:
//   POST /rest/v1/rpc/init_upload_version_for_session    (admin auth)
//   POST /rest/v1/rpc/init_upload_version_admin          (admin auth, alias compat)
//   POST /rest/v1/rpc/finalize_upload_version_admin      (admin auth)
//   POST /rest/v1/rpc/abort_upload_version_admin         (admin auth)
//   POST /rest/v1/rpc/delete_presentation_admin          (admin auth)
//   POST /rest/v1/rpc/rename_paired_device_by_token      (no auth, body porta token)
//   POST /rest/v1/rpc/rpc_room_player_set_current        (no auth, body porta token)
//   POST /rest/v1/rpc/rpc_move_presentation_to_session   (admin auth)
//
// Le firme sono allineate alle migration Supabase:
//   • 20250416090000_phase3_upload_portal.sql
//   • 20260417110000_admin_uploads_and_move_presentation.sql
//   • 20260418030000_room_state_now_playing.sql
//   • 20260418020000_move_presentation_to_session.sql
//
// Ritorni:
//   • Successo: 200 con il `jsonb` originale (es. `{"version_id":...,"storage_key":...}`).
//   • Errore di validazione: 400 con `{"error":"...","message":"..."}` come gli altri endpoint.
//
// Differenze dal cloud:
//   • niente JWT / `auth.jwt()`: il `tenant_id` e' sempre `LOCAL_TENANT_ID`,
//     `uploaded_by_user_id` e' `LOCAL_ADMIN_USER_ID`.
//   • niente quota storage_used_bytes (`-1` = illimitato sul tenant locale).
//   • niente trigger broadcast realtime — il push HTTP arriva in Sprint N3.

use std::path::PathBuf;

use axum::{extract::State, routing::post, Json, Router};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::server::{
    auth::{resolve_device, AdminAuth},
    db::{LOCAL_ADMIN_USER_ID, LOCAL_TENANT_ID},
    error::{AppError, AppResult},
    lan_push::{build_file_added, build_presentation_deleted, notify_paired_devices},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/rpc/init_upload_version_for_session", post(init_upload_for_session))
        .route("/rpc/init_upload_version_admin", post(init_upload_for_speaker))
        .route("/rpc/finalize_upload_version_admin", post(finalize_upload))
        .route("/rpc/abort_upload_version_admin", post(abort_upload))
        .route("/rpc/delete_presentation_admin", post(delete_presentation))
        .route("/rpc/rename_paired_device_by_token", post(rename_device))
        .route("/rpc/rpc_room_player_set_current", post(room_player_set_current))
        .route("/rpc/rpc_move_presentation_to_session", post(move_presentation_to_session))
        .route("/rpc/update_device_role", post(update_device_role))
}

// ── 1. init_upload_version_for_session(p_session_id, p_filename, p_size, p_mime) ───
// Crea (o ri-usa) una presentation senza speaker (modello "upload diretto a sessione")
// + presentation_version status='uploading'. Ritorna version_id, presentation_id, storage_key.

#[derive(Deserialize)]
struct InitForSessionInput {
    p_session_id: String,
    p_filename: String,
    p_size: i64,
    #[serde(default)]
    p_mime: Option<String>,
}

async fn init_upload_for_session(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<InitForSessionInput>,
) -> AppResult<Json<Value>> {
    if input.p_size <= 0 {
        return Err(AppError::BadRequest("invalid_size".into()));
    }
    if input.p_filename.trim().is_empty() || input.p_filename.len() > 255 {
        return Err(AppError::BadRequest("invalid_filename".into()));
    }

    let pool = state.db.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        // Lookup sessione → event_id
        let event_id: String = tx.query_row(
            "SELECT event_id FROM sessions WHERE id = ?1 AND tenant_id = ?2",
            [&input.p_session_id, LOCAL_TENANT_ID],
            |r| r.get(0),
        ).map_err(|_| AppError::NotFound("session_not_found".into()))?;

        // Lookup presentation senza speaker per questa sessione (1:N possibile, ma
        // su upload diretto a sessione e' 1:1 con session_id — usiamo la prima senza speaker).
        let presentation_id: String = match tx.query_row(
            "SELECT id FROM presentations
              WHERE session_id = ?1 AND tenant_id = ?2 AND speaker_id IS NULL
              LIMIT 1",
            [&input.p_session_id, LOCAL_TENANT_ID],
            |r| r.get::<_, String>(0),
        ) {
            Ok(id) => id,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                let new_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO presentations (id, session_id, event_id, tenant_id, status)
                     VALUES (?1, ?2, ?3, ?4, 'pending')",
                    [&new_id, &input.p_session_id, &event_id, &LOCAL_TENANT_ID.to_string()],
                )?;
                new_id
            }
            Err(e) => return Err(e.into()),
        };

        let version_id = Uuid::new_v4().to_string();
        let safe_name = sanitize_storage_segment(&input.p_filename);
        let storage_key = format!("{LOCAL_TENANT_ID}/{event_id}/{presentation_id}/{version_id}-{safe_name}");
        let next_version_number = tx.query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM presentation_versions
              WHERE presentation_id = ?1",
            [&presentation_id],
            |r| r.get::<_, i64>(0),
        )?;
        tx.execute(
            "INSERT INTO presentation_versions
                (id, presentation_id, tenant_id, version_number, storage_key, file_name,
                 file_size_bytes, mime_type, uploaded_by_speaker, uploaded_by_user_id,
                 upload_source, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, 'web_portal', 'uploading')",
            rusqlite::params![
                version_id,
                presentation_id,
                LOCAL_TENANT_ID,
                next_version_number,
                storage_key,
                input.p_filename,
                input.p_size,
                input.p_mime.as_deref().unwrap_or("application/octet-stream"),
                LOCAL_ADMIN_USER_ID,
            ],
        )?;

        // Audit
        let activity_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'user', ?4, 'upload_init_session', 'presentation_version', ?5, ?6)",
            rusqlite::params![
                activity_id,
                LOCAL_TENANT_ID,
                event_id,
                LOCAL_ADMIN_USER_ID,
                version_id,
                json!({ "file_name": input.p_filename, "size": input.p_size }).to_string(),
            ],
        )?;

        tx.commit()?;

        Ok(json!({
            "version_id": version_id,
            "presentation_id": presentation_id,
            "storage_key": storage_key,
            "bucket": "presentations",
        }))
    })
    .await??;

    Ok(Json(result))
}

// ── 2. init_upload_version_admin(p_speaker_id, p_filename, p_size, p_mime) ─────────
// Variante "by speaker" della init: presentation 1:1 con speaker (UNIQUE INDEX).

#[derive(Deserialize)]
struct InitForSpeakerInput {
    p_speaker_id: String,
    p_filename: String,
    p_size: i64,
    #[serde(default)]
    p_mime: Option<String>,
}

async fn init_upload_for_speaker(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<InitForSpeakerInput>,
) -> AppResult<Json<Value>> {
    if input.p_size <= 0 {
        return Err(AppError::BadRequest("invalid_size".into()));
    }
    if input.p_filename.trim().is_empty() || input.p_filename.len() > 255 {
        return Err(AppError::BadRequest("invalid_filename".into()));
    }

    let pool = state.db.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let (session_id, event_id) = tx.query_row::<(String, String), _, _>(
            "SELECT session_id, event_id FROM speakers WHERE id = ?1 AND tenant_id = ?2",
            [&input.p_speaker_id, LOCAL_TENANT_ID],
            |r| Ok((r.get(0)?, r.get(1)?)),
        ).map_err(|_| AppError::NotFound("speaker_not_found".into()))?;

        // UPSERT idempotente su `presentations(speaker_id)` UNIQUE.
        let presentation_id: String = match tx.query_row(
            "SELECT id FROM presentations WHERE speaker_id = ?1",
            [&input.p_speaker_id],
            |r| r.get::<_, String>(0),
        ) {
            Ok(id) => id,
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                let new_id = Uuid::new_v4().to_string();
                tx.execute(
                    "INSERT INTO presentations (id, speaker_id, session_id, event_id, tenant_id, status)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'pending')",
                    rusqlite::params![new_id, input.p_speaker_id, session_id, event_id, LOCAL_TENANT_ID],
                )?;
                new_id
            }
            Err(e) => return Err(e.into()),
        };

        let version_id = Uuid::new_v4().to_string();
        let safe_name = sanitize_storage_segment(&input.p_filename);
        let storage_key = format!("{LOCAL_TENANT_ID}/{event_id}/{presentation_id}/{version_id}-{safe_name}");
        let next_version_number = tx.query_row(
            "SELECT COALESCE(MAX(version_number), 0) + 1 FROM presentation_versions
              WHERE presentation_id = ?1",
            [&presentation_id],
            |r| r.get::<_, i64>(0),
        )?;
        tx.execute(
            "INSERT INTO presentation_versions
                (id, presentation_id, tenant_id, version_number, storage_key, file_name,
                 file_size_bytes, mime_type, uploaded_by_speaker, uploaded_by_user_id,
                 upload_source, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9, 'web_portal', 'uploading')",
            rusqlite::params![
                version_id,
                presentation_id,
                LOCAL_TENANT_ID,
                next_version_number,
                storage_key,
                input.p_filename,
                input.p_size,
                input.p_mime.as_deref().unwrap_or("application/octet-stream"),
                LOCAL_ADMIN_USER_ID,
            ],
        )?;

        tx.commit()?;

        Ok(json!({
            "version_id": version_id,
            "presentation_id": presentation_id,
            "storage_key": storage_key,
            "bucket": "presentations",
        }))
    })
    .await??;

    Ok(Json(result))
}

// ── 3. finalize_upload_version_admin(p_version_id, p_sha256) ─────────────────
// Promuove status uploading → ready. Verifica esistenza file binario sul filesystem.

#[derive(Deserialize)]
struct FinalizeInput {
    p_version_id: String,
    p_sha256: String,
}

async fn finalize_upload(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<FinalizeInput>,
) -> AppResult<Json<Value>> {
    if input.p_sha256.len() != 64 || !input.p_sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest("invalid_sha256".into()));
    }

    // 1) Leggi storage_key e file_size_bytes corrente dal DB.
    let pool = state.db.clone();
    let storage_root: PathBuf = state.storage_root.clone();
    let version_id_clone = input.p_version_id.clone();
    // Sprint N1: serve un secondo clone perche' `input.p_sha256` viene mosso
    // nella closure (UPDATE + activity_log) ma serve poi nel `build_file_added`
    // per il payload del fan-out.
    let sha256_for_push = input.p_sha256.clone();
    let version_id_for_push = input.p_version_id.clone();

    // Sprint N1: post-finalize raccogliamo le info necessarie al fan-out cosi'
    // dopo il `spawn_blocking` possiamo lanciare `notify_paired_devices` senza
    // richiedere un'altra query DB.
    struct FinalizeMeta {
        event_id: String,
        room_id: Option<String>,
        presentation_id: String,
        file_name: String,
        file_size: i64,
        mime_type: String,
        storage_key: String,
    }
    let (result, meta) = tokio::task::spawn_blocking(move || -> AppResult<(Value, FinalizeMeta)> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let (presentation_id, storage_key, status, declared_size, file_name, mime_type): (String, String, String, i64, String, String) = tx
            .query_row(
                "SELECT presentation_id, storage_key, status, file_size_bytes,
                        COALESCE(file_name, ''), COALESCE(mime_type, 'application/octet-stream')
                 FROM presentation_versions WHERE id = ?1 AND tenant_id = ?2",
                [&version_id_clone, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .map_err(|_| AppError::NotFound("version_not_found".into()))?;

        if status != "uploading" {
            return Err(AppError::Conflict("version_not_uploading".into()));
        }

        // Verifica esistenza file binario. La size reale potrebbe differire da quella dichiarata.
        let file_path = storage_root.join("presentations").join(&storage_key);
        let meta_fs = std::fs::metadata(&file_path)
            .map_err(|_| AppError::BadRequest("object_missing".into()))?;
        let actual_size = meta_fs.len() as i64;

        tx.execute(
            "UPDATE presentation_versions
                SET status = 'ready',
                    file_hash_sha256 = ?1,
                    file_size_bytes = ?2
              WHERE id = ?3",
            rusqlite::params![input.p_sha256, actual_size, version_id_clone],
        )?;

        // Bumpa current_version_id e supersede le altre versioni 'ready'
        tx.execute(
            "UPDATE presentations
                SET current_version_id = ?1,
                    total_versions = total_versions + 1,
                    status = CASE WHEN status = 'pending' THEN 'uploaded' ELSE status END
              WHERE id = ?2",
            rusqlite::params![version_id_clone, presentation_id],
        )?;
        tx.execute(
            "UPDATE presentation_versions
                SET status = 'superseded'
              WHERE presentation_id = ?1
                AND id <> ?2
                AND status = 'ready'",
            rusqlite::params![presentation_id, version_id_clone],
        )?;

        // Storage accounting (best-effort, su tenant locale e' irrilevante).
        let _ = declared_size;

        // Lookup event_id + room_id (per fan-out scope: solo i sala paired
        // dell'evento ricevono la notifica). room_id puo' essere NULL se la
        // presentation non ha ancora una sessione assegnata: il sala filtra.
        let (event_id, room_id): (String, Option<String>) = tx
            .query_row(
                "SELECT p.event_id, s.room_id
                   FROM presentations p
                   LEFT JOIN sessions s ON s.id = p.session_id
                  WHERE p.id = ?1",
                [&presentation_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )?;
        let activity_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'user', ?4, 'upload_finalize', 'presentation_version', ?5, ?6)",
            rusqlite::params![
                activity_id,
                LOCAL_TENANT_ID,
                event_id,
                LOCAL_ADMIN_USER_ID,
                version_id_clone,
                json!({ "sha256": input.p_sha256, "size": actual_size }).to_string(),
            ],
        )?;

        tx.commit()?;
        let response = json!({ "ok": true, "version_id": version_id_clone });
        let meta = FinalizeMeta {
            event_id,
            room_id,
            presentation_id,
            file_name,
            file_size: actual_size,
            mime_type,
            storage_key,
        };
        Ok((response, meta))
    })
    .await??;

    // Sprint N1: fan-out fire-and-forget verso i PC sala paired di questo event_id.
    // Best-effort: errori solo loggati (vedi `lan_push.rs`). NON aspettiamo:
    // l'admin SPA riceve la response del finalize prima che il push parta.
    let push_state = state.clone();
    let push_event_id = meta.event_id.clone();
    let payload = build_file_added(crate::server::lan_push::FileAddedArgs {
        event_id: meta.event_id,
        room_id: meta.room_id,
        version_id: version_id_for_push,
        presentation_id: meta.presentation_id,
        file_name: meta.file_name,
        file_size_bytes: meta.file_size,
        mime_type: meta.mime_type,
        file_hash_sha256: Some(sha256_for_push),
        storage_key: meta.storage_key,
        admin_base_url: push_state.admin_base_url(),
    });
    tokio::spawn(async move {
        notify_paired_devices(&push_state, push_event_id, payload).await;
    });

    Ok(Json(result))
}

// ── 4. abort_upload_version_admin(p_version_id) ──────────────────────────────

#[derive(Deserialize)]
struct AbortInput {
    p_version_id: String,
}

async fn abort_upload(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<AbortInput>,
) -> AppResult<Json<Value>> {
    let pool = state.db.clone();
    let storage_root: PathBuf = state.storage_root.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let conn = pool.get()?;
        // Best-effort: leggiamo storage_key per cancellare il file orfano dal disco.
        let storage_key: Option<String> = conn
            .query_row(
                "SELECT storage_key FROM presentation_versions
                  WHERE id = ?1 AND tenant_id = ?2 AND status = 'uploading'",
                [&input.p_version_id, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .ok();
        conn.execute(
            "UPDATE presentation_versions
                SET status = 'failed'
              WHERE id = ?1 AND tenant_id = ?2 AND status = 'uploading'",
            [&input.p_version_id, LOCAL_TENANT_ID],
        )?;
        if let Some(key) = storage_key {
            let path = storage_root.join("presentations").join(&key);
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    })
    .await??;
    Ok(Json(json!({ "ok": true })))
}

// ── 5. delete_presentation_admin(p_presentation_id) ──────────────────────────

#[derive(Deserialize)]
struct DeletePresentationInput {
    p_presentation_id: String,
}

async fn delete_presentation(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<DeletePresentationInput>,
) -> AppResult<Json<Value>> {
    let pool = state.db.clone();
    let storage_root: PathBuf = state.storage_root.clone();
    let presentation_id_clone = input.p_presentation_id.clone();

    // Sprint N1: oltre alla risposta JSON, raccogliamo (event_id, version_ids[])
    // per il fan-out `presentation_deleted` ai sala paired.
    struct DeleteMeta {
        event_id: String,
        version_ids: Vec<String>,
    }
    let (result, meta) = tokio::task::spawn_blocking(move || -> AppResult<(Value, DeleteMeta)> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        // Raccogli (storage_key, version_id) da cancellare a fine transazione.
        let versions: Vec<(String, String)> = {
            let mut stmt = tx.prepare(
                "SELECT storage_key, id FROM presentation_versions
                  WHERE presentation_id = ?1 AND tenant_id = ?2",
            )?;
            let rows = stmt.query_map([&presentation_id_clone, LOCAL_TENANT_ID], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            rows.filter_map(Result::ok).collect()
        };
        let storage_keys: Vec<String> = versions.iter().map(|(k, _)| k.clone()).collect();
        let version_ids: Vec<String> = versions.iter().map(|(_, v)| v.clone()).collect();

        // Verifica esistenza presentation
        let event_id: String = tx
            .query_row(
                "SELECT event_id FROM presentations WHERE id = ?1 AND tenant_id = ?2",
                [&presentation_id_clone, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound("presentation_not_found".into()))?;

        // Bonifica room_state (FK ON DELETE SET NULL gia' lo fa, ma esplicito per chiarezza)
        tx.execute(
            "UPDATE room_state SET current_presentation_id = NULL, current_version_id = NULL
              WHERE current_presentation_id = ?1",
            [&presentation_id_clone],
        )?;

        // Cascade: presentation_versions ON DELETE CASCADE → spariscono insieme.
        tx.execute(
            "DELETE FROM presentations WHERE id = ?1 AND tenant_id = ?2",
            [&presentation_id_clone, LOCAL_TENANT_ID],
        )?;

        // Audit
        let activity_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'user', ?4, 'delete_presentation', 'presentation', ?5, ?6)",
            rusqlite::params![
                activity_id,
                LOCAL_TENANT_ID,
                event_id,
                LOCAL_ADMIN_USER_ID,
                presentation_id_clone,
                json!({ "storage_keys_removed": storage_keys.len() }).to_string(),
            ],
        )?;
        tx.commit()?;

        // Cleanup file dal disco fuori dalla transazione DB
        for key in storage_keys.iter() {
            let path = storage_root.join("presentations").join(key);
            let _ = std::fs::remove_file(path);
        }

        let response = json!({
            "ok": true,
            "presentation_id": presentation_id_clone,
            "files_removed": storage_keys.len(),
        });
        Ok((response, DeleteMeta { event_id, version_ids }))
    })
    .await??;

    // Sprint N1: fan-out delete ai sala paired. Idem fire-and-forget.
    let push_state = state.clone();
    let push_event_id = meta.event_id.clone();
    let payload = build_presentation_deleted(meta.event_id, input.p_presentation_id.clone(), meta.version_ids);
    tokio::spawn(async move {
        notify_paired_devices(&push_state, push_event_id, payload).await;
    });

    Ok(Json(result))
}

// ── 6. rename_paired_device_by_token(p_token, p_name) ────────────────────────
// Equivalente alla RPC SECURITY DEFINER del cloud (vedi `room-player-rename`).
// Non richiede admin auth (il token e' la prova di possesso del device).

#[derive(Deserialize)]
struct RenameInput {
    p_token: String,
    p_name: String,
}

async fn rename_device(
    State(state): State<AppState>,
    Json(input): Json<RenameInput>,
) -> AppResult<Json<Value>> {
    let new_name = input.p_name.trim();
    if new_name.is_empty() || new_name.len() > 80 {
        return Err(AppError::BadRequest("invalid_name".into()));
    }
    let device = resolve_device(&state, &input.p_token).await?;
    let device_id_for_response = device.id.clone();

    let pool = state.db.clone();
    let new_name_owned = new_name.to_string();
    let device_id_for_update = device.id;
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE paired_devices SET device_name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE id = ?2",
            [&new_name_owned, &device_id_for_update],
        )?;
        Ok(())
    })
    .await??;

    Ok(Json(json!({
        "ok": true,
        "device_id": device_id_for_response,
        "device_name": new_name,
    })))
}

// ── 7. rpc_room_player_set_current(p_token, p_presentation_id) ───────────────
// Aggiorna `room_state.current_presentation_id` validando che la presentation
// appartenga alla stessa sala del device (no cross-room).

#[derive(Deserialize)]
struct SetCurrentInput {
    p_token: String,
    #[serde(default)]
    p_presentation_id: Option<String>,
}

async fn room_player_set_current(
    State(state): State<AppState>,
    Json(input): Json<SetCurrentInput>,
) -> AppResult<Json<Value>> {
    let device = resolve_device(&state, &input.p_token).await?;
    let room_id = device
        .room_id
        .clone()
        .ok_or_else(|| AppError::Conflict("device_not_in_room".into()))?;

    let pool = state.db.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        if let Some(pres_id) = input.p_presentation_id.as_ref() {
            // Verifica appartenenza alla sala.
            let session_room: Option<String> = tx
                .query_row(
                    "SELECT s.room_id FROM presentations p
                       JOIN sessions s ON s.id = p.session_id
                      WHERE p.id = ?1 AND p.tenant_id = ?2 AND p.event_id = ?3",
                    [pres_id, LOCAL_TENANT_ID, &device.event_id],
                    |r| r.get(0),
                )
                .ok();
            let room_id_check = session_room
                .ok_or_else(|| AppError::NotFound("presentation_not_in_event".into()))?;
            if room_id_check != room_id {
                return Err(AppError::Forbidden("presentation_not_in_device_room".into()));
            }
            tx.execute(
                "UPDATE room_state
                    SET current_presentation_id = ?1,
                        last_play_started_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE room_id = ?2",
                [pres_id, &room_id],
            )?;
        } else {
            tx.execute(
                "UPDATE room_state
                    SET current_presentation_id = NULL,
                        last_play_started_at = NULL,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE room_id = ?1",
                [&room_id],
            )?;
        }

        // Audit log (best-effort)
        let _ = upsert_room_state(&tx, &room_id);
        let activity_id = Uuid::new_v4().to_string();
        let _ = tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'agent', ?4, 'room_now_playing', 'room', ?5, ?6)",
            rusqlite::params![
                activity_id,
                LOCAL_TENANT_ID,
                device.event_id,
                device.id,
                room_id,
                json!({
                    "device_id": device.id,
                    "presentation_id": input.p_presentation_id,
                }).to_string(),
            ],
        );

        tx.commit()?;
        Ok(json!({
            "ok": true,
            "room_id": room_id,
            "presentation_id": input.p_presentation_id,
        }))
    })
    .await??;
    Ok(Json(result))
}

/// Garantisce che una riga `room_state` esista per la sala (idempotente). Necessario
/// perche' la migration cloud crea le righe via trigger, qui no: lo facciamo on-demand.
fn upsert_room_state(conn: &Connection, room_id: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO room_state (room_id, tenant_id) VALUES (?1, ?2)
         ON CONFLICT(room_id) DO NOTHING",
        [room_id, LOCAL_TENANT_ID],
    )?;
    Ok(())
}

// ── 8. rpc_move_presentation_to_session(p_presentation_id, p_target_session_id) ──
// Sposta una presentation tra sessioni dello stesso evento. Resetta speaker_id=NULL.
// Allineato a migration `20260418020000_move_presentation_to_session.sql`.

#[derive(Deserialize)]
struct MoveToSessionInput {
    p_presentation_id: String,
    p_target_session_id: String,
}

async fn move_presentation_to_session(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<MoveToSessionInput>,
) -> AppResult<Json<Value>> {
    let pool = state.db.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let (current_session, current_event): (String, String) = tx
            .query_row(
                "SELECT session_id, event_id FROM presentations
                  WHERE id = ?1 AND tenant_id = ?2",
                [&input.p_presentation_id, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| AppError::NotFound("presentation_not_found".into()))?;

        if current_session == input.p_target_session_id {
            return Ok(json!({ "ok": true, "skipped": true, "reason": "same_session_no_op" }));
        }

        let target_event: String = tx
            .query_row(
                "SELECT event_id FROM sessions WHERE id = ?1 AND tenant_id = ?2",
                [&input.p_target_session_id, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound("target_session_not_found".into()))?;

        if target_event != current_event {
            return Err(AppError::BadRequest("cross_event_move_not_allowed".into()));
        }

        tx.execute(
            "UPDATE presentations
                SET session_id = ?1,
                    speaker_id = NULL,
                    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
              WHERE id = ?2",
            [&input.p_target_session_id, &input.p_presentation_id],
        )?;

        let activity_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'user', ?4, 'move_presentation_to_session', 'presentation', ?5, ?6)",
            rusqlite::params![
                activity_id,
                LOCAL_TENANT_ID,
                current_event,
                LOCAL_ADMIN_USER_ID,
                input.p_presentation_id,
                json!({
                    "from_session_id": current_session,
                    "to_session_id": input.p_target_session_id,
                }).to_string(),
            ],
        )?;
        tx.commit()?;

        Ok(json!({
            "ok": true,
            "presentation_id": input.p_presentation_id,
            "session_id": input.p_target_session_id,
        }))
    })
    .await??;
    Ok(Json(result))
}

// ── 9. update_device_role(p_device_id, p_new_role) — Sprint D4 ──────────────
// Port 1:1 della RPC cloud `public.update_device_role` (Sprint S-4).
//
// Promuove un device a 'control_center' (room_id forzato a NULL) o lo
// riporta a 'room' (room_id rimane com'e', l'admin lo riassegna via
// drag&drop). Bumpa `updated_at` per invalidare la SWR cache nella SPA.
//
// Differenze cloud → desktop:
//   • niente `app_tenant_id()`: usiamo `LOCAL_TENANT_ID` come unico tenant.
//   • niente `is_super_admin()`: in modalita desktop solo l'admin locale
//     accede via `AdminAuth` (token in `Authorization: Bearer`).
//   • niente `RETURNS TABLE`: ritorna direttamente `{ id, role, room_id }`.

#[derive(Deserialize)]
struct UpdateDeviceRoleInput {
    p_device_id: String,
    p_new_role: String,
}

async fn update_device_role(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<UpdateDeviceRoleInput>,
) -> AppResult<Json<Value>> {
    if input.p_new_role != "room" && input.p_new_role != "control_center" {
        return Err(AppError::BadRequest(format!(
            "invalid_role: {}",
            input.p_new_role
        )));
    }

    let pool = state.db.clone();
    let device_id_for_response = input.p_device_id.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        // Verifica esistenza device + isolamento tenant.
        let exists: Option<String> = tx
            .query_row(
                "SELECT id FROM paired_devices WHERE id = ?1 AND tenant_id = ?2",
                [&input.p_device_id, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .ok();
        if exists.is_none() {
            return Err(AppError::NotFound("device_not_found".into()));
        }

        // Quando role='control_center' forziamo room_id=NULL (un Centro Slide
        // non e' assegnato a una singola sala specifica).
        if input.p_new_role == "control_center" {
            tx.execute(
                "UPDATE paired_devices
                    SET role = 'control_center',
                        room_id = NULL,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE id = ?1 AND tenant_id = ?2",
                [&input.p_device_id, LOCAL_TENANT_ID],
            )?;
        } else {
            tx.execute(
                "UPDATE paired_devices
                    SET role = 'room',
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE id = ?1 AND tenant_id = ?2",
                [&input.p_device_id, LOCAL_TENANT_ID],
            )?;
        }

        let (role, room_id): (String, Option<String>) = tx.query_row(
            "SELECT role, room_id FROM paired_devices WHERE id = ?1 AND tenant_id = ?2",
            [&input.p_device_id, LOCAL_TENANT_ID],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        let activity_id = Uuid::new_v4().to_string();
        let _ = tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             SELECT ?1, ?2, pd.event_id, 'user', ?3, 'update_device_role', 'paired_device', ?4, ?5
               FROM paired_devices pd WHERE pd.id = ?4",
            rusqlite::params![
                activity_id,
                LOCAL_TENANT_ID,
                LOCAL_ADMIN_USER_ID,
                input.p_device_id,
                json!({ "new_role": input.p_new_role }).to_string(),
            ],
        );

        tx.commit()?;
        Ok(json!({
            "id": device_id_for_response,
            "role": role,
            "room_id": room_id,
        }))
    })
    .await??;
    Ok(Json(result))
}

/// Sanitize identico a `regexp_replace(..., '[^A-Za-z0-9._-]', '_', 'g')` Postgres.
fn sanitize_storage_segment(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '_' | '-' => c,
            _ => '_',
        })
        .collect()
}
