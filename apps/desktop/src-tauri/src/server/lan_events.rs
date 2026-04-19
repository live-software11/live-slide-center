// Sprint N2 (GUIDA_OPERATIVA_v3 §4.F N2-N3) — broadcast event bus per il PC sala.
//
// Quando l'admin LAN finalize_upload_version_admin completa un upload, lancia
// un fan-out HTTP `POST /events/file_added` verso ogni PC sala paired. Il PC
// sala riceve l'evento e lo deve notificare alla SPA in webview perche' lei
// faccia un `refreshNow()` immediato del manifest invece di aspettare il
// prossimo polling 30s.
//
// Soluzione: long-poll dalla SPA su `GET /events/stream?since=<id>`. Se ci
// sono eventi nuovi (id > since), li ritorna subito. Altrimenti rimane in
// attesa fino a `timeout_ms` (default 25s) o all'arrivo di un broadcast.
// Il client setta `since` al cursore dell'ultimo evento ricevuto e fa long-poll
// di nuovo: zero polling sprecato, latenza fan-out → SPA = round-trip TCP.
//
// Architettura: `tokio::sync::broadcast::Sender<LanEvent>` (capacity 64) +
// snapshot ring buffer per gestire i client che si connettono dopo il push
// (vedono comunque gli ultimi N eventi). Il broadcast::Receiver si crea on-demand
// quando arriva un long-poll request: il subscriber drop avviene a fine handler.
//
// Sicurezza: l'endpoint `/events/file_added` non richiede device_token. La
// trust e' LAN: solo chi e' raggiungibile sul mDNS broadcast (LAN privata)
// puo' inviare push. Stesso modello usato per `pair-direct`. Se in futuro
// servisse autenticazione (multi-tenant office), aggiungeremo HMAC sull'header.

use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

/// Capacity broadcast channel: i subscriber che non leggono entro 64 eventi
/// di backlog vengono lagged. In pratica una webview SPA fa long-poll ogni
/// 25s, ricevendo tutti gli eventi pendenti — non dovremmo mai laggare.
const CHANNEL_CAPACITY: usize = 64;

/// Snapshot ring per i client che si connettono "tardi" (es. SPA che si avvia
/// dopo un push). Manteniamo gli ultimi 32 eventi, ridotti dopo lifetime di
/// 5 minuti per evitare stale state. Il GC e' lazy: `snapshot_since()` filtra.
const SNAPSHOT_MAX: usize = 32;
const SNAPSHOT_TTL_SECS: i64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LanEventPayload {
    /// Sprint N1: l'admin ha pubblicato un nuovo file (status=ready). Il PC sala
    /// fa un `refreshNow()` immediato del manifest, scarica via HTTP LAN.
    FileAdded {
        event_id: String,
        room_id: Option<String>,
        version_id: String,
        presentation_id: String,
        file_name: String,
        file_size_bytes: i64,
        mime_type: String,
        file_hash_sha256: Option<String>,
        storage_key: String,
        admin_base_url: Option<String>,
    },
    /// Sprint N1: l'admin ha cancellato una presentation. Il PC sala rimuove
    /// i file orfani dal disco al prossimo refresh.
    PresentationDeleted {
        event_id: String,
        presentation_id: String,
        version_ids: Vec<String>,
    },
    /// Sprint W C3 — File Explorer V2: cartella creata. Il PC sala invalida il
    /// tree manifest e ricarica via long-poll.
    FolderCreated {
        event_id: String,
        folder_id: String,
        parent_id: Option<String>,
        name: String,
    },
    /// Sprint W C3 — Cartella rinominata. Il PC sala aggiorna il tree.
    FolderRenamed {
        event_id: String,
        folder_id: String,
        new_name: String,
    },
    /// Sprint W C3 — Cartella eliminata (cascade su sotto-cartelle e
    /// dissociazione presentations: vedi cloud `rpc_delete_event_folder`).
    FolderDeleted {
        event_id: String,
        folder_id: String,
        cascade_folder_ids: Vec<String>,
    },
    /// Sprint W C3 — Una o piu' presentation spostate in una folder (o root).
    /// Il PC sala aggiorna il bucket di file mostrato in player.
    PresentationsMovedToFolder {
        event_id: String,
        target_folder_id: Option<String>,
        presentation_ids: Vec<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct LanEvent {
    pub id: u64,
    pub at: String,
    pub payload: LanEventPayload,
}

/// Bus eventi LAN: sender broadcast + ring di snapshot.
///
/// `next_id` e' un counter monotonic crescente (mai resettato durante la lifetime
/// del processo). Il client lo usa come cursore: ad esempio `since=42` ritorna
/// tutti gli eventi con `id > 42`. Allo startup il client passa `since=0`.
pub struct LanEventBus {
    tx: broadcast::Sender<LanEvent>,
    inner: Mutex<LanEventBusInner>,
}

struct LanEventBusInner {
    next_id: u64,
    snapshot: Vec<LanEvent>,
}

impl LanEventBus {
    pub fn new() -> Arc<Self> {
        let (tx, _rx_unused) = broadcast::channel(CHANNEL_CAPACITY);
        Arc::new(Self {
            tx,
            inner: Mutex::new(LanEventBusInner {
                next_id: 1,
                snapshot: Vec::with_capacity(SNAPSHOT_MAX),
            }),
        })
    }

    pub fn publish(&self, payload: LanEventPayload) -> LanEvent {
        let evt = {
            let mut g = self.inner.lock().expect("LanEventBus poisoned");
            let id = g.next_id;
            g.next_id += 1;
            let evt = LanEvent {
                id,
                at: chrono::Utc::now().to_rfc3339(),
                payload,
            };
            g.snapshot.push(evt.clone());
            if g.snapshot.len() > SNAPSHOT_MAX {
                let drop_n = g.snapshot.len() - SNAPSHOT_MAX;
                g.snapshot.drain(0..drop_n);
            }
            evt
        };
        // Best-effort broadcast: se nessun subscriber, send() ritorna Err
        // ma non e' un problema (lo snapshot ring serve proprio a questo).
        let _ = self.tx.send(evt.clone());
        evt
    }

    /// Sottoscrizione long-poll. Ritorna gli eventi gia' presenti con `id > since`
    /// se ci sono, altrimenti aspetta fino a `timeout` per il primo broadcast.
    /// Filtra eventi piu' vecchi di `SNAPSHOT_TTL_SECS` (best-effort GC).
    pub fn snapshot_since(&self, since: u64) -> Vec<LanEvent> {
        let g = self.inner.lock().expect("LanEventBus poisoned");
        let cutoff = chrono::Utc::now()
            .checked_sub_signed(chrono::Duration::seconds(SNAPSHOT_TTL_SECS))
            .map(|t| t.to_rfc3339())
            .unwrap_or_default();
        g.snapshot
            .iter()
            .filter(|e| e.id > since && e.at.as_str() >= cutoff.as_str())
            .cloned()
            .collect()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<LanEvent> {
        self.tx.subscribe()
    }

    /// Cursore corrente. Il client puo' usarlo come baseline per il primo poll
    /// se non vuole ricevere eventi storici.
    #[allow(dead_code)]
    pub fn cursor(&self) -> u64 {
        let g = self.inner.lock().expect("LanEventBus poisoned");
        g.next_id.saturating_sub(1)
    }
}
