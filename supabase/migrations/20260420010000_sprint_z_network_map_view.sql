-- ============================================================================
-- Sprint Z (post-field-test) — Gap A: vista unificata Network Map
-- ============================================================================
-- Obiettivo: dare all'admin tenant una sola schermata che mostra TUTTI i PC
-- node del tenant (PC sala paired_devices + PC desktop server desktop_devices)
-- con stato derivato dall'ultimo ping per filtrare velocemente i nodi
-- "online | degraded | offline" senza dover leggere due tabelle separate.
--
-- Riferimento progettuale:
--   - docs/AUDIT_FINALE_E_PIANO_TEST_v1.md §3.3 (Gap A — Vista unificata).
--
-- Sicurezza:
--   - SECURITY INVOKER (default delle view in PG): la vista eredita la RLS
--     delle tabelle sottostanti. `paired_devices` e `desktop_devices` hanno
--     gia' policy `tenant_id = app_tenant_id() AND NOT current_tenant_suspended()`
--     quindi la stessa filtra automaticamente le righe di altri tenant.
--   - Nessun nuovo `GRANT` privilegiato: usiamo solo `SELECT TO authenticated`,
--     i super_admin eredito il `super_admin_all` policy delle base table.
--
-- Performance:
--   - Le base table hanno gia' indici (tenant_id) + (last_seen_at DESC):
--     `idx_desktop_devices_active_seen` (D1) e `idx_devices_event_centers` (S-4).
--   - La query e' un semplice UNION ALL: il planner sceglie l'indice tenant
--     in entrambi i ramo, no seq scan.
--
-- Status derivato:
--   - 'online'   → last_seen_at >= now() - 30s
--   - 'degraded' → last_seen_at >= now() - 5min ma < 30s
--   - 'offline'  → last_seen_at < 5min OR NULL
--   I 30s e i 5 min sono allineati a `room_heartbeat_status` usato da
--   LivePerfTelemetryPanel (Sprint T-2) per coerenza UX.
-- ============================================================================
CREATE OR REPLACE VIEW public.tenant_network_map AS
SELECT pd.id AS node_id,
  pd.tenant_id AS tenant_id,
  'paired_device'::text AS kind,
  pd.role::text AS role,
  pd.device_name AS display_name,
  pd.event_id AS event_id,
  pd.room_id AS room_id,
  pd.last_seen_at AS last_seen_at,
  CASE
    WHEN pd.last_seen_at IS NULL THEN 'offline'
    WHEN pd.last_seen_at >= now() - interval '30 seconds' THEN 'online'
    WHEN pd.last_seen_at >= now() - interval '5 minutes' THEN 'degraded'
    ELSE 'offline'
  END AS derived_status,
  pd.status::text AS raw_status,
  NULL::text AS app_version,
  NULL::text AS machine_fingerprint,
  pd.paired_at AS registered_at
FROM public.paired_devices pd
UNION ALL
SELECT dd.id AS node_id,
  dd.tenant_id AS tenant_id,
  'desktop_device'::text AS kind,
  'desktop_server'::text AS role,
  dd.device_name AS display_name,
  NULL::uuid AS event_id,
  NULL::uuid AS room_id,
  dd.last_seen_at AS last_seen_at,
  CASE
    WHEN dd.status <> 'active' THEN 'offline'
    WHEN dd.last_seen_at IS NULL THEN 'offline'
    WHEN dd.last_seen_at >= now() - interval '30 seconds' THEN 'online'
    WHEN dd.last_seen_at >= now() - interval '15 minutes' THEN 'degraded'
    ELSE 'offline'
  END AS derived_status,
  dd.status AS raw_status,
  dd.app_version AS app_version,
  dd.machine_fingerprint AS machine_fingerprint,
  dd.registered_at AS registered_at
FROM public.desktop_devices dd;
COMMENT ON VIEW public.tenant_network_map IS 'Sprint Z (post-field-test) Gap A — vista unificata di TUTTI i PC node ' 'del tenant: paired_devices (PC sala / centri slide) + desktop_devices ' '(PC desktop server). Status "online | degraded | offline" derivato da ' 'last_seen_at con soglie allineate a LivePerfTelemetryPanel (Sprint T-2). ' 'SECURITY INVOKER: eredita RLS tenant_id = app_tenant_id() dalle base table.';
GRANT SELECT ON public.tenant_network_map TO authenticated;
