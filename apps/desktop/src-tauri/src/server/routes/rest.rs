// Sprint K3 (GUIDA_OPERATIVA_v3 §4.C K3) — endpoint REST mirror PostgREST.
//
// Layout: una sola handler quartet (GET/POST/PATCH/DELETE) per tabella, montata
// su `/rest/v1/{table}`. Il dispatcher esamina il path e applica:
//   • whitelist tabella → 404 se sconosciuta
//   • whitelist colonne (filterable + writable) → 400 se l'input contiene colonne ignote
//   • parser PostgREST per la query string
//   • iniezione automatica `tenant_id = LOCAL_TENANT_ID` su INSERT (cosi' la SPA
//     non deve preoccuparsi di settarlo in modalita desktop).
//
// Endpoint coperti (cfr. K3 della guida):
//   /rest/v1/events
//   /rest/v1/rooms
//   /rest/v1/sessions
//   /rest/v1/speakers
//   /rest/v1/presentations
//   /rest/v1/presentation_versions
//   /rest/v1/paired_devices
//   /rest/v1/room_state
//   /rest/v1/local_agents
//   /rest/v1/pairing_codes
//   /rest/v1/tenants     (GET only)
//   /rest/v1/users       (GET only)
//   /rest/v1/activity_log (GET + POST audit)

use std::collections::HashMap;

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{any, get},
    Json, Router,
};
use rusqlite::types::Value as SqlValue;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::server::{
    auth::AdminAuth,
    db::LOCAL_TENANT_ID,
    error::{AppError, AppResult},
    pgrest::{parse_query, ParsedQuery},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    // Path pattern axum 0.7: `:name` per segmento singolo.
    // Questo router viene nestato sotto `/rest/v1` in `server/mod.rs`,
    // quindi le route finali sono `/rest/v1/<table>` e `/rest/v1/`.
    Router::new()
        .route("/:table", any(table_handler))
        .route("/", get(rest_root))
}

async fn rest_root(_admin: AdminAuth) -> AppResult<Json<Value>> {
    Ok(Json(json!({
        "info": "Live SLIDE CENTER — local PostgREST-compat (Sprint K)",
        "tables": ALLOWED_TABLES,
    })))
}

async fn table_handler(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Path(table): Path<String>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    method: axum::http::Method,
    body: Option<Json<Value>>,
) -> AppResult<axum::response::Response> {
    let spec = TABLES
        .iter()
        .find(|s| s.name == table)
        .ok_or_else(|| AppError::NotFound(format!("table not exposed: {table}")))?;

    let parsed = parse_query(&query, spec.cols_filter)?;
    let prefer_return_repr = headers
        .get("prefer")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase().contains("return=representation"))
        .unwrap_or(false);

    match method {
        axum::http::Method::GET => {
            let rows = select_rows(&state, spec, &parsed).await?;
            // Header `Accept: application/vnd.pgrst.object+json` → ritorna oggetto solo
            // (semantica `.maybeSingle()` di supabase-js). Manca → array.
            let single = headers
                .get("accept")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.contains("vnd.pgrst.object+json"))
                .unwrap_or(false);
            if single {
                let obj = rows.into_iter().next().unwrap_or(Value::Null);
                Ok(Json(obj).into_response())
            } else {
                Ok(Json(Value::Array(rows)).into_response())
            }
        }
        axum::http::Method::POST => {
            let body = body
                .ok_or_else(|| AppError::BadRequest("missing JSON body".into()))?
                .0;
            let rows = insert_rows(&state, spec, body).await?;
            let status = if rows.is_empty() {
                StatusCode::NO_CONTENT
            } else {
                StatusCode::CREATED
            };
            if prefer_return_repr || !rows.is_empty() {
                Ok((status, Json(Value::Array(rows))).into_response())
            } else {
                Ok(status.into_response())
            }
        }
        axum::http::Method::PATCH => {
            if !spec.writable {
                return Err(AppError::Forbidden(format!("table read-only: {table}")));
            }
            let body = body
                .ok_or_else(|| AppError::BadRequest("missing JSON body".into()))?
                .0;
            let rows = update_rows(&state, spec, &parsed, body).await?;
            Ok(Json(Value::Array(rows)).into_response())
        }
        axum::http::Method::DELETE => {
            if !spec.writable {
                return Err(AppError::Forbidden(format!("table read-only: {table}")));
            }
            let rows = delete_rows(&state, spec, &parsed).await?;
            Ok(Json(Value::Array(rows)).into_response())
        }
        _ => Err(AppError::BadRequest(format!("method not allowed on table: {method}"))),
    }
}

// ── Whitelist tabelle + colonne ─────────────────────────────────────────────
// Mantenuta in linea con le migration Supabase (sezione 12 della guida).
// Se una colonna manca da `cols_write`, non puo' essere settata da INSERT/PATCH.
// Lo schema SQLite ha `tenant_id` su tutte le tabelle: il server lo inietta
// automaticamente con `LOCAL_TENANT_ID` per nascondere il dettaglio alla SPA.

#[derive(Debug)]
struct TableSpec {
    name: &'static str,
    cols_filter: &'static [&'static str],
    cols_write: &'static [&'static str],
    writable: bool,
    /// Colonne che hanno default `now()` o auto-generate; non vanno requisite a INSERT.
    auto_cols: &'static [&'static str],
    /// Se la PK e' `id` (uuid), il server la genera automaticamente quando manca.
    id_uuid_auto: bool,
}

const ALLOWED_TABLES: &[&str] = &[
    "events", "rooms", "sessions", "speakers", "presentations",
    "presentation_versions", "paired_devices", "room_state", "local_agents",
    "pairing_codes", "tenants", "users", "activity_log",
];

const TABLES: &[TableSpec] = &[
    TableSpec {
        name: "events",
        cols_filter: &[
            "id","tenant_id","name","name_en","location","venue","start_date","end_date",
            "timezone","status","network_mode","created_by","created_at","updated_at",
        ],
        cols_write: &[
            "id","name","name_en","location","venue","start_date","end_date",
            "timezone","status","network_mode","settings","created_by",
        ],
        writable: true,
        auto_cols: &["created_at","updated_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "rooms",
        cols_filter: &[
            "id","event_id","tenant_id","name","name_en","floor","capacity",
            "display_order","room_type","created_at",
        ],
        cols_write: &[
            "id","event_id","name","name_en","floor","capacity","display_order","room_type","settings",
        ],
        writable: true,
        auto_cols: &["created_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "sessions",
        cols_filter: &[
            "id","room_id","event_id","tenant_id","title","title_en","session_type",
            "scheduled_start","scheduled_end","display_order","chair_name","notes",
            "created_at","updated_at",
        ],
        cols_write: &[
            "id","room_id","event_id","title","title_en","session_type",
            "scheduled_start","scheduled_end","display_order","chair_name","notes",
        ],
        writable: true,
        auto_cols: &["created_at","updated_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "speakers",
        cols_filter: &[
            "id","session_id","event_id","tenant_id","full_name","email","company",
            "job_title","bio","upload_token","upload_token_expires_at","display_order","created_at",
        ],
        cols_write: &[
            "id","session_id","event_id","full_name","email","company","job_title",
            "bio","upload_token","upload_token_expires_at","display_order",
        ],
        writable: true,
        auto_cols: &["created_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "presentations",
        cols_filter: &[
            "id","speaker_id","session_id","event_id","tenant_id","current_version_id",
            "total_versions","status","created_at","updated_at",
        ],
        cols_write: &[
            "id","speaker_id","session_id","event_id","current_version_id","total_versions","status",
        ],
        writable: true,
        auto_cols: &["created_at","updated_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "presentation_versions",
        cols_filter: &[
            "id","presentation_id","tenant_id","version_number","storage_key","file_name",
            "file_size_bytes","file_hash_sha256","mime_type","uploaded_by_speaker",
            "uploaded_by_user_id","upload_source","status","notes","created_at",
        ],
        cols_write: &[
            "id","presentation_id","version_number","storage_key","file_name",
            "file_size_bytes","file_hash_sha256","mime_type","uploaded_by_speaker",
            "uploaded_by_user_id","upload_source","status","notes",
        ],
        writable: true,
        auto_cols: &["created_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "paired_devices",
        cols_filter: &[
            "id","tenant_id","event_id","room_id","device_name","device_type","browser",
            "user_agent","pair_token_hash","last_ip","last_seen_at","status","paired_at",
            "paired_by_user_id","notes","updated_at",
            // Sprint M3: URL LAN del PC sala (es. http://192.168.1.42:7300) per il
            // pair-revoke. Scritto dalla SPA admin via PATCH dopo pair-direct.
            "lan_base_url",
            // Sprint D4 (port S-4): role 'room' | 'control_center'.
            "role",
        ],
        cols_write: &[
            "id","event_id","room_id","device_name","device_type","browser","user_agent",
            "pair_token_hash","last_ip","last_seen_at","status","paired_by_user_id","notes",
            "lan_base_url",
            "role",
        ],
        writable: true,
        auto_cols: &["paired_at","updated_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "room_state",
        cols_filter: &[
            "room_id","tenant_id","current_session_id","current_presentation_id",
            "current_version_id","sync_status","agent_connection","playback_mode",
            "last_play_started_at","last_sync_at","assigned_agent_id","updated_at",
        ],
        cols_write: &[
            "room_id","current_session_id","current_presentation_id","current_version_id",
            "sync_status","agent_connection","playback_mode","last_play_started_at",
            "last_sync_at","assigned_agent_id",
        ],
        writable: true,
        auto_cols: &["updated_at"],
        id_uuid_auto: false,
    },
    TableSpec {
        name: "local_agents",
        cols_filter: &[
            "id","tenant_id","event_id","name","machine_id","lan_ip","lan_port",
            "status","last_heartbeat","cached_files_count","cached_size_bytes","agent_version",
            "registered_at","updated_at",
        ],
        cols_write: &[
            "id","event_id","name","machine_id","lan_ip","lan_port","status","last_heartbeat",
            "cached_files_count","cached_size_bytes","agent_version",
        ],
        writable: true,
        auto_cols: &["registered_at","updated_at"],
        id_uuid_auto: true,
    },
    TableSpec {
        name: "pairing_codes",
        cols_filter: &[
            "code","tenant_id","event_id","room_id","generated_by_user_id","expires_at",
            "consumed_at","consumed_by_device_id","created_at",
        ],
        cols_write: &[
            "code","event_id","room_id","generated_by_user_id","expires_at",
            "consumed_at","consumed_by_device_id",
        ],
        writable: true,
        auto_cols: &["created_at"],
        id_uuid_auto: false,
    },
    TableSpec {
        name: "tenants",
        cols_filter: &[
            "id","name","slug","plan","ls_customer_id","ls_subscription_id","storage_used_bytes",
            "storage_limit_bytes","max_events_per_month","max_rooms_per_event","suspended","settings",
            "created_at","updated_at",
        ],
        cols_write: &[],
        writable: false,
        auto_cols: &[],
        id_uuid_auto: false,
    },
    TableSpec {
        name: "users",
        cols_filter: &[
            "id","tenant_id","email","full_name","role","avatar_url","last_seen_at",
            "created_at","updated_at",
        ],
        cols_write: &[],
        writable: false,
        auto_cols: &[],
        id_uuid_auto: false,
    },
    TableSpec {
        name: "activity_log",
        cols_filter: &[
            "id","tenant_id","event_id","actor","actor_id","actor_name","action",
            "entity_type","entity_id","metadata","created_at",
        ],
        cols_write: &[
            "id","event_id","actor","actor_id","actor_name","action","entity_type","entity_id","metadata",
        ],
        writable: true,
        auto_cols: &["created_at"],
        id_uuid_auto: true,
    },
];

// ── Helpers query rusqlite (sync, eseguiti in spawn_blocking) ──────────────

async fn select_rows(
    state: &AppState,
    spec: &'static TableSpec,
    parsed: &ParsedQuery,
) -> AppResult<Vec<Value>> {
    let table = spec.name;
    let (tail_sql, binds) = parsed.render_tail();
    let sql = format!("SELECT * FROM {table}{tail_sql}");

    let pool = state.db.clone();
    let cols = spec.cols_filter.to_vec();
    let rows = tokio::task::spawn_blocking(move || -> AppResult<Vec<Value>> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&sql)?;
        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(binds.iter().map(json_to_sql_value)))?;
        let mut out: Vec<Value> = Vec::new();
        while let Some(row) = rows.next()? {
            let mut obj = serde_json::Map::new();
            for (i, name) in column_names.iter().enumerate() {
                let v: rusqlite::types::Value = row.get(i)?;
                obj.insert(name.clone(), sql_value_to_json(v));
            }
            out.push(Value::Object(obj));
        }
        // `cols` non viene piu' usato qui (lo schema viene dalla query), ma lo
        // teniamo nello scope per evitare warning (e per documentare l'invariante).
        let _ = cols;
        Ok(out)
    })
    .await??;

    Ok(rows)
}

async fn insert_rows(
    state: &AppState,
    spec: &'static TableSpec,
    body: Value,
) -> AppResult<Vec<Value>> {
    if !spec.writable {
        return Err(AppError::Forbidden(format!("table read-only: {}", spec.name)));
    }
    // Normalizziamo: la SPA puo' inviare un singolo object o un array.
    let rows: Vec<Value> = match body {
        Value::Array(a) => a,
        Value::Object(_) => vec![body],
        _ => return Err(AppError::BadRequest("body must be object or array".into())),
    };
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        out.push(insert_one(state, spec, row).await?);
    }
    Ok(out)
}

async fn insert_one(
    state: &AppState,
    spec: &'static TableSpec,
    row: Value,
) -> AppResult<Value> {
    let mut obj = match row {
        Value::Object(m) => m,
        _ => return Err(AppError::BadRequest("each row must be an object".into())),
    };

    // 1) iniezione automatica tenant_id se la tabella ce l'ha.
    if spec.cols_filter.contains(&"tenant_id") && !obj.contains_key("tenant_id") {
        obj.insert("tenant_id".into(), Value::String(LOCAL_TENANT_ID.into()));
    }

    // 2) generazione id UUID v4 se manca e la tabella lo prevede.
    if spec.id_uuid_auto && !obj.contains_key("id") {
        obj.insert("id".into(), Value::String(Uuid::new_v4().to_string()));
    }

    // 3) Verifica colonne: tutto cio' che e' nel body deve essere in `cols_write`
    //    o in `auto_cols` o essere il `tenant_id` (gestito sopra).
    let allowed: Vec<&'static str> = spec
        .cols_write
        .iter()
        .copied()
        .chain(spec.auto_cols.iter().copied())
        .chain(["tenant_id"].into_iter())
        .collect();
    for col in obj.keys() {
        if !allowed.contains(&col.as_str()) {
            return Err(AppError::BadRequest(format!(
                "column not writable on {}: {col}",
                spec.name
            )));
        }
    }

    let columns: Vec<String> = obj.keys().cloned().collect();
    let placeholders: Vec<String> = (1..=columns.len()).map(|i| format!("?{i}")).collect();
    let table = spec.name;
    let returning_sql = format!(
        "INSERT INTO {table} ({}) VALUES ({}) RETURNING *",
        columns.join(","),
        placeholders.join(","),
    );

    let binds: Vec<Value> = columns.iter().map(|c| obj.remove(c).unwrap_or(Value::Null)).collect();

    let pool = state.db.clone();
    let row = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&returning_sql)?;
        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(binds.iter().map(json_to_sql_value)))?;
        let mut row = rows
            .next()?
            .ok_or_else(|| AppError::Internal("INSERT did not RETURN any row".into()))?;
        let mut obj = serde_json::Map::new();
        for (i, name) in column_names.iter().enumerate() {
            let v: rusqlite::types::Value = row.get(i)?;
            obj.insert(name.clone(), sql_value_to_json(v));
        }
        // Suppress "second use" lints
        let _ = &mut row;
        Ok(Value::Object(obj))
    })
    .await??;

    Ok(row)
}

async fn update_rows(
    state: &AppState,
    spec: &'static TableSpec,
    parsed: &ParsedQuery,
    body: Value,
) -> AppResult<Vec<Value>> {
    let obj = match body {
        Value::Object(m) => m,
        _ => return Err(AppError::BadRequest("update body must be object".into())),
    };
    if obj.is_empty() {
        return Err(AppError::BadRequest("update body empty".into()));
    }
    for col in obj.keys() {
        if !spec.cols_write.contains(&col.as_str()) {
            return Err(AppError::BadRequest(format!(
                "column not writable on {}: {col}",
                spec.name
            )));
        }
    }

    let assignments: Vec<String> = obj.keys().enumerate().map(|(i, c)| format!("{c}=?{}", i + 1)).collect();
    let mut binds: Vec<Value> = obj.values().cloned().collect();

    let (tail_sql, where_binds) = parsed.render_tail();
    if !tail_sql.contains(" WHERE ") {
        return Err(AppError::BadRequest(
            "UPDATE without filters refused (would touch every row)".into(),
        ));
    }
    binds.extend(where_binds);

    let table = spec.name;
    let sql = format!(
        "UPDATE {table} SET {} {} RETURNING *",
        assignments.join(", "),
        tail_sql.trim_start(),
    );

    let pool = state.db.clone();
    let rows = tokio::task::spawn_blocking(move || -> AppResult<Vec<Value>> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&sql)?;
        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(binds.iter().map(json_to_sql_value)))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut obj = serde_json::Map::new();
            for (i, name) in column_names.iter().enumerate() {
                let v: rusqlite::types::Value = row.get(i)?;
                obj.insert(name.clone(), sql_value_to_json(v));
            }
            out.push(Value::Object(obj));
        }
        Ok(out)
    })
    .await??;

    Ok(rows)
}

async fn delete_rows(
    state: &AppState,
    spec: &'static TableSpec,
    parsed: &ParsedQuery,
) -> AppResult<Vec<Value>> {
    let (tail_sql, binds) = parsed.render_tail();
    if !tail_sql.contains(" WHERE ") {
        return Err(AppError::BadRequest(
            "DELETE without filters refused (would wipe every row)".into(),
        ));
    }
    let table = spec.name;
    let sql = format!("DELETE FROM {table} {} RETURNING *", tail_sql.trim_start());

    let pool = state.db.clone();
    let rows = tokio::task::spawn_blocking(move || -> AppResult<Vec<Value>> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&sql)?;
        let column_names: Vec<String> = stmt
            .column_names()
            .into_iter()
            .map(|s| s.to_string())
            .collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(binds.iter().map(json_to_sql_value)))?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let mut obj = serde_json::Map::new();
            for (i, name) in column_names.iter().enumerate() {
                let v: rusqlite::types::Value = row.get(i)?;
                obj.insert(name.clone(), sql_value_to_json(v));
            }
            out.push(Value::Object(obj));
        }
        Ok(out)
    })
    .await??;

    Ok(rows)
}

// ── Helpers conversion serde_json ↔ rusqlite::types::Value ─────────────────

fn json_to_sql_value(val: &Value) -> SqlValue {
    match val {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Text(n.to_string())
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        Value::Array(_) | Value::Object(_) => SqlValue::Text(val.to_string()),
    }
}

fn sql_value_to_json(val: SqlValue) -> Value {
    match val {
        SqlValue::Null => Value::Null,
        SqlValue::Integer(i) => Value::Number(serde_json::Number::from(i)),
        SqlValue::Real(f) => serde_json::Number::from_f64(f)
            .map(Value::Number)
            .unwrap_or(Value::Null),
        SqlValue::Text(s) => {
            // Per le colonne JSONB-like (es. settings, metadata) potrebbe contenere
            // gia' JSON valido: facciamo un best-effort di parsing, fallback string.
            // Heuristica conservativa: solo se inizia con '{' o '['.
            let trimmed = s.trim_start();
            if trimmed.starts_with('{') || trimmed.starts_with('[') {
                serde_json::from_str::<Value>(&s).unwrap_or(Value::String(s))
            } else {
                Value::String(s)
            }
        }
        SqlValue::Blob(b) => Value::String(base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            b,
        )),
    }
}
