// Sprint K1 (GUIDA_OPERATIVA_v3 §4.C K1) — autenticazione locale.
//
// Due meccanismi distinti:
//
//   1) **Admin token bearer** — richiesto su tutti gli endpoint REST `/rest/v1/*`,
//      sulle RPC admin e sull'upload storage. Generato al primo avvio in
//      `~/.slidecenter/admin_token.json` con `Uuid::new_v4()`. Il client desktop
//      lo legge via Tauri command e lo include come `Authorization: Bearer <token>`.
//      In modalita single-user e' una password lunga 36 char persistita su disco
//      (NON un JWT) — sufficiente perche' il server bind 127.0.0.1 + LAN che
//      e' gia' un dominio fidato.
//
//   2) **Device token raw** — passato nel body delle Edge Function `room-player-*`
//      e `pair-claim`. Lato server lo confrontiamo con `paired_devices.pair_token_hash`
//      via SHA-256 (stesso algoritmo del cloud Supabase, vedi `pair-claim/index.ts`).
//      Cosi' anche se il DB locale leakasse, gli attaccanti non possono ricostruire i
//      token in chiaro (e quindi rubare le sessioni dei PC sala).

use std::sync::Arc;

use axum::{
    extract::{FromRequestParts, State},
    http::{header::AUTHORIZATION, request::Parts},
};
use sha2::{Digest, Sha256};

use crate::server::{error::AppError, state::AppState};

/// Calcola lo SHA-256 hex-encoded di una stringa, identico a
/// `sha256Hex` di `supabase/functions/pair-claim/index.ts`.
pub fn sha256_hex(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    hex::encode(hasher.finalize())
}

/// Estrae il bearer token dall'header `Authorization`. Ritorna `None` se manca
/// o non e' nel formato `Bearer <token>` (case-insensitive).
pub fn parse_bearer(parts: &Parts) -> Option<String> {
    let raw = parts.headers.get(AUTHORIZATION)?.to_str().ok()?;
    let mut iter = raw.splitn(2, ' ');
    let scheme = iter.next()?;
    let token = iter.next()?.trim();
    if !scheme.eq_ignore_ascii_case("bearer") || token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

/// Confronto in tempo costante (resistente a side-channel timing) tra il token
/// fornito dal client e l'admin_token in stato.
fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.bytes().zip(b.bytes()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Extractor axum: rifiuta la richiesta con 401 se manca o non corrisponde
/// all'`admin_token`. Da agganciare a tutte le route che oggi su Supabase
/// richiedono un JWT `authenticated` (REST + RPC admin + upload).
pub struct AdminAuth;

#[axum::async_trait]
impl FromRequestParts<AppState> for AdminAuth {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parse_bearer(parts).ok_or_else(|| {
            AppError::Unauthorized("missing or malformed Authorization header".into())
        })?;
        let admin: Arc<String> = state.admin_token.clone();
        if !constant_time_eq(&token, admin.as_str()) {
            return Err(AppError::Unauthorized("invalid admin token".into()));
        }
        Ok(AdminAuth)
    }
}

/// Variante "opzionale": l'handler riceve `Option<AdminAuth>`. Utile per gli
/// endpoint che sono pubblici ma loggano il caller se admin (es. `pair-init`
/// che oggi su Supabase richiede JWT ma in desktop puo' essere chiamato dalla
/// SPA che ha gia' l'admin_token).
#[allow(dead_code)]
pub struct OptionalAdminAuth(pub bool);

#[axum::async_trait]
impl FromRequestParts<AppState> for OptionalAdminAuth {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let Some(token) = parse_bearer(parts) else {
            return Ok(OptionalAdminAuth(false));
        };
        Ok(OptionalAdminAuth(constant_time_eq(&token, state.admin_token.as_str())))
    }
}

/// Risolve `device_token` (in chiaro, dal body) → row `paired_devices` matching
/// `pair_token_hash`. Ritorna NotFound se nessun device matcha.
/// Pensata per `room-player-bootstrap` / `room-player-rename` / `rpc_room_player_set_current`.
pub async fn resolve_device(
    state: &AppState,
    raw_token: &str,
) -> Result<DeviceRow, AppError> {
    let raw = raw_token.trim().to_string();
    if raw.is_empty() {
        return Err(AppError::BadRequest("missing device_token".into()));
    }
    let hash = sha256_hex(&raw);

    let pool = state.db.clone();
    let row = tokio::task::spawn_blocking(move || -> Result<Option<DeviceRow>, AppError> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, tenant_id, event_id, room_id, device_name, status, paired_at
             FROM paired_devices
             WHERE pair_token_hash = ?1
             LIMIT 1",
        )?;
        let mut rows = stmt.query([&hash])?;
        if let Some(r) = rows.next()? {
            Ok(Some(DeviceRow {
                id: r.get::<_, String>(0)?,
                tenant_id: r.get::<_, String>(1)?,
                event_id: r.get::<_, String>(2)?,
                room_id: r.get::<_, Option<String>>(3)?,
                device_name: r.get::<_, String>(4)?,
                status: r.get::<_, String>(5)?,
                paired_at: r.get::<_, String>(6)?,
            }))
        } else {
            Ok(None)
        }
    })
    .await??;

    row.ok_or_else(|| AppError::NotFound("invalid_token".into()))
}

#[derive(Debug, Clone)]
#[allow(dead_code)] // Sprint K: alcuni campi servono solo a sotto-set di RPC; in Sprint L+ tutti.
pub struct DeviceRow {
    pub id: String,
    pub tenant_id: String,
    pub event_id: String,
    pub room_id: Option<String>,
    pub device_name: String,
    pub status: String,
    pub paired_at: String,
}

// `_state` reservato per parametro futuro (es. metrics). Mantengo l'API stabile.
#[allow(dead_code)]
pub fn ensure_state(_state: State<AppState>) {}
