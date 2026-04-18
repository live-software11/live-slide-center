//! Orchestratore alto livello del flusso licenze (Sprint D1).
//!
//! Espone le 3 operazioni principali invocate dalla UI / dal main bootstrap:
//!   - `bind(magic_link, device_name)` → consume token, salva license.enc
//!   - `verify_now()` → heartbeat ad hoc (chiamato da boot e UI)
//!   - `current_status()` → calcolo locale `LicenseStatus` da disco

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};

use super::client::LicenseClient;
use super::types::{BindRequest, LicenseData, LicenseStatus, RenewRequest, VerifyRequest};
use super::{
    fingerprint, storage, GRACE_PERIOD_SECONDS, SUPABASE_FUNCTIONS_URL,
};

/// Sprint SR — soglia (giorni) sotto cui il pair_token è "in scadenza" e il
/// heartbeat tenta auto-renew. Allineata al threshold server (`expiring_soon`).
const PAIR_TOKEN_EXPIRING_SOON_DAYS: i64 = 7;

/// Sprint SR — cooldown minimo (in secondi) tra due tentativi di auto-renew
/// dal heartbeat. Evita loop di renew falliti consecutivi se ad esempio la
/// rete è down. 6 ore = stessa cadenza del heartbeat verify.
const RENEW_COOLDOWN_SECONDS: i64 = 6 * 60 * 60;

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
        // Sprint SR — la edge function bind imposta pair_token_expires_at =
        // now + 12 mesi server-side; non lo ritorna esplicitamente nel body
        // attuale, quindi lo replichiamo lato client. La prossima verify
        // riallineerà col valore autoritativo dal cloud.
        let pair_token_expires_at = now + Duration::days(365);

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
            pair_token_expires_at: Some(pair_token_expires_at.to_rfc3339()),
            last_renew_attempt_at: None,
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
        // Sprint SR — server-side è autoritativo sulla expiry del pair_token.
        if let Some(exp) = resp.pair_token_expires_at {
            data.pair_token_expires_at = Some(exp);
        }
        storage::save(&data).context("save license.enc after verify")?;
        Ok(())
    }

    /// Sprint SR — rotazione atomica del pair_token corrente.
    ///
    /// Flusso:
    ///   1. Genera 32 byte random come NUOVO pair_token + sha256.
    ///   2. Chiama `desktop-license-renew` con OLD token in Bearer e
    ///      NEW hash nel body. La transazione server-side è atomica.
    ///   3. Su successo: salva license.enc col NUOVO pair_token plain
    ///      e con `pair_token_expires_at` ritornato dal server.
    ///   4. Aggiorna `last_renew_attempt_at` (anche su fallimento, per
    ///      cooldown del heartbeat auto-renew).
    ///
    /// Atomicità: il vecchio token resta valido finché la write su disco
    /// non riesce. Se il salvataggio fallisce DOPO il successo server-side,
    /// il dispositivo perde l'accesso (workaround: re-bind admin). Caso
    /// estremamente raro su filesystem locale; futura mitigazione = doppio
    /// scrivi (license.enc.new → rename) ma fuori scope Sprint SR.
    pub async fn renew_now(&self) -> Result<()> {
        let mut data = storage::load()
            .context("load license.enc")?
            .ok_or_else(|| anyhow!("not_bound"))?;

        let new_pair_token = generate_pair_token();
        let new_pair_token_hash = sha256_hex(new_pair_token.as_bytes());

        let req = RenewRequest { new_pair_token_hash };
        let renew_result = self.client.renew(&data.pair_token, req).await;

        // Marchia comunque il tentativo per cooldown heartbeat.
        let now = Utc::now();
        data.last_renew_attempt_at = Some(now.to_rfc3339());

        let resp = match renew_result {
            Ok(r) => r,
            Err(e) => {
                // Salva tentativo per cooldown anche su fallimento; non
                // bloccare l'errore.
                if let Err(persist_err) = storage::save(&data) {
                    tracing::warn!(error = %persist_err, "Sprint SR — impossibile salvare last_renew_attempt_at");
                }
                return Err(e.context("desktop-license-renew"));
            }
        };

        data.pair_token = new_pair_token;
        data.pair_token_expires_at = Some(resp.pair_token_expires_at);
        storage::save(&data).context("save license.enc after renew")?;
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

        // Sprint SR — analizza scadenza pair_token. Se license.enc è
        // pre-Sprint SR (campo None), assumiamo "ok" per retrocompat:
        // la prossima verify_now() popolerà il campo.
        let pair_token_expiry_state = parse_pair_token_expiry(data, now);

        if grace_until <= now {
            return LicenseStatus::GraceExpired {
                tenant_name: data.tenant_name.clone(),
                last_verified_at: data.last_verified_at.clone(),
            };
        }

        // PairTokenExpired ha priorità sui banner gialli ma non sul grace
        // expired (che è hard-stop): se il grace è ancora attivo, mostriamo
        // PairTokenExpired per spingere l'admin al re-bind prima che scatti.
        match pair_token_expiry_state {
            PairTokenExpiryState::Expired { expires_at } => {
                return LicenseStatus::PairTokenExpired {
                    tenant_name: data.tenant_name.clone(),
                    last_verified_at: data.last_verified_at.clone(),
                    pair_token_expires_at: expires_at,
                };
            }
            PairTokenExpiryState::ExpiringSoon { expires_at, days_left } => {
                return LicenseStatus::PairTokenExpiring {
                    tenant_name: data.tenant_name.clone(),
                    plan: data.plan.clone(),
                    expires_at: data.expires_at.clone(),
                    last_verified_at: data.last_verified_at.clone(),
                    pair_token_expires_at: expires_at,
                    pair_token_days_remaining: days_left,
                };
            }
            PairTokenExpiryState::Ok | PairTokenExpiryState::Unknown => {}
        }

        if elapsed > Duration::hours(24) {
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

    /// Sprint SR — Decide se va invocato `renew_now()` automatico dal
    /// heartbeat. True se:
    ///   - pair_token expiry < `PAIR_TOKEN_EXPIRING_SOON_DAYS`, AND
    ///   - last_renew_attempt_at è assente OR più vecchio del cooldown.
    ///
    /// `false` per token expired (serve re-bind admin) o non bound.
    pub fn should_attempt_auto_renew(&self) -> bool {
        let data = match storage::load() {
            Ok(Some(d)) => d,
            _ => return false,
        };
        let now = Utc::now();
        let state = parse_pair_token_expiry(&data, now);
        let needs_renew = matches!(state, PairTokenExpiryState::ExpiringSoon { .. });
        if !needs_renew {
            return false;
        }
        if let Some(last_attempt_str) = data.last_renew_attempt_at.as_ref() {
            if let Ok(dt) = DateTime::parse_from_rfc3339(last_attempt_str) {
                let dt_utc = dt.with_timezone(&Utc);
                let elapsed = now.signed_duration_since(dt_utc).num_seconds();
                if elapsed < RENEW_COOLDOWN_SECONDS {
                    return false;
                }
            }
        }
        true
    }
}

#[derive(Debug)]
enum PairTokenExpiryState {
    /// Token attivo, > 7 giorni alla scadenza.
    Ok,
    /// Token in scadenza (≤ 7 giorni). `days_left` ≥ 0.
    ExpiringSoon { expires_at: String, days_left: i64 },
    /// Token già scaduto (la verify lato cloud rifiuterà).
    Expired { expires_at: String },
    /// license.enc pre-Sprint SR (campo None) — non possiamo classificare
    /// finché la prossima verify non aggiorna il dato. Trattato come Ok.
    Unknown,
}

fn parse_pair_token_expiry(data: &LicenseData, now: DateTime<Utc>) -> PairTokenExpiryState {
    let raw = match data.pair_token_expires_at.as_ref() {
        Some(s) => s,
        None => return PairTokenExpiryState::Unknown,
    };
    let parsed = match DateTime::parse_from_rfc3339(raw) {
        Ok(dt) => dt.with_timezone(&Utc),
        Err(_) => return PairTokenExpiryState::Unknown,
    };
    if parsed <= now {
        return PairTokenExpiryState::Expired {
            expires_at: raw.clone(),
        };
    }
    let days_left = (parsed - now).num_days();
    if days_left <= PAIR_TOKEN_EXPIRING_SOON_DAYS {
        PairTokenExpiryState::ExpiringSoon {
            expires_at: raw.clone(),
            days_left: days_left.max(0),
        }
    } else {
        PairTokenExpiryState::Ok
    }
}

fn sha256_hex(input: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input);
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{:02x}", b));
    }
    s
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

    fn make_data(expires_at: Option<&str>) -> LicenseData {
        LicenseData {
            pair_token: "x".into(),
            device_id: "d".into(),
            tenant_id: "t".into(),
            tenant_name: None,
            plan: None,
            expires_at: None,
            last_verified_at: Utc::now().to_rfc3339(),
            grace_until: (Utc::now() + Duration::days(30)).to_rfc3339(),
            app_version: None,
            bound_at: Utc::now().to_rfc3339(),
            pair_token_expires_at: expires_at.map(|s| s.to_string()),
            last_renew_attempt_at: None,
        }
    }

    #[test]
    fn pair_token_unknown_when_field_missing() {
        let d = make_data(None);
        let s = parse_pair_token_expiry(&d, Utc::now());
        assert!(matches!(s, PairTokenExpiryState::Unknown));
    }

    #[test]
    fn pair_token_ok_when_far_in_future() {
        let exp = (Utc::now() + Duration::days(180)).to_rfc3339();
        let d = make_data(Some(&exp));
        let s = parse_pair_token_expiry(&d, Utc::now());
        assert!(matches!(s, PairTokenExpiryState::Ok));
    }

    #[test]
    fn pair_token_expiring_soon_within_7_days() {
        let exp = (Utc::now() + Duration::days(3)).to_rfc3339();
        let d = make_data(Some(&exp));
        let s = parse_pair_token_expiry(&d, Utc::now());
        match s {
            PairTokenExpiryState::ExpiringSoon { days_left, .. } => {
                assert!((0..=7).contains(&days_left), "days_left={days_left}");
            }
            other => panic!("expected ExpiringSoon, got {:?}", other),
        }
    }

    #[test]
    fn pair_token_expired_when_past() {
        let exp = (Utc::now() - Duration::days(1)).to_rfc3339();
        let d = make_data(Some(&exp));
        let s = parse_pair_token_expiry(&d, Utc::now());
        assert!(matches!(s, PairTokenExpiryState::Expired { .. }));
    }

    #[test]
    fn sha256_hex_known_vector() {
        // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
        let h = sha256_hex(b"abc");
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
