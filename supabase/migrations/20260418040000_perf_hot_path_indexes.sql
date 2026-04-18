-- ════════════════════════════════════════════════════════════════════════════
-- Performance: indici per le query "hot path" osservate nel codice
-- ════════════════════════════════════════════════════════════════════════════
-- Strategia: ogni indice e' giustificato da una query reale (file + linea)
-- e va valutato nel piano EXPLAIN prima di accettarlo. Ogni indice costa:
--   - ~32 byte/riga (B-tree) o meno (partial / hash)
--   - INSERT/UPDATE marginalmente piu' lento (5-10% per indice in piu')
--   - Spazio disco (proporzionale al numero di righe)
-- Beneficio: query critiche scendono da seq-scan O(n) a index-scan O(log n).
--
-- Tutti `IF NOT EXISTS`: idempotenti, non rompono nulla in caso di re-apply.
-- ════════════════════════════════════════════════════════════════════════════
-- ── 1) Dashboard regia: ultime 60 secondi room_state per evento ─────────────
-- Query: SELECT * FROM room_state WHERE tenant_id=$1 ORDER BY updated_at DESC
-- File: apps/web/src/features/live-view/LiveRegiaView.tsx (refresh 5s)
CREATE INDEX IF NOT EXISTS idx_room_state_tenant_updated ON public.room_state(tenant_id, updated_at DESC);
-- ── 2) Lookup "ultima versione READY" per presentation ──────────────────────
-- Query: SELECT * FROM presentation_versions
--        WHERE presentation_id=$1 AND status='ready'
--        ORDER BY version_number DESC LIMIT 1
-- File: apps/web/src/features/presentations/repository.ts (download/preview)
-- Partial: il 95% delle versioni storiche e' 'ready', quindi WHERE filtra poco
-- ma l'ORDER BY DESC trae beneficio dall'index ordinato.
CREATE INDEX IF NOT EXISTS idx_pv_pres_ver_desc_ready ON public.presentation_versions(presentation_id, version_number DESC)
WHERE status = 'ready';
-- ── 3) Dashboard eventi: filtro per stato + range date ──────────────────────
-- Query: SELECT * FROM events WHERE tenant_id=$1 AND status IN (...)
--        AND start_date >= now() ORDER BY start_date
-- File: apps/web/src/features/events/repository.ts
-- Composite: il primo predicato (tenant_id) e' giai' nella RLS (selettivissimo
-- per tenant medio); status fa da filtro secondario; start_date completa l'order.
CREATE INDEX IF NOT EXISTS idx_events_tenant_status_date ON public.events(tenant_id, status, start_date);
-- ── 4) Heartbeat dashboard PC sala (online) ─────────────────────────────────
-- Query: SELECT COUNT(*) FROM paired_devices
--        WHERE tenant_id=$1 AND status='online' AND last_seen_at > now()-INT'2 min'
-- File: apps/web/src/features/devices/components/DeviceList.tsx
-- Partial: un evento attivo ha tipicamente <100 device online; partial index
-- sta in pochi KB e velocizza enormemente il count.
CREATE INDEX IF NOT EXISTS idx_paired_devices_online_seen ON public.paired_devices(tenant_id, last_seen_at DESC)
WHERE status = 'online';
-- ── 5) Cleanup pairing codes scaduti (cron / lazy) ──────────────────────────
-- Query: DELETE FROM pairing_codes WHERE consumed_at IS NULL AND expires_at < now()
-- File: supabase/functions/cleanup-expired-codes/index.ts (cron 5 min)
-- Esiste gia' idx_pairing_codes_expires con WHERE consumed_at IS NULL ma
-- senza tenant_id: aggiungo composite per il dashboard "codici attivi" che
-- filtra anche per tenant.
CREATE INDEX IF NOT EXISTS idx_pairing_codes_tenant_active ON public.pairing_codes(tenant_id, expires_at)
WHERE consumed_at IS NULL;
-- ── 6) Activity log: query ultimi N eventi per evento corrente ──────────────
-- Esiste idx_activity_event(event_id, created_at DESC) ma senza filtro tenant.
-- Per super-admin/audit cross-tenant: index su tenant + tipo entita' + data.
-- Query: SELECT * FROM activity_log WHERE tenant_id=$1 AND entity_type=$2
--        ORDER BY created_at DESC LIMIT 50
-- File: apps/web/src/features/admin/AdminAuditView.tsx
CREATE INDEX IF NOT EXISTS idx_activity_tenant_entity_date ON public.activity_log(tenant_id, entity_type, created_at DESC);
-- ── 7) Speakers: lookup upload_token (TUS portal) ───────────────────────────
-- Esiste idx_speakers_token(upload_token) WHERE upload_token IS NOT NULL,
-- ma non e' UNIQUE: aggiungiamo UNIQUE constraint via partial unique index per
-- evitare collisioni token (anche se gen_random_bytes(32) le rende irrilevanti).
-- Idempotente: il token e' UNIQUE gia' a livello colonna in init_slide_center.
-- Quindi questo INDEX e' un duplicato logico, lo skippo per non sprecare disco.
-- ── 8) Tenant data exports: storico per tenant ──────────────────────────────
-- Query: SELECT * FROM tenant_data_exports WHERE tenant_id=$1 ORDER BY requested_at DESC LIMIT 10
-- File: supabase/migrations/20260417140000_sprint7_operations.sql RPC list_tenant_data_exports
-- Schema reale (vedi 20260417140000_sprint7_operations.sql): la colonna timestamp e' `requested_at`,
-- non `created_at`. Fix audit Q+1.5 18/04/2026.
CREATE INDEX IF NOT EXISTS idx_tenant_data_exports_tenant_requested ON public.tenant_data_exports(tenant_id, requested_at DESC);
-- ── 9) Email log: idempotency lookup ────────────────────────────────────────
-- Query: SELECT 1 FROM email_log WHERE idempotency_key=$1
-- File: supabase/functions/email-send/index.ts
-- idempotency_key e' UNIQUE in DDL, quindi gia' indicizzato. Skip.
-- ── 10) Storage: lookup oggetti per finalize_upload_version ─────────────────
-- Query: SELECT name, metadata FROM storage.objects
--        WHERE bucket_id='presentations' AND name=$1
-- L'index `bucketid_objname` esiste di default su storage.objects
-- (gestito da Supabase). Skip.
COMMENT ON INDEX public.idx_room_state_tenant_updated IS 'Hot path: dashboard live regia, refresh ogni 5s (Sprint hardening Q+1).';
COMMENT ON INDEX public.idx_pv_pres_ver_desc_ready IS 'Hot path: lookup ultima versione READY per download (Sprint hardening Q+1).';
COMMENT ON INDEX public.idx_events_tenant_status_date IS 'Hot path: dashboard eventi attivi/futuri (Sprint hardening Q+1).';
COMMENT ON INDEX public.idx_paired_devices_online_seen IS 'Hot path: heartbeat conta device online (Sprint hardening Q+1).';
COMMENT ON INDEX public.idx_pairing_codes_tenant_active IS 'Hot path: dashboard codici pairing attivi per tenant (Sprint hardening Q+1).';
COMMENT ON INDEX public.idx_activity_tenant_entity_date IS 'Hot path: AdminAuditView paginazione per entity_type (Sprint hardening Q+1).';
COMMENT ON INDEX public.idx_tenant_data_exports_tenant_requested IS 'Hot path: storico GDPR export per tenant (Sprint hardening Q+1).';
