-- Sprint K2 (GUIDA_OPERATIVA_v3 §4.C K2 + §12 Appendice A)
-- Schema SQLite mirror Supabase Postgres per la modalita desktop offline.
--
-- Decisioni di traduzione tipo:
--   uuid           → TEXT (UUID v4 stringa, generato lato Rust con `uuid::Uuid::new_v4()`)
--   timestamptz    → TEXT (ISO-8601 in UTC, `YYYY-MM-DDTHH:MM:SS.sssZ`)
--   jsonb          → TEXT (JSON.stringify lato server; lettura via serde_json)
--   bytea / blob   → BLOB
--   enum           → TEXT con CHECK constraint enumerativo
--   inet           → TEXT
--
-- Differenze rispetto a Postgres:
--   • niente RLS: il server e' single-user, l'autorizzazione avviene a livello HTTP
--     tramite `Authorization: Bearer <admin_token>` o `device_token` body.
--   • niente trigger broadcast realtime: il sync push HTTP arriva in Sprint N3.
--   • niente publication supabase_realtime.
--   • un unico tenant fittizio `00000000-0000-0000-0000-000000000001` per
--     mantenere la colonna `tenant_id` come nel cloud (zero divergenza schema dal
--     punto di vista della SPA).
--
-- Idempotente: tutte le CREATE usano `IF NOT EXISTS`.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tenants (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  slug                 TEXT UNIQUE NOT NULL,
  plan                 TEXT NOT NULL DEFAULT 'enterprise' CHECK (plan IN ('trial','starter','pro','enterprise')),
  ls_customer_id       TEXT,
  ls_subscription_id   TEXT,
  storage_used_bytes   INTEGER NOT NULL DEFAULT 0,
  storage_limit_bytes  INTEGER NOT NULL DEFAULT -1,
  max_events_per_month INTEGER NOT NULL DEFAULT 999999,
  max_rooms_per_event  INTEGER NOT NULL DEFAULT 999999,
  suspended            INTEGER NOT NULL DEFAULT 0,
  settings             TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin','tech','coordinator','super_admin')),
  avatar_url    TEXT,
  last_seen_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  name_en      TEXT,
  location     TEXT,
  venue        TEXT,
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  timezone     TEXT NOT NULL DEFAULT 'Europe/Rome',
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','setup','active','closed','archived')),
  network_mode TEXT NOT NULL DEFAULT 'lan' CHECK (network_mode IN ('cloud','lan')),
  settings     TEXT NOT NULL DEFAULT '{}',
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_events_tenant ON events(tenant_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_events_dates  ON events(start_date, end_date);

CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  name_en       TEXT,
  floor         TEXT,
  capacity      INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  room_type     TEXT NOT NULL DEFAULT 'main' CHECK (room_type IN ('main','breakout','preview','poster')),
  settings      TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_rooms_event ON rooms(event_id);

CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  title_en        TEXT,
  session_type    TEXT NOT NULL DEFAULT 'talk' CHECK (session_type IN ('talk','panel','workshop','break','ceremony')),
  scheduled_start TEXT NOT NULL,
  scheduled_end   TEXT NOT NULL,
  display_order   INTEGER NOT NULL DEFAULT 0,
  chair_name      TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_room     ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_event    ON sessions(event_id);
CREATE INDEX IF NOT EXISTS idx_sessions_schedule ON sessions(room_id, scheduled_start);

CREATE TABLE IF NOT EXISTS speakers (
  id                       TEXT PRIMARY KEY,
  session_id               TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id                 TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name                TEXT NOT NULL,
  email                    TEXT,
  company                  TEXT,
  job_title                TEXT,
  bio                      TEXT,
  upload_token             TEXT UNIQUE,
  upload_token_expires_at  TEXT,
  display_order            INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_speakers_session ON speakers(session_id);
CREATE INDEX IF NOT EXISTS idx_speakers_event   ON speakers(event_id);
CREATE INDEX IF NOT EXISTS idx_speakers_token   ON speakers(upload_token) WHERE upload_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS presentations (
  id                  TEXT PRIMARY KEY,
  speaker_id          TEXT REFERENCES speakers(id) ON DELETE SET NULL,
  session_id          TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id            TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_version_id  TEXT,
  total_versions      INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','uploaded','reviewed','approved','rejected','archived')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_presentations_speaker ON presentations(speaker_id);
CREATE INDEX IF NOT EXISTS idx_presentations_session ON presentations(session_id);
CREATE INDEX IF NOT EXISTS idx_presentations_event   ON presentations(event_id);
-- Vincolo unicita 1:1 speaker → presentation come migration 20260417110000 cloud.
-- NOTA: in SQLite UNIQUE non puo' essere "WHERE NOT NULL" come Postgres partial index;
-- usiamo indice univoco condizionale.
CREATE UNIQUE INDEX IF NOT EXISTS presentations_speaker_unique
  ON presentations(speaker_id)
  WHERE speaker_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS presentation_versions (
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
  upload_source         TEXT NOT NULL DEFAULT 'web_portal' CHECK (upload_source IN ('web_portal','preview_room','agent_upload')),
  status                TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','processing','ready','failed','superseded')),
  notes                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(presentation_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_versions_presentation ON presentation_versions(presentation_id);
CREATE INDEX IF NOT EXISTS idx_versions_status        ON presentation_versions(status);

CREATE TABLE IF NOT EXISTS room_state (
  room_id                  TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_session_id       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  current_presentation_id  TEXT REFERENCES presentations(id) ON DELETE SET NULL,
  current_version_id       TEXT REFERENCES presentation_versions(id) ON DELETE SET NULL,
  sync_status              TEXT NOT NULL DEFAULT 'offline' CHECK (sync_status IN ('synced','syncing','outdated','offline')),
  agent_connection         TEXT NOT NULL DEFAULT 'offline' CHECK (agent_connection IN ('online','offline','degraded')),
  playback_mode            TEXT NOT NULL DEFAULT 'auto' CHECK (playback_mode IN ('auto','live','turbo')),
  last_play_started_at     TEXT,
  last_sync_at             TEXT,
  assigned_agent_id        TEXT,
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_room_state_playback_mode ON room_state(playback_mode);

CREATE TABLE IF NOT EXISTS local_agents (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id            TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  machine_id          TEXT,
  lan_ip              TEXT,
  lan_port            INTEGER NOT NULL DEFAULT 7300,
  status              TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','degraded')),
  last_heartbeat      TEXT,
  cached_files_count  INTEGER NOT NULL DEFAULT 0,
  cached_size_bytes   INTEGER NOT NULL DEFAULT 0,
  agent_version       TEXT,
  registered_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_agents_event ON local_agents(event_id);

CREATE TABLE IF NOT EXISTS paired_devices (
  id                   TEXT PRIMARY KEY,
  tenant_id            TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id             TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id              TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  device_name          TEXT NOT NULL,
  device_type          TEXT,
  browser              TEXT,
  user_agent           TEXT,
  pair_token_hash      TEXT NOT NULL UNIQUE,
  last_ip              TEXT,
  last_seen_at         TEXT,
  status               TEXT NOT NULL DEFAULT 'offline' CHECK (status IN ('online','offline','degraded')),
  paired_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  paired_by_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  notes                TEXT,
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_devices_event   ON paired_devices(event_id);
CREATE INDEX IF NOT EXISTS idx_devices_room    ON paired_devices(room_id);
CREATE INDEX IF NOT EXISTS idx_devices_status  ON paired_devices(tenant_id, status);

CREATE TABLE IF NOT EXISTS pairing_codes (
  code                    TEXT PRIMARY KEY,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id                TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id                 TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  generated_by_user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at              TEXT NOT NULL,
  consumed_at             TEXT,
  consumed_by_device_id   TEXT REFERENCES paired_devices(id) ON DELETE SET NULL,
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires ON pairing_codes(expires_at) WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS activity_log (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id     TEXT REFERENCES events(id) ON DELETE SET NULL,
  actor        TEXT NOT NULL CHECK (actor IN ('user','speaker','agent','system')),
  actor_id     TEXT,
  actor_name   TEXT,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_event  ON activity_log(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_tenant ON activity_log(tenant_id, created_at DESC);

-- Seed: tenant fittizio "local" + utente admin di sistema, idempotente.
-- ID fissi cosi' che la SPA possa riferirli senza prima leggerli.
INSERT INTO tenants (id, name, slug, plan, storage_limit_bytes, max_events_per_month, max_rooms_per_event)
VALUES ('00000000-0000-0000-0000-000000000001', 'Local', 'local', 'enterprise', -1, 999999, 999999)
ON CONFLICT(id) DO NOTHING;

INSERT INTO users (id, tenant_id, email, full_name, role)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'admin@local', 'Admin Locale', 'admin')
ON CONFLICT(id) DO NOTHING;
