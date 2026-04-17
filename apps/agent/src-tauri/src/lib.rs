pub mod db;
pub mod discovery;
pub mod license;
mod routes;
mod server;
pub mod state;
pub mod sync;

pub use discovery::{spawn_mdns_advertiser, spawn_udp_responder};
pub use server::start_lan_server;
pub use state::AppState;
