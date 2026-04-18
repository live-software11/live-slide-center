//! HTTP client per Supabase Edge Functions (Sprint D1, esteso Sprint SR).
//!
//! Endpoint:
//!   POST  /functions/v1/desktop-bind-claim          (no auth, body porta token magic)
//!   POST  /functions/v1/desktop-license-verify      (Authorization: Bearer pair_token)
//!   POST  /functions/v1/desktop-license-renew       (Authorization: Bearer old_pair_token)
//!
//! Uso `reqwest` (gia' presente per fan-out admin → PC sala). Riusa lo stesso
//! TLS rustls del server, niente OpenSSL.

use anyhow::{anyhow, Context, Result};
use std::time::Duration;

use super::types::{BindRequest, BindResponse, RenewRequest, RenewResponse, VerifyRequest, VerifyResponse};

/// Errore semantico ritornato dalle edge functions; mappato 1:1 sui codici
/// listati in `desktop-bind-claim/index.ts`, `desktop-license-verify/index.ts`
/// e `desktop-license-renew/index.ts`.
#[derive(Debug, thiserror::Error)]
pub enum LicenseClientError {
    #[error("token invalido (magic-link non riconosciuto)")]
    TokenInvalid,
    #[error("token revocato dall'admin")]
    TokenRevoked,
    #[error("token scaduto")]
    TokenExpired,
    #[error("token gia' usato il numero massimo di volte")]
    TokenExhausted,
    #[error("tenant cloud sospeso")]
    TenantSuspended,
    #[error("licenza tenant scaduta")]
    LicenseExpired,
    #[error("device sconosciuto sul cloud (re-bind necessario)")]
    DeviceUnknown,
    #[error("device revocato dall'admin (re-bind necessario)")]
    DeviceRevoked,
    /// Sprint SR — il pair_token corrente è scaduto. L'admin deve rigenerare
    /// un magic-link e l'utente deve fare bind di nuovo. Le funzioni cloud
    /// continuano in grace finché grace_until non scade.
    #[error("pair_token scaduto: chiedere all'admin un nuovo magic-link")]
    PairTokenExpired,
    #[error("rate limit superato, riprova tra 60 secondi")]
    RateLimited,
    #[error("errore di rete: {0}")]
    Network(String),
    #[error("errore inatteso ({code}): {raw}")]
    Other { code: u16, raw: String },
}

fn map_error_code(status: u16, body_msg: &str) -> LicenseClientError {
    match body_msg {
        "token_invalid" => LicenseClientError::TokenInvalid,
        "token_revoked" => LicenseClientError::TokenRevoked,
        "token_expired" => LicenseClientError::TokenExpired,
        "token_exhausted" => LicenseClientError::TokenExhausted,
        "tenant_suspended" => LicenseClientError::TenantSuspended,
        "license_expired" => LicenseClientError::LicenseExpired,
        "device_unknown" => LicenseClientError::DeviceUnknown,
        "device_revoked" => LicenseClientError::DeviceRevoked,
        "pair_token_expired" => LicenseClientError::PairTokenExpired,
        "rate_limited" => LicenseClientError::RateLimited,
        _ => LicenseClientError::Other {
            code: status,
            raw: body_msg.to_string(),
        },
    }
}

#[derive(Clone)]
pub struct LicenseClient {
    http: reqwest::Client,
    base_url: String,
    anon_key: String,
}

impl LicenseClient {
    pub fn new(base_url: String, anon_key: String) -> Result<Self> {
        let http = reqwest::Client::builder()
            .user_agent(concat!("slide-center-desktop/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .context("build reqwest client")?;
        Ok(Self {
            http,
            base_url,
            anon_key,
        })
    }

    pub async fn bind(&self, req: BindRequest) -> Result<BindResponse> {
        let url = format!("{}/desktop-bind-claim", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("authorization", format!("Bearer {}", self.anon_key))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!(LicenseClientError::Network(e.to_string())))?;

        let status = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();

        if status == 200 {
            let parsed: BindResponse = serde_json::from_str(&body_text)
                .with_context(|| format!("parse bind 200 body: {body_text}"))?;
            return Ok(parsed);
        }

        let err_msg = parse_error_msg(&body_text).unwrap_or_else(|| body_text.clone());
        Err(anyhow!(map_error_code(status, &err_msg)))
    }

    pub async fn verify(&self, pair_token: &str, req: VerifyRequest) -> Result<VerifyResponse> {
        let url = format!("{}/desktop-license-verify", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("authorization", format!("Bearer {pair_token}"))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!(LicenseClientError::Network(e.to_string())))?;

        let status = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();

        if status == 200 {
            let parsed: VerifyResponse = serde_json::from_str(&body_text)
                .with_context(|| format!("parse verify 200 body: {body_text}"))?;
            return Ok(parsed);
        }

        let err_msg = parse_error_msg(&body_text).unwrap_or_else(|| body_text.clone());
        Err(anyhow!(map_error_code(status, &err_msg)))
    }

    /// Sprint SR — rotazione atomica del pair_token.
    ///
    /// Il caller passa l'OLD pair_token come Bearer e lo sha256 del NUOVO
    /// pair_token nel body. Server-side la transazione:
    ///   - verifica che old token sia valido + attivo + non scaduto
    ///   - sostituisce `pair_token_hash` col nuovo
    ///   - sposta `pair_token_expires_at` a now + 12 mesi
    ///   - aggiorna `last_renew_at`, `last_seen_at`
    ///
    /// Se l'old token è già scaduto: errore `pair_token_expired` → serve
    /// re-bind admin (questo metodo NON può salvarci, da design).
    pub async fn renew(&self, old_pair_token: &str, req: RenewRequest) -> Result<RenewResponse> {
        let url = format!("{}/desktop-license-renew", self.base_url);
        let resp = self
            .http
            .post(&url)
            .header("apikey", &self.anon_key)
            .header("authorization", format!("Bearer {old_pair_token}"))
            .json(&req)
            .send()
            .await
            .map_err(|e| anyhow!(LicenseClientError::Network(e.to_string())))?;

        let status = resp.status().as_u16();
        let body_text = resp.text().await.unwrap_or_default();

        if status == 200 {
            let parsed: RenewResponse = serde_json::from_str(&body_text)
                .with_context(|| format!("parse renew 200 body: {body_text}"))?;
            return Ok(parsed);
        }

        let err_msg = parse_error_msg(&body_text).unwrap_or_else(|| body_text.clone());
        Err(anyhow!(map_error_code(status, &err_msg)))
    }
}

fn parse_error_msg(body: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(String::from))
}
