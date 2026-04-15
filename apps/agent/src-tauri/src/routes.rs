use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use std::collections::HashMap;
use tower_http::cors::{Any, CorsLayer};

use crate::db::{list_cached_files, list_room_agents, upsert_room_agent, RegisteredRoomAgent};
use crate::state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
    event_id: Option<String>,
    cached_files: usize,
    room_agents: usize,
}

#[derive(Deserialize)]
struct EventQuery {
    event_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
pub struct RegisterRequest {
    pub room_id: Option<String>,
    pub ip: String,
    pub port: u16,
    pub device_name: String,
}

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        .route("/api/v1/health", get(health_handler))
        .route("/api/v1/files", get(list_files_handler))
        .route("/api/v1/files/:event_id", get(list_files_for_event_handler))
        .route("/api/v1/files/:event_id/:filename", get(serve_file_handler))
        .route("/api/v1/rooms", get(list_room_agents_handler))
        .route("/api/v1/register", post(register_handler))
        .layer(cors)
        .with_state(state)
}

async fn health_handler(State(state): State<AppState>) -> Json<HealthResponse> {
    let db = state.db.lock().unwrap();
    let event_id = state.event_id.lock().unwrap().clone();
    let cached = event_id
        .as_deref()
        .and_then(|eid| list_cached_files(&db, eid).ok())
        .map(|f| f.len())
        .unwrap_or(0);
    let agents = list_room_agents(&db).map(|a| a.len()).unwrap_or(0);
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        event_id,
        cached_files: cached,
        room_agents: agents,
    })
}

async fn list_files_handler(
    State(state): State<AppState>,
    Query(params): Query<EventQuery>,
) -> Result<Json<Vec<crate::db::CachedFile>>, StatusCode> {
    let event_id = params
        .event_id
        .or_else(|| state.event_id.lock().unwrap().clone())
        .ok_or(StatusCode::BAD_REQUEST)?;
    let db = state.db.lock().unwrap();
    let files = list_cached_files(&db, &event_id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(files))
}

async fn list_files_for_event_handler(
    State(state): State<AppState>,
    Path(event_id): Path<String>,
) -> Result<Json<Vec<crate::db::CachedFile>>, StatusCode> {
    let db = state.db.lock().unwrap();
    let files = list_cached_files(&db, &event_id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(files))
}

async fn serve_file_handler(
    State(state): State<AppState>,
    Path(params): Path<HashMap<String, String>>,
) -> Result<axum::response::Response, StatusCode> {
    use axum::body::Body;
    use axum::http::header;
    use tokio_util::io::ReaderStream;

    let filename = params.get("filename").ok_or(StatusCode::BAD_REQUEST)?;
    let event_id = params.get("event_id").ok_or(StatusCode::BAD_REQUEST)?;

    let db = state.db.lock().unwrap();
    let files = list_cached_files(&db, event_id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    drop(db);

    let cached = files
        .into_iter()
        .find(|f| f.filename == *filename)
        .ok_or(StatusCode::NOT_FOUND)?;

    let path = std::path::Path::new(&cached.local_path);
    if !path.exists() {
        return Err(StatusCode::NOT_FOUND);
    }

    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let metadata = file.metadata().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let stream = ReaderStream::new(file);

    Ok(axum::response::Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, metadata.len())
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", filename),
        )
        .body(Body::from_stream(stream))
        .unwrap())
}

async fn list_room_agents_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<RegisteredRoomAgent>>, StatusCode> {
    let db = state.db.lock().unwrap();
    let agents = list_room_agents(&db).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(agents))
}

async fn register_handler(
    State(state): State<AppState>,
    Json(payload): Json<RegisterRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let agent = RegisteredRoomAgent {
        id: Uuid::new_v4().to_string(),
        room_id: payload.room_id,
        ip: payload.ip,
        port: payload.port,
        device_name: payload.device_name,
        last_seen: Utc::now().to_rfc3339(),
    };
    let db = state.db.lock().unwrap();
    upsert_room_agent(&db, &agent).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({ "id": agent.id, "status": "registered" })))
}
