// Sprint W C1 — Folder routes per File Explorer V2 (port di cloud Sprint U-2/U-3).
//
// Espone in modalita' desktop offline il MEDESIMO contratto API del cloud per
// gestire la gerarchia `event_folders` e le operazioni di organizzazione file:
//   • REST CRUD `/rest/v1/event_folders` (GET/POST/PATCH/DELETE) + filtri
//     PostgREST minimal (solo i campi indispensabili usati dalla SPA).
//   • RPC `/rest/v1/rpc/move_presentations_to_folder` — sposta N
//     presentations in una folder (o in root) atomicamente, con scoping
//     event_id (no cross-event).
//   • RPC `/rest/v1/rpc/rename_presentation_version_file_name` — rinomina
//     display name di una version (storage_key non viene toccato).
//
// Differenze cloud → desktop:
//   • niente RLS / `auth.jwt()`: tenant fisso `LOCAL_TENANT_ID`,
//     attore `LOCAL_ADMIN_USER_ID`.
//   • niente `app_user_role()`: l'AdminAuth equivale ad `admin`.
//   • niente UNIQUE NULLS NOT DISTINCT (Postgres 15+); su SQLite l'unicita'
//     `(event_id, parent_id, name)` e' garantita dall'unique index della
//     migration 0004 con sentinel root su `parent_id`.
//
// Push LAN (Sprint W C3):
//   ogni mutazione genera un push fire-and-forget verso i sala paired
//   (vedi `lan_push.rs::build_folder_*`).

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::Method,
    routing::{any, post},
    Json, Router,
};
use rusqlite::params;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::server::{
    auth::AdminAuth,
    db::{LOCAL_ADMIN_USER_ID, LOCAL_TENANT_ID},
    error::{AppError, AppResult},
    lan_push::{
        build_folder_created, build_folder_deleted, build_folder_renamed,
        build_presentations_moved_to_folder, notify_paired_devices,
    },
    state::AppState,
};

const MAX_FOLDER_NAME_LEN: usize = 200;
const MAX_FILE_NAME_LEN: usize = 255;
const MAX_BATCH_MOVE: usize = 500;

pub fn routes() -> Router<AppState> {
    Router::new()
        // REST CRUD montato sotto `/rest/v1/event_folders`.
        // Il prefisso `/rest/v1` viene applicato in `server::mod::build_router`.
        .route("/event_folders", any(folders_collection))
        .route("/event_folders/:id", any(folder_item))
        .route(
            "/rpc/move_presentations_to_folder",
            post(rpc_move_presentations_to_folder),
        )
        .route(
            "/rpc/rename_presentation_version_file_name",
            post(rpc_rename_presentation_version_file_name),
        )
}

// ════════════════════════════════════════════════════════════════════════════
// REST CRUD: /rest/v1/event_folders
// ════════════════════════════════════════════════════════════════════════════

async fn folders_collection(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    method: Method,
    body: Option<Json<Value>>,
) -> AppResult<Json<Value>> {
    match method {
        Method::GET => list_folders(&state, &query).await.map(Json),
        Method::POST => {
            let body = body.ok_or_else(|| AppError::BadRequest("missing body".into()))?.0;
            create_folder(&state, body).await.map(Json)
        }
        _ => Err(AppError::BadRequest(format!(
            "method not allowed on /event_folders: {method}"
        ))),
    }
}

async fn folder_item(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Path(id): Path<String>,
    method: Method,
    body: Option<Json<Value>>,
) -> AppResult<Json<Value>> {
    match method {
        Method::PATCH => {
            let body = body.ok_or_else(|| AppError::BadRequest("missing body".into()))?.0;
            update_folder(&state, &id, body).await.map(Json)
        }
        Method::DELETE => delete_folder(&state, &id).await.map(Json),
        Method::GET => get_folder_one(&state, &id).await.map(Json),
        _ => Err(AppError::BadRequest(format!(
            "method not allowed on /event_folders/{{id}}: {method}"
        ))),
    }
}

async fn list_folders(state: &AppState, query: &HashMap<String, String>) -> AppResult<Value> {
    // Filtro minimal PostgREST: supportiamo `event_id=eq.<uuid>` perche'
    // e' il solo che la SPA usa per popolare il tree del File Explorer V2.
    let event_id = query
        .get("event_id")
        .and_then(|v| v.strip_prefix("eq."))
        .map(|s| s.to_string());

    let pool = state.db.clone();
    let rows = tokio::task::spawn_blocking(move || -> AppResult<Vec<Value>> {
        let conn = pool.get()?;
        let (sql, binds): (&str, Vec<String>) = match event_id {
            Some(eid) => (
                "SELECT id, tenant_id, event_id, parent_id, name, created_at, updated_at, created_by
                 FROM event_folders
                 WHERE tenant_id = ?1 AND event_id = ?2
                 ORDER BY parent_id NULLS FIRST, name COLLATE NOCASE",
                vec![LOCAL_TENANT_ID.to_string(), eid],
            ),
            None => (
                "SELECT id, tenant_id, event_id, parent_id, name, created_at, updated_at, created_by
                 FROM event_folders
                 WHERE tenant_id = ?1
                 ORDER BY event_id, parent_id NULLS FIRST, name COLLATE NOCASE",
                vec![LOCAL_TENANT_ID.to_string()],
            ),
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(binds.iter()), |r| {
            Ok(json!({
                "id":          r.get::<_, String>(0)?,
                "tenant_id":   r.get::<_, String>(1)?,
                "event_id":    r.get::<_, String>(2)?,
                "parent_id":   r.get::<_, Option<String>>(3)?,
                "name":        r.get::<_, String>(4)?,
                "created_at":  r.get::<_, String>(5)?,
                "updated_at":  r.get::<_, String>(6)?,
                "created_by":  r.get::<_, Option<String>>(7)?,
            }))
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    })
    .await??;
    Ok(Value::Array(rows))
}

async fn get_folder_one(state: &AppState, id: &str) -> AppResult<Value> {
    let pool = state.db.clone();
    let id = id.to_string();
    let row = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = pool.get()?;
        let v = conn
            .query_row(
                "SELECT id, tenant_id, event_id, parent_id, name, created_at, updated_at, created_by
                 FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
                params![id, LOCAL_TENANT_ID],
                |r| {
                    Ok(json!({
                        "id":          r.get::<_, String>(0)?,
                        "tenant_id":   r.get::<_, String>(1)?,
                        "event_id":    r.get::<_, String>(2)?,
                        "parent_id":   r.get::<_, Option<String>>(3)?,
                        "name":        r.get::<_, String>(4)?,
                        "created_at":  r.get::<_, String>(5)?,
                        "updated_at":  r.get::<_, String>(6)?,
                        "created_by":  r.get::<_, Option<String>>(7)?,
                    }))
                },
            )
            .map_err(|_| AppError::NotFound("folder_not_found".into()))?;
        Ok(v)
    })
    .await??;
    Ok(row)
}

#[derive(Debug, Deserialize)]
struct CreateFolderInput {
    event_id: String,
    name: String,
    #[serde(default)]
    parent_id: Option<String>,
}

async fn create_folder(state: &AppState, body: Value) -> AppResult<Value> {
    let input: CreateFolderInput = serde_json::from_value(body)
        .map_err(|e| AppError::BadRequest(format!("invalid create body: {e}")))?;
    let clean = sanitize_name(&input.name, MAX_FOLDER_NAME_LEN)?;
    let id = Uuid::new_v4().to_string();
    let id_for_db = id.clone();
    let event_id_for_db = input.event_id.clone();
    let parent_id_for_db = input.parent_id.clone();
    let clean_for_db = clean.clone();

    let pool = state.db.clone();
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let conn = pool.get()?;
        // Verifica esistenza evento + tenant scoping.
        let _: String = conn
            .query_row(
                "SELECT id FROM events WHERE id = ?1 AND tenant_id = ?2",
                params![event_id_for_db, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound("event_not_found".into()))?;

        // Se parent_id != NULL, deve appartenere allo stesso evento.
        if let Some(pid) = parent_id_for_db.as_ref() {
            let parent_event: Option<String> = conn
                .query_row(
                    "SELECT event_id FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
                    params![pid, LOCAL_TENANT_ID],
                    |r| r.get(0),
                )
                .ok();
            match parent_event {
                Some(ev) if ev == event_id_for_db => {}
                Some(_) => return Err(AppError::BadRequest("parent_in_different_event".into())),
                None => return Err(AppError::NotFound("parent_not_found".into())),
            }
        }

        // L'unique index `uq_event_folders_name_per_parent` (migration 0004)
        // garantisce duplicati case-insensitive sullo stesso parent.
        let result = conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id_for_db,
                LOCAL_TENANT_ID,
                event_id_for_db,
                parent_id_for_db,
                clean_for_db,
                LOCAL_ADMIN_USER_ID,
            ],
        );
        if let Err(rusqlite::Error::SqliteFailure(_, Some(msg))) = &result {
            if msg.contains("UNIQUE constraint failed") {
                return Err(AppError::Conflict("folder_name_already_exists".into()));
            }
        }
        result.map_err(AppError::from).map(|_| ())
    })
    .await??;

    // Push LAN fire-and-forget.
    spawn_folder_push(
        state,
        input.event_id.clone(),
        build_folder_created(input.event_id.clone(), id.clone(), input.parent_id, clean.clone()),
    );

    Ok(json!({
        "id": id,
        "tenant_id": LOCAL_TENANT_ID,
        "event_id": input.event_id,
        "name": clean,
    }))
}

#[derive(Debug, Deserialize)]
struct UpdateFolderInput {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    parent_id: Option<Option<String>>,
}

async fn update_folder(state: &AppState, id: &str, body: Value) -> AppResult<Value> {
    let input: UpdateFolderInput = serde_json::from_value(body)
        .map_err(|e| AppError::BadRequest(format!("invalid update body: {e}")))?;
    if input.name.is_none() && input.parent_id.is_none() {
        return Err(AppError::BadRequest("nothing_to_update".into()));
    }
    let id_owned = id.to_string();
    let id_for_push = id.to_string();

    // Carica event_id + nome corrente per push payload + cycle check.
    let pool = state.db.clone();
    let id_load = id_owned.clone();
    let (event_id, current_name): (String, String) = tokio::task::spawn_blocking(move || -> AppResult<(String, String)> {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT event_id, name FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
            params![id_load, LOCAL_TENANT_ID],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        )
        .map_err(|_| AppError::NotFound("folder_not_found".into()))
    })
    .await??;

    let mut new_name_for_push: Option<String> = None;

    // 1) rinomina
    if let Some(raw_name) = input.name.as_ref() {
        let clean = sanitize_name(raw_name, MAX_FOLDER_NAME_LEN)?;
        new_name_for_push = Some(clean.clone());
        if clean != current_name {
            let pool = state.db.clone();
            let id_rename = id_owned.clone();
            tokio::task::spawn_blocking(move || -> AppResult<()> {
                let conn = pool.get()?;
                let result = conn.execute(
                    "UPDATE event_folders
                        SET name = ?1,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                      WHERE id = ?2 AND tenant_id = ?3",
                    params![clean, id_rename, LOCAL_TENANT_ID],
                );
                if let Err(rusqlite::Error::SqliteFailure(_, Some(msg))) = &result {
                    if msg.contains("UNIQUE constraint failed") {
                        return Err(AppError::Conflict("folder_name_already_exists".into()));
                    }
                }
                result.map_err(AppError::from).map(|_| ())
            })
            .await??;
        }
    }

    // 2) sposta sotto un altro parent (con cycle check)
    if let Some(new_parent) = input.parent_id {
        let pool = state.db.clone();
        let id_move = id_owned.clone();
        let event_id_move = event_id.clone();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let conn = pool.get()?;
            if let Some(pid) = new_parent.as_ref() {
                if pid == &id_move {
                    return Err(AppError::BadRequest("cannot_set_self_as_parent".into()));
                }
                // Verifica parent appartenenza allo stesso evento.
                let parent_event: Option<String> = conn
                    .query_row(
                        "SELECT event_id FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
                        params![pid, LOCAL_TENANT_ID],
                        |r| r.get(0),
                    )
                    .ok();
                match parent_event {
                    Some(ev) if ev == event_id_move => {}
                    Some(_) => return Err(AppError::BadRequest("parent_in_different_event".into())),
                    None => return Err(AppError::NotFound("parent_not_found".into())),
                }
                // Cycle detection: salendo da pid via parent_id non deve
                // incrociare id_move (max 50 hop, sufficiente).
                let mut cursor: Option<String> = Some(pid.clone());
                let mut hops = 0;
                while let Some(c) = cursor {
                    if c == id_move {
                        return Err(AppError::BadRequest("cycle_detected".into()));
                    }
                    hops += 1;
                    if hops > 50 {
                        return Err(AppError::BadRequest("folder_depth_exceeded".into()));
                    }
                    cursor = conn
                        .query_row(
                            "SELECT parent_id FROM event_folders WHERE id = ?1",
                            params![c],
                            |r| r.get::<_, Option<String>>(0),
                        )
                        .ok()
                        .flatten();
                }
            }
            conn.execute(
                "UPDATE event_folders
                    SET parent_id = ?1,
                        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                  WHERE id = ?2 AND tenant_id = ?3",
                params![new_parent, id_move, LOCAL_TENANT_ID],
            )?;
            Ok(())
        })
        .await??;
    }

    // Push LAN per il rename (lo spostamento di parent non genera push
    // dedicato: le SPA sala leggono il tree completo al prossimo refresh).
    if let Some(new_name) = new_name_for_push {
        spawn_folder_push(
            state,
            event_id.clone(),
            build_folder_renamed(event_id.clone(), id_for_push, new_name),
        );
    }

    Ok(json!({ "ok": true }))
}

async fn delete_folder(state: &AppState, id: &str) -> AppResult<Value> {
    let id_owned = id.to_string();
    let id_for_push = id.to_string();
    let pool = state.db.clone();

    // Raccogli event_id + cascade ids prima del DELETE (FK CASCADE le elimina
    // ma a noi servono per il push payload "cascade_folder_ids").
    let (event_id, cascade_ids) = tokio::task::spawn_blocking(move || -> AppResult<(String, Vec<String>)> {
        let conn = pool.get()?;
        let event_id: String = conn
            .query_row(
                "SELECT event_id FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
                params![id_owned, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .map_err(|_| AppError::NotFound("folder_not_found".into()))?;

        // BFS della sotto-gerarchia: max 50 livelli.
        let mut cascade: Vec<String> = Vec::new();
        let mut frontier: Vec<String> = vec![id_owned.clone()];
        let mut hops = 0;
        while let Some(parent) = frontier.pop() {
            hops += 1;
            if hops > 5_000 {
                return Err(AppError::BadRequest("cascade_too_large".into()));
            }
            let mut stmt = conn.prepare(
                "SELECT id FROM event_folders WHERE parent_id = ?1 AND tenant_id = ?2",
            )?;
            let children: Vec<String> = stmt
                .query_map(params![parent, LOCAL_TENANT_ID], |r| r.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            for ch in &children {
                cascade.push(ch.clone());
            }
            frontier.extend(children);
        }

        conn.execute(
            "DELETE FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
            params![id_owned, LOCAL_TENANT_ID],
        )?;
        Ok((event_id, cascade))
    })
    .await??;

    spawn_folder_push(
        state,
        event_id.clone(),
        build_folder_deleted(event_id.clone(), id_for_push, cascade_ids.clone()),
    );

    Ok(json!({ "ok": true, "cascade_count": cascade_ids.len() }))
}

// ════════════════════════════════════════════════════════════════════════════
// RPC: move_presentations_to_folder
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
struct MovePresentationsInput {
    p_presentation_ids: Vec<String>,
    #[serde(default)]
    p_folder_id: Option<String>,
}

async fn rpc_move_presentations_to_folder(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<MovePresentationsInput>,
) -> AppResult<Json<Value>> {
    if input.p_presentation_ids.is_empty() {
        return Err(AppError::BadRequest("empty_presentation_ids".into()));
    }
    if input.p_presentation_ids.len() > MAX_BATCH_MOVE {
        return Err(AppError::BadRequest("too_many_presentations".into()));
    }

    let folder_id = input.p_folder_id.clone();
    let presentation_ids = input.p_presentation_ids.clone();
    let pool = state.db.clone();
    let count_event = tokio::task::spawn_blocking(move || -> AppResult<(i64, Option<String>)> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        // Se folder_id e' valorizzato, deve esistere e ritorna l'event_id;
        // se NULL → "muovi in root" → nessun evento di scope.
        let folder_event_id: Option<String> = if let Some(fid) = folder_id.as_ref() {
            let ev: Option<String> = tx
                .query_row(
                    "SELECT event_id FROM event_folders WHERE id = ?1 AND tenant_id = ?2",
                    params![fid, LOCAL_TENANT_ID],
                    |r| r.get(0),
                )
                .ok();
            if ev.is_none() {
                return Err(AppError::NotFound("folder_not_found".into()));
            }
            ev
        } else {
            None
        };

        let mut updated: i64 = 0;
        for pid in &presentation_ids {
            // Filtro tenant + (se folder_id != NULL) event_id matching.
            let n = if let Some(ev) = folder_event_id.as_ref() {
                tx.execute(
                    "UPDATE presentations
                        SET folder_id = ?1,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                      WHERE id = ?2 AND tenant_id = ?3 AND event_id = ?4",
                    params![folder_id, pid, LOCAL_TENANT_ID, ev],
                )?
            } else {
                tx.execute(
                    "UPDATE presentations
                        SET folder_id = NULL,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                      WHERE id = ?1 AND tenant_id = ?2",
                    params![pid, LOCAL_TENANT_ID],
                )?
            };
            updated += n as i64;
        }

        // Audit
        let activity_id = Uuid::new_v4().to_string();
        let audit_event_id = folder_event_id.clone().unwrap_or_else(|| String::new());
        let _ = tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'user', ?4, 'presentations.move_to_folder', 'event_folder', ?5, ?6)",
            params![
                activity_id,
                LOCAL_TENANT_ID,
                audit_event_id,
                LOCAL_ADMIN_USER_ID,
                folder_id,
                json!({
                    "presentation_ids": presentation_ids,
                    "folder_id": folder_id,
                    "count": updated,
                }).to_string(),
            ],
        );

        tx.commit()?;
        Ok((updated, folder_event_id))
    })
    .await??;

    let (count, folder_event_id) = count_event;

    // Risolvi un event_id "rappresentativo" per il push: se folder_id era NULL,
    // estraiamo l'event della prima presentation aggiornata.
    let push_event_id = match folder_event_id {
        Some(ev) => Some(ev),
        None => {
            let pool = state.db.clone();
            let pid_first = input.p_presentation_ids.first().cloned();
            tokio::task::spawn_blocking(move || -> AppResult<Option<String>> {
                let conn = pool.get()?;
                if let Some(pid) = pid_first {
                    let ev: Option<String> = conn
                        .query_row(
                            "SELECT event_id FROM presentations WHERE id = ?1 AND tenant_id = ?2",
                            params![pid, LOCAL_TENANT_ID],
                            |r| r.get(0),
                        )
                        .ok();
                    Ok(ev)
                } else {
                    Ok(None)
                }
            })
            .await??
        }
    };

    if let Some(ev) = push_event_id {
        spawn_folder_push(
            &state,
            ev.clone(),
            build_presentations_moved_to_folder(
                ev,
                input.p_folder_id.clone(),
                input.p_presentation_ids.clone(),
            ),
        );
    }

    Ok(Json(json!({ "ok": true, "count": count })))
}

// ════════════════════════════════════════════════════════════════════════════
// RPC: rename_presentation_version_file_name
// ════════════════════════════════════════════════════════════════════════════

#[derive(Debug, Deserialize)]
struct RenameVersionInput {
    p_version_id: String,
    p_new_name: String,
}

async fn rpc_rename_presentation_version_file_name(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<RenameVersionInput>,
) -> AppResult<Json<Value>> {
    let clean = sanitize_name(&input.p_new_name, MAX_FILE_NAME_LEN)?;
    let version_id = input.p_version_id.clone();
    let clean_for_db = clean.clone();

    let pool = state.db.clone();
    let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let (presentation_id, current_name): (String, String) = tx
            .query_row(
                "SELECT presentation_id, file_name FROM presentation_versions
                  WHERE id = ?1 AND tenant_id = ?2",
                params![version_id, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|_| AppError::NotFound("version_not_found".into()))?;

        if current_name == clean_for_db {
            // No-op idempotente.
            tx.commit()?;
            return Ok(json!({
                "ok": true,
                "version_id": version_id,
                "file_name": clean_for_db,
                "changed": false,
            }));
        }

        tx.execute(
            "UPDATE presentation_versions SET file_name = ?1 WHERE id = ?2",
            params![clean_for_db, version_id],
        )?;

        let activity_id = Uuid::new_v4().to_string();
        let event_id_for_audit: String = tx
            .query_row(
                "SELECT event_id FROM presentations WHERE id = ?1",
                params![presentation_id],
                |r| r.get(0),
            )
            .unwrap_or_default();
        let _ = tx.execute(
            "INSERT INTO activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
             VALUES (?1, ?2, ?3, 'user', ?4, 'rename_presentation_version', 'presentation_version', ?5, ?6)",
            params![
                activity_id,
                LOCAL_TENANT_ID,
                event_id_for_audit,
                LOCAL_ADMIN_USER_ID,
                version_id,
                json!({
                    "old_name": current_name,
                    "new_name": clean_for_db,
                    "presentation_id": presentation_id,
                }).to_string(),
            ],
        );

        tx.commit()?;
        Ok(json!({
            "ok": true,
            "version_id": version_id,
            "file_name": clean_for_db,
            "changed": true,
        }))
    })
    .await??;

    Ok(Json(result))
}

// ════════════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════════════

/// Sanitizzazione nome cartella/file allineata al cloud:
///   • trim,
///   • rimozione caratteri di controllo (\x00-\x1F),
///   • lunghezza 1..max_len.
fn sanitize_name(raw: &str, max_len: usize) -> AppResult<String> {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return Err(AppError::BadRequest("invalid_name_empty".into()));
    }
    if cleaned.chars().count() > max_len {
        return Err(AppError::BadRequest("invalid_name_too_long".into()));
    }
    Ok(cleaned)
}

/// Spawna il fan-out push fire-and-forget. `notify_paired_devices` filtra
/// internamente per `event_id` quando interroga `paired_devices`.
fn spawn_folder_push(state: &AppState, event_id: String, payload: crate::server::lan_events::LanEventPayload) {
    let push_state = state.clone();
    tokio::spawn(async move {
        notify_paired_devices(&push_state, event_id, payload).await;
    });
}

// ════════════════════════════════════════════════════════════════════════════
// Sprint W C4 — test integration su SQLite in-memory.
//
// Strategia:
//   • Apriamo una `Connection::open_in_memory()` e applichiamo MIGRATION_0001
//     (schema base + seed tenant) + MIGRATION_0004 (event_folders) + 0005.
//   • Eseguiamo direttamente gli SQL che le funzioni RPC eseguono in produzione,
//     verificando i comportamenti chiave: unique constraint, COALESCE root,
//     case-insensitive collision, FK cascade, slot folder_id nullable.
//   • NON costruiamo un `AppState` reale: troppe dipendenze (storage_root,
//     mDNS, license, ...). I test esercitano gli SQL e gli helper puri.
// ════════════════════════════════════════════════════════════════════════════
#[cfg(test)]
mod tests {
    use super::sanitize_name;
    use crate::server::db::{
        LOCAL_ADMIN_USER_ID, LOCAL_TENANT_ID, MIGRATION_0001, MIGRATION_0004, MIGRATION_0005,
    };
    use rusqlite::Connection;

    fn setup_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        // FK ON serve a testare il cascade; va attivato per-connection.
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn.execute_batch(MIGRATION_0001).unwrap();
        conn.execute_batch(MIGRATION_0004).unwrap();
        conn.execute_batch(MIGRATION_0005).unwrap();
        // Seed evento + room + sessione di test (tenant gia' seeded da 0001).
        conn.execute(
            "INSERT INTO events (id, tenant_id, name, start_date, end_date)
             VALUES ('event-1', ?1, 'Test Event', '2026-01-01', '2026-01-02')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rooms (id, event_id, tenant_id, name)
             VALUES ('room-1', 'event-1', ?1, 'Sala A')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, room_id, event_id, tenant_id, title, scheduled_start, scheduled_end)
             VALUES ('s1', 'room-1', 'event-1', ?1, 'Sess', '2026-01-01T09:00:00Z', '2026-01-01T10:00:00Z')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        conn
    }

    /// 1. `sanitize_name` regge gli edge case standardizzati.
    #[test]
    fn test_sanitize_name_edge_cases() {
        assert!(sanitize_name("", 100).is_err(), "stringa vuota deve fallire");
        assert!(sanitize_name("   ", 100).is_err(), "solo whitespace deve fallire");
        assert_eq!(sanitize_name("ok", 100).unwrap(), "ok");
        assert_eq!(sanitize_name("  spaced  ", 100).unwrap(), "spaced");
        assert_eq!(
            sanitize_name("with\x01\x07control", 100).unwrap(),
            "withcontrol",
            "i caratteri di controllo vengono filtrati"
        );
        let too_long = "a".repeat(201);
        assert!(
            sanitize_name(&too_long, 200).is_err(),
            "lunghezza > max_len deve fallire"
        );
    }

    /// 2. Indice unique su `(event_id, COALESCE(parent_id,...), name)` blocca
    /// duplicati in root con stesso nome → analogo cloud `UNIQUE NULLS NOT DISTINCT`.
    #[test]
    fn test_folder_unique_per_root() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('fA', ?1, 'event-1', NULL, 'Reports', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        )
        .unwrap();

        // Stesso nome stesso parent (NULL = root) → UNIQUE constraint failed.
        let res = conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('fB', ?1, 'event-1', NULL, 'Reports', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        );
        let err = res.unwrap_err().to_string();
        assert!(
            err.contains("UNIQUE constraint failed"),
            "atteso UNIQUE constraint failed, got: {err}"
        );
    }

    /// 3. Collation NOCASE blocca duplicati case-insensitive.
    #[test]
    fn test_folder_unique_case_insensitive() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('fA', ?1, 'event-1', NULL, 'reports', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        )
        .unwrap();

        // 'REPORTS' diverso solo per case → l'indice usa COLLATE NOCASE.
        let res = conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('fB', ?1, 'event-1', NULL, 'REPORTS', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        );
        assert!(res.is_err(), "atteso conflitto case-insensitive");
    }

    /// 4. Indice unique distingue parent diversi (root vs sotto-cartella).
    #[test]
    fn test_folder_same_name_different_parent_ok() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('parent', ?1, 'event-1', NULL, 'Top', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        )
        .unwrap();
        // 'Sub' in root
        conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('subRoot', ?1, 'event-1', NULL, 'Sub', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        )
        .unwrap();
        // 'Sub' dentro 'Top' → OK, parent_id diverso.
        let res = conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('subUnderTop', ?1, 'event-1', 'parent', 'Sub', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        );
        assert!(res.is_ok(), "stesso nome ma parent diverso deve passare");
    }

    /// 5. `presentations.folder_id` accetta valori e si resetta a NULL su
    /// cascade DELETE della cartella (FK ON DELETE SET NULL della migration 0004).
    #[test]
    fn test_presentation_folder_id_cascade_set_null() {
        let conn = setup_conn();
        conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('fA', ?1, 'event-1', NULL, 'Cartella', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO presentations (id, session_id, event_id, tenant_id, folder_id, status)
             VALUES ('p1', 's1', 'event-1', ?1, 'fA', 'pending')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        let folder_before: Option<String> = conn
            .query_row(
                "SELECT folder_id FROM presentations WHERE id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(folder_before, Some("fA".into()));

        conn.execute("DELETE FROM event_folders WHERE id = 'fA'", []).unwrap();

        let folder_after: Option<String> = conn
            .query_row(
                "SELECT folder_id FROM presentations WHERE id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            folder_after, None,
            "cascade ON DELETE SET NULL deve azzerare folder_id"
        );
    }

    /// 6. Move presentations con scoping event_id: la UPDATE non tocca
    /// presentations di event diversi anche se sono nel batch.
    #[test]
    fn test_move_presentations_respects_event_scope() {
        let conn = setup_conn();
        // Secondo evento + sua sessione + presentation
        conn.execute(
            "INSERT INTO events (id, tenant_id, name, start_date, end_date)
             VALUES ('event-2', ?1, 'Other Event', '2026-02-01', '2026-02-02')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO rooms (id, event_id, tenant_id, name)
             VALUES ('room-2', 'event-2', ?1, 'Sala B')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO sessions (id, room_id, event_id, tenant_id, title, scheduled_start, scheduled_end)
             VALUES ('s2', 'room-2', 'event-2', ?1, 'Sess2', '2026-02-01T09:00:00Z', '2026-02-01T10:00:00Z')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        // folder appartiene a event-1
        conn.execute(
            "INSERT INTO event_folders (id, tenant_id, event_id, parent_id, name, created_by)
             VALUES ('fEvent1', ?1, 'event-1', NULL, 'F1', ?2)",
            [LOCAL_TENANT_ID, LOCAL_ADMIN_USER_ID],
        )
        .unwrap();
        // Presentation A in event-1, B in event-2
        conn.execute(
            "INSERT INTO presentations (id, session_id, event_id, tenant_id, status)
             VALUES ('pA', 's1', 'event-1', ?1, 'pending')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO presentations (id, session_id, event_id, tenant_id, status)
             VALUES ('pB', 's2', 'event-2', ?1, 'pending')",
            [LOCAL_TENANT_ID],
        )
        .unwrap();

        // Simuliamo il move: WHERE event_id = ? blocca l'aggiornamento di pB.
        let n_a = conn
            .execute(
                "UPDATE presentations SET folder_id = ?1
                  WHERE id = ?2 AND tenant_id = ?3 AND event_id = ?4",
                rusqlite::params!["fEvent1", "pA", LOCAL_TENANT_ID, "event-1"],
            )
            .unwrap();
        let n_b = conn
            .execute(
                "UPDATE presentations SET folder_id = ?1
                  WHERE id = ?2 AND tenant_id = ?3 AND event_id = ?4",
                rusqlite::params!["fEvent1", "pB", LOCAL_TENANT_ID, "event-1"],
            )
            .unwrap();

        assert_eq!(n_a, 1, "pA appartiene all'evento giusto, deve aggiornarsi");
        assert_eq!(
            n_b, 0,
            "pB e' di event-2: lo scope event-1 nel WHERE non lo deve toccare"
        );

        // Verifica finale: pA ha folder, pB resta NULL.
        let folder_a: Option<String> = conn
            .query_row(
                "SELECT folder_id FROM presentations WHERE id = 'pA'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let folder_b: Option<String> = conn
            .query_row(
                "SELECT folder_id FROM presentations WHERE id = 'pB'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(folder_a, Some("fEvent1".into()));
        assert_eq!(folder_b, None);
    }
}
