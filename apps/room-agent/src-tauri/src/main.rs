// Previene finestra console su Windows release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use room_agent_lib::{
    disable_autostart, discover_local_agent, enable_autostart, invalidate_discovery_cache,
    manual_agent, set_network_private, start_polling, DiscoveryOutcome, RoomAgentState,
};
use room_agent_lib::DiscoveryMethod;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tracing::info;

fn main() {
    // Sprint 4 — supporto NSIS pre-uninstall: `room-agent.exe --deactivate`
    // libera lo slot hardware su Live WORKS APP prima di rimuovere i file.
    if std::env::args().any(|a| a == "--deactivate") {
        room_agent_lib::license::run_deactivate_uninstall();
        return;
    }

    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "room_agent=info,warn".to_string()),
        )
        .init();

    let hostname = gethostname::gethostname()
        .into_string()
        .unwrap_or_else(|_| "PC-Sala".to_owned());

    let state = RoomAgentState::new(hostname.clone());

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(state)
        .setup(|app| {
            let state: tauri::State<RoomAgentState> = app.state();
            let st = (*state).clone();

            // Tray icon
            let quit_item = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
            let show_item = MenuItem::with_id(app, "show", "Apri pannello", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        info!("Room Agent: quit requested");
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|_tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        // doppio click aprirà la finestra (gestito sopra tramite menu)
                    }
                })
                .build(app)?;

            // Avvia polling in background se agent_address è configurato
            let event_id = std::env::var("SLIDE_EVENT_ID").unwrap_or_default();
            if !event_id.is_empty() {
                let st2 = st.clone();
                tauri::async_runtime::spawn(async move {
                    start_polling(st2, event_id).await;
                });
            }

            Ok(())
        });

    #[cfg(feature = "license")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        cmd_get_status,
        cmd_set_agent,
        cmd_set_room,
        cmd_set_event_and_start,
        cmd_enable_autostart,
        cmd_disable_autostart,
        cmd_open_folder,
        cmd_discover_agent,
        cmd_set_manual_agent,
        cmd_set_network_private,
        room_agent_lib::license::license_activate,
        room_agent_lib::license::license_verify,
        room_agent_lib::license::license_deactivate,
        room_agent_lib::license::license_status,
        room_agent_lib::license::license_fingerprint,
    ]);

    #[cfg(not(feature = "license"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        cmd_get_status,
        cmd_set_agent,
        cmd_set_room,
        cmd_set_event_and_start,
        cmd_enable_autostart,
        cmd_disable_autostart,
        cmd_open_folder,
        cmd_discover_agent,
        cmd_set_manual_agent,
        cmd_set_network_private,
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("Error running Room Agent");
}

// ─── Tauri Commands ───────────────────────────────────────────────────────────

#[tauri::command]
fn cmd_get_status(state: tauri::State<RoomAgentState>) -> serde_json::Value {
    let status = format!("{:?}", *state.status.lock().unwrap()).to_lowercase();
    let downloaded = state.downloaded.lock().unwrap().len();
    let room_id = state.room_id.lock().unwrap().clone();
    let agent_addr = state.agent_address.lock().unwrap().clone();
    let discovery = state.last_discovery.lock().unwrap().clone();
    serde_json::json!({
        "status": status,
        "device_name": *state.device_name,
        "room_id": room_id,
        "agent_address": agent_addr,
        "downloaded_files": downloaded,
        "output_dir": state.output_dir.to_string_lossy(),
        "discovery": discovery,
    })
}

#[tauri::command]
fn cmd_set_agent(address: String, state: tauri::State<RoomAgentState>) {
    *state.agent_address.lock().unwrap() = if address.is_empty() { None } else { Some(address) };
}

#[tauri::command]
fn cmd_set_room(room_id: String, state: tauri::State<RoomAgentState>) {
    *state.room_id.lock().unwrap() = if room_id.is_empty() { None } else { Some(room_id) };
}

#[tauri::command]
async fn cmd_set_event_and_start(
    event_id: String,
    state: tauri::State<'_, RoomAgentState>,
) -> Result<(), String> {
    if event_id.is_empty() {
        return Err("event_id cannot be empty".to_owned());
    }
    state.cancel_token.cancel();
    let mut new_state = (*state).clone();
    new_state.cancel_token = tokio_util::sync::CancellationToken::new();
    let st = new_state;
    tauri::async_runtime::spawn(async move {
        start_polling(st, event_id).await;
    });
    Ok(())
}

#[tauri::command]
fn cmd_enable_autostart() -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    enable_autostart(&exe, "LiveSlideCenterRoomAgent").map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_disable_autostart() -> Result<(), String> {
    disable_autostart("LiveSlideCenterRoomAgent").map_err(|e| e.to_string())
}

#[tauri::command]
fn cmd_open_folder(state: tauri::State<RoomAgentState>) -> Result<(), String> {
    let room_id = state.room_id.lock().unwrap().clone().unwrap_or_else(|| "default".to_owned());
    let path = state.output_dir.join(&room_id);
    std::fs::create_dir_all(&path).ok();

    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer")
        .arg(path.to_string_lossy().as_ref())
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Sprint 2 — Discovery automatica del Local Agent.
/// Esegue UNC → UDP → mDNS in cascata. Se trova un agent valido, lo registra
/// come `agent_address` e salva i dettagli in `last_discovery` per la UI.
/// Se non trova nulla, ritorna outcome `not_found` con i metodi tentati: la UI
/// guidera' l'utente verso input manuale.
#[tauri::command]
async fn cmd_discover_agent(
    force: Option<bool>,
    state: tauri::State<'_, RoomAgentState>,
) -> Result<serde_json::Value, String> {
    if force.unwrap_or(false) {
        invalidate_discovery_cache();
    }
    let outcome = discover_local_agent().await;
    match &outcome {
        DiscoveryOutcome::Found { agent } => {
            *state.agent_address.lock().unwrap() = Some(agent.address.clone());
            *state.last_discovery.lock().unwrap() = Some(room_agent_lib::DiscoveryInfo {
                method: agent.method.clone(),
                address: agent.address.clone(),
                hostname: agent.hostname.clone(),
                version: agent.version.clone(),
                discovered_at: chrono::Utc::now().to_rfc3339(),
            });
            info!(method = ?agent.method, address = %agent.address, "Room Agent: discovery riuscita");
        }
        DiscoveryOutcome::NotFound { tried } => {
            info!(tried = ?tried, "Room Agent: discovery automatica non riuscita");
        }
    }
    serde_json::to_value(outcome).map_err(|e| e.to_string())
}

/// Imposta manualmente l'indirizzo del Local Agent (ultimo fallback Sprint 2).
#[tauri::command]
fn cmd_set_manual_agent(
    address: String,
    state: tauri::State<RoomAgentState>,
) -> Result<serde_json::Value, String> {
    let trimmed = address.trim();
    if trimmed.is_empty() {
        return Err("address_empty".to_owned());
    }
    if !trimmed.contains(':') {
        return Err("address_missing_port".to_owned());
    }
    let agent = manual_agent(trimmed.to_owned());
    *state.agent_address.lock().unwrap() = Some(agent.address.clone());
    *state.last_discovery.lock().unwrap() = Some(room_agent_lib::DiscoveryInfo {
        method: DiscoveryMethod::Manual,
        address: agent.address.clone(),
        hostname: None,
        version: None,
        discovered_at: chrono::Utc::now().to_rfc3339(),
    });
    serde_json::to_value(agent).map_err(|e| e.to_string())
}

/// Sprint 2 — Imposta il profilo di rete dell'interfaccia attiva su Private,
/// permettendo broadcast UDP/mDNS/SMB sulla LAN. Richiede PowerShell.
#[tauri::command]
fn cmd_set_network_private(interface: String) -> Result<(), String> {
    set_network_private(&interface).map_err(|e| e.to_string())
}
