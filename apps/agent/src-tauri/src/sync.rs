use anyhow::Result;
use futures_util::StreamExt;
use reqwest::Client;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use tracing::{info, warn};
use uuid::Uuid;

use crate::db::{upsert_cached_file, CachedFile};
use crate::state::AppState;

/// Scarica un file da Supabase Storage e lo salva localmente.
/// Restituisce il path locale del file.
pub async fn download_file(
    state: &AppState,
    event_id: &str,
    room_id: Option<&str>,
    version_id: &str,
    storage_key: &str,
    filename: &str,
) -> Result<String> {
    let signed_url = get_signed_url(state, storage_key).await?;

    let client = Client::new();
    let response = client.get(&signed_url).send().await?;
    if !response.status().is_success() {
        anyhow::bail!("HTTP {} fetching file {}", response.status(), storage_key);
    }

    let file_size = response.content_length().unwrap_or(0);
    let cache_dir = state.cache_dir.as_ref();
    let event_dir = cache_dir.join(event_id);
    tokio::fs::create_dir_all(&event_dir).await?;

    let local_path = event_dir.join(filename);
    let mut file = tokio::fs::File::create(&local_path).await?;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    drop(file);

    let sha256 = hex::encode(hasher.finalize());
    let local_path_str = local_path.to_string_lossy().into_owned();

    info!(
        "Downloaded {} ({} bytes, sha256={})",
        filename, file_size, &sha256[..8]
    );

    let cached = CachedFile {
        id: Uuid::new_v4().to_string(),
        event_id: event_id.to_owned(),
        room_id: room_id.map(str::to_owned),
        version_id: version_id.to_owned(),
        storage_key: storage_key.to_owned(),
        filename: filename.to_owned(),
        file_size_bytes: file_size as i64,
        sha256: Some(sha256),
        local_path: local_path_str.clone(),
        downloaded_at: chrono::Utc::now().to_rfc3339(),
    };

    {
        let db = state.db.lock().unwrap();
        upsert_cached_file(&db, &cached)?;
    }

    Ok(local_path_str)
}

/// Ottiene un signed URL di 5 minuti da Supabase Storage REST API.
async fn get_signed_url(state: &AppState, storage_key: &str) -> Result<String> {
    let url = format!(
        "{}/storage/v1/object/sign/presentations/{}",
        state.supabase_url, storage_key
    );
    let client = Client::new();
    let resp: serde_json::Value = client
        .post(&url)
        .header("apikey", state.supabase_key.as_str())
        .header("Authorization", format!("Bearer {}", state.supabase_key.as_str()))
        .json(&serde_json::json!({ "expiresIn": 300 }))
        .send()
        .await?
        .json()
        .await?;

    resp.get("signedURL")
        .and_then(|v| v.as_str())
        .map(|s| format!("{}{}", state.supabase_url, s))
        .ok_or_else(|| anyhow::anyhow!("No signedURL in response: {}", resp))
}

/// Sincronizza tutti i file ready per l'evento attivo da Supabase.
pub async fn sync_event(state: &AppState, event_id: &str) -> Result<()> {
    info!("Syncing event {}...", event_id);
    let client = Client::new();

    // Recupera le presentation_versions ready filtrate per evento specifico (via inner join)
    let url = format!(
        "{}/rest/v1/presentation_versions?status=eq.ready&select=id,storage_key,file_name,presentations!inner(session_id,sessions!inner(room_id,event_id))&presentations.sessions.event_id=eq.{}",
        state.supabase_url, event_id
    );

    let resp: serde_json::Value = client
        .get(&url)
        .header("apikey", state.supabase_key.as_str())
        .header("Authorization", format!("Bearer {}", state.supabase_key.as_str()))
        .send()
        .await?
        .json()
        .await?;

    let versions = resp.as_array().ok_or_else(|| anyhow::anyhow!("Expected array"))?;
    info!("Found {} versions to sync for event {}", versions.len(), event_id);

    for v in versions {
        let version_id = v.get("id").and_then(|x| x.as_str()).unwrap_or_default();
        let storage_key = v.get("storage_key").and_then(|x| x.as_str()).unwrap_or_default();
        let filename = v.get("file_name").and_then(|x| x.as_str()).unwrap_or("file.bin");

        // Controlla se già scaricato. Manteniamo il lock in uno scope esplicito
        // così che il MutexGuard (non-Send) venga droppato prima dell'.await
        // successivo: requisito per Tauri command async (Future Send).
        let already = {
            let db = state.db.lock().unwrap();
            crate::db::list_cached_files(&db, event_id)
                .unwrap_or_default()
                .into_iter()
                .any(|f| f.version_id == version_id)
        };

        if already {
            continue;
        }

        let pres = v.get("presentations").and_then(|p| p.as_object());
        let room_id = pres
            .and_then(|p| p.get("sessions"))
            .and_then(|s| s.as_object())
            .and_then(|s| s.get("room_id"))
            .and_then(|r| r.as_str());

        if let Err(e) = download_file(state, event_id, room_id, version_id, storage_key, filename).await {
            warn!("Failed to download {}: {}", filename, e);
        }
    }

    info!("Sync complete for event {}", event_id);
    Ok(())
}
