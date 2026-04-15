use std::time::Duration;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::downloader::list_remote_files;
use crate::downloader::download_file_from_agent;
use crate::state::{AgentStatus, RoomAgentState};

/// Avvia il polling verso il Local Agent ogni 5 secondi.
/// Si ferma quando il token di cancellazione viene attivato o quando l'event_id cambia.
pub async fn start_polling(state: RoomAgentState, event_id: String) {
    info!("Room Agent: polling started for event {}", event_id);

    let cancel = state.cancel_token.clone();
    let mut interval = tokio::time::interval(Duration::from_secs(5));

    // Pre-popola la mappa download con file già presenti su disco (sopravvive a restart)
    {
        let room_id = state.room_id.lock().unwrap().clone().unwrap_or_else(|| "default".to_owned());
        let room_dir = state.output_dir.join(&room_id);
        if room_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&room_dir) {
                let mut dl = state.downloaded.lock().unwrap();
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        dl.entry(name.to_owned()).or_insert_with(|| "cached".to_owned());
                    }
                }
            }
        }
    }

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                info!("Room Agent: polling cancelled for event {}", event_id);
                break;
            }
            _ = interval.tick() => {}
        }

        let has_agent = state.agent_address.lock().unwrap().is_some();
        if !has_agent {
            *state.status.lock().unwrap() = AgentStatus::Offline;
            continue;
        }

        let agent_addr = state.agent_address.lock().unwrap().clone().unwrap();
        let health_url = format!("http://{}/api/v1/health", agent_addr);
        let client = reqwest::Client::new();
        let health = client
            .get(&health_url)
            .timeout(Duration::from_secs(3))
            .send()
            .await;

        if health.is_err() {
            warn!("Room Agent: Local Agent unreachable at {}", agent_addr);
            *state.status.lock().unwrap() = AgentStatus::Offline;
            continue;
        }

        match list_remote_files(&state, &event_id).await {
            Err(e) => {
                warn!("Room Agent: failed to list files: {}", e);
                *state.status.lock().unwrap() = AgentStatus::Offline;
            }
            Ok(files) => {
                let downloaded = state.downloaded.lock().unwrap().clone();
                let pending: Vec<_> = files
                    .into_iter()
                    .filter(|f| !downloaded.contains_key(&f.filename))
                    .collect();

                if pending.is_empty() {
                    *state.status.lock().unwrap() = AgentStatus::Synced;
                    continue;
                }

                *state.status.lock().unwrap() = AgentStatus::Syncing;
                for f in &pending {
                    if cancel.is_cancelled() { break; }
                    info!("Room Agent: downloading {}", f.filename);
                    if let Err(e) = download_file_from_agent(&state, &event_id, &f.filename).await {
                        warn!("Room Agent: download error for {}: {}", f.filename, e);
                    }
                }
                if !cancel.is_cancelled() {
                    *state.status.lock().unwrap() = AgentStatus::Synced;
                }
            }
        }
    }
}
