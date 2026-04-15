use rusqlite::Connection;
use std::sync::{Arc, Mutex};

/// Stato condiviso tra HTTP handler e comandi Tauri
#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub cache_dir: Arc<std::path::PathBuf>,
    pub supabase_url: Arc<String>,
    pub supabase_key: Arc<String>,
    pub event_id: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new(
        db: Connection,
        cache_dir: std::path::PathBuf,
        supabase_url: String,
        supabase_key: String,
    ) -> Self {
        Self {
            db: Arc::new(Mutex::new(db)),
            cache_dir: Arc::new(cache_dir),
            supabase_url: Arc::new(supabase_url),
            supabase_key: Arc::new(supabase_key),
            event_id: Arc::new(Mutex::new(None)),
        }
    }
}
