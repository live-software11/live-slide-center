mod autostart;
mod discovery;
mod downloader;
pub mod license;
mod motw;
mod poller;
mod state;

pub use autostart::{disable_autostart, enable_autostart, set_network_private};
pub use discovery::{
    discover_local_agent, invalidate_cache as invalidate_discovery_cache, manual_agent,
    DiscoveredAgent, DiscoveryMethod, DiscoveryOutcome,
};
pub use downloader::download_file_from_agent;
pub use motw::strip_mark_of_the_web;
pub use poller::start_polling;
pub use state::{AgentStatus, DiscoveryInfo, RoomAgentState};
