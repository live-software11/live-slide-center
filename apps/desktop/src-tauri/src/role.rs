// Sprint L1 (GUIDA_OPERATIVA_v3 §4.D L1) — persistenza del ruolo del nodo desktop.
//
// All'avvio l'utente sceglie una volta sola se questo PC e':
//   • "admin" → centro di controllo (SPA admin completa, mDNS publish role=admin,
//               SQLite sorgente di verita', storage locale, accetta pairing).
//   • "sala"  → PC che proietta (SPA in modalita PairView/RoomPlayerView, mDNS
//               publish role=sala, accetta pair-direct dall'admin LAN, scarica
//               file dall'admin server).
//
// Il valore viene persistito in `~/SlideCenter/role.json` e letto al boot
// successivo: regola §0.4 "persistenza assoluta — un PC sala NON perde mai stato
// a un riavvio". Modificabile solo:
//   • dal selezionatore iniziale (prima volta),
//   • dal menu Settings della SPA (con conferma),
//   • cancellando manualmente il file.
//
// Contratto file:
//   {
//     "role": "admin" | "sala",
//     "chosen_at": "2026-04-17T12:34:56Z",
//     "app_version": "0.1.0"
//   }

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::{info, warn};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeRole {
    Admin,
    Sala,
}

impl NodeRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            NodeRole::Admin => "admin",
            NodeRole::Sala => "sala",
        }
    }

    pub fn parse(value: &str) -> Option<NodeRole> {
        match value.trim().to_ascii_lowercase().as_str() {
            "admin" => Some(NodeRole::Admin),
            "sala" => Some(NodeRole::Sala),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedRole {
    role: String,
    chosen_at: String,
    app_version: String,
}

/// Legge il ruolo persistito. Ritorna `None` se il file manca o e' invalido:
/// in entrambi i casi la SPA mostrera' il selezionatore.
pub fn read_role(data_root: &Path) -> Option<NodeRole> {
    let path = role_path(data_root);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return None,
        Err(e) => {
            warn!(?e, "lettura role.json fallita: tratto come ruolo non scelto");
            return None;
        }
    };
    match serde_json::from_slice::<PersistedRole>(&bytes) {
        Ok(p) => NodeRole::parse(&p.role),
        Err(e) => {
            warn!(?e, "role.json non parsabile: tratto come ruolo non scelto");
            None
        }
    }
}

/// Scrive il ruolo in modo atomico (write tmp + rename). Non sovrascrive se il
/// ruolo richiesto e' identico a quello gia' persistito (evita touch inutili).
pub fn write_role(data_root: &Path, role: NodeRole) -> std::io::Result<()> {
    if read_role(data_root) == Some(role) {
        return Ok(());
    }
    std::fs::create_dir_all(data_root)?;
    let payload = PersistedRole {
        role: role.as_str().to_string(),
        chosen_at: chrono::Utc::now().to_rfc3339(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    let bytes = serde_json::to_vec_pretty(&payload).map_err(std::io::Error::other)?;
    let path = role_path(data_root);
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &bytes)?;
    std::fs::rename(&tmp, &path)?;
    info!(role = role.as_str(), path = %path.display(), "ruolo nodo persistito");
    Ok(())
}

fn role_path(data_root: &Path) -> PathBuf {
    data_root.join("role.json")
}
