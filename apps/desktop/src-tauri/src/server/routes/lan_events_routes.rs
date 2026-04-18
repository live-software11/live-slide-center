// Sprint N2-N3 (GUIDA_OPERATIVA_v3 §4.F N2-N3) — handler HTTP per il bus eventi LAN.
//
// Tre endpoint:
//
//   POST /events/file_added           (no auth, LAN trust)
//     Body: { event_id, room_id?, version_id, presentation_id, file_name,
//             file_size_bytes, mime_type, file_hash_sha256?, storage_key,
//             admin_base_url? }
//     Effetto: il PC sala riceve la notifica push dall'admin, la pubblica sul
//     proprio `event_bus`, i client long-poll la consumano e fanno `refreshNow()`.
//     Solo nodi `role == "sala"` accettano (sull'admin non ha senso).
//
//   POST /events/presentation_deleted (no auth, LAN trust)
//     Body: { event_id, presentation_id, version_ids[] }
//     Effetto: stessa pipeline. Il sala fa refreshNow() che recepisce l'assenza.
//     Cleanup file orfani sul disco al prossimo ciclo `useFileSync` (gia' presente).
//
//   GET /events/stream?since=<u64>&timeout_ms=<u64>   (no auth)
//     Long-poll: se ci sono eventi con id > since, ritorna subito.
//     Altrimenti aspetta fino a `timeout_ms` (default 25000, max 60000) per
//     un nuovo broadcast. Risposta: { events: [...], cursor: <last_id> }.
//     Senza `since`, ritorna lo snapshot ring (ultimi 32 eventi recenti).
//
// Sicurezza:
//   • LAN trust come pair-direct (chi raggiunge la porta 7300 e' fidato).
//   • In futuro: HMAC header `X-Slidecenter-Signature` con admin_token come
//     shared secret derivato al pair-direct (Sprint Q).

use std::time::Duration;

use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast::error::RecvError;
use tracing::{debug, info, warn};

use crate::server::{
    error::{AppError, AppResult},
    lan_events::{LanEvent, LanEventPayload},
    state::AppState,
};

const DEFAULT_LONGPOLL_TIMEOUT_MS: u64 = 25_000;
const MAX_LONGPOLL_TIMEOUT_MS: u64 = 60_000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/events/file_added", post(receive_file_added))
        .route("/events/presentation_deleted", post(receive_presentation_deleted))
        .route("/events/stream", get(stream_events))
}

// ── 1. Receive: POST /events/file_added (admin → sala) ───────────────────

async fn receive_file_added(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> AppResult<Json<Value>> {
    enforce_role_sala(&state)?;
    let parsed: LanEventPayload =
        serde_json::from_value(materialize_kind(&payload, "file_added"))
            .map_err(|e| AppError::BadRequest(format!("invalid file_added body: {e}")))?;

    if !matches!(parsed, LanEventPayload::FileAdded { .. }) {
        return Err(AppError::BadRequest("expected kind=file_added".into()));
    }

    let evt = state.event_bus.publish(parsed);
    info!(
        evt_id = evt.id,
        "lan-events: ricevuto file_added dall'admin, pubblicato su event_bus"
    );
    Ok(Json(json!({ "ok": true, "event_id": evt.id })))
}

// ── 2. Receive: POST /events/presentation_deleted (admin → sala) ─────────

async fn receive_presentation_deleted(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> AppResult<Json<Value>> {
    enforce_role_sala(&state)?;
    let parsed: LanEventPayload =
        serde_json::from_value(materialize_kind(&payload, "presentation_deleted"))
            .map_err(|e| AppError::BadRequest(format!("invalid presentation_deleted body: {e}")))?;

    if !matches!(parsed, LanEventPayload::PresentationDeleted { .. }) {
        return Err(AppError::BadRequest("expected kind=presentation_deleted".into()));
    }

    let evt = state.event_bus.publish(parsed);
    info!(
        evt_id = evt.id,
        "lan-events: ricevuto presentation_deleted dall'admin"
    );
    Ok(Json(json!({ "ok": true, "event_id": evt.id })))
}

// ── 3. Stream: GET /events/stream?since=&timeout_ms= (sala → SPA webview) ─

#[derive(Debug, Deserialize)]
struct StreamParams {
    #[serde(default)]
    since: Option<u64>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    /// Filter opzionale: solo eventi per questo `event_id`. La SPA passa l'event_id
    /// del proprio device.json per evitare di ricevere notifiche di eventi diversi
    /// (raro ma possibile in setup multi-evento sulla stessa sala).
    #[serde(default)]
    event_id: Option<String>,
}

async fn stream_events(
    State(state): State<AppState>,
    Query(params): Query<StreamParams>,
) -> AppResult<Json<Value>> {
    let since = params.since.unwrap_or(0);
    let timeout_ms = params
        .timeout_ms
        .unwrap_or(DEFAULT_LONGPOLL_TIMEOUT_MS)
        .min(MAX_LONGPOLL_TIMEOUT_MS);

    // 1) Snapshot: se ci sono eventi recenti con id > since, rispondi subito.
    let snapshot = state.event_bus.snapshot_since(since);
    let snapshot = filter_by_event_id(snapshot, params.event_id.as_deref());
    if !snapshot.is_empty() {
        let cursor = snapshot.iter().map(|e| e.id).max().unwrap_or(since);
        return Ok(Json(json!({
            "events": snapshot,
            "cursor": cursor,
        })));
    }

    // 2) Long-poll: subscribe e aspetta il primo broadcast o timeout.
    let mut rx = state.event_bus.subscribe();
    let event_filter = params.event_id.clone();
    let collected = match tokio::time::timeout(Duration::from_millis(timeout_ms), async move {
        loop {
            match rx.recv().await {
                Ok(evt) => {
                    if event_filter
                        .as_deref()
                        .map(|eid| event_id_match(&evt, eid))
                        .unwrap_or(true)
                    {
                        return Ok::<_, RecvError>(Some(evt));
                    }
                    // Skip evento di altro event_id, riprova ricezione.
                }
                Err(RecvError::Lagged(n)) => {
                    warn!(skipped = n, "lan-events: subscriber laggato, ritorno snapshot");
                    return Ok::<_, RecvError>(None);
                }
                Err(RecvError::Closed) => return Ok::<_, RecvError>(None),
            }
        }
    })
    .await
    {
        Ok(Ok(Some(evt))) => vec![evt],
        Ok(Ok(None)) | Err(_) => Vec::new(),
        Ok(Err(_)) => Vec::new(),
    };

    let cursor = collected.iter().map(|e| e.id).max().unwrap_or(since);
    let response_size = collected.len();
    debug!(?since, ?timeout_ms, returned = response_size, "lan-events: long-poll completato");
    Ok(Json(json!({
        "events": collected,
        "cursor": cursor,
    })))
}

// ── helpers ───────────────────────────────────────────────────────────────

/// Solo i PC sala accettano push (sull'admin il bus esiste ma e' inutile).
/// Differenziando per role evita confusione in dev (e.g. fan-out admin →
/// admin per errore di config DNS LAN).
fn enforce_role_sala(state: &AppState) -> AppResult<()> {
    if state.role.as_str() != "sala" {
        return Err(AppError::Forbidden("role_not_sala".into()));
    }
    Ok(())
}

/// Aggiunge `kind: "<expected>"` al payload in arrivo se manca, perche'
/// l'enum `LanEventPayload` usa `#[serde(tag = "kind")]` e l'admin manda
/// solo i campi del payload "interno". Rende l'API piu' tollerante.
fn materialize_kind(payload: &Value, expected: &str) -> Value {
    match payload {
        Value::Object(map) => {
            let mut m = map.clone();
            if !m.contains_key("kind") {
                m.insert("kind".into(), Value::String(expected.into()));
            }
            Value::Object(m)
        }
        _ => payload.clone(),
    }
}

fn filter_by_event_id(events: Vec<LanEvent>, event_id: Option<&str>) -> Vec<LanEvent> {
    let Some(eid) = event_id else { return events };
    events
        .into_iter()
        .filter(|e| event_id_match(e, eid))
        .collect()
}

fn event_id_match(evt: &LanEvent, event_id: &str) -> bool {
    match &evt.payload {
        LanEventPayload::FileAdded { event_id: eid, .. }
        | LanEventPayload::PresentationDeleted { event_id: eid, .. } => eid.as_str() == event_id,
    }
}
