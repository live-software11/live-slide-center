-- Sprint W B1 (port di cloud `20260418100000_device_metric_pings.sql`).
--
-- Tabella `device_metric_pings` append-only per heartbeat metric dei PC sala
-- (CPU/RAM/disco/heap/fps/network/battery). Sul desktop offline serve a:
--   • alimentare la `LivePerfTelemetryPanel` quando la sidebar non e' nascosta
--     (vedi Sprint W D2 — in modalita' desktop la voce telemetria e' nascosta
--     ma la tabella resta per future sync hybrid),
--   • catturare snapshot debug ("perche' la sala 3 ha freezato?").
--
-- Differenze cloud → desktop:
--   • BIGSERIAL → INTEGER PRIMARY KEY AUTOINCREMENT
--   • TIMESTAMPTZ → TEXT ISO-8601 UTC
--   • NUMERIC(p,s) → REAL (SQLite non ha precisione fissa; affidiamo i range
--     ai CHECK constraint).
--   • Niente RLS (single-tenant locale).
--   • Niente policy: l'unico writer e' `rpc_record_device_metric_ping` in
--     `server/rpc.rs` (Sprint W C2), accessibile solo via device_token HTTP.
--   • Retention: cleanup 24h fatto da task Tauri schedulato (vedi futura
--     `server/cleanup.rs`) con `DELETE WHERE ts < now() - 24h`.

CREATE TABLE IF NOT EXISTS device_metric_pings (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id                TEXT NOT NULL REFERENCES paired_devices(id) ON DELETE CASCADE,
  event_id                 TEXT REFERENCES events(id) ON DELETE SET NULL,
  room_id                  TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  ts                       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  source                   TEXT NOT NULL CHECK (source IN ('browser', 'desktop')),

  js_heap_used_pct         REAL,
  js_heap_used_mb          REAL,
  storage_quota_used_pct   REAL,
  storage_quota_used_mb    REAL,
  fps                      REAL,
  network_type             TEXT,
  network_downlink_mbps    REAL,
  battery_pct              REAL,
  battery_charging         INTEGER,
  visibility               TEXT CHECK (visibility IS NULL OR visibility IN ('visible', 'hidden')),

  cpu_pct                  REAL,
  ram_used_pct             REAL,
  ram_used_mb              REAL,
  disk_free_pct            REAL,
  disk_free_gb             REAL,

  app_uptime_sec           INTEGER,
  playback_mode            TEXT CHECK (playback_mode IS NULL OR playback_mode IN ('auto', 'live', 'turbo')),
  device_role              TEXT CHECK (device_role IS NULL OR device_role IN ('room', 'control_center')),

  CHECK (
    (js_heap_used_pct       IS NULL OR (js_heap_used_pct       >= 0 AND js_heap_used_pct       <= 100)) AND
    (storage_quota_used_pct IS NULL OR (storage_quota_used_pct >= 0 AND storage_quota_used_pct <= 100)) AND
    (cpu_pct                IS NULL OR (cpu_pct                >= 0 AND cpu_pct                <= 100)) AND
    (ram_used_pct           IS NULL OR (ram_used_pct           >= 0 AND ram_used_pct           <= 100)) AND
    (disk_free_pct          IS NULL OR (disk_free_pct          >= 0 AND disk_free_pct          <= 100)) AND
    (battery_pct            IS NULL OR (battery_pct            >= 0 AND battery_pct            <= 100)) AND
    (fps                    IS NULL OR (fps                    >= 0 AND fps                    <= 240))
  )
);

CREATE INDEX IF NOT EXISTS idx_device_metric_pings_device_ts
  ON device_metric_pings(device_id, ts DESC);

CREATE INDEX IF NOT EXISTS idx_device_metric_pings_event_ts
  ON device_metric_pings(event_id, ts DESC)
  WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_device_metric_pings_ts
  ON device_metric_pings(ts);
