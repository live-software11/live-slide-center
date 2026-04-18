-- ════════════════════════════════════════════════════════════════════════════
-- Sprint Hardening Pre-Field-Test §2.2 — VACUUM ANALYZE settimanale
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tabelle hot-path con UPDATE/INSERT frequenti → statistiche planner stale
-- nel tempo → P95 latenza che cresce. Forziamo VACUUM ANALYZE settimanale
-- (Domenica 04:00 UTC, fascia oraria con minor traffico EU/IT) per:
--
--   • device_metric_pings  → 28-172k righe/evento, retention 24h
--   • room_state           → UPDATE ogni 5s in turbo mode
--   • paired_devices       → UPDATE su last_seen_at frequente
--   • desktop_devices      → UPDATE 1x/24h heartbeat
--
-- Nota su pg_cron: ogni statement nel `command` viene eseguito autocommit
-- (VACUUM non e' transactional). Idempotenza: cron.unschedule se esiste
-- + re-schedule con stesso jobname. Safe re-run.
--
-- Nota timestamp: applicata su Supabase con version 20260418200712 (vedi
-- MCP list_migrations) ma salvata nel repo con timestamp 20260418310000
-- per restare consecutiva alla sequenza locale post-quota_triggers.
-- ════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN IF EXISTS (
  SELECT 1
  FROM pg_extension
  WHERE extname = 'pg_cron'
) THEN PERFORM cron.unschedule('vacuum_hot_tables_weekly')
WHERE EXISTS (
    SELECT 1
    FROM cron.job
    WHERE jobname = 'vacuum_hot_tables_weekly'
  );
PERFORM cron.schedule(
  'vacuum_hot_tables_weekly',
  '0 4 * * 0',
  $cron$ VACUUM ANALYZE public.device_metric_pings;
VACUUM ANALYZE public.room_state;
VACUUM ANALYZE public.paired_devices;
VACUUM ANALYZE public.desktop_devices;
$cron$
);
END IF;
END $$;
COMMENT ON EXTENSION pg_cron IS 'Sprint Hardening Pre-Field-Test §2.2: ospita anche vacuum_hot_tables_weekly (Dom 04:00 UTC) oltre ai cleanup giornalieri esistenti.';
