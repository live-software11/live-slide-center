-- Sprint 6 — Onboarding wizard primo accesso + demo seed data + healthcheck.
-- Contenuti:
--  1) tenants.onboarded_at (TIMESTAMPTZ nullable): NULL = mai onboardato → wizard auto-trigger
--  2) RPC mark_tenant_onboarded(): admin self-call per chiudere wizard (anche skip)
--  3) RPC reset_tenant_onboarding(): admin self-call per riaprire wizard
--  4) RPC seed_demo_data(): genera 1 evento demo + 2 sale + 4 sessioni + 4 relatori marcati settings.demo='true'
--      (idempotente: se già esiste evento demo per il tenant, restituisce il suo id senza duplicare)
--  5) RPC clear_demo_data(): cancella tutti gli eventi marcati settings.demo='true' del tenant
--  6) RPC tenant_health(): SECURITY DEFINER con counter veloci per /admin/health (super-admin only)
-- Tutte le RPC: SECURITY DEFINER, search_path=public, GRANT a authenticated, gating su ruolo via has_tenant_admin_role().

-- ── 1. Colonna onboarded_at (idempotente) ────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tenants.onboarded_at IS
  'Sprint 6: NULL = wizard onboarding non completato (UI auto-trigger). UPDATE da mark_tenant_onboarded().';

-- ── 2. mark_tenant_onboarded(): chiude wizard per il tenant del JWT ──────
-- Solo admin del tenant: blocca tech/coordinator (anche se in tenant valido) e super_admin (no auto-onboard).
CREATE OR REPLACE FUNCTION public.mark_tenant_onboarded()
  RETURNS TIMESTAMPTZ
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_now    TIMESTAMPTZ := now();
BEGIN
  v_tenant := public.app_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (auth.jwt()->>'sub')::uuid
      AND u.tenant_id = v_tenant
      AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenants
     SET onboarded_at = COALESCE(onboarded_at, v_now),
         updated_at = v_now
   WHERE id = v_tenant
   RETURNING onboarded_at INTO v_now;
  RETURN v_now;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_tenant_onboarded() TO authenticated;

-- ── 3. reset_tenant_onboarding(): riapre wizard per il tenant ────────────
-- Solo admin: utile per Settings "Riapri tour".
CREATE OR REPLACE FUNCTION public.reset_tenant_onboarding()
  RETURNS VOID
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := public.app_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (auth.jwt()->>'sub')::uuid
      AND u.tenant_id = v_tenant
      AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.tenants
     SET onboarded_at = NULL,
         updated_at = now()
   WHERE id = v_tenant;
END;
$$;
GRANT EXECUTE ON FUNCTION public.reset_tenant_onboarding() TO authenticated;

-- ── 4. seed_demo_data(): crea evento demo + sale + sessioni + relatori ───
-- Idempotente: se gia' esiste evento con settings->>'demo' = 'true' lo riusa.
-- Restituisce JSONB { event_id, rooms, sessions, speakers, created (true|false) }.
-- Le presentation_versions NON vengono create (richiede storage upload reale).
-- Le presentations vengono create in stato 'pending' (placeholder).
CREATE OR REPLACE FUNCTION public.seed_demo_data()
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_user   UUID;
  v_event_id UUID;
  v_room_a UUID;
  v_room_b UUID;
  v_session_a1 UUID;
  v_session_a2 UUID;
  v_session_b1 UUID;
  v_session_b2 UUID;
  v_speaker_count INT := 0;
  v_room_count INT := 0;
  v_session_count INT := 0;
  v_existing UUID;
  v_today DATE := current_date;
BEGIN
  v_tenant := public.app_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
  END IF;
  v_user := (auth.jwt()->>'sub')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = v_user
      AND u.tenant_id = v_tenant
      AND u.role IN ('admin', 'coordinator')
  ) THEN
    RAISE EXCEPTION 'forbidden_admin_or_coordinator_only' USING ERRCODE = '42501';
  END IF;

  -- Idempotenza: se gia' esiste evento demo, ritorna il suo id senza creare nulla.
  SELECT id INTO v_existing
    FROM public.events
   WHERE tenant_id = v_tenant
     AND settings->>'demo' = 'true'
   ORDER BY created_at ASC
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'event_id', v_existing,
      'created', false,
      'message', 'demo_already_exists'
    );
  END IF;

  -- Cap quota: blocca se gia' al max_events_per_month per il mese corrente.
  -- (consente al wizard di proporre solo "skip" se non si puo' creare)
  IF EXISTS (
    SELECT 1 FROM public.tenants t
     WHERE t.id = v_tenant
       AND t.max_events_per_month <> 0  -- 0 = unlimited (enterprise)
       AND (
         SELECT count(*) FROM public.events e
          WHERE e.tenant_id = v_tenant
            AND date_trunc('month', e.start_date) = date_trunc('month', v_today)
       ) >= t.max_events_per_month
  ) THEN
    RAISE EXCEPTION 'quota_events_per_month_exceeded' USING ERRCODE = '53400';
  END IF;

  -- Evento demo (3 giorni).
  INSERT INTO public.events (
    tenant_id, name, name_en, location, venue, start_date, end_date, status, settings, created_by
  ) VALUES (
    v_tenant,
    'Conferenza Demo 2026',
    'Demo Conference 2026',
    'Roma, Italia',
    'Auditorium Esempio',
    v_today,
    v_today + INTERVAL '2 days',
    'setup',
    '{"demo": "true", "demo_version": "1"}'::jsonb,
    v_user
  ) RETURNING id INTO v_event_id;

  -- 2 sale.
  INSERT INTO public.rooms (event_id, tenant_id, name, name_en, floor, capacity, display_order, room_type)
  VALUES
    (v_event_id, v_tenant, 'Sala Plenaria',  'Plenary Hall',  'Piano Terra', 200, 0, 'main'),
    (v_event_id, v_tenant, 'Sala Workshop',  'Workshop Room', 'Piano 1',      80, 1, 'breakout')
  RETURNING id INTO v_room_a;
  -- Recupero entrambi.
  SELECT id INTO v_room_a FROM public.rooms WHERE event_id = v_event_id AND display_order = 0;
  SELECT id INTO v_room_b FROM public.rooms WHERE event_id = v_event_id AND display_order = 1;
  v_room_count := 2;

  -- 4 sessioni (2 per sala) con orari realistici giorno 1.
  INSERT INTO public.sessions (room_id, event_id, tenant_id, title, title_en, session_type,
                                scheduled_start, scheduled_end, display_order, chair_name)
  VALUES
    (v_room_a, v_event_id, v_tenant, 'Apertura ufficiale',     'Opening Keynote',
      'ceremony', (v_today::timestamp + interval '9 hours'),  (v_today::timestamp + interval '10 hours'), 0, 'Marco Bianchi'),
    (v_room_a, v_event_id, v_tenant, 'Tavola rotonda esperti', 'Expert Panel',
      'panel',   (v_today::timestamp + interval '10 hours'), (v_today::timestamp + interval '11 hours 30 minutes'), 1, NULL),
    (v_room_b, v_event_id, v_tenant, 'Workshop pratico',       'Hands-on Workshop',
      'workshop',(v_today::timestamp + interval '14 hours'), (v_today::timestamp + interval '16 hours'), 0, NULL),
    (v_room_b, v_event_id, v_tenant, 'Sessione domande',       'Q&A Session',
      'talk',    (v_today::timestamp + interval '16 hours 30 minutes'), (v_today::timestamp + interval '17 hours 30 minutes'), 1, NULL);
  v_session_count := 4;

  SELECT id INTO v_session_a1 FROM public.sessions WHERE event_id = v_event_id AND room_id = v_room_a AND display_order = 0;
  SELECT id INTO v_session_a2 FROM public.sessions WHERE event_id = v_event_id AND room_id = v_room_a AND display_order = 1;
  SELECT id INTO v_session_b1 FROM public.sessions WHERE event_id = v_event_id AND room_id = v_room_b AND display_order = 0;
  SELECT id INTO v_session_b2 FROM public.sessions WHERE event_id = v_event_id AND room_id = v_room_b AND display_order = 1;

  -- 4 relatori demo (1 per sessione).
  INSERT INTO public.speakers (session_id, event_id, tenant_id, full_name, email, company, job_title, display_order)
  VALUES
    (v_session_a1, v_event_id, v_tenant, 'Anna Rossi',     'anna.rossi@demo.example',     'Acme S.p.A.',   'Direttrice Innovazione', 0),
    (v_session_a2, v_event_id, v_tenant, 'Luca Esposito',  'luca.esposito@demo.example',  'Beta SRL',      'CTO',                    0),
    (v_session_b1, v_event_id, v_tenant, 'Chiara Verdi',   'chiara.verdi@demo.example',   'Gamma Studios', 'Lead Designer',          0),
    (v_session_b2, v_event_id, v_tenant, 'Davide Neri',    'davide.neri@demo.example',    'Delta Labs',    'Researcher',             0);
  v_speaker_count := 4;

  -- 4 presentations placeholder (status 'pending' senza versions, simulano speaker da invitare).
  INSERT INTO public.presentations (speaker_id, session_id, event_id, tenant_id, total_versions, status)
  SELECT s.id, s.session_id, s.event_id, s.tenant_id, 0, 'pending'
    FROM public.speakers s
   WHERE s.event_id = v_event_id;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'rooms', v_room_count,
    'sessions', v_session_count,
    'speakers', v_speaker_count,
    'presentations', v_speaker_count,
    'created', true
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.seed_demo_data() TO authenticated;

-- ── 5. clear_demo_data(): cancella eventi marcati demo del tenant ────────
-- Cascade: rooms/sessions/speakers/presentations/presentation_versions.
-- NON azzera storage_used_bytes perche' demo non crea version reali (no upload).
CREATE OR REPLACE FUNCTION public.clear_demo_data()
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
  v_deleted INT := 0;
BEGIN
  v_tenant := public.app_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (auth.jwt()->>'sub')::uuid
      AND u.tenant_id = v_tenant
      AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
  END IF;
  WITH del AS (
    DELETE FROM public.events
     WHERE tenant_id = v_tenant
       AND settings->>'demo' = 'true'
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;
  RETURN jsonb_build_object('deleted_events', v_deleted);
END;
$$;
GRANT EXECUTE ON FUNCTION public.clear_demo_data() TO authenticated;

-- ── 6. tenant_health(): counter veloci per /admin/health ─────────────────
-- Solo super_admin (via JWT app_metadata.role).
-- Non legge dati tenant-isolated, usa solo aggregati globali (count, max).
CREATE OR REPLACE FUNCTION public.tenant_health()
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_total_tenants INT;
  v_active_tenants INT;
  v_suspended INT;
  v_total_events INT;
  v_active_events INT;
  v_total_users INT;
  v_recent_signups INT;
  v_db_size_mb NUMERIC;
BEGIN
  v_role := (auth.jwt()->>'app_metadata')::jsonb->>'role';
  IF v_role IS NULL OR v_role <> 'super_admin' THEN
    RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT count(*) INTO v_total_tenants FROM public.tenants;
  SELECT count(*) INTO v_active_tenants FROM public.tenants WHERE COALESCE(suspended, false) = false;
  SELECT count(*) INTO v_suspended FROM public.tenants WHERE COALESCE(suspended, false) = true;
  SELECT count(*) INTO v_total_events FROM public.events;
  SELECT count(*) INTO v_active_events FROM public.events WHERE status IN ('setup', 'active');
  SELECT count(*) INTO v_total_users FROM public.users;
  SELECT count(*) INTO v_recent_signups FROM public.users WHERE created_at >= now() - interval '7 days';
  SELECT (pg_database_size(current_database()) / 1024.0 / 1024.0)::NUMERIC(12, 2) INTO v_db_size_mb;

  RETURN jsonb_build_object(
    'tenants_total', v_total_tenants,
    'tenants_active', v_active_tenants,
    'tenants_suspended', v_suspended,
    'events_total', v_total_events,
    'events_active', v_active_events,
    'users_total', v_total_users,
    'users_signups_7d', v_recent_signups,
    'db_size_mb', v_db_size_mb,
    'as_of', now()
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_health() TO authenticated;

COMMENT ON FUNCTION public.mark_tenant_onboarded() IS 'Sprint 6: chiude wizard onboarding (admin only).';
COMMENT ON FUNCTION public.reset_tenant_onboarding() IS 'Sprint 6: riapre wizard onboarding (admin only).';
COMMENT ON FUNCTION public.seed_demo_data() IS 'Sprint 6: crea 1 evento + 2 sale + 4 sessioni + 4 relatori demo (idempotente).';
COMMENT ON FUNCTION public.clear_demo_data() IS 'Sprint 6: cancella eventi demo del tenant (admin only).';
COMMENT ON FUNCTION public.tenant_health() IS 'Sprint 6: counter aggregati per /admin/health (super_admin only).';
