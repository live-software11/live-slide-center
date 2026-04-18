//! Sprint D6 — Heartbeat automatico licenza desktop.
//!
//! All'avvio dell'app Tauri (subito dopo che il server locale e' pronto)
//! spawniamo un task tokio che chiama periodicamente `LicenseManager::verify_now()`.
//!
//! Politica:
//!   - Se la licenza non e' bound (`NotBound`): ZERO chiamate. Lo skip e'
//!     chiave per non spammare l'edge function quando l'utente non ha mai
//!     legato il PC al cloud (es. uso solo LAN). L'avvio del bind avverra'
//!     manualmente da `cmd_license_bind` chiamato dalla SPA.
//!
//!   - Se bound: prima chiamata dopo ~30s dal boot (lasciamo respirare
//!     il server locale + mDNS), poi una ogni 6 ore. Errori (offline,
//!     timeout, 5xx) sono LOGGATI ma NON propagati: la licenza resta in
//!     stato `GracePeriod` finche' grace_until non scade (30 giorni di
//!     default), e l'utente vede comunque il banner sticky che chiede di
//!     verificare manualmente.
//!
//!   - In modalita debug il loop usa intervalli ridotti (60s) per facilitare
//!     il dev cycle (override env `SLIDECENTER_LICENSE_HEARTBEAT_INTERVAL_S`
//!     accetta un valore in secondi, da 60 a 86400).
//!
//! Sicurezza: il task e' detached, non viene mai joinato. Tauri lo termina
//! col processo (no zombie thread). Non condivide stato con altri moduli
//! oltre ai file `~/.slidecenter/license.enc` (gestiti via `storage::*`
//! con file lock implicito su scrittura).

use std::time::Duration;

use tracing::{debug, info, warn};

use super::manager::LicenseManager;
use super::types::LicenseStatus;

/// Intervallo nominale tra heartbeat in produzione: 6 ore.
/// Compromesso tra "scopri revoca rapidamente" e "non sprecare quota Edge
/// Functions": 4 chiamate/giorno per PC = ~120/mese. Su 100 PC tenant medio
/// = 12k chiamate/mese, ben dentro tier free Supabase (500k/mese inclusi).
const DEFAULT_INTERVAL_SECONDS: u64 = 6 * 60 * 60;

/// Delay iniziale (post-boot) prima della prima chiamata. Lasciamo che
/// il backend HTTP locale e l'mDNS si stabilizzino; la rete potrebbe non
/// essere ancora pronta (DHCP lease, VPN client, etc).
const INITIAL_DELAY_SECONDS: u64 = 30;

/// Timeout massimo della singola chiamata `verify_now()`. Coerente col
/// timeout interno del client HTTP in `client.rs` (10s); aggiungiamo
/// margine per disk I/O del save license.enc.
const SINGLE_CALL_TIMEOUT_SECONDS: u64 = 20;

fn read_interval_seconds() -> u64 {
    if let Ok(s) = std::env::var("SLIDECENTER_LICENSE_HEARTBEAT_INTERVAL_S") {
        if let Ok(n) = s.parse::<u64>() {
            return n.clamp(60, 86_400);
        }
    }
    DEFAULT_INTERVAL_SECONDS
}

/// Spawna il loop heartbeat su tokio runtime corrente. Da chiamare UNA
/// volta sola dal `setup()` Tauri dopo che il server locale e' partito.
///
/// Ritorna immediatamente; il task gira in background detached.
pub fn spawn_background_loop() {
    let interval_s = read_interval_seconds();
    let initial_s = INITIAL_DELAY_SECONDS;

    info!(
        interval_seconds = interval_s,
        initial_delay_seconds = initial_s,
        "Sprint D6 — heartbeat licenza desktop schedulato"
    );

    tauri::async_runtime::spawn(async move {
        // Boot delay: lascia stabilizzare rete + server locale.
        tokio::time::sleep(Duration::from_secs(initial_s)).await;

        // Lazy: creiamo il manager dentro il task. Se la creazione fallisce
        // (env malformato), logghiamo warn e usciamo dal loop senza
        // crashare l'app: l'utente potra' comunque usare la SPA manuale.
        let manager = match LicenseManager::new() {
            Ok(m) => m,
            Err(e) => {
                warn!(error = %e, "Sprint D6 — LicenseManager::new fallito, heartbeat disabilitato");
                return;
            }
        };

        loop {
            // Skip rapido se la licenza non e' bound (ZERO I/O di rete).
            // Rilettura ad ogni tick: se l'utente fa bind nel mentre, il
            // prossimo ciclo lo intercetta senza restart.
            let status = manager.current_status();
            let should_call = !matches!(status, LicenseStatus::NotBound | LicenseStatus::Error { .. });

            if should_call {
                debug!("Sprint D6 — heartbeat tick: chiamo verify_now()");
                let call = manager.verify_now();
                match tokio::time::timeout(
                    Duration::from_secs(SINGLE_CALL_TIMEOUT_SECONDS),
                    call,
                )
                .await
                {
                    Ok(Ok(())) => {
                        debug!("Sprint D6 — heartbeat OK");
                        // Sprint SR — dopo verify riuscita, controlla se il
                        // pair_token sta scadendo (≤ 7gg) e tenta auto-renew
                        // (con cooldown anti-loop). Salta se token già scaduto
                        // (serve re-bind) o se il cooldown non è trascorso.
                        if manager.should_attempt_auto_renew() {
                            info!("Sprint SR — pair_token in scadenza ≤ 7gg, tento auto-renew");
                            let renew_call = manager.renew_now();
                            match tokio::time::timeout(
                                Duration::from_secs(SINGLE_CALL_TIMEOUT_SECONDS),
                                renew_call,
                            )
                            .await
                            {
                                Ok(Ok(())) => {
                                    info!("Sprint SR — auto-renew pair_token OK");
                                }
                                Ok(Err(e)) => {
                                    warn!(
                                        error = %e,
                                        "Sprint SR — auto-renew fallito (riprovo dopo cooldown 6h)"
                                    );
                                }
                                Err(_) => {
                                    warn!(
                                        timeout_seconds = SINGLE_CALL_TIMEOUT_SECONDS,
                                        "Sprint SR — auto-renew timeout (riprovo dopo cooldown 6h)"
                                    );
                                }
                            }
                        }
                    }
                    Ok(Err(e)) => {
                        // Errori semanticamente rilevanti (revoked,
                        // tenant_suspended, pair_token_expired) NON modificano
                        // direttamente lo stato locale: e' verify_now() stesso
                        // che salva license.enc e classify() che ricalcola lo
                        // stato alla prossima query. Qui logghiamo e basta.
                        // Specificamente per pair_token_expired la SPA mostrerà
                        // banner "contatta admin per re-bind" via classify().
                        warn!(error = %e, "Sprint D6 — heartbeat fallito (continuo)");
                    }
                    Err(_) => {
                        warn!(
                            timeout_seconds = SINGLE_CALL_TIMEOUT_SECONDS,
                            "Sprint D6 — heartbeat timeout (continuo)"
                        );
                    }
                }
            } else {
                debug!(
                    status = ?status,
                    "Sprint D6 — heartbeat tick saltato (licenza non bound o errore lettura)"
                );
            }

            tokio::time::sleep(Duration::from_secs(interval_s)).await;
        }
    });
}
