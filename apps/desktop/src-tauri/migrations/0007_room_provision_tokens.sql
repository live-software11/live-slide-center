-- Sprint W B1 (port di cloud `20260418260000_room_provision_tokens.sql`).
--
-- Magic-link token per zero-friction provisioning di PC sala.
-- Su desktop il workflow e':
--   1) admin genera token (RPC `rpc_admin_create_room_provision_token`),
--      ritorna URL `/provision/<token>` da stampare come QR/short link.
--   2) PC sala apre l'URL: dispatcher Rust chiama
--      `rpc_consume_room_provision_token`, crea `paired_devices`, setta
--      sessione e indirizza a RoomPlayerView senza che l'operatore
--      digiti il codice 6-cifre di Sprint K.
--
-- Sicurezza: token plain mai persistito, sha256 hex in `token_hash`.
-- Le RPC vivono in `server/rpc.rs` (Sprint W C2). Qui solo schema.
CREATE TABLE IF NOT EXISTS room_provision_tokens (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (
    max_uses BETWEEN 1 AND 10
  ),
  consumed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_by_user_id TEXT REFERENCES users(id) ON DELETE
  SET NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_room_provision_tokens_expires ON room_provision_tokens(expires_at)
WHERE revoked_at IS NULL
  AND consumed_count < max_uses;
CREATE INDEX IF NOT EXISTS idx_room_provision_tokens_room ON room_provision_tokens(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_provision_tokens_event ON room_provision_tokens(event_id, created_at DESC);
