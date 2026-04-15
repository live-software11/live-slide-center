use std::net::SocketAddr;
use tracing::info;

use crate::routes::build_router;
use crate::state::AppState;

/// Avvia il server Axum in background (tokio::spawn).
/// Porta default: 8080, bind: 0.0.0.0 (tutte le interfacce LAN).
pub async fn start_lan_server(state: AppState, port: u16) {
    let app = build_router(state);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Local Agent HTTP server listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind LAN server port");

    axum::serve(listener, app)
        .await
        .expect("LAN server crashed");
}
