//! Orchestratore alto livello del flusso licenze (Sprint D1).
//!
//! Espone le 3 operazioni principali invocate dalla UI / dal main bootstrap:
//!   - `bind(magic_link, device_name)` → consume token, salva license.enc
//!   - `verify_now()` → heartbeat ad hoc (chiamato da boot e UI)
//!   - `current_status()` → calcolo locale `LicenseStatus` da disco

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;

use super::client::LicenseClient;
use super::types::{BindRequest, LicenseData, LicenseStatus, VerifyRequest};
use super::{
    fingerprint, storage, GRACE_PERIOD_SECONDS, SUPABASE_FUNCTIONS_URL,
};

/// Anon key Supabase di Slide Center (ok in chiaro: e' una chiave PUBBLICA
/// rate-limited, identica a quella usata dalla SPA web). Override per
/// dev/staging via env `SLIDECENTER_SUPABASE_ANON_KEY`.
const SUPABASE_ANON_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNkanh4eGtyaGdka2Nwa2tvemRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ0NTYwMDAsImV4cCI6MjA2MDAzMjAwMH0.PUBLIC_ANON_PLACEHOLDER";

pub struct LicenseManager {
    client: LicenseClient,
}

impl LicenseManager {
    pub fn new() -> Result<Self> {
        let base = std::env::var("SLIDECENTER_SUPABASE_URL")
            .unwrap_or_else(|_| SUPABASE_FUNCTIONS_URL.to_string());
        let anon = std::env::var("SLIDECENTER_SUPABASE_ANON_KEY")
            .unwrap_or_else(|_| SUPABASE_ANON_KEY.to_string());
        let client = LicenseClient::new(base, anon).context("create LicenseClient")?;
        Ok(Self { client })
    }

    /// Binda il PC al tenant cloud usando il magic-link.
    pub async fn bind(&self, magic_link: &str, device_name_override: Option<String>) -> Result<()> {
        let token = parse_magic_link(magic_link).context("parse magic link")?;

        let pair_token = generate_pair_token();
        let machine_id = fingerprint::get_or_create_machine_id().context("machine fingerprint")?;
        let device_name = device_name_override
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(fingerprint::get_default_device_name);

        let req = BindRequest {
            token,
            pair_token: pair_token.clone(),
            device_name,
            machine_fingerprint: machine_id,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os_version: fingerprint::get_os_version(),
        };

        let resp = self.client.bind(req).await.context("desktop-bind-claim")?;
        let now = Utc::now();
        let grace_until = now + Duration::seconds(GRACE_PERIOD_SECONDS);

        let data = LicenseData {
            pair_token: resp.pair_token.clone(),
            device_id: resp.device_id,
            tenant_id: resp.tenant_id,
            tenant_name: None,
            plan: resp.license.as_ref().and_then(|l| l.plan.clone()),
            expires_at: resp.license.as_ref().and_then(|l| l.expires_at.clone()),
            last_verified_at: now.to_rfc3339(),
            grace_until: grace_until.to_rfc3339(),
            app_version: Some(env!("CARGO_PKG_VERSION").to_string()),
            bound_at: now.to_rfc3339(),
        };
        storage::save(&data).context("save license.enc after bind")?;
        Ok(())
    }

    /// Heartbeat: chiama desktop-license-verify e aggiorna license.enc.
    /// Chiamato al boot e da UI button "verifica ora".
    pub async fn verify_now(&self) -> Result<()> {
        let mut data = storage::load()
            .context("load license.enc")?
            .ok_or_else(|| anyhow!("not_bound"))?;

        let req = VerifyRequest {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        let resp = self
            .client
            .verify(&data.pair_token, req)
            .await
            .context("desktop-license-verify")?;

        let now = Utc::now();
        let grace_until = now + Duration::seconds(GRACE_PERIOD_SECONDS);
        data.tenant_name = resp.tenant_name;
        data.plan = resp.plan;
        data.expires_at = resp.expires_at;
        data.last_verified_at = now.to_rfc3339();
        data.grace_until = grace_until.to_rfc3339();
        data.app_version = Some(env!("CARGO_PKG_VERSION").to_string());
        storage::save(&data).context("save license.enc after verify")?;
        Ok(())
    }

    /// Calcolo `LicenseStatus` SOLO da disco (no I/O di rete). Chiamabile
    /// frequentemente dalla UI per render rapido.
    pub fn current_status(&self) -> LicenseStatus {
        match storage::load() {
            Ok(None) => LicenseStatus::NotBound,
            Err(e) => LicenseStatus::Error {
                message: format!("read license.enc: {e}"),
            },
            Ok(Some(data)) => self.classify(&data),
        }
    }

    fn classify(&self, data: &LicenseData) -> LicenseStatus {
        let now = Utc::now();
        let last_verified = match DateTime::parse_from_rfc3339(&data.last_verified_at) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(e) => {
                return LicenseStatus::Error {
                    message: format!("parse last_verified_at: {e}"),
                };
            }
        };
        let grace_until = match DateTime::parse_from_rfc3339(&data.grace_until) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => last_verified + Duration::seconds(GRACE_PERIOD_SECONDS),
        };
        let elapsed = now.signed_duration_since(last_verified);
        let days_remaining = (grace_until - now).num_days().max(0);

        if grace_until <= now {
            LicenseStatus::GraceExpired {
                tenant_name: data.tenant_name.clone(),
                last_verified_at: data.last_verified_at.clone(),
            }
        } else if elapsed > Duration::hours(24) {
            LicenseStatus::GracePeriod {
                tenant_name: data.tenant_name.clone(),
                plan: data.plan.clone(),
                last_verified_at: data.last_verified_at.clone(),
                grace_until: data.grace_until.clone(),
                days_remaining,
            }
        } else {
            LicenseStatus::Active {
                tenant_name: data.tenant_name.clone(),
                plan: data.plan.clone(),
                expires_at: data.expires_at.clone(),
                last_verified_at: data.last_verified_at.clone(),
            }
        }
    }
}

/// Estrae il `token` da un magic-link nei seguenti formati:
///   - `https://live-slide-center.vercel.app/desktop-bind?t=<token>`
///   - `https://live-slide-center.vercel.app/desktop-bind#t=<token>`
///   - direttamente il token plain (~43 char base64url)
pub fn parse_magic_link(input: &str) -> Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("empty magic link"));
    }
    if !trimmed.contains('/') && !trimmed.contains('?') && !trimmed.contains('#') {
        return Ok(trimmed.to_string());
    }
    if let Ok(parsed) = url::Url::parse(trimmed) {
        if let Some((_, v)) = parsed.query_pairs().find(|(k, _)| k == "t" || k == "token") {
            return Ok(v.into_owned());
        }
        if let Some(frag) = parsed.fragment() {
            for kv in frag.split('&') {
                if let Some((k, v)) = kv.split_once('=') {
                    if k == "t" || k == "token" {
                        return Ok(v.to_string());
                    }
                }
            }
        }
    }
    Err(anyhow!("magic link non riconosciuto"))
}

/// Genera 32 byte random + base64url (padding strippato). Stesso schema di
/// `room_provision_tokens` lato cloud: 32B = ~43 char b64url.
pub fn generate_pair_token() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let mut buf = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_link_query() {
        let token = parse_magic_link("https://x.example/desktop-bind?t=ABC123").unwrap();
        assert_eq!(token, "ABC123");
    }

    #[test]
    fn parse_link_fragment() {
        let token = parse_magic_link("https://x.example/desktop-bind#t=ABC123").unwrap();
        assert_eq!(token, "ABC123");
    }

    #[test]
    fn parse_token_plain() {
        let token = parse_magic_link("ABCDEF1234567890_-aZ").unwrap();
        assert_eq!(token, "ABCDEF1234567890_-aZ");
    }

    #[test]
    fn parse_link_invalid() {
        assert!(parse_magic_link("").is_err());
        assert!(parse_magic_link("https://x.example/no-token").is_err());
    }

    #[test]
    fn generated_pair_token_shape() {
        let t = generate_pair_token();
        assert!(t.len() >= 32);
        assert!(!t.contains('='));
        assert!(!t.contains('+'));
        assert!(!t.contains('/'));
    }
}
