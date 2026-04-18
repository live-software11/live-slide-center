// Sprint K1 + Sprint L (GUIDA_OPERATIVA_v3 §4.C K1 + §4.D L2/L3) — mDNS publish + discovery.
//
// Pubblica e scopre il servizio `_slidecenter._tcp.local.` sulla LAN cosi' che gli altri
// nodi (PC sala, agent, dashboard mobile) possano scoprire questo backend
// senza configurazione manuale.
//
// TXT records pubblicati:
//   role=admin|sala         → "admin" = centro di controllo, "sala" = PC che proietta
//   name=<hostname>         → nome leggibile per la lista dispositivi
//   event_id=<uuid|null>    → evento attivo (utile in scenari multi-evento simultanei,
//                              su PC sala diventa l'evento a cui e' paired)
//   port=<u16>              → porta HTTP del backend
//   app_version=<x.y.z>     → utile per discovery di compatibilita' minima
//
// `mdns-sd` usa thread interni; bastano `register` + `unregister`. Se il
// processo viene killato senza chiamare `shutdown`, il record scade dopo TTL
// 120s (default) — gli altri nodi smettono di vederlo.
//
// **Discovery (Sprint L)**: `discover(timeout, role_filter)` crea un secondo daemon
// effimero, fa browse del service type, raccoglie i `ServiceResolved` per la durata
// indicata e ritorna la lista filtrata. Il daemon viene shutdownato a fine browse
// per non lasciare thread orfani.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

const SERVICE_TYPE: &str = "_slidecenter._tcp.local.";
/// Default timeout per discovery one-shot. Il valore reale viene passato dal client
/// (Tauri command `cmd_discover_lan_pcs` o test). 1.5s sono sufficienti su LAN
/// veloce per scoprire 5-10 nodi (mDNS risponde entro 100-500ms tipicamente).
pub const DISCOVERY_DEFAULT_TIMEOUT_MS: u64 = 1500;

/// Handle per il publisher mDNS attivo. Tiene traccia del daemon e dell'ultima
/// `ServiceInfo` registrata cosi' da poterla aggiornare (es. quando il PC sala
/// si pairizza e cambia l'`event_id`).
pub struct MdnsHandle {
    daemon: ServiceDaemon,
    role: String,
    host_name: String,
    ips: Vec<IpAddr>,
    port: u16,
    /// Stato mutabile: fullname corrente registrato + event_id pubblicato.
    /// `Mutex` perche' `update_event_id` puo' essere chiamato da thread diversi
    /// (es. handler axum del pair-direct).
    inner: Mutex<MdnsInner>,
}

struct MdnsInner {
    fullname: String,
    event_id: Option<String>,
}

impl MdnsHandle {
    #[allow(dead_code)] // Sprint Q: chiamato quando aggiungeremo graceful shutdown del processo.
    pub fn shutdown(&self) {
        let inner = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        if let Err(e) = self.daemon.unregister(&inner.fullname) {
            warn!(?e, "mDNS unregister failed");
        }
        if let Err(e) = self.daemon.shutdown() {
            warn!(?e, "mDNS daemon shutdown failed");
        }
    }

    /// Re-pubblica il servizio con un nuovo `event_id` nei TXT records. Eseguito
    /// quando un PC sala viene paired (`POST /functions/v1/pair-direct`) per
    /// segnalare ai discovery futuri "questo PC e' gia' assegnato all'evento X".
    pub fn update_event_id(&self, new_event_id: Option<&str>) {
        let mut inner = match self.inner.lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        };
        let same = match (&inner.event_id, new_event_id) {
            (Some(a), Some(b)) => a == b,
            (None, None) => true,
            _ => false,
        };
        if same {
            return;
        }
        if let Err(e) = self.daemon.unregister(&inner.fullname) {
            warn!(?e, "mDNS unregister (pre-update) failed");
        }
        let info = match build_service_info(
            &self.role,
            &self.host_name,
            &self.ips,
            self.port,
            new_event_id,
        ) {
            Some(s) => s,
            None => {
                warn!("rebuild ServiceInfo fallita: mantengo registrazione precedente");
                return;
            }
        };
        let new_fullname = info.get_fullname().to_string();
        if let Err(e) = self.daemon.register(info) {
            warn!(?e, "mDNS re-register fallita");
            return;
        }
        info!(
            old_fullname = %inner.fullname,
            new_fullname = %new_fullname,
            event_id = ?new_event_id,
            "mDNS service ri-pubblicato con TXT aggiornati"
        );
        inner.fullname = new_fullname;
        inner.event_id = new_event_id.map(|s| s.to_string());
    }
}

/// Pubblica il servizio mDNS. Ritorna `None` se il daemon non e' disponibile
/// (es. permission denied, multicast bloccato dalla rete).
pub fn publish(port: u16, role: &str, event_id: Option<&str>) -> Option<MdnsHandle> {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            warn!(?e, "mDNS daemon non disponibile (alcune reti la bloccano: continuo senza discovery)");
            return None;
        }
    };

    let host_name = hostname();
    let ips: Vec<IpAddr> = local_ipv4_addresses();
    if ips.is_empty() {
        warn!("nessun IP locale trovato per mDNS publish: skip");
        return None;
    }

    let info = build_service_info(role, &host_name, &ips, port, event_id)?;

    let fullname = info.get_fullname().to_string();
    if let Err(e) = daemon.register(info) {
        warn!(?e, "mDNS register fallita");
        return None;
    }
    info!(%fullname, ip_count = ips.len(), %port, %role, "mDNS service pubblicato");
    Some(MdnsHandle {
        daemon,
        role: role.to_string(),
        host_name,
        ips,
        port,
        inner: Mutex::new(MdnsInner {
            fullname,
            event_id: event_id.map(|s| s.to_string()),
        }),
    })
}

fn build_service_info(
    role: &str,
    host_name: &str,
    ips: &[IpAddr],
    port: u16,
    event_id: Option<&str>,
) -> Option<ServiceInfo> {
    let instance_name = format!("slide-center-{role}-{host_name}");
    let mut props: HashMap<String, String> = HashMap::new();
    props.insert("role".to_string(), role.to_string());
    props.insert("name".to_string(), host_name.to_string());
    props.insert("port".to_string(), port.to_string());
    props.insert(
        "app_version".to_string(),
        env!("CARGO_PKG_VERSION").to_string(),
    );
    if let Some(ev) = event_id {
        props.insert("event_id".to_string(), ev.to_string());
    }

    match ServiceInfo::new(
        SERVICE_TYPE,
        &instance_name,
        &format!("{host_name}.local."),
        ips,
        port,
        Some(props),
    ) {
        Ok(s) => Some(s),
        Err(e) => {
            warn!(?e, "creazione ServiceInfo fallita");
            None
        }
    }
}

/// Risultato di una sessione di discovery mDNS one-shot. Dati esposti via Tauri
/// command alla SPA per popolare la lista "Aggiungi PC LAN" (Sprint L3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredNode {
    /// Nome completo registrato (es. `slide-center-sala-MIO-PC._slidecenter._tcp.local.`).
    pub fullname: String,
    /// `name` dal TXT (di solito = hostname, leggibile in UI).
    pub name: String,
    /// Hostname DNS (es. `MIO-PC.local.`).
    pub hostname: String,
    /// Tutti gli IP risolti (IPv4/IPv6). La SPA usera' il primo IPv4 raggiungibile.
    pub addresses: Vec<String>,
    pub port: u16,
    /// Ruolo dichiarato dal nodo: `"admin"` o `"sala"`.
    pub role: String,
    /// Event_id se gia' assegnato (PC sala paired); `None` se libero.
    pub event_id: Option<String>,
    /// Versione applicazione (utile per UI / compatibilita' future).
    pub app_version: Option<String>,
    /// Timestamp ms di quando il nodo e' stato risolto in questa sessione.
    pub resolved_at_ms: u64,
}

/// Esegue una discovery mDNS one-shot per `_slidecenter._tcp.local.`.
///
/// Crea un nuovo `ServiceDaemon`, fa browse e raccoglie i `ServiceResolved` per
/// `timeout_ms` (default `DISCOVERY_DEFAULT_TIMEOUT_MS`). Filtra per `role`
/// (`Some("sala")`/`Some("admin")`) o ritorna tutti se `None`.
///
/// **Esclusione del nodo locale**: opzionalmente accetta `exclude_fullname` per
/// non includere se stesso nei risultati (utile per il caso "scopro PC sala
/// diversi dal mio").
pub fn discover(
    timeout_ms: u64,
    role_filter: Option<&str>,
    exclude_fullname: Option<&str>,
) -> Vec<DiscoveredNode> {
    let daemon = match ServiceDaemon::new() {
        Ok(d) => d,
        Err(e) => {
            warn!(?e, "mDNS daemon non disponibile per discovery");
            return Vec::new();
        }
    };
    let receiver = match daemon.browse(SERVICE_TYPE) {
        Ok(r) => r,
        Err(e) => {
            warn!(?e, "mDNS browse fallito");
            let _ = daemon.shutdown();
            return Vec::new();
        }
    };

    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut by_fullname: HashMap<String, DiscoveredNode> = HashMap::new();

    while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
        match receiver.recv_timeout(remaining) {
            Ok(ServiceEvent::ServiceResolved(info)) => {
                let role = info
                    .get_property_val_str("role")
                    .unwrap_or("")
                    .to_string();
                if let Some(filter) = role_filter {
                    if !role.eq_ignore_ascii_case(filter) {
                        continue;
                    }
                }
                let fullname = info.get_fullname().to_string();
                if let Some(excl) = exclude_fullname {
                    if fullname == excl {
                        continue;
                    }
                }
                let event_id = info.get_property_val_str("event_id").map(|s| s.to_string());
                let app_version = info
                    .get_property_val_str("app_version")
                    .map(|s| s.to_string());
                let name = info
                    .get_property_val_str("name")
                    .unwrap_or_else(|| info.get_hostname().trim_end_matches('.'))
                    .to_string();
                let addresses = info
                    .get_addresses()
                    .iter()
                    .map(|ip| ip.to_string())
                    .collect();
                let now_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                by_fullname.insert(
                    fullname.clone(),
                    DiscoveredNode {
                        fullname,
                        name,
                        hostname: info.get_hostname().to_string(),
                        addresses,
                        port: info.get_port(),
                        role,
                        event_id,
                        app_version,
                        resolved_at_ms: now_ms,
                    },
                );
            }
            Ok(ServiceEvent::ServiceRemoved(_, fullname)) => {
                by_fullname.remove(&fullname);
            }
            Ok(_) => {}
            Err(_e) => {
                // recv_timeout error = timeout o canale chiuso → esci dal loop
                break;
            }
        }
    }

    // Cleanup: shutdown del daemon effimero per non lasciare thread orfani.
    if let Err(e) = daemon.shutdown() {
        warn!(?e, "mDNS daemon discovery shutdown failed");
    }

    let mut nodes: Vec<DiscoveredNode> = by_fullname.into_values().collect();
    nodes.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    nodes
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME") // Windows
        .or_else(|_| std::env::var("HOSTNAME")) // Unix shells
        .unwrap_or_else(|_| "slide-center".to_string())
}

/// Sprint L: esposta pubblicamente perche' `boot()` la usa per popolare
/// `BootedServer.lan_addresses` (poi propagati a `cmd_backend_info` per la SPA
/// admin: serve a costruire `admin_server.base_url` reale per il pair-direct,
/// non un inutile `127.0.0.1` che il PC sala non potrebbe richiamare).
pub fn local_ipv4_addresses() -> Vec<IpAddr> {
    // Apriamo un UDP "datagram" verso un IP pubblico fittizio: il SO sceglie
    // l'interfaccia di default e da li' estraiamo l'IP locale. Niente bind a
    // tutte le interfacce (hardcoded `getifaddrs` cross-platform e' fragile).
    let socket = match std::net::UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    if socket.connect("8.8.8.8:80").is_err() {
        return vec![];
    }
    match socket.local_addr() {
        Ok(addr) => vec![addr.ip()],
        Err(_) => vec![],
    }
}
