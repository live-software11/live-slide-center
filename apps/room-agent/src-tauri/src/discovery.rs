//! Sprint 2 — Discovery client del Local Agent in modalità intranet offline.
//!
//! Il Room Agent prova in cascata 4 metodi di discovery, dal piu' affidabile
//! (richiede meno dipendenze esterne) al piu' costoso. Si ferma alla prima
//! risposta valida e ritorna l'indirizzo `IP:PORTA` del Local Agent.
//!
//! Ordine di tentativo:
//!  1. **UNC file share** — `\\<host>\SlideCenter$\agent.json`. Andrea pubblica
//!     un file statico in regia con i dati del Local Agent. Funziona anche se
//!     UDP/mDNS sono bloccati. Hostname target derivato da env `SLIDE_AGENT_HOST`
//!     o lista hostname noti (chiave registro `HKCU\Software\LiveSlideCenter\KnownAgents`).
//!  2. **UDP broadcast** — invia `{"q":"slide-center","client":"room-agent"}` a
//!     `255.255.255.255:9999` e attende risposte (timeout 1.5s). Risponde il
//!     Local Agent con `{ip,port,version,hostname,instance}`.
//!  3. **mDNS** — query `_slide-center._tcp.local.`. Funziona su switch L2
//!     gestiti che bloccano broadcast UDP ma propagano mDNS multicast.
//!  4. **IP manuale** — l'utente inserisce l'indirizzo nella UI; persistito
//!     localmente e usato come ultimo fallback.
//!
//! Ogni metodo è opzionale: se uno fallisce, passiamo al successivo. Se tutti
//! falliscono, ritorniamo `Ok(DiscoveryOutcome::NotFound { tried })` (non un
//! errore: lo status UI sarà "Offline" finche' l'utente non immette IP a mano).
//!
//! Cache TTL 60s su discovery riuscita per evitare network thrashing.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tokio::net::UdpSocket;
use tokio::time::timeout;
use tracing::{debug, info, warn};

const DISCOVERY_PORT: u16 = 9999;
const HTTP_PORT_FALLBACK: u16 = 8080;
const MDNS_SERVICE_TYPE: &str = "_slide-center._tcp.local.";
const UDP_TIMEOUT: Duration = Duration::from_millis(1500);
const MDNS_TIMEOUT: Duration = Duration::from_millis(2500);
const UNC_TIMEOUT: Duration = Duration::from_millis(800);
const DISCOVERY_CACHE_TTL: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoveryMethod {
    File,
    Udp,
    Mdns,
    Manual,
    Cache,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredAgent {
    pub address: String,
    pub method: DiscoveryMethod,
    pub hostname: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum DiscoveryOutcome {
    Found { agent: DiscoveredAgent },
    NotFound { tried: Vec<DiscoveryMethod> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AgentAnnouncement {
    #[serde(default)]
    service: Option<String>,
    ip: String,
    port: u16,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    hostname: Option<String>,
    #[serde(default)]
    instance: Option<String>,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    agent: DiscoveredAgent,
    captured_at: Instant,
}

static CACHE: Mutex<Option<CacheEntry>> = Mutex::new(None);

fn cached() -> Option<DiscoveredAgent> {
    let guard = CACHE.lock().ok()?;
    let entry = guard.as_ref()?;
    if entry.captured_at.elapsed() < DISCOVERY_CACHE_TTL {
        let mut a = entry.agent.clone();
        a.method = DiscoveryMethod::Cache;
        Some(a)
    } else {
        None
    }
}

fn store_cache(agent: &DiscoveredAgent) {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(CacheEntry {
            agent: agent.clone(),
            captured_at: Instant::now(),
        });
    }
}

pub fn invalidate_cache() {
    if let Ok(mut guard) = CACHE.lock() {
        *guard = None;
    }
}

fn announcement_to_address(ann: &AgentAnnouncement) -> Option<String> {
    if ann.ip.trim().is_empty() {
        return None;
    }
    if ann.port == 0 {
        return None;
    }
    Some(format!("{}:{}", ann.ip.trim(), ann.port))
}

/// Lista dei hostname/IP da provare per discovery via UNC.
/// Ordine: env var `SLIDE_AGENT_HOSTS` (csv) → "PC-REGIA" default convenzionale.
fn known_unc_hosts() -> Vec<String> {
    let mut hosts: Vec<String> = Vec::new();

    if let Ok(env_hosts) = std::env::var("SLIDE_AGENT_HOSTS") {
        for h in env_hosts.split(',') {
            let trimmed = h.trim();
            if !trimmed.is_empty() {
                hosts.push(trimmed.to_owned());
            }
        }
    }

    if let Ok(env_host) = std::env::var("SLIDE_AGENT_HOST") {
        let trimmed = env_host.trim();
        if !trimmed.is_empty() && !hosts.iter().any(|h| h.eq_ignore_ascii_case(trimmed)) {
            hosts.push(trimmed.to_owned());
        }
    }

    // Convenzione consigliata nei manuali: rinominare il PC regia "PC-REGIA"
    if !hosts.iter().any(|h| h.eq_ignore_ascii_case("PC-REGIA")) {
        hosts.push("PC-REGIA".to_owned());
    }

    hosts
}

/// Tenta discovery via file `\\<host>\SlideCenter$\agent.json`. Best-effort.
async fn try_file_share() -> Option<DiscoveredAgent> {
    for host in known_unc_hosts() {
        let path = format!(r"\\{}\SlideCenter$\agent.json", host);
        let read = timeout(UNC_TIMEOUT, tokio::fs::read_to_string(path.clone())).await;

        let content = match read {
            Ok(Ok(c)) => c,
            Ok(Err(err)) => {
                debug!(host = %host, error = %err, "discovery: UNC read fallita");
                continue;
            }
            Err(_) => {
                debug!(host = %host, "discovery: UNC read timeout");
                continue;
            }
        };

        let parsed: AgentAnnouncement = match serde_json::from_str(&content) {
            Ok(a) => a,
            Err(err) => {
                warn!(host = %host, error = %err, "discovery: UNC JSON malformato");
                continue;
            }
        };

        let address = match announcement_to_address(&parsed) {
            Some(a) => a,
            None => continue,
        };

        info!(method = "file", host = %host, address = %address, "discovery: trovato Local Agent");
        return Some(DiscoveredAgent {
            address,
            method: DiscoveryMethod::File,
            hostname: parsed.hostname.or_else(|| Some(host.clone())),
            version: parsed.version,
        });
    }
    None
}

/// Tenta discovery via broadcast UDP su 255.255.255.255:9999.
async fn try_udp_broadcast() -> Option<DiscoveredAgent> {
    let bind_addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0));
    let socket = match UdpSocket::bind(bind_addr).await {
        Ok(s) => s,
        Err(err) => {
            warn!(error = %err, "discovery: UDP bind fallito");
            return None;
        }
    };

    if let Err(err) = socket.set_broadcast(true) {
        warn!(error = %err, "discovery: set_broadcast non supportato");
        return None;
    }

    let payload = br#"{"q":"slide-center","client":"room-agent"}"#;
    let target = SocketAddr::from((Ipv4Addr::BROADCAST, DISCOVERY_PORT));
    if let Err(err) = socket.send_to(payload, target).await {
        warn!(error = %err, "discovery: UDP send_to broadcast fallito");
        return None;
    }

    let mut buf = vec![0u8; 1500];
    let recv = timeout(UDP_TIMEOUT, socket.recv_from(&mut buf)).await;

    let (len, src) = match recv {
        Ok(Ok(v)) => v,
        Ok(Err(err)) => {
            debug!(error = %err, "discovery: UDP recv_from errore");
            return None;
        }
        Err(_) => {
            debug!("discovery: UDP timeout, nessuna risposta");
            return None;
        }
    };

    let parsed: AgentAnnouncement = match serde_json::from_slice(&buf[..len]) {
        Ok(a) => a,
        Err(err) => {
            warn!(error = %err, ?src, "discovery: UDP risposta non parsabile");
            return None;
        }
    };

    let address = announcement_to_address(&parsed)?;
    info!(method = "udp", address = %address, ?src, "discovery: trovato Local Agent");
    Some(DiscoveredAgent {
        address,
        method: DiscoveryMethod::Udp,
        hostname: parsed.hostname,
        version: parsed.version,
    })
}

/// Tenta discovery via mDNS query `_slide-center._tcp.local.`.
/// Spawna un thread dedicato (mdns-sd ha proprio scheduler) e attende risposta
/// con timeout. Best-effort: se mDNS non è disponibile, ritorna None.
async fn try_mdns() -> Option<DiscoveredAgent> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<DiscoveredAgent>>();

    std::thread::Builder::new()
        .name("mdns-discovery".to_owned())
        .spawn(move || {
            let daemon = match mdns_sd::ServiceDaemon::new() {
                Ok(d) => d,
                Err(err) => {
                    warn!(error = %err, "discovery: mDNS daemon non disponibile");
                    let _ = tx.send(None);
                    return;
                }
            };

            let receiver = match daemon.browse(MDNS_SERVICE_TYPE) {
                Ok(r) => r,
                Err(err) => {
                    warn!(error = %err, "discovery: mDNS browse fallita");
                    let _ = tx.send(None);
                    return;
                }
            };

            let deadline = Instant::now() + MDNS_TIMEOUT;
            let mut found: Option<DiscoveredAgent> = None;

            while Instant::now() < deadline {
                let remaining = deadline.saturating_duration_since(Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match receiver.recv_timeout(remaining) {
                    Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                        let port = info.get_port();
                        let ip = info
                            .get_addresses()
                            .iter()
                            .filter_map(|a| match a.to_ip_addr() {
                                IpAddr::V4(v4) => Some(v4.to_string()),
                                IpAddr::V6(_) => None,
                            })
                            .next();

                        let Some(ip) = ip else { continue };
                        let port = if port == 0 { HTTP_PORT_FALLBACK } else { port };

                        found = Some(DiscoveredAgent {
                            address: format!("{}:{}", ip, port),
                            method: DiscoveryMethod::Mdns,
                            hostname: Some(info.get_hostname().to_owned()),
                            version: info
                                .get_property("version")
                                .map(|p| p.val_str().to_owned()),
                        });
                        break;
                    }
                    Ok(_) => continue,
                    Err(_) => continue,
                }
            }

            let _ = daemon.shutdown();
            let _ = tx.send(found);
        })
        .ok()?;

    rx.await.ok().flatten()
}

/// Esegue il discovery con cache 60s e cascata UNC → UDP → mDNS.
/// Non considera "manual" perche' viene gestito separatamente dall'UI.
pub async fn discover_local_agent() -> DiscoveryOutcome {
    if let Some(agent) = cached() {
        debug!(method = ?agent.method, address = %agent.address, "discovery: cache hit");
        return DiscoveryOutcome::Found { agent };
    }

    let mut tried = Vec::new();

    tried.push(DiscoveryMethod::File);
    if let Some(agent) = try_file_share().await {
        store_cache(&agent);
        return DiscoveryOutcome::Found { agent };
    }

    tried.push(DiscoveryMethod::Udp);
    if let Some(agent) = try_udp_broadcast().await {
        store_cache(&agent);
        return DiscoveryOutcome::Found { agent };
    }

    tried.push(DiscoveryMethod::Mdns);
    if let Some(agent) = try_mdns().await {
        store_cache(&agent);
        return DiscoveryOutcome::Found { agent };
    }

    info!(?tried, "discovery: nessun Local Agent trovato in cascata");
    DiscoveryOutcome::NotFound { tried }
}

/// Marca un IP fornito manualmente come ultimo metodo. Utile per esporre
/// un `DiscoveredAgent` consistente all'UI quando l'utente immette IP a mano.
pub fn manual_agent(address: String) -> DiscoveredAgent {
    let agent = DiscoveredAgent {
        address,
        method: DiscoveryMethod::Manual,
        hostname: None,
        version: None,
    };
    store_cache(&agent);
    agent
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn announcement_to_address_rejects_empty() {
        let ann = AgentAnnouncement {
            service: None,
            ip: "".into(),
            port: 8080,
            version: None,
            hostname: None,
            instance: None,
        };
        assert!(announcement_to_address(&ann).is_none());
    }

    #[test]
    fn announcement_to_address_rejects_zero_port() {
        let ann = AgentAnnouncement {
            service: None,
            ip: "192.168.1.10".into(),
            port: 0,
            version: None,
            hostname: None,
            instance: None,
        };
        assert!(announcement_to_address(&ann).is_none());
    }

    #[test]
    fn announcement_to_address_builds_correct_string() {
        let ann = AgentAnnouncement {
            service: Some("slide-center-agent".into()),
            ip: "  192.168.1.10  ".into(),
            port: 8080,
            version: Some("0.1.0".into()),
            hostname: Some("PC-REGIA".into()),
            instance: Some("PC-REGIA:8080".into()),
        };
        assert_eq!(announcement_to_address(&ann), Some("192.168.1.10:8080".to_owned()));
    }

    #[test]
    fn known_unc_hosts_includes_default() {
        std::env::remove_var("SLIDE_AGENT_HOSTS");
        std::env::remove_var("SLIDE_AGENT_HOST");
        let hosts = known_unc_hosts();
        assert!(hosts.iter().any(|h| h == "PC-REGIA"));
    }

    #[test]
    fn manual_agent_caches_and_marks_method() {
        invalidate_cache();
        let agent = manual_agent("10.0.0.5:8080".to_owned());
        assert_eq!(agent.method, DiscoveryMethod::Manual);
        let cached = cached().expect("cache should be populated");
        assert_eq!(cached.address, "10.0.0.5:8080");
        assert_eq!(cached.method, DiscoveryMethod::Cache);
        invalidate_cache();
    }
}
