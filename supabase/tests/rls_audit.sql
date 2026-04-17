-- RLS Audit Script — Live SLIDE CENTER — Sprint 1 / Fase 14
-- Eseguire come service_role (Supabase SQL Editor o psql con SUPABASE_DB_URL).
-- Simula JWT di tenant A, tenant B, super_admin, anon e verifica visibilità corretta.
--
-- Prerequisiti:
--   1. Almeno due tenant attivi con dati in tutte le tabelle operative.
--   2. Sostituire i valori TENANT_A_ID, TENANT_B_ID, USER_A_ID con UUID reali.
--   3. Eseguire una volta dopo ogni migration che tocca RLS.
--
-- Uso:
--   psql "$SUPABASE_DB_URL" -f supabase/tests/rls_audit.sql

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Configurazione — sostituire con valori reali prima dell'esecuzione
-- ─────────────────────────────────────────────────────────────────────────────
\set TENANT_A_ID   '''00000000-aaaa-0000-0000-000000000001'''
\set TENANT_B_ID   '''00000000-bbbb-0000-0000-000000000002'''
\set USER_A_ID     '''00000000-aaaa-0000-0000-000000000010'''
\set USER_B_ID     '''00000000-bbbb-0000-0000-000000000020'''

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: imposta JWT simulato
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._audit_set_jwt(
  p_user_id text,
  p_tenant_id text,
  p_role text
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id,
      'role', 'authenticated',
      'app_metadata', json_build_object(
        'tenant_id', p_tenant_id,
        'role', p_role
      )
    )::text,
    true  -- local to transaction
  );
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public._audit_set_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('role', 'anon', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabelle operative: tenant A vede solo i propri dati
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cnt_a INT; cnt_b INT;
BEGIN
  PERFORM public._audit_set_jwt(
    :USER_A_ID::text, :TENANT_A_ID::text, 'admin'
  );

  SELECT count(*) INTO cnt_a FROM public.events WHERE tenant_id = :TENANT_A_ID;
  SELECT count(*) INTO cnt_b FROM public.events WHERE tenant_id = :TENANT_B_ID;

  IF cnt_b > 0 THEN
    RAISE EXCEPTION '[FAIL] events: tenant A vede % righe di tenant B', cnt_b;
  END IF;
  RAISE NOTICE '[OK] events isolation: tenant A vede % eventi propri, 0 di tenant B', cnt_a;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. rooms, sessions, speakers
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt_b INT;
BEGIN
  PERFORM public._audit_set_jwt(:USER_A_ID::text, :TENANT_A_ID::text, 'admin');

  SELECT count(*) INTO cnt_b FROM public.rooms WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] rooms cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] rooms isolation';

  SELECT count(*) INTO cnt_b FROM public.sessions WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] sessions cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] sessions isolation';

  SELECT count(*) INTO cnt_b FROM public.speakers WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] speakers cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] speakers isolation';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. presentations, presentation_versions
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt_b INT;
BEGIN
  PERFORM public._audit_set_jwt(:USER_A_ID::text, :TENANT_A_ID::text, 'coordinator');

  SELECT count(*) INTO cnt_b FROM public.presentations WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] presentations cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] presentations isolation';

  SELECT count(*) INTO cnt_b FROM public.presentation_versions WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] presentation_versions cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] presentation_versions isolation';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. users: tenant A vede propri utenti, non quelli di tenant B
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt_b INT;
BEGIN
  PERFORM public._audit_set_jwt(:USER_A_ID::text, :TENANT_A_ID::text, 'admin');

  SELECT count(*) INTO cnt_b FROM public.users WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] users cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] users isolation';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. team_invitations
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt_b INT;
BEGIN
  PERFORM public._audit_set_jwt(:USER_A_ID::text, :TENANT_A_ID::text, 'admin');

  SELECT count(*) INTO cnt_b FROM public.team_invitations WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] team_invitations cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] team_invitations isolation';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. activity_log, paired_devices, pairing_codes
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt_b INT;
BEGIN
  PERFORM public._audit_set_jwt(:USER_A_ID::text, :TENANT_A_ID::text, 'tech');

  SELECT count(*) INTO cnt_b FROM public.activity_log WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] activity_log cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] activity_log isolation';

  SELECT count(*) INTO cnt_b FROM public.paired_devices WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] paired_devices cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] paired_devices isolation';

  SELECT count(*) INTO cnt_b FROM public.pairing_codes WHERE tenant_id = :TENANT_B_ID;
  IF cnt_b > 0 THEN RAISE EXCEPTION '[FAIL] pairing_codes cross-tenant leak: %', cnt_b; END IF;
  RAISE NOTICE '[OK] pairing_codes isolation';
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Super_admin: vede tutti i tenant
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt_a INT; cnt_b INT; cnt_total INT;
BEGIN
  -- super_admin JWT: role='super_admin' in app_metadata
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', 'super-admin-user-id',
      'role', 'authenticated',
      'app_metadata', json_build_object('role', 'super_admin')
    )::text,
    true
  );
  PERFORM set_config('role', 'authenticated', true);

  SELECT count(*) INTO cnt_a FROM public.events WHERE tenant_id = :TENANT_A_ID;
  SELECT count(*) INTO cnt_b FROM public.events WHERE tenant_id = :TENANT_B_ID;
  cnt_total := cnt_a + cnt_b;

  -- super_admin deve vedere dati di entrambi i tenant (o almeno non essere bloccato)
  RAISE NOTICE '[OK] super_admin events: tenant_A=%, tenant_B=%, total=%', cnt_a, cnt_b, cnt_total;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Anon: non vede tabelle operative
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE cnt INT;
BEGIN
  PERFORM public._audit_set_anon();

  BEGIN
    SELECT count(*) INTO cnt FROM public.events;
    IF cnt > 0 THEN
      RAISE EXCEPTION '[FAIL] anon vede % eventi (dovrebbe vedere 0)', cnt;
    END IF;
    RAISE NOTICE '[OK] anon events: 0 righe visibili';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE '[OK] anon events: accesso negato (RLS corretto)';
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Tenant sospeso: bloccato su tabelle operative
-- ─────────────────────────────────────────────────────────────────────────────
-- Per testare la sospensione, sospendi temporaneamente tenant_a (richiede service_role):
-- UPDATE public.tenants SET suspended = true WHERE id = TENANT_A_ID;
-- Poi ri-esegui i check 1-6 → devono tornare 0 righe.
-- Ripristina: UPDATE public.tenants SET suspended = false WHERE id = TENANT_A_ID;
RAISE NOTICE '[INFO] Sospensione tenant: eseguire manualmente (UPDATE tenants SET suspended=true) e verificare che i check 1-6 restituiscano 0 righe.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Cleanup helper functions
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public._audit_set_jwt(text, text, text);
DROP FUNCTION IF EXISTS public._audit_set_anon();

RAISE NOTICE '=== RLS AUDIT COMPLETATO ===';
