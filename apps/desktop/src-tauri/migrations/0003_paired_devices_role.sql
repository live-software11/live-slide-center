-- Sprint D4 (port di Sprint S-4 cloud) — Centro Slide multi-room device role.
--
-- Aggiunge `paired_devices.role` per distinguere device "sala" (default,
-- 1 device = 1 sala) dai device "Centro Slide" (1 device = N sale,
-- room_id NULL, riceve i file di TUTTE le sale dell'evento).
--
-- Cloud parity: vedi `supabase/migrations/20260418090000_paired_devices_role.sql`.
-- Backward-compat: tutti i device esistenti restano `role='room'` di default.
--
-- L'`ALTER TABLE` non e' supportato da `IF NOT EXISTS` su SQLite, quindi
-- la migration e' lanciata da `db.rs::run_migrations` con tolleranza
-- "duplicate column name: role" (idempotenza), come gia' fatto per la 0002.
ALTER TABLE paired_devices ADD COLUMN role TEXT NOT NULL DEFAULT 'room'
  CHECK (role IN ('room', 'control_center'));

-- Indice parziale: cardinalita' bassa (1-3 Centri Slide per evento), ma
-- accelera "list centri di questo evento" lato admin.
CREATE INDEX IF NOT EXISTS idx_devices_event_centers
  ON paired_devices (event_id)
  WHERE role = 'control_center';
