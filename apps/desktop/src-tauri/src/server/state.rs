// Sprint K1 (GUIDA_OPERATIVA_v3 §4.C K1) — stato condiviso del server.
//
// `AppState` viene clonato in tutti gli handler axum (e' `Clone` perche' contiene
// solo `Arc<...>` e copie cheap). Tiene insieme:
//   • il pool SQLite,
//   • i path persistenti (data root, storage root),
//   • il segreto HMAC per la firma URL signed.

use std::path::PathBuf;
use std::sync::Arc;

use crate::server::db::DbPool;
use crate::server::lan_events::LanEventBus;
use crate::server::mdns::MdnsHandle;

#[derive(Clone)]
pub struct AppState {
    pub db: DbPool,

    /// Root dei dati locali Live SLIDE CENTER. Default `~/SlideCenter`.
    /// Vedi sezione 13 della guida operativa.
    pub data_root: PathBuf,

    /// Cartella dove i file binari del bucket "presentations" vengono persistiti.
    /// Path: `<data_root>/storage/<bucket>/<storage_key>`.
    pub storage_root: PathBuf,

    /// Token admin HTTP bearer (statico per lifetime processo, generato al primo
    /// avvio in `~/.slidecenter/admin_token.json` — cfr. Sprint M).
    /// In modalita desktop la SPA lo legge da Tauri al boot.
    pub admin_token: Arc<String>,

    /// Segreto HMAC per firmare le URL `/storage/v1/object/sign/...`.
    /// Generato random al primo avvio insieme all'admin_token e persistito.
    pub hmac_secret: Arc<Vec<u8>>,

    /// Sprint L: ruolo del nodo desktop ("admin" o "sala"). Cambiando ruolo dalla
    /// SPA va riavviato il processo (server + mDNS dipendono da questo valore).
    pub role: Arc<String>,

    /// Sprint L: handle al publisher mDNS. Usato dal pair-direct endpoint per
    /// aggiornare il TXT `event_id` quando il PC sala viene paired.
    /// `None` se mDNS non e' partito (rete che blocca multicast).
    pub mdns: Option<Arc<MdnsHandle>>,

    /// Sprint N1-N2: client HTTP per fan-out admin → PC sala paired (`reqwest`
    /// con timeout 5s + rustls-tls). Cloned `Arc` interno: zero overhead per
    /// handler. Usato sia lato admin (push fan-out) sia teoricamente per
    /// future chiamate cross-LAN.
    pub http_client: Arc<reqwest::Client>,

    /// Sprint N2-N3: bus eventi LAN per il long-poll della SPA sala.
    /// Riceve push HTTP da `/events/file_added` (admin → sala) e li distribuisce
    /// al `/events/stream` long-poll. Lato admin, e' presente ma inutilizzato
    /// (il fan-out outgoing usa `lan_push.rs`).
    pub event_bus: Arc<LanEventBus>,

    /// Sprint N1: lista IPv4 LAN locali del nodo, calcolata al boot. Usata dal
    /// server admin per popolare `admin_base_url` nei payload `FileAdded` cosi'
    /// il PC sala sa da dove scaricare. `127.0.0.1` escluso (irraggiungibile dal sala).
    pub lan_addresses: Arc<Vec<String>>,
}

impl AppState {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: DbPool,
        data_root: PathBuf,
        storage_root: PathBuf,
        admin_token: String,
        hmac_secret: Vec<u8>,
        role: String,
        mdns: Option<Arc<MdnsHandle>>,
        http_client: Arc<reqwest::Client>,
        event_bus: Arc<LanEventBus>,
        lan_addresses: Vec<String>,
    ) -> Self {
        Self {
            db,
            data_root,
            storage_root,
            admin_token: Arc::new(admin_token),
            hmac_secret: Arc::new(hmac_secret),
            role: Arc::new(role),
            mdns,
            http_client,
            event_bus,
            lan_addresses: Arc::new(lan_addresses),
        }
    }

    /// Sprint N1: best-guess di `admin_base_url` quando il server admin pubblica
    /// un fan-out `FileAdded`. Usa il primo IP LAN non-loopback. Se la lista e'
    /// vuota (NIC giu'), ritorna `None` e il PC sala dovra' arrangiarsi col
    /// `device.json` (campo `admin_server.base_url` salvato al pair-direct).
    pub fn admin_base_url(&self) -> Option<String> {
        // Default port = 7300 (vedi `server::DEFAULT_PORT`).
        self.lan_addresses
            .iter()
            .find(|ip| !ip.starts_with("127.") && !ip.starts_with("169.254.")) // skip loopback + APIPA
            .map(|ip| format!("http://{ip}:7300"))
    }
}
