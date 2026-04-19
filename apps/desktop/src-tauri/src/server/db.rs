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

// Sprint W C4 — visibilita' `pub(crate)` cosi' i test integration in
// altri moduli (es. `folder_routes::tests`) possono inizializzare un
// Connection in-memory con le stesse migration applicate.

/// Migrazione iniziale embedded nel binario, cosi' il PC sala / admin desktop
/// non deve avere file SQL accanto all'eseguibile.
pub(crate) const MIGRATION_0001: &str = include_str!("../../migrations/0001_init.sql");

/// Sprint M3 — `paired_devices.lan_base_url` per il pair-revoke via LAN.
#[allow(dead_code)]
pub(crate) const MIGRATION_0002: &str = include_str!("../../migrations/0002_paired_devices_lan_url.sql");

/// Sprint D4 (port S-4 cloud) — `paired_devices.role` per Centro Slide multi-room.
#[allow(dead_code)]
pub(crate) const MIGRATION_0003: &str = include_str!("../../migrations/0003_paired_devices_role.sql");

/// Sprint W B1 — `event_folders` + `presentations.folder_id` (File Explorer V2).
pub(crate) const MIGRATION_0004: &str = include_str!("../../migrations/0004_event_folders.sql");

/// Sprint W B1 — `presentation_versions.validation_warnings/validated_at`.
pub(crate) const MIGRATION_0005: &str = include_str!("../../migrations/0005_validation_warnings.sql");

/// Sprint W B1 — `remote_control_pairings` + rate events (telecomando tablet).
#[allow(dead_code)]
pub(crate) const MIGRATION_0006: &str = include_str!("../../migrations/0006_remote_control_pairings.sql");

/// Sprint W B1 — `room_provision_tokens` (zero-friction room PCs magic-link).
#[allow(dead_code)]
pub(crate) const MIGRATION_0007: &str = include_str!("../../migrations/0007_room_provision_tokens.sql");

/// Sprint W B1 — `room_state.current_slide_index/current_slide_total`.
#[allow(dead_code)]
pub(crate) const MIGRATION_0008: &str = include_str!("../../migrations/0008_room_state_slide_index.sql");

/// Sprint W B1 — Estensione enum CHECK su `presentation_versions.upload_source`
/// + `activity_log.actor` (port di cloud R-3 G3 + T-3-G).
#[allow(dead_code)]
pub(crate) const MIGRATION_0009: &str = include_str!("../../migrations/0009_extended_enums.sql");

/// Sprint W B1 — `device_metric_pings` (telemetria PC sala, retention 24h).
#[allow(dead_code)]
pub(crate) const MIGRATION_0010: &str = include_str!("../../migrations/0010_device_metric_pings.sql");

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

    // Sprint W B1 — 0004: event_folders + presentations.folder_id.
    // `CREATE TABLE IF NOT EXISTS` e indici sono idempotenti; l'`ALTER TABLE
    // ADD COLUMN folder_id` non lo e' → tolleranza "duplicate column name".
    if let Err(err) = conn.execute_batch(MIGRATION_0004) {
        let msg = err.to_string();
        if msg.contains("duplicate column name") {
            info!("migrazione 0004 gia' applicata (folder_id presente), skip");
        } else {
            warn!(?err, "errore esecuzione migrazione 0004");
            return Err(DbError::Sqlite(err));
        }
    }

    // Sprint W B1 — 0005: presentation_versions.validation_warnings + validated_at.
    if let Err(err) = conn.execute_batch(MIGRATION_0005) {
        let msg = err.to_string();
        if msg.contains("duplicate column name") {
            info!("migrazione 0005 gia' applicata (validation_warnings presente), skip");
        } else {
            warn!(?err, "errore esecuzione migrazione 0005");
            return Err(DbError::Sqlite(err));
        }
    }

    // Sprint W B1 — 0006: remote_control_pairings + rate events.
    // `CREATE TABLE IF NOT EXISTS` rende lo script idempotente.
    if let Err(err) = conn.execute_batch(MIGRATION_0006) {
        warn!(?err, "errore esecuzione migrazione 0006");
        return Err(DbError::Sqlite(err));
    }

    // Sprint W B1 — 0007: room_provision_tokens.
    if let Err(err) = conn.execute_batch(MIGRATION_0007) {
        warn!(?err, "errore esecuzione migrazione 0007");
        return Err(DbError::Sqlite(err));
    }

    // Sprint W B1 — 0008: room_state.current_slide_index/current_slide_total.
    if let Err(err) = conn.execute_batch(MIGRATION_0008) {
        let msg = err.to_string();
        if msg.contains("duplicate column name") {
            info!("migrazione 0008 gia' applicata (current_slide_index presente), skip");
        } else {
            warn!(?err, "errore esecuzione migrazione 0008");
            return Err(DbError::Sqlite(err));
        }
    }

    // Sprint W B1 — 0009: estensione enum CHECK (rebuild presentation_versions
    // + activity_log). Idempotenza basata su sentinella: testiamo se i nuovi
    // valori CHECK esistono gia' tentando un INSERT-ROLLBACK su un valore enum
    // estensivo. Se passa, la migration e' gia' applicata e skippiamo.
    if migration_0009_already_applied(conn) {
        info!("migrazione 0009 gia' applicata (enum estesi presenti), skip");
    } else if let Err(err) = conn.execute_batch(MIGRATION_0009) {
        let msg = err.to_string();
        // `table xxx_new already exists` → migrazione interrotta a meta'; non
        // possiamo riprenderla in automatico, segnaliamo all'admin.
        if msg.contains("already exists") {
            warn!(?err, "migrazione 0009 in stato inconsistente (tabella _new gia' presente)");
            return Err(DbError::Sqlite(err));
        }
        warn!(?err, "errore esecuzione migrazione 0009");
        return Err(DbError::Sqlite(err));
    }

    // Sprint W B1 — 0010: device_metric_pings (idempotente via IF NOT EXISTS).
    if let Err(err) = conn.execute_batch(MIGRATION_0010) {
        warn!(?err, "errore esecuzione migrazione 0010");
        return Err(DbError::Sqlite(err));
    }

    Ok(())
}

/// Sentinella per `MIGRATION_0009`: verifica se la tabella
/// `presentation_versions` accetta gia' il nuovo CHECK enum esteso
/// (presenza dei valori `'admin_upload'` e `'room_device'`).
///
/// Se SQLite rifiuta l'INSERT con check_constraint failed → migration NON
/// applicata; serve eseguire la 0009. Negli altri casi (errore generico,
/// successo dell'INSERT-ROLLBACK) consideriamo la migrazione gia' applicata
/// per evitare di re-rinominare tabelle e perdere dati.
fn migration_0009_already_applied(conn: &Connection) -> bool {
    // Approccio: leggiamo lo SQL effettivo della tabella da `sqlite_master`
    // e cerchiamo il valore enum esteso. Niente effetti collaterali, niente
    // INSERT/ROLLBACK rumorosi.
    let res: Result<String, _> = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='presentation_versions'",
        [],
        |row| row.get(0),
    );
    match res {
        Ok(sql) => sql.contains("'room_device'") && sql.contains("'admin_upload'"),
        Err(_) => false,
    }
}

/// Tenant fittizio per la modalita desktop (1 sola org locale).
/// Mantiene la colonna `tenant_id` su tutte le tabelle senza rompere lo schema cloud.
pub const LOCAL_TENANT_ID: &str = "00000000-0000-0000-0000-000000000001";
/// Utente admin fittizio (creato al seed).
pub const LOCAL_ADMIN_USER_ID: &str = "00000000-0000-0000-0000-000000000002";
