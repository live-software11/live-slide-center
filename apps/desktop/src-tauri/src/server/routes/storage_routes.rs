// Sprint K4 (GUIDA_OPERATIVA_v3 §4.C K4) — endpoint storage HTTP.
//
// Tre route:
//   1. POST /storage/v1/object/{bucket}/{*key}     (admin auth, body = bytes)
//      → scrive `<storage_root>/<bucket>/<key>`. mkdir -p della directory parent.
//      → 409 se file esiste e size > 0 (caller deve abort_upload prima di re-init).
//
//   2. GET  /storage/v1/object/sign/{bucket}/{*key} (admin auth)
//      → ritorna `{"signedURL":"http://127.0.0.1:7300/storage-files/<bucket>/<key>?...",
//                 "path":"...", "token":"sig"}` (compat shape Supabase storage-js).
//
//   3. GET  /storage-files/{bucket}/{*key}?expires&sig    (no auth, signed URL)
//      → serve il file con Content-Type guessato + Range request support.
//      → 401 se scaduto/firma invalida.
//
// Range header parsing:
//   "Range: bytes=0-499"     → first 500 bytes
//   "Range: bytes=500-"      → from 500 to EOF
//   "Range: bytes=-500"      → last 500 bytes
//   altri formati             → 416 Range Not Satisfiable

use std::path::PathBuf;

use axum::{
    body::Body,
    extract::{Path, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::server::{
    auth::AdminAuth,
    error::{AppError, AppResult},
    state::AppState,
    storage::{build_signed_url, object_path, verify_signed_url},
};

pub fn routes() -> Router<AppState> {
    // axum 0.7: `:name` per segmento singolo, `*name` per catch-all (slash inclusi).
    Router::new()
        .route("/storage/v1/object/:bucket/*key", post(upload_object))
        .route("/storage/v1/object/sign/:bucket/*key", get(sign_object))
        .route("/storage-files/:bucket/*key", get(serve_object))
}

// ── 1. Upload ──────────────────────────────────────────────────────────────
async fn upload_object(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
    body: Body,
) -> AppResult<Response> {
    let path: PathBuf = object_path(&state.storage_root, &bucket, &key)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    // Streaming write: niente buffer in RAM. Indispensabile per file da 5+ GB.
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&path)
        .await?;

    let mut stream = body.into_data_stream();
    let mut total: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| AppError::Internal(format!("body stream: {e}")))?;
        total += bytes.len() as u64;
        file.write_all(&bytes).await?;
    }
    file.flush().await?;

    Ok((
        StatusCode::CREATED,
        Json(json!({
            "Key": format!("{bucket}/{key}"),
            "size": total,
        })),
    )
        .into_response())
}

// ── 2. Sign ────────────────────────────────────────────────────────────────
#[derive(Deserialize, Default)]
struct SignParams {
    #[serde(default)]
    expires_in: Option<u64>,
}

async fn sign_object(
    _admin: AdminAuth,
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
    Query(params): Query<SignParams>,
) -> AppResult<Json<serde_json::Value>> {
    let expires_in = params.expires_in.unwrap_or(60 * 60); // default: 1h
    let signed = build_signed_url(&state.hmac_secret, &bucket, &key, expires_in)?;
    Ok(Json(json!({
        "signedURL": signed,
        "path": format!("{bucket}/{key}"),
    })))
}

// ── 3. Serve (con Range) ───────────────────────────────────────────────────
#[derive(Deserialize)]
struct ServeParams {
    expires: u64,
    sig: String,
}

async fn serve_object(
    State(state): State<AppState>,
    Path((bucket, key)): Path<(String, String)>,
    Query(params): Query<ServeParams>,
    request: Request,
) -> AppResult<Response> {
    verify_signed_url(&state.hmac_secret, &bucket, &key, params.expires, &params.sig)?;

    let path: PathBuf = object_path(&state.storage_root, &bucket, &key)?;
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|_| AppError::NotFound(format!("object not found: {bucket}/{key}")))?;
    if !meta.is_file() {
        return Err(AppError::NotFound(format!("not a file: {bucket}/{key}")));
    }
    let total = meta.len();

    let mime: String = mime_guess::from_path(&path)
        .first_or_octet_stream()
        .essence_str()
        .to_string();

    let range_header = request.headers().get(header::RANGE).cloned();

    // Common headers su tutte le response.
    let mut headers = HeaderMap::new();
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("private, max-age=300"),
    );
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );

    if let Some(range) = range_header {
        let raw = range.to_str().map_err(|_| AppError::BadRequest("invalid Range header".into()))?;
        let (start, end) = parse_range(raw, total)?;
        let length = end - start + 1;

        let mut file = tokio::fs::File::open(&path).await?;
        file.seek(std::io::SeekFrom::Start(start)).await?;
        let stream = ReaderStream::new(file.take(length));

        headers.insert(
            header::CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{total}"))
                .map_err(|e| AppError::Internal(e.to_string()))?,
        );
        headers.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&length.to_string()).map_err(|e| AppError::Internal(e.to_string()))?,
        );

        return Ok((StatusCode::PARTIAL_CONTENT, headers, Body::from_stream(stream)).into_response());
    }

    let file = tokio::fs::File::open(&path).await?;
    let stream = ReaderStream::new(file);
    headers.insert(
        header::CONTENT_LENGTH,
        HeaderValue::from_str(&total.to_string()).map_err(|e| AppError::Internal(e.to_string()))?,
    );
    Ok((StatusCode::OK, headers, Body::from_stream(stream)).into_response())
}

/// Parsa `bytes=START-END` con tre forme accettate.
/// Return: (start_inclusive, end_inclusive) clampati a [0, total-1].
fn parse_range(raw: &str, total: u64) -> Result<(u64, u64), AppError> {
    let raw = raw.trim();
    let suffix = raw.strip_prefix("bytes=").ok_or_else(|| AppError::BadRequest("range must start with bytes=".into()))?;
    // Multi-range non supportato (raro, complicato; tower-http non lo fa nemmeno di default).
    if suffix.contains(',') {
        return Err(AppError::BadRequest("multi-range not supported".into()));
    }
    let mut iter = suffix.splitn(2, '-');
    let start_s = iter.next().unwrap_or("");
    let end_s = iter.next().unwrap_or("");

    let (start, end) = match (start_s.is_empty(), end_s.is_empty()) {
        (false, false) => {
            let s: u64 = start_s.parse().map_err(|_| AppError::BadRequest("invalid range start".into()))?;
            let e: u64 = end_s.parse().map_err(|_| AppError::BadRequest("invalid range end".into()))?;
            (s, e.min(total.saturating_sub(1)))
        }
        (false, true) => {
            let s: u64 = start_s.parse().map_err(|_| AppError::BadRequest("invalid range start".into()))?;
            (s, total.saturating_sub(1))
        }
        (true, false) => {
            // suffix range: ultimi N bytes
            let n: u64 = end_s.parse().map_err(|_| AppError::BadRequest("invalid suffix range".into()))?;
            if n == 0 {
                return Err(AppError::RangeNotSatisfiable);
            }
            let n = n.min(total);
            (total.saturating_sub(n), total.saturating_sub(1))
        }
        (true, true) => return Err(AppError::BadRequest("empty range".into())),
    };

    if start > end || start >= total {
        return Err(AppError::RangeNotSatisfiable);
    }
    Ok((start, end))
}

