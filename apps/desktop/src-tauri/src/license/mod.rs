//! Modulo licenze Live SLIDE CENTER Desktop (Sprint D1).
//!
//! Sistema licenze UNIFICATO cloud/desktop: il PC desktop server NON ha un
//! abbonamento separato, condivide la licenza del tenant cloud Slide Center.
//! Andrea 18/04/2026: "stesse licenze condivise".
//!
//! Architettura (vedi `supabase/migrations/20260418290000_desktop_devices_licensing.sql`):
//!   1. Admin in regia loggato sul cloud genera un magic-link via RPC
//!      `rpc_admin_create_desktop_provision_token` → URL con token plain.
//!   2. L'utente apre l'app desktop e incolla il magic-link nella view bind.
//!   3. Il client desktop genera 32 byte random come `pair_token` (mai usciti
//!      dal device), ne calcola sha256 e chiama edge function
//!      `desktop-bind-claim` → ottiene `device_id`, `tenant_id`, `license`.
//!   4. Il pair_token plain viene salvato in `~/.slidecenter/license.enc`
//!      cifrato AES-256-GCM (chiave hardcoded ma diversa dagli agent legacy).
//!   5. Verifica periodica (1x/24h al boot + scheduled): chiama edge function
//!      `desktop-license-verify` con `Authorization: Bearer <pair_token>` →
//!      aggiorna `last_verified_at` lato DB e `grace_until` lato client.
//!   6. Se offline > 30 giorni dall'ultimo verify riuscito: lock funzioni
//!      cloud-dipendenti (LAN dell'evento in corso continua a funzionare).
//!
//! Differenze rispetto al sistema legacy in `apps/agent/src-tauri/src/license/`:
//!   - NIENTE Live WORKS APP: backend e' Supabase Edge Functions del monorepo.
//!   - NIENTE hardware fingerprint vincolante: e' indicativo per la dashboard
//!     admin, non blocca lo spostamento di licenza tra PC.
//!   - NIENTE feature flag `license`: il modulo e' sempre incluso (ma le
//!     funzioni cloud restano gracefully no-op se non bound).

pub mod client;
pub mod commands;
pub mod crypto;
pub mod fingerprint;
pub mod heartbeat;
pub mod manager;
pub mod storage;
pub mod types;

pub use commands::*;

/// URL base Supabase Edge Functions del monorepo Slide Center (production).
/// Override via env var `SLIDECENTER_SUPABASE_URL` per dev/staging.
pub const SUPABASE_FUNCTIONS_URL: &str = "https://cdjxxxkrhgdkcpkkozdl.supabase.co/functions/v1";

/// Cartella dati lato HOME (NON `%LOCALAPPDATA%` perche' il server desktop usa
/// gia' `~/SlideCenter` per i file scaricati e `~/.slidecenter` per
/// `admin_token.json`; restiamo coerenti).
pub const APP_DOTDIR: &str = ".slidecenter";

/// Nome file licenza cifrata (AES-256-GCM).
pub const LICENSE_FILE: &str = "license.enc";

/// Nome file machine fingerprint (UUID v4 generato al primo bind, persistente).
pub const MACHINE_ID_FILE: &str = "machine-id";

/// Chiave AES-256 dedicata al PC desktop server. Diversa dalle chiavi degli
/// agent legacy: impedisce di copiare un `license.enc` tra prodotti.
/// Generata con `openssl rand -hex 32` (key rotation = nuova chiave + bump
/// versione client → re-bind richiesto).
pub const LICENSE_AES_KEY: [u8; 32] = [
    0x9c, 0x21, 0x4f, 0x83, 0xb1, 0x06, 0xae, 0x57, 0xd2, 0x68, 0x39, 0xfd, 0x4c, 0x10, 0xa7, 0x8b,
    0x65, 0x3e, 0xc4, 0x12, 0x90, 0x77, 0xab, 0x5f, 0x21, 0xd6, 0x83, 0x49, 0x0e, 0xb7, 0x2c, 0xfa,
];

/// Grace period offline in secondi (30 giorni). Allineato alla `grace_until`
/// ritornata da `rpc_desktop_license_verify` lato cloud.
pub const GRACE_PERIOD_SECONDS: i64 = 30 * 24 * 60 * 60;
