// Sprint K1 (GUIDA_OPERATIVA_v3 §4.C K1) — error type unico per l'intero server.
//
// Strategia:
//   • un solo enum `AppError` con varianti specifiche per i casi che hanno status
//     HTTP distinti (Unauthorized 401, Forbidden 403, NotFound 404, BadRequest 400,
//     Conflict 409). Tutto il resto cade in `Internal` 500.
//   • From<rusqlite::Error>, From<r2d2::Error>, From<std::io::Error> per `?` ergonomico
//     senza scrivere `.map_err(...)` in ogni handler.
//   • IntoResponse: ritorna sempre JSON `{ "error": <code>, "message": <human> }`
//     compatibile con il fmt errore Supabase REST/PostgREST (`{"code","message"}`)
//     in modo che la SPA possa fare un singolo error-mapper.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use tracing::error;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("unauthorized: {0}")]
    Unauthorized(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("conflict: {0}")]
    Conflict(String),

    #[allow(dead_code)] // Sprint M: usata quando aggiungeremo limit chunked upload.
    #[error("payload too large: {0}")]
    PayloadTooLarge(String),

    #[error("range not satisfiable")]
    RangeNotSatisfiable,

    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("pool: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("join: {0}")]
    Join(#[from] tokio::task::JoinError),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("internal: {0}")]
    Internal(String),
}

impl AppError {
    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::Unauthorized(_) => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "not_found"),
            AppError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            AppError::PayloadTooLarge(_) => (StatusCode::PAYLOAD_TOO_LARGE, "payload_too_large"),
            AppError::RangeNotSatisfiable => (StatusCode::RANGE_NOT_SATISFIABLE, "range_not_satisfiable"),
            AppError::Io(_) | AppError::Sqlite(_) | AppError::Pool(_) | AppError::Join(_)
            | AppError::Json(_) | AppError::Internal(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, "internal_error")
            }
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        // Log degli errori 5xx con livello error, 4xx silenziosi (saturerebbero i log
        // su request "normali" tipo 404 di endpoint inesistenti).
        if status.is_server_error() {
            error!(target: "slide_center::server", error = %self, "richiesta fallita");
        }
        let body = Json(json!({
            "error": code,
            "message": self.to_string(),
        }));
        (status, body).into_response()
    }
}

pub type AppResult<T> = Result<T, AppError>;
