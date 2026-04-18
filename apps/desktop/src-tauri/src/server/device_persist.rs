// Sprint L4 (GUIDA_OPERATIVA_v3 §4.D L4 + Sprint M1) — persistenza configurazione
// del PC sala dopo pair-direct.
//
// Quando un PC sala viene pairizzato dall'admin LAN, le info essenziali per
// rejoin auto al riavvio vanno salvate **fuori** dal DB SQLite (che e' la
// sorgente di verita' lato server admin) anche sul disco del PC sala in un
// formato leggibile, cosi' che:
//   • alla prossima accensione il PC sala non chieda di nuovo il pairing,
//   • l'utente possa ispezionare il file (path/admin server) per debug,
//   • un eventuale re-install conservi lo stato (file in `~/SlideCenter/`).
//
// Questo file vive nello stesso `data_root` del server (default
// `~/SlideCenter/device.json`) e segue il contratto descritto in §4.E M1:
//
// {
//   "device_id":   "<uuid>",
//   "device_token": "<token-clear>",
//   "device_name": "PC-Sala-Plenaria",
//   "event_id":    "<uuid>",
//   "room_id":     "<uuid|null>",
//   "admin_server": {
//     "base_url":    "http://192.168.1.10:7300",
//     "name":        "MIO-PC-ADMIN",
//     "fingerprint": null
//   },
//   "paired_at":  "2026-04-17T12:34:56Z",
//   "app_version": "0.1.0"
// }
//
// La scrittura e' atomica (tmp+rename). Per coerenza con i secrets, gli errori
// non sono bloccanti per il client (l'admin riceve comunque il pair-direct
// success); vengono solo loggati. La perdita del file e' recuperabile rifacendo
// pair-direct dall'admin.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdminServerInfo {
    pub base_url: String,
    pub name: Option<String>,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersistedDevice {
    pub device_id: String,
    pub device_token: String,
    pub device_name: String,
    pub event_id: String,
    pub room_id: Option<String>,
    pub admin_server: Option<AdminServerInfo>,
    pub paired_at: String,
    pub app_version: String,
}

pub fn write(data_root: &Path, payload: &PersistedDevice) -> std::io::Result<()> {
    std::fs::create_dir_all(data_root)?;
    let path = device_path(data_root);
    let bytes = serde_json::to_vec_pretty(payload).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &path)?;
    info!(path = %path.display(), device_id = %payload.device_id, "device.json persistito");
    Ok(())
}

pub fn read(data_root: &Path) -> Option<PersistedDevice> {
    let path = device_path(data_root);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            warn!(?e, "lettura device.json fallita");
            return None;
        }
    };
    match serde_json::from_slice::<PersistedDevice>(&bytes) {
        Ok(d) => Some(d),
        Err(e) => {
            warn!(?e, "device.json non parsabile");
            None
        }
    }
}

/// Sprint M3 — rimuove `device.json` dal disco. Chiamata da `pair-revoke` (admin
/// LAN smonta il pairing) e da `cmd_clear_device_pairing` (utente sala esce
/// dall'evento dal menu locale). NotFound non e' un errore (idempotenza).
pub fn clear(data_root: &Path) -> std::io::Result<()> {
    let path = device_path(data_root);
    match std::fs::remove_file(&path) {
        Ok(_) => {
            info!(path = %path.display(), "device.json rimosso (pair-revoke / esci-evento)");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

fn device_path(data_root: &Path) -> PathBuf {
    data_root.join("device.json")
}
