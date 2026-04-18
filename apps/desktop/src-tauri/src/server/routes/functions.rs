// Sprint K5 + Sprint L4 (GUIDA_OPERATIVA_v3 §4.C K5 + §4.D L4) — emulazione Edge Functions.
//
// Endpoint montati sotto `/functions/v1/...`:
//   POST /functions/v1/pair-init                (admin)  → genera codice 6 cifre
//   POST /functions/v1/pair-poll                (admin)  → status del codice
//   POST /functions/v1/pair-claim               (no auth)→ device si registra col codice
//   POST /functions/v1/pair-direct              (no auth)→ admin LAN registra device direttamente (Sprint L)
//   POST /functions/v1/room-player-bootstrap    (no auth)→ device riceve room+files
//   POST /functions/v1/room-player-rename       (no auth)→ device cambia nome
//   POST /functions/v1/room-player-set-current  (no auth)→ device segna "in onda"
//
// Queste rotte mirano alle stesse shape di request/response delle Edge Functions
// originali, cosi' la SPA (`apps/web`) puo' chiamarle con `supabase.functions.invoke`
// senza modifiche. La differenza tecnica:
//   • niente JWT utente: il `tenant_id` e' fissato a LOCAL_TENANT_ID.
//   • pair-claim non rate-limita (LAN trust). Se vorrai aggiungerlo in futuro:
//     basta una tabella `pair_claim_rate_events` come Supabase.
//   • room-player-bootstrap riusa lo stesso schema con LEFT JOIN tra
//     presentations/versions/sessions/speakers via prepared statements rusqlite.

use std::sync::Arc;

use axum::{extract::State, routing::post, Json, Router};
use chrono::{Duration, Utc};
use rand::Rng;
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::server::{
    auth::{sha256_hex, AdminAuth},
    db::{LOCAL_ADMIN_USER_ID, LOCAL_TENANT_ID},
    device_persist::{self, AdminServerInfo, PersistedDevice},
    error::{AppError, AppResult},
    state::AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/functions/v1/pair-init", post(pair_init))
        .route("/functions/v1/pair-poll", post(pair_poll))
        .route("/functions/v1/pair-claim", post(pair_claim))
        .route("/functions/v1/pair-direct", post(pair_direct))
        // Sprint M3: pair-revoke chiamato dall'admin LAN per smontare il pairing
        // remotamente sul PC sala (cancella device.json + record paired_devices
        // + reset TXT mDNS event_id).
        .route("/functions/v1/pair-revoke", post(pair_revoke))
        .route("/functions/v1/room-player-bootstrap", post(room_player_bootstrap))
        .route("/functions/v1/room-player-rename", post(room_player_rename))
        .route("/functions/v1/room-player-set-current", post(room_player_set_current))
        // Sprint N2 (GUIDA_OPERATIVA_v3 §4.F N2): il PC sala (o un suo proxy admin)
        // chiama questo endpoint per ottenere un signed URL HMAC verso un file del
        // bucket. Auth via `device_token` invece di admin_token: il sala non ha
        // l'admin_token, ma ha il proprio token rilasciato da pair-direct/pair-claim.
        .route("/functions/v1/lan-sign-url", post(lan_sign_url))
}

// ── pair-init ─────────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct PairInitInput {
    event_id: String,
    #[serde(default)]
    room_id: Option<String>,
}

async fn pair_init(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<PairInitInput>,
) -> AppResult<Json<Value>> {
    if input.event_id.trim().is_empty() {
        return Err(AppError::BadRequest("event_id_required".into()));
    }

    let pool = state.db.clone();
    let value = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = pool.get()?;
        let tenant_match: Option<String> = conn
            .query_row(
                "SELECT tenant_id FROM events WHERE id = ?1 AND tenant_id = ?2",
                params![input.event_id, LOCAL_TENANT_ID],
                |r| r.get(0),
            )
            .optional()?;
        if tenant_match.is_none() {
            return Err(AppError::NotFound("event_not_found".into()));
        }
        let mut rng = rand::thread_rng();
        let code: String = (0..6).map(|_| rng.gen_range(0..10).to_string()).collect();
        let expires_at = (Utc::now() + Duration::minutes(10)).to_rfc3339();
        conn.execute(
            "INSERT INTO pairing_codes
                (code, tenant_id, event_id, room_id, generated_by_user_id, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                code,
                LOCAL_TENANT_ID,
                input.event_id,
                input.room_id,
                LOCAL_ADMIN_USER_ID,
                expires_at,
            ],
        )?;
        Ok(json!({ "code": code, "expires_at": expires_at }))
    })
    .await??;

    Ok(Json(value))
}

// ── pair-poll ─────────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct PairPollInput {
    code: String,
}

async fn pair_poll(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Json(input): Json<PairPollInput>,
) -> AppResult<Json<Value>> {
    if !is_six_digits(&input.code) {
        return Err(AppError::BadRequest("invalid_code_format".into()));
    }
    let pool = state.db.clone();
    let value = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = pool.get()?;
        let row: Option<(Option<String>, Option<String>, String)> = conn
            .query_row(
                "SELECT consumed_at, consumed_by_device_id, expires_at
                   FROM pairing_codes
                  WHERE code = ?1 AND tenant_id = ?2",
                params![input.code, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((consumed_at, consumed_by_device_id, expires_at)) = row else {
            return Err(AppError::NotFound("code_not_found".into()));
        };
        let now = Utc::now().to_rfc3339();
        if expires_at.as_str() < now.as_str() && consumed_at.is_none() {
            return Ok(json!({ "status": "expired" }));
        }
        if consumed_at.is_some() {
            let device_name: Option<String> = if let Some(ref device_id) = consumed_by_device_id {
                conn.query_row(
                    "SELECT device_name FROM paired_devices WHERE id = ?1",
                    [device_id],
                    |r| r.get(0),
                )
                .optional()?
            } else {
                None
            };
            return Ok(json!({
                "status": "consumed",
                "device_id": consumed_by_device_id,
                "device_name": device_name,
            }));
        }
        Ok(json!({ "status": "pending" }))
    })
    .await??;
    Ok(Json(value))
}

// ── pair-claim (no auth, LAN trust) ───────────────────────────────────────
#[derive(Deserialize)]
struct PairClaimInput {
    code: String,
    #[serde(default)]
    device_name: Option<String>,
    #[serde(default)]
    device_type: Option<String>,
    #[serde(default)]
    browser: Option<String>,
    #[serde(default)]
    user_agent: Option<String>,
}

async fn pair_claim(
    State(state): State<AppState>,
    Json(input): Json<PairClaimInput>,
) -> AppResult<Json<Value>> {
    if !is_six_digits(&input.code) {
        return Err(AppError::BadRequest("invalid_code_format".into()));
    }
    let pool = state.db.clone();
    let value = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        let now = Utc::now().to_rfc3339();
        let code_row: Option<(String, String, Option<String>, Option<String>)> = tx
            .query_row(
                "SELECT tenant_id, event_id, room_id, generated_by_user_id
                   FROM pairing_codes
                  WHERE code = ?1
                    AND consumed_at IS NULL
                    AND expires_at > ?2",
                params![input.code, now],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let Some((tenant_id, event_id, room_id, generated_by)) = code_row else {
            return Err(AppError::NotFound("code_invalid_or_expired".into()));
        };

        let device_token = Uuid::new_v4().to_string();
        let token_hash = sha256_hex(&device_token);
        let resolved_name = input
            .device_name
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("PC-{}", input.code));

        let device_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO paired_devices
                (id, tenant_id, event_id, room_id, device_name, device_type, browser,
                 user_agent, pair_token_hash, last_seen_at, status, paired_by_user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'online', ?11)",
            params![
                device_id,
                tenant_id,
                event_id,
                room_id,
                resolved_name,
                input.device_type,
                input.browser,
                input.user_agent,
                token_hash,
                now,
                generated_by,
            ],
        )?;

        tx.execute(
            "UPDATE pairing_codes
                SET consumed_at = ?1, consumed_by_device_id = ?2
              WHERE code = ?3",
            params![now, device_id, input.code],
        )?;
        tx.commit()?;

        Ok(json!({
            "device_token": device_token,
            "device_id": device_id,
            "event_id": event_id,
            "room_id": room_id,
        }))
    })
    .await??;
    Ok(Json(value))
}

// ── pair-direct (Sprint L4 — admin LAN registra il PC sala senza codice) ──
//
// Flow:
//   1. L'admin (browser/Tauri) scopre via mDNS i PC sala con `role=sala` e
//      `event_id=null` (non ancora paired).
//   2. Apre il dialog "Aggiungi PC", l'utente sceglie a quale sala assegnarlo.
//   3. La SPA dell'admin chiama il PC sala scoperto su:
//        POST http://<sala_ip>:7300/functions/v1/pair-direct
//      con body `{ event_id, room_id?, device_name?, admin_server: { base_url, name } }`.
//   4. Il PC sala (= **questo** server, perche' la richiesta arriva al suo Axum locale)
//      crea le entries `events`/`rooms` se mancanti (mirror minimo di quelle che
//      l'admin ha creato), inserisce un `paired_devices` con un `device_token`
//      generato qui, e salva tutto in `~/SlideCenter/device.json` per persistenza
//      al riavvio (regola sovrana §0.4).
//   5. Risponde con `{ device_token, device_id, ... }` cosi' la SPA admin sa
//      l'esito e puo' aggiornare la propria lista dispositivi.
//   6. Il PC sala aggiorna anche il TXT mDNS `event_id=<event_id>` cosi' altri
//      admin LAN vedranno questo nodo come "gia' assegnato".
//
// **Sicurezza in LAN trust**: non c'e' bearer admin (i due nodi non si conoscono
// a priori). La protezione e' che solo chi e' SULLA STESSA LAN puo' raggiungere
// la porta 7300. Se serviranno controlli piu' stringenti (es. multi-tenant
// office), in Sprint Q aggiungeremo un PIN one-time mostrato sul PC sala.
//
// **Idempotenza**: se il PC sala riceve un secondo pair-direct mentre e' gia'
// paired, ritorna `409 Conflict` con il device_id corrente. L'admin deve prima
// chiamare un (futuro) `pair-revoke` per liberarlo.
#[derive(Deserialize)]
struct AdminServerBody {
    base_url: String,
    #[serde(default)]
    name: Option<String>,
}

#[derive(Deserialize)]
struct PairDirectInput {
    event_id: String,
    #[serde(default)]
    event_name: Option<String>,
    #[serde(default)]
    room_id: Option<String>,
    #[serde(default)]
    room_name: Option<String>,
    #[serde(default)]
    device_name: Option<String>,
    #[serde(default)]
    device_type: Option<String>,
    #[serde(default)]
    browser: Option<String>,
    #[serde(default)]
    user_agent: Option<String>,
    /// Info del server admin che sta facendo il pairing (per device.json). Usato
    /// dal PC sala per sapere a chi connettersi al riavrio.
    #[serde(default)]
    admin_server: Option<AdminServerBody>,
}

async fn pair_direct(
    State(state): State<AppState>,
    Json(input): Json<PairDirectInput>,
) -> AppResult<Json<Value>> {
    // Solo i nodi con ruolo "sala" devono accettare pair-direct: e' la
    // contropartita dell'admin che fa la richiesta. Se per errore un admin
    // chiama il pair-direct di un altro admin, blocchiamo.
    if state.role.as_str() != "sala" {
        return Err(AppError::Forbidden(
            "this_node_is_not_a_sala_pc".into(),
        ));
    }
    let event_id = input.event_id.trim().to_string();
    if event_id.is_empty() {
        return Err(AppError::BadRequest("missing_event_id".into()));
    }

    let pool = state.db.clone();
    let mdns = state.mdns.clone();
    let data_root = state.data_root.clone();
    let admin_server = input.admin_server;

    let value = tokio::task::spawn_blocking(move || -> AppResult<(Value, Option<String>)> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        // Idempotenza: se esiste gia' un device paired per questo event/room,
        // ritorna conflict (richiede unpair esplicito prima di re-pair).
        let existing: Option<(String, String, String)> = tx
            .query_row(
                "SELECT id, device_name, status
                   FROM paired_devices
                  WHERE event_id = ?1 AND tenant_id = ?2
                  LIMIT 1",
                params![event_id, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        if let Some((existing_id, existing_name, existing_status)) = existing {
            return Err(AppError::Conflict(format!(
                "device_already_paired:{existing_id}:{existing_name}:{existing_status}"
            )));
        }

        // Crea/upsert event mirror (locale): la sorgente di verita' e' lato
        // admin, qui basta una riga minima per soddisfare i FK su paired_devices
        // / room_state / sessions.
        let now = Utc::now().to_rfc3339();
        let event_name = input
            .event_name
            .as_deref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Event {}", &event_id[..8.min(event_id.len())]));
        tx.execute(
            "INSERT INTO events (id, tenant_id, name, network_mode, status, created_at)
             VALUES (?1, ?2, ?3, 'intranet', 'active', ?4)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name",
            params![event_id, LOCAL_TENANT_ID, event_name, now],
        )?;

        let room_id = input
            .room_id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if let Some(ref rid) = room_id {
            let room_name = input
                .room_name
                .as_deref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("Sala {}", &rid[..8.min(rid.len())]));
            tx.execute(
                "INSERT INTO rooms (id, tenant_id, event_id, name, room_type, created_at)
                 VALUES (?1, ?2, ?3, ?4, 'main', ?5)
                 ON CONFLICT(id) DO UPDATE SET name = excluded.name",
                params![rid, LOCAL_TENANT_ID, event_id, room_name, now],
            )?;
        }

        // Genera device_token, hash SHA-256 (stesso algo di pair-claim) e inserisci.
        let device_token = Uuid::new_v4().to_string();
        let token_hash = sha256_hex(&device_token);
        let resolved_name = input
            .device_name
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("PC-Sala-LAN-{}", &Uuid::new_v4().to_string()[..8]));

        let device_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO paired_devices
                (id, tenant_id, event_id, room_id, device_name, device_type, browser,
                 user_agent, pair_token_hash, last_seen_at, status, paired_by_user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'online', ?11)",
            params![
                device_id,
                LOCAL_TENANT_ID,
                event_id,
                room_id,
                resolved_name,
                input.device_type,
                input.browser,
                input.user_agent,
                token_hash,
                now,
                LOCAL_ADMIN_USER_ID,
            ],
        )?;
        tx.commit()?;

        // Persisti device.json (best-effort: errore loggato ma non bloccante).
        let payload = PersistedDevice {
            device_id: device_id.clone(),
            device_token: device_token.clone(),
            device_name: resolved_name.clone(),
            event_id: event_id.clone(),
            room_id: room_id.clone(),
            admin_server: admin_server.map(|a| AdminServerInfo {
                base_url: a.base_url,
                name: a.name,
                fingerprint: None,
            }),
            paired_at: now.clone(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        if let Err(e) = device_persist::write(&data_root, &payload) {
            tracing::warn!(?e, "device.json write fallita (non bloccante)");
        }

        Ok((
            json!({
                "device_token": device_token,
                "device_id": device_id,
                "device_name": resolved_name,
                "event_id": event_id,
                "room_id": room_id,
                "paired_at": now,
            }),
            Some(event_id),
        ))
    })
    .await??;

    let (response, event_id_for_mdns) = value;
    if let (Some(handle), Some(ev)) = (mdns, event_id_for_mdns) {
        handle.update_event_id(Some(&ev));
    }
    Ok(Json(response))
}

// ── pair-revoke (Sprint M3) ───────────────────────────────────────────────
//
// L'admin (PC desktop role=admin) chiama questa funzione sul PC sala via LAN
// per smontare il pairing in modo coordinato (vs. solo `revokeDevice` che
// cancellerebbe il record locale ma lascerebbe il sala convinto di essere paired).
//
// Sicurezza minima (sufficiente per LAN trusted):
//   • Il body deve includere `device_token` (clear). Confronto SHA-256 con
//     `paired_devices.pair_token_hash`. Senza match → 404.
//   • In alternativa accetta `device_id` + `event_id` (per scenari in cui
//     l'admin ha perso il token clear ma vuole comunque smontare il pairing).
//     In quel caso match meno forte ma comunque richiede la conoscenza dei
//     UUID, non enumerable.
//   • Solo nodi `role == "sala"` accettano la chiamata (`role_not_sala` 400).
//
// Effetto:
//   1. cancella la riga `paired_devices` corrispondente,
//   2. cancella `device.json` dal disco (se presente),
//   3. reset TXT mDNS `event_id` a `null` (il sala torna disponibile per pair).
#[derive(Deserialize)]
struct PairRevokeInput {
    #[serde(default)]
    device_token: Option<String>,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    event_id: Option<String>,
}

async fn pair_revoke(
    State(state): State<AppState>,
    Json(input): Json<PairRevokeInput>,
) -> AppResult<Json<Value>> {
    if state.role.as_str() != "sala" {
        return Err(AppError::Forbidden("role_not_sala".into()));
    }

    let pool = state.db.clone();
    let data_root = state.data_root.clone();
    let mdns = state.mdns.clone();

    let removed = tokio::task::spawn_blocking(move || -> AppResult<Option<(String, String)>> {
        let mut conn = pool.get()?;
        let tx = conn.transaction()?;

        // Match per device_token (preferito) → pair_token_hash; altrimenti per device_id+event_id.
        let target: Option<(String, String)> = if let Some(tok) = input
            .device_token
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
        {
            let hash = crate::server::auth::sha256_hex(tok);
            tx.query_row(
                "SELECT id, event_id FROM paired_devices
                  WHERE pair_token_hash = ?1 AND tenant_id = ?2 LIMIT 1",
                params![hash, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
        } else if let (Some(did), Some(eid)) = (
            input
                .device_id
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty()),
            input
                .event_id
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty()),
        ) {
            tx.query_row(
                "SELECT id, event_id FROM paired_devices
                  WHERE id = ?1 AND event_id = ?2 AND tenant_id = ?3 LIMIT 1",
                params![did, eid, LOCAL_TENANT_ID],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
        } else {
            return Err(AppError::BadRequest(
                "missing_device_token_or_id_event".into(),
            ));
        };

        let Some((device_id, event_id)) = target else {
            return Ok(None);
        };

        tx.execute(
            "DELETE FROM paired_devices WHERE id = ?1 AND tenant_id = ?2",
            params![device_id, LOCAL_TENANT_ID],
        )?;
        tx.commit()?;

        // device.json: cancellazione best-effort (errori solo log).
        if let Err(e) = device_persist::clear(&data_root) {
            tracing::warn!(?e, "device.json clear fallita (non bloccante)");
        }

        Ok(Some((device_id, event_id)))
    })
    .await??;

    // Reset TXT mDNS: il sala torna disponibile per il prossimo pair-direct.
    if let Some(handle) = mdns {
        handle.update_event_id(None);
    }

    match removed {
        Some((device_id, event_id)) => Ok(Json(json!({
            "ok": true,
            "device_id": device_id,
            "event_id": event_id,
        }))),
        None => Err(AppError::NotFound("device_not_found".into())),
    }
}

// ── room-player-bootstrap ─────────────────────────────────────────────────
#[derive(Deserialize)]
struct BootstrapInput {
    device_token: String,
    #[serde(default = "default_true")]
    include_versions: bool,
    #[serde(default)]
    playback_mode: Option<String>,
}
fn default_true() -> bool {
    true
}

async fn room_player_bootstrap(
    State(state): State<AppState>,
    Json(input): Json<BootstrapInput>,
) -> AppResult<Json<Value>> {
    if input.device_token.trim().is_empty() {
        return Err(AppError::BadRequest("missing_device_token".into()));
    }
    let requested_mode = match input.playback_mode.as_deref() {
        Some("auto") | Some("live") | Some("turbo") => input.playback_mode.clone(),
        _ => None,
    };
    let token = input.device_token.clone();
    let include = input.include_versions;
    let state_arc = Arc::new(state.clone());

    let value = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = state_arc.db.get()?;

        let token_hash = sha256_hex(&token);
        let device: Option<(String, String, String, Option<String>, String, String)> = conn
            .query_row(
                "SELECT id, tenant_id, event_id, room_id, status, device_name
                   FROM paired_devices
                  WHERE pair_token_hash = ?1",
                [&token_hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .optional()?;
        let Some((device_id, tenant_id, event_id, room_id, _status, device_name)) = device else {
            return Err(AppError::NotFound("invalid_token".into()));
        };

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE paired_devices
                SET last_seen_at = ?1, status = 'online'
              WHERE id = ?2",
            params![now, device_id],
        )?;

        // Tenant.suspended check (anche se sul tenant locale è sempre false)
        let suspended: Option<i64> = conn
            .query_row(
                "SELECT suspended FROM tenants WHERE id = ?1",
                [&tenant_id],
                |r| r.get(0),
            )
            .optional()?;
        if suspended.unwrap_or(0) == 1 {
            return Err(AppError::Forbidden("tenant_suspended".into()));
        }

        let Some(room_id) = room_id else {
            return Ok(json!({
                "device": { "id": device_id, "name": device_name },
                "room": null,
                "event_id": event_id,
                "network_mode": null,
                "agent": null,
                "room_state": {
                    "sync_status": "offline",
                    "current_session": null,
                    "playback_mode": requested_mode.unwrap_or_else(|| "auto".to_string()),
                },
                "files": [],
                "warning": "no_room_assigned",
            }));
        };

        let (room_name,): (String,) = conn
            .query_row(
                "SELECT name FROM rooms WHERE id = ?1",
                [&room_id],
                |r| Ok((r.get(0)?,)),
            )
            .map_err(|_| AppError::NotFound("room_not_found".into()))?;
        let (network_mode, event_name): (String, String) = conn
            .query_row(
                "SELECT network_mode, name FROM events WHERE id = ?1",
                [&event_id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            )
            .map_err(|_| AppError::NotFound("event_not_found".into()))?;

        if let Some(ref m) = requested_mode {
            conn.execute(
                "UPDATE room_state SET playback_mode = ?1 WHERE room_id = ?2",
                params![m, room_id],
            )?;
        }
        let room_state: (String, Option<String>, String) = conn
            .query_row(
                "SELECT COALESCE(sync_status, 'offline'),
                        current_session_id,
                        COALESCE(playback_mode, 'auto')
                   FROM room_state
                  WHERE room_id = ?1",
                [&room_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap_or_else(|_| ("offline".to_string(), None, "auto".to_string()));

        let current_session = if let Some(ref sid) = room_state.1 {
            let row: Option<(String, String, Option<String>, Option<String>)> = conn
                .query_row(
                    "SELECT id, title, scheduled_start, scheduled_end FROM sessions WHERE id = ?1",
                    [sid],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()?;
            row.map(|(id, title, scheduled_start, scheduled_end)| {
                json!({
                    "id": id,
                    "title": title,
                    "scheduled_start": scheduled_start,
                    "scheduled_end": scheduled_end,
                })
            })
        } else {
            None
        };

        let agent: Option<(Option<String>, Option<i64>)> = conn
            .query_row(
                "SELECT lan_ip, lan_port FROM local_agents
                  WHERE event_id = ?1 AND status = 'online' AND lan_ip IS NOT NULL
                  ORDER BY updated_at DESC LIMIT 1",
                [&event_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let agent_json = agent.and_then(|(ip, port)| {
            ip.map(|ip| json!({ "lan_ip": ip, "lan_port": port.unwrap_or(8080) }))
        });

        let mut files = Vec::<Value>::new();
        if include {
            let mut sessions_stmt = conn.prepare(
                "SELECT id, title, scheduled_start FROM sessions
                  WHERE room_id = ?1 AND event_id = ?2",
            )?;
            let session_rows = sessions_stmt
                .query_map(params![room_id, event_id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            if !session_rows.is_empty() {
                let session_ids: Vec<&String> = session_rows.iter().map(|s| &s.0).collect();
                let placeholders = vec!["?"; session_ids.len()].join(",");
                let sql = format!(
                    "SELECT p.id, p.current_version_id, p.session_id, sp.full_name
                       FROM presentations p
                       LEFT JOIN speakers sp ON sp.id = p.speaker_id
                      WHERE p.session_id IN ({placeholders})
                        AND p.current_version_id IS NOT NULL"
                );
                let mut stmt = conn.prepare(&sql)?;
                let bind_params: Vec<&dyn rusqlite::ToSql> = session_ids
                    .iter()
                    .map(|s| *s as &dyn rusqlite::ToSql)
                    .collect();
                let pres_rows = stmt
                    .query_map(bind_params.as_slice(), |r| {
                        Ok((
                            r.get::<_, String>(0)?,
                            r.get::<_, String>(1)?,
                            r.get::<_, String>(2)?,
                            r.get::<_, Option<String>>(3)?,
                        ))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;

                for (presentation_id, version_id, session_id, speaker_name) in pres_rows {
                    type VersionRow = (
                        String,
                        Option<String>,
                        Option<i64>,
                        Option<String>,
                        Option<String>,
                        Option<String>,
                    );
                    let version: Option<VersionRow> = conn
                        .query_row(
                            "SELECT id, file_name, file_size_bytes, file_hash_sha256, mime_type, created_at
                               FROM presentation_versions
                              WHERE id = ?1 AND status = 'ready'",
                            [&version_id],
                            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
                        )
                        .optional()?;
                    let storage_key: Option<String> = conn
                        .query_row(
                            "SELECT storage_key FROM presentation_versions WHERE id = ?1",
                            [&version_id],
                            |r| r.get(0),
                        )
                        .optional()?;
                    let (Some(version), Some(storage_key)) = (version, storage_key) else {
                        continue;
                    };
                    let session_meta = session_rows
                        .iter()
                        .find(|s| s.0 == session_id)
                        .map(|s| (s.1.clone(), s.2.clone()));

                    files.push(json!({
                        "versionId": version.0,
                        "presentationId": presentation_id,
                        "storageKey": storage_key,
                        "filename": version.1.unwrap_or_else(|| format!("file_{}", version.0)),
                        "speakerName": speaker_name,
                        "sessionId": session_id,
                        "sessionTitle": session_meta.as_ref().map(|s| s.0.clone()).unwrap_or_else(|| "—".into()),
                        "sessionScheduledStart": session_meta.and_then(|s| s.1),
                        "fileSizeBytes": version.2.unwrap_or(0),
                        "mimeType": version.4.unwrap_or_else(|| "application/octet-stream".into()),
                        "createdAt": version.5,
                        "fileHashSha256": version.3,
                    }));
                }
            }
            files.sort_by(|a, b| {
                let ta = a.get("sessionScheduledStart").and_then(|v| v.as_str()).unwrap_or("");
                let tb = b.get("sessionScheduledStart").and_then(|v| v.as_str()).unwrap_or("");
                let cmp = ta.cmp(tb);
                if cmp != std::cmp::Ordering::Equal {
                    return cmp;
                }
                let fa = a.get("filename").and_then(|v| v.as_str()).unwrap_or("");
                let fb = b.get("filename").and_then(|v| v.as_str()).unwrap_or("");
                fa.cmp(fb)
            });
        }

        Ok(json!({
            "device": { "id": device_id, "name": device_name },
            "room": { "id": room_id, "name": room_name },
            "event_id": event_id,
            "event_name": event_name,
            "network_mode": network_mode,
            "agent": agent_json,
            "room_state": {
                "sync_status": room_state.0,
                "current_session": current_session,
                "playback_mode": room_state.2,
            },
            "files": files,
        }))
    })
    .await??;
    Ok(Json(value))
}

// ── room-player-rename ────────────────────────────────────────────────────
#[derive(Deserialize)]
struct RenameInput {
    device_token: String,
    device_name: String,
}
async fn room_player_rename(
    State(state): State<AppState>,
    Json(input): Json<RenameInput>,
) -> AppResult<Json<Value>> {
    let token = input.device_token.trim().to_string();
    let name = input.device_name.trim().to_string();
    if token.is_empty() {
        return Err(AppError::BadRequest("missing_device_token".into()));
    }
    if name.is_empty() {
        return Err(AppError::BadRequest("missing_device_name".into()));
    }
    if name.len() > 80 {
        return Err(AppError::BadRequest("name_too_long".into()));
    }

    let pool = state.db.clone();
    let value = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = pool.get()?;
        let token_hash = sha256_hex(&token);
        let device_id: Option<String> = conn
            .query_row(
                "SELECT id FROM paired_devices WHERE pair_token_hash = ?1",
                [&token_hash],
                |r| r.get(0),
            )
            .optional()?;
        let Some(device_id) = device_id else {
            return Err(AppError::NotFound("device_not_found".into()));
        };
        conn.execute(
            "UPDATE paired_devices SET device_name = ?1, last_seen_at = ?2 WHERE id = ?3",
            params![name, Utc::now().to_rfc3339(), device_id],
        )?;
        Ok(json!({ "device_id": device_id, "device_name": name }))
    })
    .await??;
    Ok(Json(value))
}

// ── room-player-set-current ───────────────────────────────────────────────
#[derive(Deserialize)]
struct SetCurrentInput {
    device_token: String,
    #[serde(default)]
    presentation_id: Option<String>,
}
async fn room_player_set_current(
    State(state): State<AppState>,
    Json(input): Json<SetCurrentInput>,
) -> AppResult<Json<Value>> {
    let token = input.device_token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::BadRequest("missing_device_token".into()));
    }
    let presentation_id = input
        .presentation_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let pool = state.db.clone();
    let value = tokio::task::spawn_blocking(move || -> AppResult<Value> {
        let conn = pool.get()?;
        let token_hash = sha256_hex(&token);
        let device: Option<(String, String, Option<String>)> = conn
            .query_row(
                "SELECT id, event_id, room_id FROM paired_devices WHERE pair_token_hash = ?1",
                [&token_hash],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((_device_id, event_id, room_id)) = device else {
            return Err(AppError::NotFound("device_not_found".into()));
        };
        let Some(room_id) = room_id else {
            return Err(AppError::Conflict("device_not_in_room".into()));
        };

        if let Some(ref pid) = presentation_id {
            let pres: Option<(String, Option<String>)> = conn
                .query_row(
                    "SELECT event_id, session_id FROM presentations WHERE id = ?1",
                    [pid],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let Some((p_event_id, session_id)) = pres else {
                return Err(AppError::NotFound("presentation_not_in_event".into()));
            };
            if p_event_id != event_id {
                return Err(AppError::NotFound("presentation_not_in_event".into()));
            }
            if let Some(sid) = session_id {
                let session_room: Option<String> = conn
                    .query_row(
                        "SELECT room_id FROM sessions WHERE id = ?1",
                        [&sid],
                        |r| r.get(0),
                    )
                    .optional()?;
                if session_room != Some(room_id.clone()) {
                    return Err(AppError::Forbidden("presentation_not_in_device_room".into()));
                }
            }
        }

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO room_state (room_id, tenant_id, event_id, current_presentation_id, current_session_id, sync_status, playback_mode, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, 'online', 'auto', ?5)
             ON CONFLICT(room_id) DO UPDATE SET
                current_presentation_id = excluded.current_presentation_id,
                updated_at = excluded.updated_at",
            params![room_id, LOCAL_TENANT_ID, event_id, presentation_id, now],
        )?;

        Ok(json!({ "room_id": room_id, "current_presentation_id": presentation_id }))
    })
    .await??;
    Ok(Json(value))
}

fn is_six_digits(s: &str) -> bool {
    s.len() == 6 && s.chars().all(|c| c.is_ascii_digit())
}

// ── lan-sign-url (Sprint N2) ──────────────────────────────────────────────
//
// Il PC sala (in modalita desktop) ha un `device_token` ma NON ha l'admin_token
// del server admin. Per scaricare i file via signed URL HMAC chiama questo
// endpoint passando token + storage_key + bucket. L'admin valida il token
// (presente in `paired_devices`), verifica che la storage_key appartenga a una
// presentation del proprio event_id, e ritorna il signed URL.
//
// La risposta usa lo stesso shape di `/storage/v1/object/sign/<bucket>/<key>`
// (Supabase) ma senza richiedere admin auth: `{ signedURL, path, expiresIn }`.
//
// Sicurezza:
//   • Match `device_token` (sha256) con `paired_devices.pair_token_hash`.
//   • Verifica `presentation_versions.storage_key = ?1 AND event_id matchi quello del device`.
//     Questo blocca un sala maligno che provi a scaricare file di altri eventi
//     paired sullo stesso server admin (multi-evento).
//   • TTL signed URL = 600s (10 min, sufficiente per download anche di file 5GB
//     a 10MB/s = 8 min). Configurabile lato client via `expires_in`.
#[derive(Deserialize)]
struct LanSignUrlInput {
    device_token: String,
    storage_key: String,
    #[serde(default = "default_bucket")]
    bucket: String,
    #[serde(default)]
    expires_in: Option<u64>,
}
fn default_bucket() -> String {
    "presentations".to_string()
}

async fn lan_sign_url(
    State(state): State<AppState>,
    Json(input): Json<LanSignUrlInput>,
) -> AppResult<Json<Value>> {
    let token = input.device_token.trim().to_string();
    if token.is_empty() {
        return Err(AppError::BadRequest("missing_device_token".into()));
    }
    if input.storage_key.trim().is_empty() {
        return Err(AppError::BadRequest("missing_storage_key".into()));
    }
    if input.bucket != "presentations" {
        return Err(AppError::BadRequest("only_presentations_bucket_supported".into()));
    }

    let pool = state.db.clone();
    let storage_key = input.storage_key.clone();
    let bucket = input.bucket.clone();
    // 1) Valida device_token + scope: la storage_key deve appartenere all'event_id del device.
    //    `?` propaga errori di validazione (Unauthorized/NotFound/Forbidden) come response HTTP
    //    al sala chiamante.
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        let conn = pool.get()?;
        let token_hash = sha256_hex(&token);
        let device_event: Option<String> = conn
            .query_row(
                "SELECT event_id FROM paired_devices WHERE pair_token_hash = ?1",
                [&token_hash],
                |r| r.get(0),
            )
            .optional()?;
        let Some(device_event_id) = device_event else {
            return Err(AppError::Unauthorized("invalid_device_token".into()));
        };

        let pres_event: Option<String> = conn
            .query_row(
                "SELECT p.event_id
                   FROM presentation_versions v
                   JOIN presentations p ON p.id = v.presentation_id
                  WHERE v.storage_key = ?1
                  LIMIT 1",
                [&storage_key],
                |r| r.get(0),
            )
            .optional()?;
        let Some(pres_event_id) = pres_event else {
            return Err(AppError::NotFound("storage_key_not_found".into()));
        };
        if pres_event_id != device_event_id {
            return Err(AppError::Forbidden("storage_key_not_in_device_event".into()));
        }
        Ok(())
    })
    .await??;

    // 2) Costruisci il signed URL HMAC. Usa `state.admin_base_url()` per dare un URL assoluto
    //    al sala (`build_signed_url` ritorna solo path+query). Fallback `127.0.0.1:7300`
    //    se non c'e' IP LAN (caso degenere: sala e admin sulla stessa macchina, dev test).
    let expires_in = input.expires_in.unwrap_or(600);
    let signed_path = crate::server::storage::build_signed_url(
        &state.hmac_secret,
        &bucket,
        &input.storage_key,
        expires_in,
    )?;
    let absolute = match state.admin_base_url() {
        Some(base) => format!("{}{}", base.trim_end_matches('/'), signed_path),
        None => format!("http://127.0.0.1:7300{signed_path}"),
    };

    Ok(Json(json!({
        "signedURL": absolute,
        "path": format!("{}/{}", bucket, input.storage_key),
        "expiresIn": expires_in,
    })))
}
