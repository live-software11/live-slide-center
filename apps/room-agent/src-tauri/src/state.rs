use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Connecting,
    Synced,
    Syncing,
    Offline,
}

#[derive(Clone)]
pub struct RoomAgentState {
    /// IP:porta del Local Agent (es. "192.168.1.100:8080")
    pub agent_address: Arc<Mutex<Option<String>>>,
    /// ID sala assegnata
    pub room_id: Arc<Mutex<Option<String>>>,
    /// Nome dispositivo
    pub device_name: Arc<String>,
    /// Cartella locale dove scrivere i file (C:\SlideCenter\{roomName}\)
    pub output_dir: Arc<std::path::PathBuf>,
    /// Stato corrente
    pub status: Arc<Mutex<AgentStatus>>,
    /// Lista file scaricati (filename -> sha256 o "ok")
    pub downloaded: Arc<Mutex<std::collections::HashMap<String, String>>>,
    /// Token per fermare il polling loop
    pub cancel_token: CancellationToken,
}

impl RoomAgentState {
    pub fn new(device_name: String) -> Self {
        let output_dir = dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("C:\\"))
            .join("SlideCenter");
        std::fs::create_dir_all(&output_dir).ok();

        Self {
            agent_address: Arc::new(Mutex::new(None)),
            room_id: Arc::new(Mutex::new(None)),
            device_name: Arc::new(device_name),
            output_dir: Arc::new(output_dir),
            status: Arc::new(Mutex::new(AgentStatus::Offline)),
            downloaded: Arc::new(Mutex::new(std::collections::HashMap::new())),
            cancel_token: CancellationToken::new(),
        }
    }
}
