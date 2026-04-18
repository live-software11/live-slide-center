-- =============================================================================
-- Sprint T-2 (GAP G9) — Telemetria perf live PC sala (CPU/RAM/disco) NON aggregata
-- =============================================================================
-- Obiettivo sovrano: l'admin in centro slide deve sapere "a colpo d'occhio" se
-- ognuno dei suoi PC sala (5 / 12 / 30 device per evento) sta soffrendo —
-- prima che il pubblico veda lag, freeze o blackout durante la proiezione.
--
-- Modello dati:
--   tabella append-only `device_metric_pings`. Una riga per ogni ping del PC
--   sala (piggyback su `room-player-bootstrap` ogni 5/12/60s a seconda del
--   `playback_mode`). Retention 24h via cron giornaliero (cleanup_device_pings).
--
-- Privacy/sovrano #2 ("file partono SEMPRE da locale"):
--   - i metric pings NON contengono path file ne' contenuto, solo aggregati
--     numerici (% CPU, MB heap, fps, etc.).
--   - i campi sono opzionali nullable: il PC sala invia SOLO le metriche che
--     puo' misurare (browser != desktop). Es: in PWA browser non ho cpu_pct
--     reale (sandbox), ma ho js_heap_used_pct e storage_quota_used_pct.
--
-- Volume stimato:
--   evento medio = 12 PC sala × 1 ping/12s × 8h = 28.800 righe/evento.
--   evento grande = 30 PC sala × 1 ping/5s (turbo) × 8h = 172.800 righe/evento.
--   Con retention 24h e indice (device_id, ts DESC) il footprint resta < 50 MB
--   anche con 5 eventi paralleli su tenant Enterprise.
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Tabella device_metric_pings
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_metric_pings (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.paired_devices(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Source: 'browser' (PWA / Tab cloud) o 'desktop' (Tauri Rust con sysinfo).
  -- Determina quali colonne sono popolate (browser non ha cpu_pct reale).
  source TEXT NOT NULL CHECK (source IN ('browser', 'desktop')),

  -- Browser-side metrics (sempre nullable: dipendono da browser/permessi).
  -- ─────────────────────────────────────────────────────────────────────
  -- Heap JS (Chrome only, performance.memory). 0..100.
  js_heap_used_pct NUMERIC(5, 2),
  -- Heap JS in MB. Nice-to-have per troubleshooting.
  js_heap_used_mb NUMERIC(10, 2),
  -- Quota storage Cache API + IndexedDB + OPFS (navigator.storage.estimate).
  -- Sovrano #2: questa e' la quota DEL BROWSER (sandboxed), non del disco
  -- del PC. Tipicamente Chrome alloca 60% del disco libero come quota.
  storage_quota_used_pct NUMERIC(5, 2),
  storage_quota_used_mb NUMERIC(10, 2),
  -- Frame rate stimato (rAF EMA ultimi 5s). Indica se la UI sta freezando.
  fps NUMERIC(5, 2),
  -- Network info (navigator.connection). 'wifi', '4g', '5g', 'ethernet', etc.
  network_type TEXT,
  network_downlink_mbps NUMERIC(8, 2),
  -- Battery API (laptop in sala). Se non in carica e <15%, alert.
  battery_pct NUMERIC(5, 2),
  battery_charging BOOLEAN,
  -- Tab visibility (document.visibilityState). Se PC sala e' 'hidden' a meta'
  -- evento → admin deve saperlo (qualcuno ha minimizzato il browser?).
  visibility TEXT CHECK (visibility IS NULL OR visibility IN ('visible', 'hidden')),

  -- Desktop-side metrics (Tauri + sysinfo, future Sprint Q hybrid sync).
  -- Per ora nullable: il collector desktop arrivera' in fase 2 di T-2.
  -- ─────────────────────────────────────────────────────────────────────
  cpu_pct NUMERIC(5, 2),
  ram_used_pct NUMERIC(5, 2),
  ram_used_mb NUMERIC(10, 2),
  -- Disk free % della partition che ospita la cartella sync (handle FS Access
  -- in browser → no info; in desktop Tauri → metric reale).
  disk_free_pct NUMERIC(5, 2),
  disk_free_gb NUMERIC(10, 2),

  -- Common metrics (sempre disponibili).
  -- ─────────────────────────────────────────────────────────────────────
  -- Uptime app (Date.now() - performance.timeOrigin in ms / 1000).
  app_uptime_sec INTEGER,
  -- Modalita' playback corrente del PC sala. Aiuta a correlare alert
  -- (es: heap alto SOLO in turbo perche' 3 download paralleli).
  playback_mode TEXT CHECK (playback_mode IS NULL OR playback_mode IN ('auto', 'live', 'turbo')),
  -- Ruolo device snapshot al ping (room | control_center). I CC tendono ad
  -- avere heap piu' alto perche' tracciano N sale.
  device_role TEXT CHECK (device_role IS NULL OR device_role IN ('room', 'control_center')),

  -- Sentinella anti-flood (rate limit soft 1 ping ogni 5s per device).
  -- Implementata come constraint nella RPC ingest, NON qui (sennò rifiuta
  -- ping legittimi durante turbo che pollerebbe ogni 5s preciso).

  CONSTRAINT chk_pct_ranges CHECK (
    (js_heap_used_pct IS NULL OR (js_heap_used_pct >= 0 AND js_heap_used_pct <= 100)) AND
    (storage_quota_used_pct IS NULL OR (storage_quota_used_pct >= 0 AND storage_quota_used_pct <= 100)) AND
    (cpu_pct IS NULL OR (cpu_pct >= 0 AND cpu_pct <= 100)) AND
    (ram_used_pct IS NULL OR (ram_used_pct >= 0 AND ram_used_pct <= 100)) AND
    (disk_free_pct IS NULL OR (disk_free_pct >= 0 AND disk_free_pct <= 100)) AND
    (battery_pct IS NULL OR (battery_pct >= 0 AND battery_pct <= 100)) AND
    (fps IS NULL OR (fps >= 0 AND fps <= 240))
  )
);

COMMENT ON TABLE public.device_metric_pings IS
  'Sprint T-2 (G9): heartbeat metric ping append-only per PC sala. Retention 24h.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Indici hot-path
-- ────────────────────────────────────────────────────────────────────────────
-- Ultimo ping per device (admin dashboard live perf widget).
CREATE INDEX IF NOT EXISTS idx_device_metric_pings_device_ts
  ON public.device_metric_pings(device_id, ts DESC);

-- Range query "ultimi N min per evento" (sparkline LivePerfTelemetryPanel).
CREATE INDEX IF NOT EXISTS idx_device_metric_pings_event_ts
  ON public.device_metric_pings(event_id, ts DESC)
  WHERE event_id IS NOT NULL;

-- Cleanup retention.
CREATE INDEX IF NOT EXISTS idx_device_metric_pings_ts
  ON public.device_metric_pings(ts);

COMMENT ON INDEX public.idx_device_metric_pings_device_ts IS
  'Hot path: SELECT ultimo ping per device (Sprint T-2 widget LivePerfTelemetryPanel).';
COMMENT ON INDEX public.idx_device_metric_pings_event_ts IS
  'Hot path: range "ultimi 30 min" per tutti i device dell evento (Sprint T-2 sparkline).';
COMMENT ON INDEX public.idx_device_metric_pings_ts IS
  'Cleanup retention 24h via cron daily (Sprint T-2).';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) RLS — solo admin del tenant puo' leggere; INSERT solo via SECURITY DEFINER
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.device_metric_pings ENABLE ROW LEVEL SECURITY;

-- SELECT: solo super_admin OPPURE admin/tech del tenant proprietario.
DROP POLICY IF EXISTS "device_metric_pings_select" ON public.device_metric_pings;
CREATE POLICY "device_metric_pings_select" ON public.device_metric_pings
  FOR SELECT
  USING (
    public.is_super_admin()
    OR (
      tenant_id = public.app_tenant_id()
      AND public.app_user_role() IN ('admin', 'tech')
    )
  );

-- INSERT: nessuno (anon o auth). Solo via RPC SECURITY DEFINER record_device_metric_ping.
-- Niente policy → INSERT bloccato per default a tutti gli utenti.

-- UPDATE/DELETE: nessuno. Solo cleanup_device_pings (SECURITY DEFINER) tramite
-- delete BY ts. Niente policy → bloccato by default.

-- ────────────────────────────────────────────────────────────────────────────
-- 4) RPC record_device_metric_ping — chiamata da room-player-bootstrap
-- ────────────────────────────────────────────────────────────────────────────
-- NB: questa RPC e' chiamata dall'Edge Function `room-player-bootstrap` con
-- service_role, dopo aver gia' validato il device_token. Quindi:
--   - non riautentica
--   - accetta device_id direttamente (gia' verificato)
--   - rate-limit soft: se l'ultimo ping ha ts > now()-3s, NO-OP
--     (evita flood se PC sala bugga e chiama bootstrap a 1Hz)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_device_metric_ping(
  p_device_id UUID,
  p_payload JSONB
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_device RECORD;
  v_last_ts TIMESTAMPTZ;
BEGIN
  -- 1. Lookup device per estrarre tenant/event/room (sempre allineato al
  --    pairing corrente: se admin sposta device a sala B, i ping vanno
  --    automaticamente associati a B dal prossimo ping in poi).
  SELECT id, tenant_id, event_id, room_id, role
    INTO v_device
    FROM public.paired_devices
   WHERE id = p_device_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_not_found');
  END IF;

  -- 2. Rate-limit anti-flood: se l'ultimo ping e' < 3s, ignoramo.
  --    NB: usiamo l'indice idx_device_metric_pings_device_ts → O(log n).
  SELECT ts INTO v_last_ts
    FROM public.device_metric_pings
   WHERE device_id = p_device_id
   ORDER BY ts DESC
   LIMIT 1;

  IF v_last_ts IS NOT NULL AND v_last_ts > now() - INTERVAL '3 seconds' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'rate_limited');
  END IF;

  -- 3. INSERT con CAST sicuro: i campi sono tutti NULLABLE, quindi se il
  --    payload non ha la chiave o ha null, finisce a NULL e basta.
  --    I CHECK constraint sui range gia' bloccano valori folli.
  INSERT INTO public.device_metric_pings (
    tenant_id, device_id, event_id, room_id, source,
    js_heap_used_pct, js_heap_used_mb,
    storage_quota_used_pct, storage_quota_used_mb,
    fps, network_type, network_downlink_mbps,
    battery_pct, battery_charging, visibility,
    cpu_pct, ram_used_pct, ram_used_mb,
    disk_free_pct, disk_free_gb,
    app_uptime_sec, playback_mode, device_role
  ) VALUES (
    v_device.tenant_id, v_device.id, v_device.event_id, v_device.room_id,
    COALESCE(NULLIF(p_payload ->> 'source', ''), 'browser'),
    NULLIF(p_payload ->> 'js_heap_used_pct', '')::NUMERIC,
    NULLIF(p_payload ->> 'js_heap_used_mb', '')::NUMERIC,
    NULLIF(p_payload ->> 'storage_quota_used_pct', '')::NUMERIC,
    NULLIF(p_payload ->> 'storage_quota_used_mb', '')::NUMERIC,
    NULLIF(p_payload ->> 'fps', '')::NUMERIC,
    NULLIF(p_payload ->> 'network_type', ''),
    NULLIF(p_payload ->> 'network_downlink_mbps', '')::NUMERIC,
    NULLIF(p_payload ->> 'battery_pct', '')::NUMERIC,
    CASE WHEN p_payload ? 'battery_charging' THEN (p_payload ->> 'battery_charging')::BOOLEAN ELSE NULL END,
    NULLIF(p_payload ->> 'visibility', ''),
    NULLIF(p_payload ->> 'cpu_pct', '')::NUMERIC,
    NULLIF(p_payload ->> 'ram_used_pct', '')::NUMERIC,
    NULLIF(p_payload ->> 'ram_used_mb', '')::NUMERIC,
    NULLIF(p_payload ->> 'disk_free_pct', '')::NUMERIC,
    NULLIF(p_payload ->> 'disk_free_gb', '')::NUMERIC,
    NULLIF(p_payload ->> 'app_uptime_sec', '')::INTEGER,
    NULLIF(p_payload ->> 'playback_mode', ''),
    COALESCE(NULLIF(p_payload ->> 'device_role', ''), v_device.role)
  );

  RETURN jsonb_build_object('ok', true);
EXCEPTION
  WHEN OTHERS THEN
    -- Best-effort: una riga di telemetria persa NON deve mai bloccare il
    -- bootstrap. Logga ed esci ok (lo vedremo solo nel pg_log se grave).
    RAISE WARNING '[record_device_metric_ping] failed for device % : %', p_device_id, SQLERRM;
    RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_device_metric_ping(UUID, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.record_device_metric_ping(UUID, JSONB) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_device_metric_ping(UUID, JSONB) IS
  'Sprint T-2 (G9): ingest metric ping da room-player-bootstrap. Rate-limit 3s.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5) RPC fetch_device_metrics_for_event — admin live perf widget
-- ────────────────────────────────────────────────────────────────────────────
-- Ritorna per ogni device dell'evento: il device row + ARRAY ultimi N ping
-- (ordinati per ts DESC). Default windowMin=30, max 60.
--
-- Pattern: usiamo lateral join + LIMIT per evitare di scaricare l'intera
-- tabella (28k righe / 8h). L'indice idx_device_metric_pings_device_ts
-- copre la query in O(log n + k).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fetch_device_metrics_for_event(
  p_event_id UUID,
  p_window_min INTEGER DEFAULT 30,
  p_max_pings_per_device INTEGER DEFAULT 60
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id UUID;
  v_role TEXT;
  v_window_min INTEGER;
  v_max_pings INTEGER;
  v_result JSONB;
BEGIN
  -- 1. Auth: solo admin/tech del tenant proprietario dell'evento.
  IF NOT public.is_super_admin() THEN
    SELECT tenant_id INTO v_tenant_id
      FROM public.events
     WHERE id = p_event_id;
    IF NOT FOUND OR v_tenant_id IS NULL OR v_tenant_id <> public.app_tenant_id() THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    v_role := public.app_user_role();
    IF v_role NOT IN ('admin', 'tech') THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Clamp parametri (anti-DoS).
  v_window_min := GREATEST(1, LEAST(60, COALESCE(p_window_min, 30)));
  v_max_pings  := GREATEST(1, LEAST(200, COALESCE(p_max_pings_per_device, 60)));

  -- 3. Build response: array di {device, latest_ping, recent_pings[]}.
  --    Recente = ultime v_window_min minuti.
  WITH device_list AS (
    SELECT
      pd.id, pd.tenant_id, pd.event_id, pd.room_id, pd.device_name,
      pd.role, pd.status, pd.last_seen_at, pd.last_ip
    FROM public.paired_devices pd
    WHERE pd.event_id = p_event_id
  ),
  latest AS (
    SELECT DISTINCT ON (mp.device_id)
      mp.device_id, mp.ts AS latest_ts,
      to_jsonb(mp.*) - 'id' AS latest_row
    FROM public.device_metric_pings mp
    WHERE mp.event_id = p_event_id
      AND mp.ts >= now() - (v_window_min || ' minutes')::INTERVAL
    ORDER BY mp.device_id, mp.ts DESC
  ),
  recent AS (
    SELECT
      dl.id AS device_id,
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'ts', mp.ts,
            'cpu_pct', mp.cpu_pct,
            'ram_used_pct', mp.ram_used_pct,
            'js_heap_used_pct', mp.js_heap_used_pct,
            'storage_quota_used_pct', mp.storage_quota_used_pct,
            'disk_free_pct', mp.disk_free_pct,
            'fps', mp.fps,
            'battery_pct', mp.battery_pct,
            'battery_charging', mp.battery_charging,
            'network_type', mp.network_type,
            'visibility', mp.visibility
          ) ORDER BY mp.ts ASC)
          FROM (
            SELECT * FROM public.device_metric_pings sub
            WHERE sub.device_id = dl.id
              AND sub.ts >= now() - (v_window_min || ' minutes')::INTERVAL
            ORDER BY sub.ts DESC
            LIMIT v_max_pings
          ) mp
        ),
        '[]'::jsonb
      ) AS recent_pings
    FROM device_list dl
  )
  SELECT jsonb_agg(jsonb_build_object(
    'device', jsonb_build_object(
      'id', dl.id,
      'name', dl.device_name,
      'role', dl.role,
      'status', dl.status,
      'room_id', dl.room_id,
      'last_seen_at', dl.last_seen_at,
      'last_ip', dl.last_ip
    ),
    'latest', l.latest_row,
    'pings', r.recent_pings
  ) ORDER BY dl.device_name)
  INTO v_result
  FROM device_list dl
  LEFT JOIN latest l ON l.device_id = dl.id
  LEFT JOIN recent r ON r.device_id = dl.id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.fetch_device_metrics_for_event(UUID, INTEGER, INTEGER)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fetch_device_metrics_for_event(UUID, INTEGER, INTEGER) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.fetch_device_metrics_for_event(UUID, INTEGER, INTEGER) IS
  'Sprint T-2 (G9): per ogni device dell evento ritorna latest ping + array ultimi N ping in finestra Mmin.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Cleanup retention 24h
-- ────────────────────────────────────────────────────────────────────────────
-- Funzione idempotente. Chiamata da pg_cron OR fallback lazy nella RPC ingest
-- (se non c'e' pg_cron sull'istanza Supabase user, ogni 1000 INSERT pulisce).
CREATE OR REPLACE FUNCTION public.cleanup_device_metric_pings()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.device_metric_pings
   WHERE ts < now() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_device_metric_pings() TO service_role;
REVOKE ALL ON FUNCTION public.cleanup_device_metric_pings() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.cleanup_device_metric_pings() IS
  'Sprint T-2 (G9): retention 24h, chiamata da pg_cron daily o lazy.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7) pg_cron schedule (idempotent, no-op se pg_cron non installato)
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Idempotente: rimuove eventuale schedule precedente, poi (re)crea.
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup_device_metric_pings_daily') THEN
      PERFORM cron.unschedule('cleanup_device_metric_pings_daily');
    END IF;
    -- Schedule daily at 03:00 UTC (= 04:00/05:00 IT, fascia low-traffic).
    PERFORM cron.schedule(
      'cleanup_device_metric_pings_daily',
      '0 3 * * *',
      $cron$ SELECT public.cleanup_device_metric_pings(); $cron$
    );
  END IF;
END $$;
