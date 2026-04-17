// Previene il warning "not dead code" per il binary entry-point
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use local_agent_lib::{spawn_mdns_advertiser, spawn_udp_responder, start_lan_server, AppState};
use rusqlite::Connection;
use tracing::info;

fn main() {
    // Sprint 4 — supporto NSIS pre-uninstall: `local-agent.exe --deactivate`
    // libera lo slot hardware su Live WORKS APP prima di rimuovere i file.
    if std::env::args().any(|a| a == "--deactivate") {
        local_agent_lib::license::run_deactivate_uninstall();
        return;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "local_agent=info,warn".to_string()),
        )
        .init();

    let cache_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("LiveSLIDECENTER")
        .join("agent-cache");
    std::fs::create_dir_all(&cache_dir).expect("Cannot create cache dir");

    let db_path = cache_dir.join("agent.db");
    let conn = Connection::open(&db_path).expect("Cannot open SQLite database");
    local_agent_lib::db::init_db(&conn).expect("DB init failed");

    // Legge le credenziali da variabili d'ambiente o dal db (prime credenziali configurate dall'utente)
    let supabase_url = std::env::var("SUPABASE_URL").unwrap_or_default();
    let supabase_key = std::env::var("SUPABASE_ANON_KEY").unwrap_or_default();

    let state = AppState::new(conn, cache_dir, supabase_url, supabase_key);
    let state_for_http = state.clone();
    let state_for_discovery = state.clone();

    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.spawn(async move {
        start_lan_server(state_for_http, 8080).await;
    });

    rt.spawn(async move {
        spawn_udp_responder(state_for_discovery).await;
    });

    spawn_mdns_advertiser(env!("CARGO_PKG_VERSION").to_owned());

    info!("Starting Tauri UI...");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state);

    #[cfg(feature = "license")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        cmd_get_status,
        cmd_set_event,
        cmd_sync_event,
        cmd_list_files,
        cmd_list_room_agents,
        local_agent_lib::license::license_activate,
        local_agent_lib::license::license_verify,
        local_agent_lib::license::license_deactivate,
        local_agent_lib::license::license_status,
        local_agent_lib::license::license_fingerprint,
    ]);

    #[cfg(not(feature = "license"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        cmd_get_status,
        cmd_set_event,
        cmd_sync_event,
        cmd_list_files,
        cmd_list_room_agents,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("Error running Tauri application");
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn cmd_get_status(state: tauri::State<AppState>) -> serde_json::Value {
    use local_agent_lib::db::{list_cached_files, list_room_agents};
    let event_id = state.event_id.lock().unwrap().clone();
    let db = state.db.lock().unwrap();
    let files = event_id
        .as_deref()
        .and_then(|e| list_cached_files(&db, e).ok())
        .map(|f| f.len())
        .unwrap_or(0);
    let agents = list_room_agents(&db).map(|a| a.len()).unwrap_or(0);
    serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
        "event_id": event_id,
        "cached_files": files,
        "room_agents": agents,
    })
}

#[tauri::command]
async fn cmd_set_event(event_id: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    *state.event_id.lock().unwrap() = Some(event_id);
    Ok(())
}

#[tauri::command]
async fn cmd_sync_event(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let event_id = state
        .event_id
        .lock()
        .unwrap()
        .clone()
        .ok_or("No event set")?;
    local_agent_lib::sync::sync_event(&state, &event_id)
        .await
        .map(|_| "sync_complete".to_owned())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_list_files(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    use local_agent_lib::db::list_cached_files;
    let event_id = state.event_id.lock().unwrap().clone().unwrap_or_default();
    let db = state.db.lock().unwrap();
    let files = list_cached_files(&db, &event_id).map_err(|e| e.to_string())?;
    Ok(serde_json::json!(files))
}

#[tauri::command]
fn cmd_list_room_agents(state: tauri::State<AppState>) -> Result<serde_json::Value, String> {
    use local_agent_lib::db::list_room_agents;
    let db = state.db.lock().unwrap();
    let agents = list_room_agents(&db).map_err(|e| e.to_string())?;
    Ok(serde_json::json!(agents))
}
