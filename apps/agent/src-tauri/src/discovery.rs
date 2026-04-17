//! Sprint 2 — Discovery LAN per intranet offline (Local Agent lato server).
//!
//! Il Local Agent espone tre meccanismi di discovery, in modo che i Room Agent
//! possano trovarlo anche senza configurazione manuale:
//!
//! 1. UDP responder su :9999 — risponde a query broadcast/unicast con un payload
//!    JSON contenente `{ip, port, version, hostname}`. Usato come metodo
//!    primario in LAN dove il broadcast è permesso.
//! 2. mDNS service `_slide-center._tcp.local.` — annuncio multicast DNS-SD,
//!    funziona anche dietro switch L2 che non propagano broadcast UDP.
//! 3. Share SMB `\\<host>\SlideCenter$\agent.json` — opzionale (Andrea decide se
//!    abilitarla manualmente). Vedi installer-hooks.nsi per il setup.
//!
//! Tutto best-effort: errori loggati ma mai fatali. Il Local Agent funziona
//! anche se discovery fallisce (i Room Agent possono sempre inserire IP a mano).

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use serde::Serialize;
use tokio::net::UdpSocket;
use tracing::{debug, info, warn};

use crate::state::AppState;

const DISCOVERY_PORT: u16 = 9999;
const HTTP_PORT: u16 = 8080;
const MDNS_SERVICE_TYPE: &str = "_slide-center._tcp.local.";
const QUERY_KEYWORD: &str = "slide-center";
const MAX_DATAGRAM_SIZE: usize = 1024;

#[derive(Serialize)]
struct DiscoveryAnnouncement<'a> {
    service: &'static str,
    ip: String,
    port: u16,
    version: &'a str,
    hostname: String,
    /// Identificatore univoco di rete: <hostname>:<port>. Aiuta i Room Agent
    /// a deduplicare risposte di Local Agent multipli sulla stessa LAN.
    instance: String,
}

/// Calcola un IP LAN valido (preferendo IPv4 privato) per l'annuncio.
/// Se non disponibile (PC senza rete), restituisce loopback per fallback locale.
fn detect_lan_ip() -> IpAddr {
    match local_ip_address::local_ip() {
        Ok(ip) => ip,
        Err(err) => {
            warn!(error = %err, "discovery: impossibile determinare IP LAN, fallback 127.0.0.1");
            IpAddr::V4(Ipv4Addr::LOCALHOST)
        }
    }
}

fn detect_hostname() -> String {
    gethostname::gethostname()
        .into_string()
        .unwrap_or_else(|_| "slide-center-agent".to_owned())
}

fn build_announcement(version: &str) -> DiscoveryAnnouncement<'_> {
    let ip = detect_lan_ip();
    let hostname = detect_hostname();
    let instance = format!("{}:{}", hostname, HTTP_PORT);
    DiscoveryAnnouncement {
        service: "slide-center-agent",
        ip: ip.to_string(),
        port: HTTP_PORT,
        version,
        hostname,
        instance,
    }
}

/// Avvia il responder UDP su 0.0.0.0:9999. Best-effort: se il bind fallisce
/// (porta occupata, permessi mancanti) logga warning e termina senza panico.
pub async fn spawn_udp_responder(_state: AppState) {
    let bind_addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT));
    let socket = match UdpSocket::bind(bind_addr).await {
        Ok(s) => s,
        Err(err) => {
            warn!(
                error = %err,
                port = DISCOVERY_PORT,
                "discovery: UDP bind fallito, responder disabilitato"
            );
            return;
        }
    };

    if let Err(err) = socket.set_broadcast(true) {
        debug!(error = %err, "discovery: set_broadcast non supportato");
    }

    info!(
        port = DISCOVERY_PORT,
        "discovery: UDP responder in ascolto"
    );

    let version = env!("CARGO_PKG_VERSION");
    let mut buf = vec![0u8; MAX_DATAGRAM_SIZE];

    loop {
        let (len, src) = match socket.recv_from(&mut buf).await {
            Ok(v) => v,
            Err(err) => {
                warn!(error = %err, "discovery: recv_from errore, riprovo dopo 1s");
                tokio::time::sleep(Duration::from_secs(1)).await;
                continue;
            }
        };

        let payload = String::from_utf8_lossy(&buf[..len]);
        if !payload.contains(QUERY_KEYWORD) {
            debug!(?src, len, "discovery: payload sconosciuto, ignoro");
            continue;
        }

        let announcement = build_announcement(version);
        let body = match serde_json::to_vec(&announcement) {
            Ok(b) => b,
            Err(err) => {
                warn!(error = %err, "discovery: serializzazione annuncio fallita");
                continue;
            }
        };

        if let Err(err) = socket.send_to(&body, src).await {
            debug!(error = %err, ?src, "discovery: send_to fallito");
        }
    }
}

/// Avvia un thread dedicato che pubblica il servizio mDNS
/// `_slide-center._tcp.local.` con TXT records utili al client.
/// Best-effort: errori loggati ma mai propagati. Indipendente dal runtime
/// tokio: lavora con `std::thread` perche' `mdns-sd` ha il proprio scheduler.
pub fn spawn_mdns_advertiser(version: String) {
    std::thread::Builder::new()
        .name("mdns-advertiser".to_owned())
        .spawn(move || {
            let daemon = match mdns_sd::ServiceDaemon::new() {
                Ok(d) => d,
                Err(err) => {
                    warn!(error = %err, "discovery: mDNS daemon non disponibile");
                    return;
                }
            };

            let hostname = detect_hostname();
            let host_label = sanitize_label(&hostname);
            let host_fqdn = format!("{}.local.", host_label);
            let instance_name = format!("Live SLIDE Agent {}", host_label);

            let ip = detect_lan_ip();
            let ips: Vec<IpAddr> = vec![ip];

            let mut props = std::collections::HashMap::new();
            props.insert("path".to_owned(), "/api/v1/health".to_owned());
            props.insert("version".to_owned(), version.clone());
            props.insert("hostname".to_owned(), hostname.clone());

            let service = match mdns_sd::ServiceInfo::new(
                MDNS_SERVICE_TYPE,
                &instance_name,
                &host_fqdn,
                &ips[..],
                HTTP_PORT,
                Some(props),
            ) {
                Ok(s) => s,
                Err(err) => {
                    warn!(error = %err, "discovery: mDNS ServiceInfo non valido");
                    return;
                }
            };

            match daemon.register(service) {
                Ok(_) => info!(service = MDNS_SERVICE_TYPE, "discovery: mDNS service registrato"),
                Err(err) => warn!(error = %err, "discovery: mDNS register fallito"),
            }

            // Tieni il daemon vivo per la durata del processo
            loop {
                std::thread::sleep(Duration::from_secs(60));
            }
        })
        .ok();
}

/// Sanitizza una stringa rendendola un label DNS valido (RFC 1035 best-effort).
/// Sostituisce caratteri non alfanumerici con `-` e tronca a 63 caratteri.
fn sanitize_label(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
        } else if ch == '-' || ch == '_' {
            out.push('-');
        } else {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    let mut s = trimmed.to_string();
    if s.is_empty() {
        s = "slide-center-agent".to_owned();
    }
    if s.len() > 63 {
        s.truncate(63);
        s = s.trim_end_matches('-').to_owned();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_label_normalises_hostname() {
        assert_eq!(sanitize_label("PC-Regia.local"), "PC-Regia-local");
        assert_eq!(sanitize_label("PC SALA 01"), "PC-SALA-01");
        assert_eq!(sanitize_label("---"), "slide-center-agent");
        assert_eq!(sanitize_label(""), "slide-center-agent");
    }

    #[test]
    fn sanitize_label_truncates_long_input() {
        let long = "a".repeat(120);
        let out = sanitize_label(&long);
        assert!(out.len() <= 63);
    }

    #[test]
    fn announcement_serializes_to_expected_json() {
        let v = "9.9.9";
        let ann = build_announcement(v);
        let json = serde_json::to_value(&ann).unwrap();
        assert_eq!(json["service"], "slide-center-agent");
        assert_eq!(json["port"], HTTP_PORT);
        assert_eq!(json["version"], v);
        assert!(json["hostname"].as_str().unwrap().len() > 0);
        assert!(json["instance"].as_str().unwrap().contains(":"));
    }
}
