-- ════════════════════════════════════════════════════════════════════════════
-- Sprint R-3 (G3) — Estensioni enum per upload da PC sala
-- ════════════════════════════════════════════════════════════════════════════
--
-- IMPORTANTE: ALTER TYPE ... ADD VALUE deve essere COMMITTATO prima che il
-- nuovo valore possa essere usato nelle INSERT. Per questo questa migration
-- e' separata dalla `20260418080100_room_device_upload_rpcs.sql` che crea
-- le RPC che usano i nuovi valori.
--
-- Postgres 12+: `IF NOT EXISTS` evita errore se gia' aggiunto (es. su replay).
--
-- ESTENSIONI:
--   1) upload_source: + 'room_device' → identifica versions caricate dal PC sala
--   2) actor_type:    + 'device'      → activity_log con actor 'device' invece
--                                       di 'system' (audit chiaro di chi ha
--                                       fatto l'upload).

ALTER TYPE public.upload_source ADD VALUE IF NOT EXISTS 'room_device';
ALTER TYPE public.actor_type ADD VALUE IF NOT EXISTS 'device';

COMMENT ON TYPE public.upload_source IS
  'Sorgenti upload presentation_versions: web_portal (default UI admin), preview_room (legacy), agent_upload (LAN agent intranet), room_device (PC sala via device_token, Sprint R-3).';

COMMENT ON TYPE public.actor_type IS
  'Tipi di attore per activity_log: user (admin/coordinator), speaker (relatore via portale), agent (LAN agent), system (Edge Function/cron/webhook), device (PC sala paired via device_token, Sprint R-3).';
