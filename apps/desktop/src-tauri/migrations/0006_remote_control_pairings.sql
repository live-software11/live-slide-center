-- Sprint W B1 (port di cloud `20260418210000_remote_control_pairings.sql`).
--
-- Tabella `remote_control_pairings` per il telecomando remoto via PWA tablet
-- (Sprint T-3-G cloud). Su desktop il flusso e':
--   1) admin crea pairing -> token UUID + URL `/remote/<token>`
--   2) tablet apre URL -> `validate_remote_control_token` (HTTP route)
--   3) tablet invia comandi -> dispatcher Rust aggiorna `room_state`
--   4) PC sala via SSE/poll vede cambio current_presentation_id
--
-- Le RPC Rust corrispondenti vivono in `server/rpc.rs` (Sprint W C2). Qui solo
-- lo schema (parita' cloud) per consentire seed/test e futura sync.
CREATE TABLE IF NOT EXISTS remote_control_pairings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (
    length(trim(name)) BETWEEN 1 AND 80
  ),
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE
  SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT,
    commands_count INTEGER NOT NULL DEFAULT 0,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_rcp_tenant_event_room ON remote_control_pairings (tenant_id, event_id, room_id);
CREATE INDEX IF NOT EXISTS idx_rcp_active_expiry ON remote_control_pairings (expires_at)
WHERE revoked_at IS NULL;
-- Tabella rate-limit (60 cmd/min/pairing su cloud).
CREATE TABLE IF NOT EXISTS remote_control_rate_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pairing_id TEXT NOT NULL REFERENCES remote_control_pairings(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_rcre_pairing_time ON remote_control_rate_events (pairing_id, created_at DESC);
