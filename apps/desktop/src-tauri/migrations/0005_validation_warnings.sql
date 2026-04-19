-- Sprint W B1 (port di cloud `20260418170000_presentation_validation.sql`).
--
-- Aggiunge a `presentation_versions`:
--   • `validation_warnings` (JSON array di warning non bloccanti),
--   • `validated_at` (timestamp ultimo controllo).
--
-- Lato cloud i warning vengono popolati dal trigger PG `validate_presentation_version()`.
-- Su desktop la validazione e' fatta da `validation.rs` (Sprint Q-3) e scrive
-- direttamente i warning serializzati come JSON quando salva la nuova versione.
--
-- ALTER TABLE non supporta IF NOT EXISTS su SQLite → tolleranza
-- "duplicate column name" gestita in `db.rs::run_migrations`.

ALTER TABLE presentation_versions ADD COLUMN validation_warnings TEXT;
ALTER TABLE presentation_versions ADD COLUMN validated_at TEXT;
