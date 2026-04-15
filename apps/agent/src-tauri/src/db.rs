use anyhow::Result;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

/// Struttura che rappresenta un file in cache locale
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedFile {
    pub id: String,
    pub event_id: String,
    pub room_id: Option<String>,
    pub version_id: String,
    pub storage_key: String,
    pub filename: String,
    pub file_size_bytes: i64,
    pub sha256: Option<String>,
    pub local_path: String,
    pub downloaded_at: String,
}

/// Struttura che rappresenta un Room Agent registrato
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisteredRoomAgent {
    pub id: String,
    pub room_id: Option<String>,
    pub ip: String,
    pub port: u16,
    pub device_name: String,
    pub last_seen: String,
}

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;

         CREATE TABLE IF NOT EXISTS cached_files (
           id            TEXT PRIMARY KEY,
           event_id      TEXT NOT NULL,
           room_id       TEXT,
           version_id    TEXT NOT NULL UNIQUE,
           storage_key   TEXT NOT NULL,
           filename      TEXT NOT NULL,
           file_size_bytes INTEGER NOT NULL DEFAULT 0,
           sha256        TEXT,
           local_path    TEXT NOT NULL,
           downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE INDEX IF NOT EXISTS idx_cf_event ON cached_files(event_id);
         CREATE INDEX IF NOT EXISTS idx_cf_version ON cached_files(version_id);

         CREATE TABLE IF NOT EXISTS room_agents (
           id          TEXT PRIMARY KEY,
           room_id     TEXT,
           ip          TEXT NOT NULL,
           port        INTEGER NOT NULL DEFAULT 9090,
           device_name TEXT NOT NULL,
           last_seen   TEXT NOT NULL DEFAULT (datetime('now'))
         );

         CREATE TABLE IF NOT EXISTS agent_config (
           key   TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );",
    )?;
    Ok(())
}

pub fn upsert_cached_file(conn: &Connection, f: &CachedFile) -> Result<()> {
    conn.execute(
        "INSERT INTO cached_files
           (id, event_id, room_id, version_id, storage_key, filename, file_size_bytes, sha256, local_path, downloaded_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(version_id) DO UPDATE SET
           local_path=excluded.local_path,
           sha256=excluded.sha256,
           downloaded_at=excluded.downloaded_at",
        params![
            f.id, f.event_id, f.room_id, f.version_id,
            f.storage_key, f.filename, f.file_size_bytes, f.sha256, f.local_path, f.downloaded_at
        ],
    )?;
    Ok(())
}

pub fn list_cached_files(conn: &Connection, event_id: &str) -> Result<Vec<CachedFile>> {
    let mut stmt = conn.prepare(
        "SELECT id,event_id,room_id,version_id,storage_key,filename,file_size_bytes,sha256,local_path,downloaded_at
         FROM cached_files WHERE event_id=?1",
    )?;
    let rows = stmt.query_map(params![event_id], |row| {
        Ok(CachedFile {
            id: row.get(0)?,
            event_id: row.get(1)?,
            room_id: row.get(2)?,
            version_id: row.get(3)?,
            storage_key: row.get(4)?,
            filename: row.get(5)?,
            file_size_bytes: row.get(6)?,
            sha256: row.get(7)?,
            local_path: row.get(8)?,
            downloaded_at: row.get(9)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn upsert_room_agent(conn: &Connection, agent: &RegisteredRoomAgent) -> Result<()> {
    conn.execute(
        "INSERT INTO room_agents (id, room_id, ip, port, device_name, last_seen)
         VALUES (?1,?2,?3,?4,?5,?6)
         ON CONFLICT(id) DO UPDATE SET
           room_id=excluded.room_id,
           ip=excluded.ip,
           port=excluded.port,
           device_name=excluded.device_name,
           last_seen=excluded.last_seen",
        params![
            agent.id,
            agent.room_id,
            agent.ip,
            agent.port,
            agent.device_name,
            agent.last_seen
        ],
    )?;
    Ok(())
}

pub fn list_room_agents(conn: &Connection) -> Result<Vec<RegisteredRoomAgent>> {
    let mut stmt =
        conn.prepare("SELECT id,room_id,ip,port,device_name,last_seen FROM room_agents")?;
    let rows = stmt.query_map([], |row| {
        Ok(RegisteredRoomAgent {
            id: row.get(0)?,
            room_id: row.get(1)?,
            ip: row.get(2)?,
            port: row.get::<_, i64>(3)? as u16,
            device_name: row.get(4)?,
            last_seen: row.get(5)?,
        })
    })?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn get_config(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM agent_config WHERE key=?1")?;
    let mut rows = stmt.query(params![key])?;
    Ok(rows.next()?.map(|r| r.get(0).unwrap_or_default()))
}

pub fn set_config(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO agent_config(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )?;
    Ok(())
}
