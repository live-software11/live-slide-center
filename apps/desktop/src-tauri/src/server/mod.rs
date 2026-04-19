// Sprint K1 + Sprint L (GUIDA_OPERATIVA_v3 §4.C K1 + §4.D) — entrypoint del backend Rust locale.
//
// Espone:
//   • `boot(role)`        → inizializza DB + admin_token + HMAC + Router + start Axum
//                           su 0.0.0.0:7300 + mDNS publish con TXT `role=<role>`.
//                           `role` arriva da `~/SlideCenter/role.json` (Sprint L1).
//   • `mdns::publish()`   → annuncia il servizio mDNS sulla LAN (Sprint L2).
//   • `mdns::discover()`  → browse mDNS one-shot (Sprint L3, esposto via Tauri command).
//
// Architettura:
//   1. Risolve i path persistenti (`~/SlideCenter/`) usando `dirs::home_dir()`.
//   2. Apre/migra il DB SQLite (`db.sqlite`).
//   3. Carica/genera `admin_token` + `hmac_secret` da `secrets.json`
//      (nuove generazioni = scrittura atomica; mai ri-genera se gia' presenti).
//   4. Costruisce il Router Axum con CORS aperto su 127.0.0.1 (ok perche'
//      tutto e' protetto da admin_token o device_token o signed URL HMAC).
//   5. Spawn dei task tokio: bind + serve.
//
// Ritorna `BootedServer` con: porta effettiva, admin_token, mdns handle.

pub mod auth;
pub mod db;
pub mod device_persist;
pub mod error;
pub mod lan_events;
pub mod lan_push;
pub mod mdns;
pub mod pgrest;
pub mod routes;
pub mod state;
pub mod storage;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{routing::get, Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::{info, warn};

use self::{
    db::init_pool,
    lan_events::LanEventBus,
    mdns::MdnsHandle,
    state::AppState,
};

pub const DEFAULT_PORT: u16 = 7300;

// `MdnsHandle` racchiude `ServiceDaemon` che NON implementa Debug,
// quindi non possiamo derivare automaticamente: facciamo un Debug manuale
// che omette l'handle daemon (utile sui log al boot).
pub struct BootedServer {
    pub port: u16,
    pub admin_token: String,
    pub data_root: PathBuf,
    pub storage_root: PathBuf,
    /// Sprint L: ruolo del nodo desktop ("admin" o "sala"). Esposto alla SPA via
    /// `cmd_backend_info` cosi' la UI sa cosa mostrare (admin dashboard vs PairView).
    pub role: String,
    /// Sprint L: handle al publisher mDNS (clonabile via Arc per essere
    /// condivisibile con AppState e con Tauri commands). `None` se mDNS non e'
    /// partito (rete che blocca multicast).
    pub mdns: Option<Arc<MdnsHandle>>,
    /// Sprint L3: indirizzi IPv4 locali utilizzabili dalla LAN. Servono alla
    /// SPA admin per costruire `admin_server.base_url` quando fa pair-direct
    /// verso un PC sala (`127.0.0.1` non sarebbe richiamabile dal sala).
    /// Calcolati con `mdns::local_ipv4_addresses()`. Vuoto se nessuna NIC
    /// attiva oppure se la rete blocca le query (raro su LAN).
    pub lan_addresses: Vec<String>,
}

impl std::fmt::Debug for BootedServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BootedServer")
            .field("port", &self.port)
            .field("admin_token_len", &self.admin_token.len())
            .field("data_root", &self.data_root)
            .field("storage_root", &self.storage_root)
            .field("role", &self.role)
            .field("mdns_active", &self.mdns.is_some())
            .field("lan_addresses", &self.lan_addresses)
            .finish()
    }
}

#[derive(Serialize, Deserialize)]
struct PersistedSecrets {
    admin_token: String,
    /// HMAC secret in base64 (URL_SAFE_NO_PAD) per leggibilita' del file.
    hmac_secret_b64: String,
}

pub async fn boot(role: &str) -> anyhow::Result<BootedServer> {
    let data_root = resolve_data_root()?;
    let storage_root = data_root.join("storage");
    std::fs::create_dir_all(&data_root)?;
    std::fs::create_dir_all(&storage_root)?;

    let db_path = data_root.join("db.sqlite");
    let db_pool = init_pool(&db_path).map_err(|e| anyhow::anyhow!("DB init: {e}"))?;

    let secrets_path = data_root.join("secrets.json");
    let (admin_token, hmac_secret) = load_or_create_secrets(&secrets_path)?;

    // Sprint L: pubblica mDNS PRIMA di costruire l'AppState cosi' possiamo
    // condividerne l'Arc con il pair-direct handler (per update_event_id).
    let port = DEFAULT_PORT;
    // Per il PC sala: se device.json esiste, riutilizza l'event_id come TXT iniziale
    // (cosi' altri admin LAN vedono "gia' assegnato" anche al primo boot).
    let initial_event_id = if role == "sala" {
        device_persist::read(&data_root).map(|d| d.event_id)
    } else {
        None
    };
    let mdns_handle = mdns::publish(port, role, initial_event_id.as_deref()).map(Arc::new);

    // Sprint L3: gli IP LAN servono alla SPA admin per `admin_server.base_url`
    // (vedi `BootedServer.lan_addresses`). Calcolati una sola volta al boot:
    // se l'utente cambia rete, basta riavviare l'app. Non e' un problema in
    // produzione perche' i field-test sono per loro natura "rete fissa".
    let lan_addresses: Vec<String> = mdns::local_ipv4_addresses()
        .iter()
        .map(|ip| ip.to_string())
        .collect();
    if lan_addresses.is_empty() {
        warn!("nessun IP LAN locale rilevato: pair-direct dalla SPA admin non potra' fornire base_url valido");
    }

    // Sprint N1: client HTTP per fan-out admin → PC sala. Timeout di rete
    // gestito per-request in `lan_push.rs` (default reqwest = no timeout
    // sarebbe troppo permissivo). Pool TCP keepalive di default reqwest
    // basta per il volume tipico di fan-out (1-10 sala paired).
    let http_client = Arc::new(
        reqwest::Client::builder()
            .user_agent(concat!("slide-center-desktop/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|e| anyhow::anyhow!("reqwest::Client init: {e}"))?,
    );

    // Sprint N2-N3: bus eventi LAN per il long-poll della SPA (PC sala).
    // Lato admin il bus esiste ma non viene mai pubblicato (il fan-out outgoing
    // usa direttamente reqwest). Lato sala riceve gli eventi via
    // `POST /events/file_added` e li distribuisce ai client long-poll.
    let event_bus = LanEventBus::new();

    let app_state = AppState::new(
        db_pool,
        data_root.clone(),
        storage_root.clone(),
        admin_token.clone(),
        hmac_secret,
        role.to_string(),
        mdns_handle.clone(),
        http_client,
        event_bus,
        lan_addresses.clone(),
    );

    let app = build_router(app_state);
    let bind: SocketAddr = ([0, 0, 0, 0], port).into();
    let listener = tokio::net::TcpListener::bind(bind).await?;
    info!(%bind, %role, "server HTTP locale in ascolto");

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            warn!(?e, "server HTTP terminato con errore");
        }
    });

    Ok(BootedServer {
        port,
        admin_token,
        data_root,
        storage_root,
        role: role.to_string(),
        mdns: mdns_handle,
        lan_addresses,
    })
}

fn resolve_data_root() -> anyhow::Result<PathBuf> {
    if let Ok(custom) = std::env::var("SLIDECENTER_DATA_ROOT") {
        let p = PathBuf::from(custom);
        return Ok(p);
    }
    let home = dirs::home_dir().ok_or_else(|| anyhow::anyhow!("HOME non risolvibile"))?;
    Ok(home.join("SlideCenter"))
}

fn load_or_create_secrets(path: &std::path::Path) -> anyhow::Result<(String, Vec<u8>)> {
    if let Ok(bytes) = std::fs::read(path) {
        if let Ok(s) = serde_json::from_slice::<PersistedSecrets>(&bytes) {
            let secret = base64::Engine::decode(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD,
                &s.hmac_secret_b64,
            )
            .map_err(|e| anyhow::anyhow!("hmac_secret_b64 invalido: {e}"))?;
            info!("secrets caricati da {}", path.display());
            return Ok((s.admin_token, secret));
        }
        warn!("secrets.json esiste ma non e' parsabile: rigenero");
    }
    use rand::RngCore;
    let mut rng = rand::thread_rng();
    let mut admin_bytes = [0u8; 32];
    rng.fill_bytes(&mut admin_bytes);
    let admin_token = format!(
        "sc_{}",
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, admin_bytes)
    );
    let mut hmac_bytes = vec![0u8; 32];
    rng.fill_bytes(&mut hmac_bytes);
    let hmac_b64 =
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &hmac_bytes);

    let persisted = PersistedSecrets {
        admin_token: admin_token.clone(),
        hmac_secret_b64: hmac_b64,
    };
    let bytes = serde_json::to_vec_pretty(&persisted)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, path)?;
    info!("secrets generati e salvati in {}", path.display());
    Ok((admin_token, hmac_bytes))
}

fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::very_permissive();

    // PostgREST/Supabase usa il prefix `/rest/v1` per REST e RPC.
    // I sotto-router lo ignorano e definiscono solo `/:table` e `/rpc/<name>`,
    // cosi' restano riusabili (es. test integration).
    let rest_v1 = Router::new()
        .merge(routes::rest::routes())
        .merge(routes::rpc::routes())
        // Sprint W C1 — Folder routes (REST event_folders + RPC move/rename).
        .merge(routes::folder_routes::routes());

    Router::new()
        .route("/health", get(health))
        .route("/info", get(info_endpoint))
        .nest("/rest/v1", rest_v1)
        .merge(routes::storage_routes::routes())
        .merge(routes::functions::routes())
        .merge(routes::lan_events_routes::routes())
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "service": "slide-center-desktop", "version": env!("CARGO_PKG_VERSION") }))
}

async fn info_endpoint(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Json<serde_json::Value> {
    Json(json!({
        "service": "slide-center-desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "role": state.role.as_str(),
        "data_root": state.data_root.display().to_string(),
        "storage_root": state.storage_root.display().to_string(),
    }))
}

#[allow(dead_code)]
fn _arc_check() {
    let _: Arc<String> = Arc::new(String::new());
}
