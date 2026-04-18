-- ────────────────────────────────────────────────────────────────────
-- Audit MEDIUM fixes 2026-04-18
-- ────────────────────────────────────────────────────────────────────
-- Chiude AU-01, AU-02, AU-03, AU-05 dalla §0.23.2 di docs/STATO_E_TODO.md.
--
-- AU-01 (DB retention): pg_cron daily 04:00 UTC cleanup
--                       lemon_squeezy_event_log eventi 'processed' > 90 giorni.
--
-- AU-02 (DB retention): pg_cron schedule per cleanup_device_metric_pings (24h)
--                       e cleanup_pair_claim_rate_events (>2x window 15min).
--
-- AU-03 (DB observability): hardening SET search_path = pg_catalog, public,
--                           pg_temp (+ schema secondari mantenuti) su tutte
--                           le SECURITY DEFINER functions di public, per
--                           prevenire schema hijacking.
--
-- AU-05 (Rate limit Edge): nuova tabella edge_function_rate_events generale
--                          + RPC atomica check_and_record_edge_rate per
--                          rate limit estendibile a piu' Edge Functions.
-- ────────────────────────────────────────────────────────────────────

-- ── 0) Estensione pg_cron (necessaria per cron jobs) ───────────────────────
-- IMPORTANT: pg_cron va installato nel db `postgres` ed e' a livello DB.
-- Su Supabase managed e' supportato in schema `cron`.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- ── 1) AU-01: retention lemon_squeezy_event_log ───────────────────────────
-- Cleanup daily 04:00 UTC: cancella eventi 'processed' o 'skipped' piu' vecchi
-- di 90 giorni. Eventi 'failed' o 'received' restano per audit/troubleshoot.
CREATE OR REPLACE FUNCTION public.cleanup_lemon_squeezy_event_log()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  DELETE FROM public.lemon_squeezy_event_log
  WHERE processing_status IN ('processed', 'skipped')
    AND received_at < now() - interval '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_lemon_squeezy_event_log() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_lemon_squeezy_event_log() TO service_role;
COMMENT ON FUNCTION public.cleanup_lemon_squeezy_event_log() IS
  'Audit-fix AU-01 (2026-04-18): cleanup eventi processed/skipped >90 giorni.';

-- ── 2) AU-02: cleanup pair_claim_rate_events ──────────────────────────────
-- L'Edge Function pair-claim cancellava on-demand al primo claim. Sostituito
-- con pg_cron schedule fisso per garantire retention anche durante low-traffic.
CREATE OR REPLACE FUNCTION public.cleanup_pair_claim_rate_events()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_deleted bigint;
BEGIN
  -- Window pair-claim = 15 minuti, retention 2x = 30 minuti.
  DELETE FROM public.pair_claim_rate_events
  WHERE created_at < now() - interval '30 minutes';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_pair_claim_rate_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_pair_claim_rate_events() TO service_role;
COMMENT ON FUNCTION public.cleanup_pair_claim_rate_events() IS
  'Audit-fix AU-02 (2026-04-18): cleanup eventi rate-limit pair-claim >30 minuti.';

-- ── 3) Schedule pg_cron jobs ──────────────────────────────────────────────
-- Schedule sintassi: minute hour day month dow.
-- Tutti i tempi in UTC sul cluster Supabase.
DO $$
BEGIN
  -- Job 1: cleanup_lemon_squeezy_event_log daily 04:00 UTC
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_lemon_squeezy_event_log') THEN
    PERFORM cron.schedule(
      'cleanup_lemon_squeezy_event_log',
      '0 4 * * *',
      $cron$SELECT public.cleanup_lemon_squeezy_event_log();$cron$
    );
  END IF;

  -- Job 2: cleanup_device_metric_pings daily 03:00 UTC (gia' definita in
  -- migration 20260418100000_device_metric_pings.sql ma non schedulata)
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_device_metric_pings') THEN
    PERFORM cron.schedule(
      'cleanup_device_metric_pings',
      '0 3 * * *',
      $cron$SELECT public.cleanup_device_metric_pings();$cron$
    );
  END IF;

  -- Job 3: cleanup_pair_claim_rate_events ogni 30 minuti
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_pair_claim_rate_events') THEN
    PERFORM cron.schedule(
      'cleanup_pair_claim_rate_events',
      '*/30 * * * *',
      $cron$SELECT public.cleanup_pair_claim_rate_events();$cron$
    );
  END IF;

  -- Job 4: cleanup edge_function_rate_events (creata sotto) ogni 30 minuti
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_edge_function_rate_events') THEN
    PERFORM cron.schedule(
      'cleanup_edge_function_rate_events',
      '*/30 * * * *',
      $cron$DELETE FROM public.edge_function_rate_events WHERE created_at < now() - interval '1 hour';$cron$
    );
  END IF;
END $$;

-- ── 4) AU-05: tabella + RPC rate-limit generale per Edge Functions ────────
-- Estende il pattern di pair_claim_rate_events a piu' Edge Functions:
-- room-device-upload-init, remote-control-dispatch, e altre future.
CREATE TABLE IF NOT EXISTS public.edge_function_rate_events (
  id          BIGSERIAL PRIMARY KEY,
  ip_hash     TEXT        NOT NULL,
  scope       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_edge_function_rate_events_lookup
  ON public.edge_function_rate_events (scope, ip_hash, created_at DESC);

ALTER TABLE public.edge_function_rate_events ENABLE ROW LEVEL SECURITY;
-- Nessuna policy: solo service_role accede via RPC SECURITY DEFINER.

CREATE OR REPLACE FUNCTION public.check_and_record_edge_rate(
  p_ip_hash         TEXT,
  p_scope           TEXT,
  p_max_per_window  INTEGER,
  p_window_minutes  INTEGER
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_window_start  TIMESTAMPTZ;
  v_count         INTEGER;
BEGIN
  IF p_ip_hash IS NULL OR p_ip_hash = '' THEN
    RAISE EXCEPTION 'invalid_ip_hash' USING ERRCODE = 'check_violation';
  END IF;
  IF p_scope IS NULL OR p_scope = '' THEN
    RAISE EXCEPTION 'invalid_scope' USING ERRCODE = 'check_violation';
  END IF;
  IF p_max_per_window IS NULL OR p_max_per_window <= 0 THEN
    RAISE EXCEPTION 'invalid_max' USING ERRCODE = 'check_violation';
  END IF;
  IF p_window_minutes IS NULL OR p_window_minutes <= 0 THEN
    RAISE EXCEPTION 'invalid_window' USING ERRCODE = 'check_violation';
  END IF;

  v_window_start := now() - make_interval(mins => p_window_minutes);

  -- Conta richieste recenti per (scope, ip_hash)
  SELECT count(*) INTO v_count
  FROM public.edge_function_rate_events
  WHERE scope = p_scope
    AND ip_hash = p_ip_hash
    AND created_at >= v_window_start;

  IF v_count >= p_max_per_window THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'count', v_count,
      'limit', p_max_per_window,
      'window_minutes', p_window_minutes
    );
  END IF;

  -- Registra il nuovo accesso (anche in caso di success: cosi' il counter resta consistente)
  INSERT INTO public.edge_function_rate_events (ip_hash, scope)
  VALUES (p_ip_hash, p_scope);

  RETURN jsonb_build_object(
    'allowed', true,
    'count', v_count + 1,
    'limit', p_max_per_window,
    'window_minutes', p_window_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_record_edge_rate(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_record_edge_rate(TEXT, TEXT, INTEGER, INTEGER) TO service_role;
COMMENT ON FUNCTION public.check_and_record_edge_rate(TEXT, TEXT, INTEGER, INTEGER) IS
  'Audit-fix AU-05 (2026-04-18): rate limit atomico generale per Edge Functions device-anonime.';

-- ── 5) AU-03: hardening SET search_path su SECURITY DEFINER public.* ──────
-- Antepone pg_catalog a tutti i search_path per prevenire schema hijacking
-- (utente crea schema con stesso nome di una funzione/tipo built-in,
-- shadowing temporaneo durante l'esecuzione del SECURITY DEFINER body).
--
-- Mantiene gli schemi secondari gia' presenti nel setting (extensions,
-- realtime, auth) cosi' le funzioni che li usano non si rompono.
DO $$
DECLARE
  r          RECORD;
  cur_path   TEXT;
  new_path   TEXT;
  has_ext    BOOLEAN;
  has_rt     BOOLEAN;
  has_auth   BOOLEAN;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           n.nspname,
           pg_get_function_identity_arguments(p.oid) AS args,
           array_to_string(
             ARRAY(SELECT c FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'),
             ','
           ) AS current_path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    cur_path := COALESCE(r.current_path, '');

    -- Skip se gia' inizia con pg_catalog (hardened)
    IF position('pg_catalog' in cur_path) > 0
       AND position('pg_catalog' in cur_path) < 25
    THEN
      CONTINUE;
    END IF;

    has_ext  := position('extensions' in cur_path) > 0;
    has_rt   := position('realtime' in cur_path) > 0;
    has_auth := position('auth' in cur_path) > 0;

    new_path := 'pg_catalog, public';
    IF has_ext  THEN new_path := new_path || ', extensions'; END IF;
    IF has_rt   THEN new_path := new_path || ', realtime';   END IF;
    IF has_auth THEN new_path := new_path || ', auth';       END IF;
    new_path := new_path || ', pg_temp';

    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = %s',
      r.nspname, r.proname, r.args, new_path
    );
  END LOOP;
END $$;

-- ── 6) Verifica finale (info-only, idempotente) ───────────────────────────
DO $$
DECLARE
  v_unhardened_count INTEGER;
BEGIN
  SELECT count(*) INTO v_unhardened_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef = true
    AND NOT EXISTS (
      SELECT 1 FROM unnest(p.proconfig) c
      WHERE c LIKE 'search_path=pg_catalog%'
    );
  RAISE NOTICE 'AU-03 hardening: % SECURITY DEFINER functions still unhardened in public.', v_unhardened_count;
END $$;
