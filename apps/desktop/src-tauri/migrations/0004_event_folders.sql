-- Sprint W B1 (port di cloud `20260418240000_event_folders.sql`).
--
-- Aggiunge la gerarchia cartelle `event_folders` + colonna
-- `presentations.folder_id` per il File Explorer V2 (vedi
-- `apps/web/src/features/events/ProductionView.tsx`).
--
-- Differenze rispetto al cloud:
--   • Postgres usa `UNIQUE NULLS NOT DISTINCT (event_id, parent_id, lower(name))`
--     (PG15+). SQLite non lo supporta — usiamo un'expression UNIQUE INDEX con
--     `COALESCE(parent_id, '00000000-0000-0000-0000-000000000000')` come
--     "sentinel root" cosi' anche le folder root (parent_id=NULL) competono
--     correttamente per unicita' (event_id, name).
--   • Niente RLS: il backend Rust e' single-tenant locale.
--   • `name COLLATE NOCASE` su SQLite per case-insensitive equivalente di
--     `lower(name)` in Postgres.
--
-- Idempotente: tutte le CREATE usano `IF NOT EXISTS`. La `ALTER TABLE
-- presentations ADD COLUMN folder_id` non supporta `IF NOT EXISTS` su
-- SQLite — gestita lato `db.rs` con error tolerance (vedi 0002/0003).

CREATE TABLE IF NOT EXISTS event_folders (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES event_folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_event_folders_event   ON event_folders(event_id);
CREATE INDEX IF NOT EXISTS idx_event_folders_tenant  ON event_folders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_event_folders_parent  ON event_folders(parent_id) WHERE parent_id IS NOT NULL;

-- Equivalente SQLite di `UNIQUE NULLS NOT DISTINCT (event_id, parent_id, lower(name))`.
-- COALESCE rende NULL (root) un valore comparabile.
CREATE UNIQUE INDEX IF NOT EXISTS uq_event_folders_name_per_parent
  ON event_folders (
    event_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'),
    name COLLATE NOCASE
  );

-- ALTER TABLE non supporta IF NOT EXISTS — la `db.rs` tollera l'errore
-- "duplicate column name" per idempotenza.
ALTER TABLE presentations ADD COLUMN folder_id TEXT REFERENCES event_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_presentations_folder ON presentations(folder_id) WHERE folder_id IS NOT NULL;
