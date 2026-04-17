//! Modulo licenze Live SLIDE CENTER — Local Agent.
//!
//! Sistema licenze centralizzato sull'API Live WORKS APP
//! (`https://live-works-app.web.app/api`). Pattern allineato a
//! `Live 3d Ledwall Render/src-tauri/src/license/`.
//!
//! Costanti per-prodotto (uniche e divergenti dal Room Agent):
//!   - `PRODUCT_ID`        identificativo SKU su Live WORKS APP
//!   - `APP_DATA_DIR`      cartella di persistenza in `%LOCALAPPDATA%`
//!   - `LICENSE_AES_KEY`   chiave AES-256 per cifrare `license.enc`
//!
//! Tutto il resto del modulo (types/crypto/fingerprint/api/manager/commands) e'
//! GEMELLO con `apps/room-agent/src-tauri/src/license/`. Modifiche al
//! comportamento DEVONO essere replicate. Mantieni i due file allineati:
//! questo riduce il rischio di divergenze HMAC/firma/serialize.
//!
//! Build di vendita:    `cargo tauri build --features license`
//! Build di sviluppo:   `cargo tauri build` (commands stub no-op)

#[cfg(feature = "license")]
pub mod api;
#[cfg(feature = "license")]
pub mod commands;
#[cfg(feature = "license")]
pub mod crypto;
#[cfg(feature = "license")]
pub mod fingerprint;
#[cfg(feature = "license")]
pub mod manager;
#[cfg(feature = "license")]
pub mod types;

#[cfg(feature = "license")]
pub use commands::*;
#[cfg(feature = "license")]
pub use manager::run_deactivate_uninstall;
#[cfg(feature = "license")]
pub use types::LicenseStatus;

#[cfg(feature = "license")]
pub const API_BASE_URL: &str = "https://live-works-app.web.app/api";

/// SKU unico Local Agent (mini-PC regia). Allineato a `Live WORKS APP`
/// `functions/scripts/seed-firestore.mjs` e a docs §5.2 di
/// `PIANO_FINALE_SLIDE_CENTER_v2.md`.
#[cfg(feature = "license")]
pub const PRODUCT_ID: &str = "slide-center-agent";

/// Cartella dentro `%LOCALAPPDATA%`. NON sovrapposta con la cache delle
/// presentazioni (`LiveSLIDECENTER/agent-cache`) per separare scope di
/// pulizia / esclusione Defender.
#[cfg(feature = "license")]
pub const APP_DATA_DIR: &str = "com.livesoftware.slidecenter.agent";

/// Nome file licenza cifrata.
#[cfg(feature = "license")]
pub const LICENSE_FILE: &str = "license.enc";

/// Nome file pending activation cifrato (polling automatico per primo bind
/// che richiede approvazione admin).
#[cfg(feature = "license")]
pub const PENDING_FILE: &str = "pending_activation.json";

/// Chiave AES-256-GCM dedicata al Local Agent. Generata con
/// `openssl rand -hex 32` (key rotation = nuova chiave + nuova versione client).
/// **DIVERSA** dalla chiave del Room Agent: impedisce di copiare un file
/// `license.enc` tra installazioni di prodotti diversi.
#[cfg(feature = "license")]
pub const LICENSE_AES_KEY: [u8; 32] = [
    0x4a, 0x9c, 0x18, 0xe7, 0x52, 0x83, 0x6f, 0x21, 0x0d, 0xb6, 0x47, 0x1c, 0xa9, 0x35, 0xff, 0x68,
    0x73, 0x2e, 0x80, 0x95, 0xc1, 0x40, 0xab, 0x5d, 0x12, 0xe9, 0x66, 0x37, 0xfa, 0x88, 0x04, 0x21,
];

// Stub no-op quando la feature `license` e' disabilitata: permette di chiamare
// `run_deactivate_uninstall()` (NSIS pre-uninstall) senza compile error.
#[cfg(not(feature = "license"))]
pub fn run_deactivate_uninstall() {}
