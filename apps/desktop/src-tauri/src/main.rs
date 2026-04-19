// Sprint J1 + Sprint K1 + Sprint L (GUIDA_OPERATIVA_v3 §4.B + §4.C K1 + §4.D L1-L5)
// — Bootstrap Tauri 2 di Live SLIDE CENTER Desktop.
//
// In modalita release nasconde la console DOS dietro la finestra (windows_subsystem).
// In debug build resta visibile per inspect dei log.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod license;
mod role;
mod server;
mod session_store;

use std::sync::OnceLock;

use tracing::{error, info};

use crate::role::NodeRole;

/// Stato globale del backend HTTP locale: porta, admin_token, root paths, ruolo
/// nodo, mdns handle. Inizializzato in `setup()` Tauri prima dell'apertura della finestra.
static BACKEND: OnceLock<server::BootedServer> = OnceLock::new();

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG")
                .unwrap_or_else(|_| "slide_center_desktop=info,warn".to_string()),
        )
        .init();

    info!(
        "Live SLIDE CENTER Desktop v{} — bootstrap (Sprint J + K + L)",
        env!("CARGO_PKG_VERSION")
    );

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init());

    // Sprint P3 + Sprint W E3 — updater plugin gated dietro feature `signed-updater`.
    // Tauri 2 panica al boot se `plugins.updater` esiste ma manca `pubkey`. Per
    // evitare di forzare la build firmata su ogni installazione (e per non far
    // crashare l'app unsigned), il plugin viene REGISTRATO solo quando la build
    // include la chiave pubblica via `--features signed-updater` + override
    // `tauri.signing.json`. Lato SPA, la chiamata `app.updater().check()`
    // ritorna semplicemente "updater non disponibile" se il plugin non e'
    // registrato. `process` resta sempre attivo per `app.restart()` post-install.
    #[cfg(feature = "signed-updater")]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder = builder
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Sprint L1: leggi il ruolo PRIMA di avviare il server. Default `admin`
            // se non scelto: la SPA mostrera' il selezionatore al primo render.
            // Il file vive in `~/SlideCenter/role.json` (stessa data_root del server).
            let data_root = resolve_data_root_for_setup();
            let role = role::read_role(&data_root).unwrap_or(NodeRole::Admin);
            info!(role = role.as_str(), "ruolo nodo risolto al boot");

            // Avvio del server Rust locale dentro il runtime tokio di Tauri.
            // Bloccare il setup fino al boot ci garantisce che `cmd_backend_info`
            // chiamato dalla SPA al primo render trovi gia' il backend pronto.
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                match server::boot(role.as_str()).await {
                    Ok(booted) => {
                        info!(
                            port = booted.port,
                            data_root = %booted.data_root.display(),
                            storage_root = %booted.storage_root.display(),
                            role = %booted.role,
                            mdns_active = booted.mdns.is_some(),
                            "server locale Rust pronto"
                        );
                        if BACKEND.set(booted).is_err() {
                            error!("BACKEND OnceLock gia' inizializzato (impossibile)");
                        }
                    }
                    Err(e) => {
                        error!(?e, "server locale fallito al boot — la SPA non potra' lavorare in modalita desktop");
                    }
                }
                // suppress unused warning su `handle` se in futuro non serve
                let _ = handle;
            });

            // Sprint D6 — heartbeat licenza desktop.
            // Spawn detached: 30s post-boot, poi 1 chiamata ogni 6h. Skip
            // automatico se la licenza non e' bound (no spam su PC mai
            // collegati al cloud). Errori loggati in warn ma NON bloccano
            // l'app: la grace_period locale (30g) tiene la licenza valida
            // anche con cloud irraggiungibile.
            license::heartbeat::spawn_background_loop();

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cmd_app_info,
            cmd_backend_info,
            cmd_get_role,
            cmd_set_role,
            cmd_discover_lan_pcs,
            cmd_get_persisted_device,
            cmd_clear_device_pairing,
            cmd_get_last_session,
            cmd_save_last_session,
            cmd_updater_status,
            cmd_check_for_update,
            cmd_install_update_and_restart,
            license::cmd_license_status,
            license::cmd_license_bind,
            license::cmd_license_verify_now,
            license::cmd_license_renew_now,
            license::cmd_license_reset,
        ]);

    builder
        .run(tauri::generate_context!())
        .expect("Error running Live SLIDE CENTER Desktop");
}

/// Replica della logica `server::resolve_data_root` per l'uso pre-boot:
/// va calcolata prima di avere il `BootedServer` (per leggere role.json).
fn resolve_data_root_for_setup() -> std::path::PathBuf {
    if let Ok(custom) = std::env::var("SLIDECENTER_DATA_ROOT") {
        return std::path::PathBuf::from(custom);
    }
    dirs::home_dir()
        .map(|h| h.join("SlideCenter"))
        .unwrap_or_else(|| std::path::PathBuf::from("./SlideCenter"))
}

/// Sprint J3 — comando minimale chiamabile dalla SPA per verificare che siamo dentro Tauri.
#[tauri::command]
fn cmd_app_info() -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "name": "Live SLIDE CENTER Desktop",
        "version": env!("CARGO_PKG_VERSION"),
        "sprint": "J1 bootstrap + K1 server locale + L1 mDNS LAN",
    })
}

/// Sprint K1 — la SPA chiama questo command per ricevere `base_url` + `admin_token`
/// del server locale (uniche credenziali necessarie per parlare col backend in
/// modalita desktop). Lato SPA il ritorno alimenta `localStorage` o un
/// `BackendModeContext` che tutti i client (rest/storage/functions) leggono.
///
/// Sprint L: aggiunto anche `role` (admin|sala), `mdns_active` e
/// `lan_addresses` (lista IPv4 LAN dell'admin: serve a costruire
/// `admin_server.base_url` per il pair-direct verso il PC sala —
/// `127.0.0.1` non sarebbe richiamabile dall'altro PC).
#[tauri::command]
fn cmd_backend_info() -> serde_json::Value {
    match BACKEND.get() {
        Some(b) => serde_json::json!({
            "ready": true,
            "base_url": format!("http://127.0.0.1:{}", b.port),
            "port": b.port,
            "admin_token": b.admin_token,
            "data_root": b.data_root.display().to_string(),
            "storage_root": b.storage_root.display().to_string(),
            "role": b.role,
            "mdns_active": b.mdns.is_some(),
            "lan_addresses": b.lan_addresses,
        }),
        None => serde_json::json!({ "ready": false }),
    }
}

/// Sprint L1 — ritorna il ruolo persistito (`admin` | `sala`). Se non c'e' file
/// ritorna `null`: la SPA mostrera' la schermata di scelta ruolo al primo avvio.
#[tauri::command]
fn cmd_get_role() -> serde_json::Value {
    let data_root = match BACKEND.get() {
        Some(b) => b.data_root.clone(),
        None => resolve_data_root_for_setup(),
    };
    match role::read_role(&data_root) {
        Some(r) => serde_json::json!({ "role": r.as_str() }),
        None => serde_json::json!({ "role": null }),
    }
}

/// Sprint L1 — persiste il ruolo scelto. Richiede restart del processo per
/// applicare (server + mDNS dipendono da questo valore al boot). La SPA dopo
/// la chiamata mostra "Riavvia l'app per completare la configurazione".
#[tauri::command]
fn cmd_set_role(role: String) -> Result<serde_json::Value, String> {
    let parsed = NodeRole::parse(&role).ok_or_else(|| "invalid_role".to_string())?;
    let data_root = match BACKEND.get() {
        Some(b) => b.data_root.clone(),
        None => resolve_data_root_for_setup(),
    };
    role::write_role(&data_root, parsed).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "ok": true,
        "role": parsed.as_str(),
        "requires_restart": true,
    }))
}

/// Sprint L3 — discovery one-shot dei nodi mDNS sulla LAN. Pensata per il
/// dialog "Aggiungi PC LAN" dell'admin: la SPA chiama questo command, riceve la
/// lista di PC sala visibili (filtrati per `role=sala`) e mostra l'elenco.
///
/// Argomenti opzionali:
///   - `role_filter`: `"sala"` o `"admin"` (default: tutti).
///   - `timeout_ms`: durata del browse mDNS (default 1500ms; sufficiente per LAN
///     veloci, alzare a 3000-5000 su LAN sature o con piu' di 20 nodi).
///   - `exclude_self`: se `true` esclude il nodo locale dai risultati (default true).
#[tauri::command]
fn cmd_discover_lan_pcs(
    role_filter: Option<String>,
    timeout_ms: Option<u64>,
    exclude_self: Option<bool>,
) -> serde_json::Value {
    let timeout = timeout_ms.unwrap_or(server::mdns::DISCOVERY_DEFAULT_TIMEOUT_MS);
    // exclude_self default = true. Per ora il fullname locale non e' esposto in
    // BootedServer (semplicita'): la SPA gia' filtra per `role` lato Rust e per
    // `event_id != self` lato JS prima di mostrarli all'admin. Se in Sprint Q
    // servira' un confronto piu' preciso, esporremo `mdns_fullname` in BootedServer.
    let _ = exclude_self;
    let nodes = server::mdns::discover(timeout, role_filter.as_deref(), None);
    serde_json::json!({
        "ok": true,
        "count": nodes.len(),
        "nodes": nodes,
    })
}

/// Sprint M2 — ritorna il payload di `~/SlideCenter/device.json` se presente.
///
/// Usato dalla SPA in modalita desktop role=sala per:
///   1. pre-popolare `localStorage.device_token` PRIMA di renderizzare PairView,
///      cosi' il PC sala fa subito auto-rejoin verso il proprio server locale
///      senza mostrare il keypad (regola sovrana 4: mai chiedere nuovo pairing
///      se gia' configurato);
///   2. costruire la schermata "STANDALONE LOCAL" quando il bootstrap fallisce
///      (admin server irraggiungibile durante l'evento) — l'utente vede il nome
///      della sala assegnata, l'evento, il device_name e i file gia' scaricati
///      senza tornare alla scelta del codice 6 cifre.
///
/// Ritorna `{ ok: true, device: { ... } }` o `{ ok: true, device: null }` se
/// device.json non esiste / e' corrotto.
#[tauri::command]
fn cmd_get_persisted_device() -> serde_json::Value {
    let data_root = match BACKEND.get() {
        Some(b) => b.data_root.clone(),
        None => resolve_data_root_for_setup(),
    };
    match server::device_persist::read(&data_root) {
        Some(d) => serde_json::json!({
            "ok": true,
            "device": {
                "device_id": d.device_id,
                "device_token": d.device_token,
                "device_name": d.device_name,
                "event_id": d.event_id,
                "room_id": d.room_id,
                "admin_server": d.admin_server,
                "paired_at": d.paired_at,
                "app_version": d.app_version,
            }
        }),
        None => serde_json::json!({ "ok": true, "device": null }),
    }
}

/// Sprint M3 — il PC sala "esce dall'evento" dal menu locale.
///
/// Effetto:
///   • cancella `~/SlideCenter/device.json`,
///   • cancella la riga `paired_devices` dal DB SQLite locale (cosi' il
///     successivo `room-player-bootstrap` chiamato dalla SPA fallisce con
///     `device_not_found` e l'UI mostra il keypad come per un PC nuovo),
///   • reset TXT mDNS `event_id` a `null` (il sala torna disponibile per il
///     pair-direct di altri admin).
///
/// **Idempotente**: se device.json non esiste / paired_devices vuoto → no-op.
/// La SPA dopo questa chiamata pulisce `localStorage` e naviga a `/pair`.
#[tauri::command]
fn cmd_clear_device_pairing() -> Result<serde_json::Value, String> {
    let backend = BACKEND.get();
    let data_root = match backend {
        Some(b) => b.data_root.clone(),
        None => resolve_data_root_for_setup(),
    };

    // 1. Leggi device.json per ricavare device_token (per cancellare paired_devices).
    let persisted = server::device_persist::read(&data_root);

    // 2. Cancella device.json (idempotente).
    if let Err(e) = server::device_persist::clear(&data_root) {
        return Err(format!("clear_device_json_failed: {e}"));
    }

    // 3. Cancella paired_devices (best-effort: se il backend non e' ancora pronto
    //    o il DB e' lock, log warn e continua — l'utente si aspetta che il
    //    pulsante "Esci dall'evento" funzioni anche se qualcosa va storto sotto).
    if let Some(d) = persisted.as_ref() {
        let token_hash = server::auth::sha256_hex(&d.device_token);
        if let Err(e) = clear_paired_device_row(&data_root, &token_hash) {
            tracing::warn!(error = %e, "clear paired_devices fallito (non bloccante)");
        }
    }

    // 4. Reset TXT mDNS event_id (ritorna disponibile per nuovi pair-direct).
    if let Some(b) = backend {
        if let Some(handle) = &b.mdns {
            handle.update_event_id(None);
        }
    }

    // 5. Sprint Z (post-field-test) Gap C — pulizia last-session.json: senza
    //    questo, dopo "Esci dall'evento" il prossimo boot rifarebbe il
    //    restore alla session vecchia mentre il device.json non c'e' piu'
    //    (loop infinito risolto da fallback ma sporco UX).
    if let Err(e) = session_store::clear(&data_root) {
        tracing::warn!(error = %e, "clear last-session.json fallito (non bloccante)");
    }

    Ok(serde_json::json!({
        "ok": true,
        "had_device_json": persisted.is_some(),
    }))
}

// ─── Sprint Z (post-field-test) Gap C — Tauri commands last session ──────
//
// La SPA in modalita desktop (Tauri) chiama questi due comandi per leggere /
// salvare lo stato "ultimo evento + sala + presentation + slide" del PC sala.
// In modalita cloud (browser) il bridge JS torna `null` e questi comandi
// non vengono mai invocati (vedi `desktop-bridge.ts`).
//
// Strategia di restore (lato React, hook `useLastSession`):
//   1. boot Tauri → SPA chiama `getLastSession()`
//   2. se ritorna non-null E `device.json` esiste con lo stesso device_token,
//      naviga direttamente a `/sala/<token>` con stato pre-caricato
//   3. altrimenti fallback al flow normale (PairView o waiting room)

#[tauri::command]
fn cmd_get_last_session() -> serde_json::Value {
    let data_root = match BACKEND.get() {
        Some(b) => b.data_root.clone(),
        None => resolve_data_root_for_setup(),
    };
    match session_store::read(&data_root) {
        Some(s) => serde_json::json!({ "ok": true, "session": s }),
        None => serde_json::json!({ "ok": true, "session": null }),
    }
}

#[tauri::command]
fn cmd_save_last_session(payload: session_store::LastSession) -> Result<serde_json::Value, String> {
    let data_root = match BACKEND.get() {
        Some(b) => b.data_root.clone(),
        None => resolve_data_root_for_setup(),
    };
    session_store::write(&data_root, &payload).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "ok": true }))
}

/// Helper: cancella la riga paired_devices col dato `pair_token_hash` aprendo
/// una connection diretta (NON usa il pool del server perche' siamo in un
/// Tauri command sync e non vogliamo bloccare i workers axum). WAL mode
/// rende sicuro avere una connection extra in scrittura.
fn clear_paired_device_row(data_root: &std::path::Path, token_hash: &str) -> Result<(), String> {
    let db_path = data_root.join("db.sqlite");
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    conn.execute("PRAGMA foreign_keys = ON", []).ok();
    conn.execute(
        "DELETE FROM paired_devices WHERE pair_token_hash = ?1",
        rusqlite::params![token_hash],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Sprint P3 (GUIDA_OPERATIVA_v3 §4.H) — Tauri commands updater ──────────
//
// Tre comandi pensati per la SPA (`apps/web/src/lib/desktop-bridge.ts`):
//
//   1. `cmd_updater_status` → ritorna `{ configured: bool, current_version }`.
//      Usato dal banner update per decidere se nascondere completamente il
//      controllo (config incompleta = nessuna pubkey = check graceful skip).
//
//   2. `cmd_check_for_update` → check remoto contro l'endpoint configurato in
//      `tauri.conf.json -> plugins.updater.endpoints`. Ritorna `{ available,
//      version?, notes?, date? }` o `{ available: false, error?: "..." }` su
//      qualsiasi fallimento (rete, JSON malformato, pubkey mismatch).
//
//   3. `cmd_install_update_and_restart` → scarica + installa + restart. Su
//      Windows il downloader Tauri chiama l'NSIS installer in `installMode:
//      "passive"` (window con progress, no input utente). Dopo il restart la
//      SPA riparte: il backend HTTP viene re-bootato dal `setup()` in cima a
//      questo file.
//
// Tutti i comandi usano `app: tauri::AppHandle` come argomento, iniettato
// automaticamente da Tauri (vedi `invoke_handler![...]`). Sono resilienti:
// MAI panicano, sempre `Result<Value, String>` con errore tradotto in stringa
// per essere mostrato in UI.

/// Errore stringificato per la SPA. Codici noti:
///   • `updater_not_configured` — manca `pubkey` o `endpoints` nel config.
///   • `network_error` — endpoint irraggiungibile.
///   • `signature_invalid` — il `.sig` scaricato non valida col pubkey locale.
///   • `install_failed` — l'NSIS installer ha fallito (vedi log Tauri).
fn updater_err(code: &str, source: impl std::fmt::Display) -> String {
    format!("{code}: {source}")
}

#[tauri::command]
fn cmd_updater_status() -> serde_json::Value {
    // Sappiamo se l'updater e' configurato leggendo `tauri.conf.json` al
    // build-time tramite `tauri::generate_context!()`. Pero' una via piu'
    // semplice (e check-able a runtime in caso di config patch via
    // `tauri-plugin-config` future) e' provare a costruire il builder e
    // catturare il fail. Per Sprint P3 facciamo un check euristico: se non
    // abbiamo `pubkey` settata in env-var TAURI_SIGNING_PUBLIC_KEY o nel
    // bundle, ritorniamo `configured: false`.
    //
    // Tauri 2 NON espone un getter pubblico per la pubkey corrente del
    // plugin. Lo vediamo SOLO al primo `check()`. Quindi qui ritorniamo
    // sempre `configured: true` (tentativo) e lasciamo che `check()` decida.
    serde_json::json!({
        "configured": true,
        "current_version": env!("CARGO_PKG_VERSION"),
        "endpoint_hint": "https://github.com/live-software11/live-slide-center/releases/latest/download/latest.json",
    })
}

#[tauri::command]
async fn cmd_check_for_update(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| updater_err("updater_not_configured", e))?;
    match updater.check().await {
        Ok(Some(update)) => Ok(serde_json::json!({
            "available": true,
            "version": update.version,
            "current_version": update.current_version,
            "date": update.date.map(|d| d.to_string()),
            "body": update.body,
        })),
        Ok(None) => Ok(serde_json::json!({
            "available": false,
            "current_version": env!("CARGO_PKG_VERSION"),
        })),
        Err(e) => {
            // Errore tipico: rete, endpoint 404 (no release pubblicata), pubkey
            // mismatch. NON facciamo crashare la SPA: ritorniamo errore strutturato.
            tracing::warn!(?e, "check_for_update fallito");
            Ok(serde_json::json!({
                "available": false,
                "error": format!("check_failed: {e}"),
            }))
        }
    }
}

#[tauri::command]
async fn cmd_install_update_and_restart(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| updater_err("updater_not_configured", e))?;
    let update = updater
        .check()
        .await
        .map_err(|e| updater_err("check_failed", e))?
        .ok_or_else(|| "no_update_available".to_string())?;

    // download_and_install fa progress callback (per ora ignoriamo: la SPA
    // mostra spinner indeterminato; in Sprint Q possiamo emettere eventi
    // tramite app.emit() per progress real-time).
    update
        .download_and_install(
            |_chunk, _total| { /* silent: SPA mostra spinner */ },
            || { /* finished */ },
        )
        .await
        .map_err(|e| updater_err("install_failed", e))?;

    // Restart immediato. Su Windows tauri-plugin-updater chiude gia' la app
    // prima dell'install, quindi `restart()` qui parte solo se l'install ha
    // mantenuto il processo vivo (Mac/Linux). Su Win e' no-op.
    app.restart();
}
