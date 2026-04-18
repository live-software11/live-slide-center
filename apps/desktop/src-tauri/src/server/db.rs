// Sprint K2 (GUIDA_OPERATIVA_v3 §4.C K2) — pool SQLite WAL + migrazioni embeddate.
//
// Decisioni architetturali:
//   • rusqlite + r2d2 pool (size 4): semplice, single-binary, niente runtime SQL service.
//   • WAL mode: writers non bloccano readers → fondamentale quando il PC sala fa
//     polling continuo e l'admin scrive aggiornamenti in parallelo.
//   • busy_timeout 5s: eventi rari di lock pendente (es. checkpoint WAL) ritentano
//     in trasparenza invece di propagare `SQLITE_BUSY` al client HTTP.
//   • foreign_keys=ON: per non rompere il modello a cascata (rooms→sessions→...).
//   • Migration semplice: include_str! del file `migrations/0001_init.sql` eseguito
//     sempre (idempotente perche' usa `CREATE ... IF NOT EXISTS` + `INSERT ON CONFLICT`).
//     Migration successive (Sprint M+) gireranno una `migrations` table piu' strutturata.

use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use tracing::{info, warn};

pub type DbPool = Pool<SqliteConnectionManager>;
#[allow(dead_code)] // Sprint K: alias usato dai test integration in Sprint Q.
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// Migrazione iniziale embedded nel binario, cosi' il PC sala / admin desktop
/// non deve avere file SQL accanto all'eseguibile.
const MIGRATION_0001: &str = include_str!("../../migrations/0001_init.sql");

/// Sprint M3 — `paired_devices.lan_base_url` per il pair-revoke via LAN.
const MIGRATION_0002: &str = include_str!("../../migrations/0002_paired_devices_lan_url.sql");

/// Sprint D4 (port S-4 cloud) — `paired_devices.role` per Centro Slide multi-room.
const MIGRATION_0003: &str = include_str!("../../migrations/0003_paired_devices_role.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("pool: {0}")]
    Pool(#[from] r2d2::Error),
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// Inizializza il database SQLite a `db_path`:
///  1. crea la cartella parent se manca,
///  2. apre il pool r2d2 con `SqliteConnectionManager::file`,
///  3. abilita WAL + foreign_keys + busy_timeout via init hook (eseguito su ogni
///     connection presa dal pool, perche' i pragma sono *per-connection*, non globali),
///  4. esegue le migration embeddate.
pub fn init_pool(db_path: &Path) -> Result<DbPool, DbError> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let manager = SqliteConnectionManager::file(db_path).with_init(|conn: &mut Connection| {
        // I PRAGMA in SQLite sono per-connection; settarli nell'init hook del pool
        // garantisce che ogni connection riusata abbia gli stessi setting.
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA busy_timeout = 5000;
            PRAGMA temp_store = MEMORY;
            ",
        )?;
        Ok(())
    });

    let pool = Pool::builder()
        .max_size(4)
        .connection_timeout(std::time::Duration::from_secs(5))
        .build(manager)?;

    // Migration applicata fuori dal `with_init` perche' deve girare una volta
    // sola al boot, non ad ogni check-out di connection.
    {
        let conn = pool.get()?;
        run_migrations(&conn)?;
    }

    info!(?db_path, "Database SQLite inizializzato (WAL, FK, migrations applicate)");
    Ok(pool)
}

fn run_migrations(conn: &Connection) -> Result<(), DbError> {
    // Idempotente: tutte le DDL della migration usano IF NOT EXISTS.
    if let Err(err) = conn.execute_batch(MIGRATION_0001) {
        warn!(?err, "errore esecuzione migrazione 0001 (potrebbe essere gia' applicata)");
        return Err(DbError::Sqlite(err));
    }
    // Sprint M3: `ALTER TABLE ADD COLUMN` non supporta `IF NOT EXISTS` su SQLite.
    // Tolleriamo l'errore "duplicate column name: lan_base_url" cosi' la migration
    // resta idempotente: utile sia su DB nuovi che su DB gia' migrati.
    if let Err(err) = conn.execute_batch(MIGRATION_0002) {
        let msg = err.to_string();
        if msg.contains("duplicate column name") {
            info!("migrazione 0002 gia' applicata (lan_base_url presente), skip");
        } else {
            warn!(?err, "errore esecuzione migrazione 0002");
            return Err(DbError::Sqlite(err));
        }
    }
    // Sprint D4: idem 0002. Tolleriamo "duplicate column name: role" per
    // idempotenza. L'indice parziale e' protetto da IF NOT EXISTS.
    if let Err(err) = conn.execute_batch(MIGRATION_0003) {
        let msg = err.to_string();
        if msg.contains("duplicate column name") {
            info!("migrazione 0003 gia' applicata (role presente), skip");
        } else {
            warn!(?err, "errore esecuzione migrazione 0003");
            return Err(DbError::Sqlite(err));
        }
    }
    Ok(())
}

/// Tenant fittizio per la modalita desktop (1 sola org locale).
/// Mantiene la colonna `tenant_id` su tutte le tabelle senza rompere lo schema cloud.
pub const LOCAL_TENANT_ID: &str = "00000000-0000-0000-0000-000000000001";
/// Utente admin fittizio (creato al seed).
pub const LOCAL_ADMIN_USER_ID: &str = "00000000-0000-0000-0000-000000000002";
