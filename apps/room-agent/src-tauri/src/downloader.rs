use anyhow::Result;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;
use tracing::info;

use crate::state::RoomAgentState;

#[derive(Debug, Deserialize)]
pub struct RemoteFile {
    pub version_id: String,
    pub filename: String,
    pub storage_key: String,
    pub file_size_bytes: Option<i64>,
}

/// Scarica un file dal Local Agent LAN e lo salva nella cartella di output.
/// Restituisce il path locale del file.
pub async fn download_file_from_agent(
    state: &RoomAgentState,
    event_id: &str,
    filename: &str,
) -> Result<PathBuf> {
    let agent_addr = state
        .agent_address
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow::anyhow!("No agent address configured"))?;

    let url = format!("http://{}/api/v1/files/{}/{}", agent_addr, event_id, filename);
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let response = client.get(&url).send().await?;
    if !response.status().is_success() {
        anyhow::bail!("HTTP {} from Local Agent for {}", response.status(), filename);
    }

    let room_id = state.room_id.lock().unwrap().clone().unwrap_or_else(|| "default".to_owned());
    let room_dir = state.output_dir.join(&room_id);
    tokio::fs::create_dir_all(&room_dir).await?;

    let local_path = room_dir.join(filename);
    let mut file = tokio::fs::File::create(&local_path).await?;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
    }
    file.flush().await?;

    info!("Room Agent: downloaded {} -> {}", filename, local_path.display());

    state
        .downloaded
        .lock()
        .unwrap()
        .insert(filename.to_owned(), "ok".to_owned());

    Ok(local_path)
}

/// Lista i file disponibili sul Local Agent per l'evento/sala specificati.
pub async fn list_remote_files(
    state: &RoomAgentState,
    event_id: &str,
) -> Result<Vec<RemoteFile>> {
    let agent_addr = state
        .agent_address
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| anyhow::anyhow!("No agent address configured"))?;

    let url = format!("http://{}/api/v1/files/{}", agent_addr, event_id);
    let client = Client::new();
    let files: Vec<RemoteFile> = client
        .get(&url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await?
        .json()
        .await?;

    Ok(files)
}
