-- ============================================================================
-- Sprint SR (Security Review) - Fix JWT check per cron Edge Functions
-- ============================================================================
-- PROBLEMA:
--   Le RPC `list_tenants_for_license_warning` (Sprint 7) e
--   `rpc_admin_list_expiring_desktop_devices` (Sprint SR) erano definite con
--   il check:
--     v_role := (auth.jwt()->'app_metadata'->>'role');
--     IF v_role IS NULL OR v_role <> 'super_admin' THEN RAISE EXCEPTION ...
--
--   Questo funziona quando un super_admin chiama la RPC dalla UI (il suo JWT
--   ha `app_metadata.role = 'super_admin'`), ma FALLISCE quando la cron Edge
--   Function chiama con la service_role key: il JWT del service_role contiene
--   solo `{"role":"service_role","iss":"supabase",...}` SENZA `app_metadata`,
--   quindi `v_role` resta NULL e la RPC solleva 'forbidden_super_admin_only'.
--
-- SOLUZIONE:
--   Rilassiamo il check per accettare ANCHE chiamate dirette con service_role
--   (`auth.jwt()->>'role' = 'service_role'`), oltre al super_admin via UI.
--   Le GRANT EXECUTE restano invariate (TO service_role) quindi nessuna
--   esposizione a ruoli inattesi: il check JWT diventa "or service_role".
--
-- IDEMPOTENTE: usa CREATE OR REPLACE FUNCTION; non tocca dati.
-- ============================================================================
-- ── 1. Patch list_tenants_for_license_warning ───────────────────────────────
CREATE OR REPLACE FUNCTION public.list_tenants_for_license_warning(
    p_days_min INTEGER,
    p_days_max INTEGER,
    p_email_kind TEXT
  ) RETURNS TABLE (
    tenant_id UUID,
    tenant_name TEXT,
    admin_email TEXT,
    admin_full_name TEXT,
    expires_at TIMESTAMPTZ,
    plan TEXT,
    days_remaining INTEGER
  ) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,
  public,
  pg_temp AS $$
DECLARE v_app_role TEXT;
v_jwt_role TEXT;
BEGIN v_app_role := (auth.jwt()->'app_metadata'->>'role');
v_jwt_role := (auth.jwt()->>'role');
IF (
  v_app_role IS NULL
  OR v_app_role <> 'super_admin'
)
AND (
  v_jwt_role IS NULL
  OR v_jwt_role <> 'service_role'
) THEN RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
END IF;
RETURN QUERY
SELECT t.id AS tenant_id,
  t.name AS tenant_name,
  u.email AS admin_email,
  u.full_name AS admin_full_name,
  t.expires_at,
  t.plan::text AS plan,
  EXTRACT(
    DAY
    FROM (t.expires_at - now())
  )::INT AS days_remaining
FROM public.tenants t
  INNER JOIN LATERAL (
    SELECT email,
      full_name
    FROM public.users
    WHERE tenant_id = t.id
      AND role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1
  ) u ON true
WHERE t.expires_at IS NOT NULL
  AND COALESCE(t.suspended, false) = false
  AND t.expires_at >= now() + (p_days_min || ' days')::interval
  AND t.expires_at <= now() + (p_days_max || ' days')::interval
  AND NOT EXISTS (
    SELECT 1
    FROM public.email_log el
    WHERE el.tenant_id = t.id
      AND el.kind = p_email_kind
      AND el.metadata->>'expires_at_iso' = to_char(t.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
ORDER BY t.expires_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_tenants_for_license_warning(INT, INT, TEXT) TO service_role;
COMMENT ON FUNCTION public.list_tenants_for_license_warning(INT, INT, TEXT) IS 'Sprint 7 (patched Sprint SR): scan tenant in scadenza che NON hanno ancora ' 'ricevuto email del tipo specificato. Accetta chiamate da super_admin (via UI) ' 'OR da service_role (Edge Function cron). Idempotente.';
-- ── 2. Patch rpc_admin_list_expiring_desktop_devices ────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_list_expiring_desktop_devices(
    p_days_min INTEGER,
    p_days_max INTEGER,
    p_email_kind TEXT
  ) RETURNS TABLE (
    device_id UUID,
    device_name TEXT,
    tenant_id UUID,
    tenant_name TEXT,
    admin_email TEXT,
    admin_full_name TEXT,
    pair_token_expires_at TIMESTAMPTZ,
    days_remaining INTEGER,
    machine_fingerprint TEXT
  ) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog,
  public,
  pg_temp AS $$
DECLARE v_app_role TEXT;
v_jwt_role TEXT;
BEGIN v_app_role := (auth.jwt()->'app_metadata'->>'role');
v_jwt_role := (auth.jwt()->>'role');
IF (
  v_app_role IS NULL
  OR v_app_role <> 'super_admin'
)
AND (
  v_jwt_role IS NULL
  OR v_jwt_role <> 'service_role'
) THEN RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
END IF;
RETURN QUERY
SELECT d.id AS device_id,
  d.device_name,
  t.id AS tenant_id,
  t.name AS tenant_name,
  u.email AS admin_email,
  u.full_name AS admin_full_name,
  d.pair_token_expires_at,
  EXTRACT(
    DAY
    FROM (d.pair_token_expires_at - now())
  )::INT AS days_remaining,
  d.machine_fingerprint
FROM public.desktop_devices d
  INNER JOIN public.tenants t ON t.id = d.tenant_id
  INNER JOIN LATERAL (
    SELECT email,
      full_name
    FROM public.users
    WHERE tenant_id = t.id
      AND role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1
  ) u ON true
WHERE d.status = 'active'
  AND COALESCE(t.suspended, false) = false
  AND d.pair_token_expires_at >= now() + (p_days_min || ' days')::interval
  AND d.pair_token_expires_at <= now() + (p_days_max || ' days')::interval
  AND NOT EXISTS (
    SELECT 1
    FROM public.email_log el
    WHERE el.tenant_id = t.id
      AND el.kind = p_email_kind
      AND el.metadata->>'device_id' = d.id::text
      AND el.metadata->>'pair_token_expires_at_iso' = to_char(
        d.pair_token_expires_at,
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      )
  )
ORDER BY d.pair_token_expires_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_expiring_desktop_devices(INT, INT, TEXT) TO service_role;
COMMENT ON FUNCTION public.rpc_admin_list_expiring_desktop_devices(INT, INT, TEXT) IS 'Sprint SR (patched): lista desktop_devices in scadenza non ancora notificati. ' 'Accetta chiamate da super_admin (via UI) OR da service_role (Edge Function cron).';
