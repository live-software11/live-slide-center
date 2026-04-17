//! Wrapper HTTP async verso Live WORKS APP `/api/{activate,verify,deactivate}`.
//!
//! GEMELLO con `apps/agent/src-tauri/src/license/api.rs`.

use super::types::{
    ActivateRequest, ActivateResponse, DeactivateRequest, VerifyRequest, VerifyResponse,
};
use super::API_BASE_URL;

const TIMEOUT_SECS: u64 = 45;

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .user_agent(format!(
            "LiveSlideCenterRoomAgent/{}",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|e| format!("HTTP client: {}", e))
}

pub async fn post_activate(body: &ActivateRequest<'_>) -> Result<ActivateResponse, String> {
    let client = http_client()?;
    let res = client
        .post(format!("{}/activate", API_BASE_URL))
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Rete: {}", e))?;
    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| {
        format!(
            "Risposta server non valida ({}). Snippet: {}",
            status,
            text.chars().take(200).collect::<String>()
        )
    })
}

pub async fn post_verify(body: &VerifyRequest<'_>) -> Result<VerifyResponse, String> {
    let client = http_client()?;
    let res = client
        .post(format!("{}/verify", API_BASE_URL))
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Rete: {}", e))?;
    let text = res.text().await.map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|_| "Risposta verify non valida".to_string())
}

/// Best-effort: errori di rete vengono ignorati (la deact locale procede comunque).
pub async fn post_deactivate(body: &DeactivateRequest<'_>) {
    let client = match http_client() {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = client
        .post(format!("{}/deactivate", API_BASE_URL))
        .json(body)
        .send()
        .await;
}
