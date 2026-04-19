-- Sprint W B1 — Estensione enum CHECK per parita' con cloud:
--   • presentation_versions.upload_source: + 'admin_upload' (Sprint cloud
--     20260417110000) + 'room_device' (Sprint cloud 20260418080000).
--   • activity_log.actor: + 'device' (Sprint cloud 20260418080000)
--     + 'remote_control' (Sprint cloud 20260418210000).
--
-- SQLite non supporta `ALTER TABLE ... DROP CONSTRAINT`, quindi seguiamo il
-- pattern documentato:
--   1) CREATE TABLE new con CHECK aggiornato
--   2) INSERT INTO new SELECT * FROM old
--   3) DROP TABLE old
--   4) ALTER TABLE new RENAME TO old
--   5) Ricostruzione indici (i CREATE INDEX IF NOT EXISTS della 0001
--      non vengono ricreati automaticamente perche' la nuova tabella ha
--      stesso nome ma indici diversi).
--
-- IDEMPOTENZA: usiamo `IF NOT EXISTS` per la tabella temporanea e una
-- guard logica via colonne esistenti. Se la migration e' gia' applicata,
-- la nuova tabella avra' gia' i nuovi valori CHECK e l'INSERT fallirebbe
-- con violazione (visto che old non esisterebbe). Per gestire il replay,
-- la migration e' applicata UNA VOLTA SOLA dalla `db.rs::run_migrations`
-- con tolleranza errore "no such table: presentation_versions_old" /
-- "table presentation_versions_new already exists" (vedi 0002/0003).
--
-- NB: PRAGMA foreign_keys=OFF e' obbligatorio durante la ricreazione,
-- altrimenti i REFERENCES dalle altre tabelle (activity_log, etc.)
-- bloccano il DROP. Il pragma viene poi ripristinato da `run_migrations`.

PRAGMA foreign_keys = OFF;

-- ════════════════════════════════════════════════════════════════════════════
-- 1) presentation_versions: estensione upload_source CHECK
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS presentation_versions_new (
  id                    TEXT PRIMARY KEY,
  presentation_id       TEXT NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  tenant_id             TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number        INTEGER NOT NULL,
  storage_key           TEXT NOT NULL,
  file_name             TEXT NOT NULL,
  file_size_bytes       INTEGER NOT NULL,
  file_hash_sha256      TEXT,
  mime_type             TEXT NOT NULL,
  uploaded_by_speaker   INTEGER NOT NULL DEFAULT 1,
  uploaded_by_user_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  upload_source         TEXT NOT NULL DEFAULT 'web_portal'
    CHECK (upload_source IN ('web_portal','preview_room','agent_upload','admin_upload','room_device')),
  status                TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading','processing','ready','failed','superseded')),
  notes                 TEXT,
  validation_warnings   TEXT,
  validated_at          TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(presentation_id, version_number)
);

INSERT INTO presentation_versions_new
SELECT
  id, presentation_id, tenant_id, version_number, storage_key,
  file_name, file_size_bytes, file_hash_sha256, mime_type,
  uploaded_by_speaker, uploaded_by_user_id, upload_source, status,
  notes, validation_warnings, validated_at, created_at
FROM presentation_versions;

DROP TABLE presentation_versions;
ALTER TABLE presentation_versions_new RENAME TO presentation_versions;

CREATE INDEX IF NOT EXISTS idx_versions_presentation ON presentation_versions(presentation_id);
CREATE INDEX IF NOT EXISTS idx_versions_status        ON presentation_versions(status);

-- ════════════════════════════════════════════════════════════════════════════
-- 2) activity_log: estensione actor CHECK
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS activity_log_new (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,
  actor        TEXT NOT NULL CHECK (actor IN ('user','speaker','agent','system','device','remote_control')),
  actor_id     TEXT,
  actor_name   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO activity_log_new
SELECT id, tenant_id, event_id, actor, actor_id, actor_name,
       action, entity_type, entity_id, metadata, created_at
FROM activity_log;

DROP TABLE activity_log;
ALTER TABLE activity_log_new RENAME TO activity_log;

CREATE INDEX IF NOT EXISTS idx_activity_event  ON activity_log(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_log(tenant_id, created_at DESC);

PRAGMA foreign_keys = ON;
