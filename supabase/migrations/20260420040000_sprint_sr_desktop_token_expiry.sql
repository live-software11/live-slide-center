-- ============================================================================
-- Sprint SR (Security Review) — Rotazione automatica pair_token desktop
-- ============================================================================
-- Audit AUDIT_FINALE_E_PIANO_TEST_v1.md §1.2: il `pair_token` di
-- `desktop_devices` non aveva scadenza. Conseguenza: se un PC desktop server
-- viene rubato/smaltito senza revoca esplicita, il token resta valido a vita.
-- Mitigazione legacy: revoca manuale dal pannello admin.
--
-- Questa migration introduce:
--
--   1. Colonna `pair_token_expires_at TIMESTAMPTZ NOT NULL` (default now()+1y).
--      Backfill per record esistenti = `registered_at + 1 anno`.
--   2. Indice parziale per cron: solo righe attive ordinate per scadenza.
--   3. Modifica `rpc_consume_desktop_provision_token` (Sprint D1) per inizializzare
--      `pair_token_expires_at = now() + 1 anno` su ogni bind (incluso re-bind).
--   4. Modifica `rpc_desktop_license_verify` (Sprint D1) per:
--        - lanciare `pair_token_expired` se scaduto;
--        - includere nel JSON di risposta `pair_token_expires_at` +
--          `pair_token_expires_in_days` (≥0) + `pair_token_status` ∈
--          {ok, expiring_soon, expired_grace, expired};
--   5. RPC `rpc_desktop_renew_token(p_old, p_new)` (service_role only) per la
--      rotazione: vecchio hash → nuovo hash + `pair_token_expires_at = now()+1y`.
--      Tolleranza fino a 30 giorni dopo la scadenza per recuperare PC offline.
--   6. RPC `rpc_admin_extend_desktop_token(p_device_id, p_extra_months)` per
--      estensione manuale dal pannello admin (admin/tech del tenant).
--   7. RPC `rpc_admin_list_expiring_desktop_devices(p_days_min, p_days_max,
--      p_email_kind)` per il cron email warning, idempotente via `email_log`
--      (stesso pattern di `list_tenants_for_license_warning` Sprint 7).
--
-- IDEMPOTENTE: uso `IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`.
-- ============================================================================
-- ── 1. Colonna pair_token_expires_at + backfill ─────────────────────────────
-- Aggiunta SENZA default + backfill esplicito + ALTER NOT NULL: garantiamo
-- che i record gia' in tabella ricevano una scadenza coerente con la loro
-- registered_at (NON now() — sarebbe arbitrario). Cosi' un PC registrato
-- 6 mesi fa avra' 6 mesi residui di vita.
ALTER TABLE public.desktop_devices
ADD COLUMN IF NOT EXISTS pair_token_expires_at TIMESTAMPTZ;
UPDATE public.desktop_devices
SET pair_token_expires_at = registered_at + interval '1 year'
WHERE pair_token_expires_at IS NULL;
ALTER TABLE public.desktop_devices
ALTER COLUMN pair_token_expires_at
SET NOT NULL,
  ALTER COLUMN pair_token_expires_at
SET DEFAULT (now() + interval '1 year');
COMMENT ON COLUMN public.desktop_devices.pair_token_expires_at IS 'Sprint SR: scadenza del bearer pair_token. Default 1 anno dal bind. ' 'Renew via desktop-license-renew (auto, 7gg prima) o estensione admin. ' 'Oltre la scadenza la verifica fallisce con pair_token_expired; ' 'fino a 30gg di tolleranza il renew e'' ancora possibile per PC offline.';
-- Indice parziale: scan veloce del cron warning (solo active).
CREATE INDEX IF NOT EXISTS idx_desktop_devices_token_expiry ON public.desktop_devices(pair_token_expires_at)
WHERE status = 'active';
-- ── 2. Modifica rpc_consume_desktop_provision_token (CREATE OR REPLACE) ─────
-- Stessa firma e logica del Sprint D1; aggiungiamo solo l'inizializzazione
-- esplicita di `pair_token_expires_at = now() + 1 anno` sia sull'INSERT
-- iniziale sia sull'UPDATE in caso di re-bind con stesso machine_fingerprint
-- (re-bind = "ricomincia il conto").
CREATE OR REPLACE FUNCTION public.rpc_consume_desktop_provision_token(
    p_token TEXT,
    p_pair_token_hash TEXT,
    p_device_name TEXT DEFAULT NULL,
    p_machine_fingerprint TEXT DEFAULT NULL,
    p_app_version TEXT DEFAULT NULL,
    p_os_version TEXT DEFAULT NULL
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_token_hash TEXT;
v_provision RECORD;
v_device_id UUID;
v_now TIMESTAMPTZ := now();
v_expires_at TIMESTAMPTZ := v_now + interval '1 year';
v_tenant_plan TEXT;
v_tenant_expires TIMESTAMPTZ;
v_tenant_suspended BOOLEAN;
BEGIN IF p_token IS NULL
OR length(trim(p_token)) = 0 THEN RAISE EXCEPTION 'missing_token' USING ERRCODE = 'check_violation';
END IF;
IF p_pair_token_hash IS NULL
OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = 'check_violation';
END IF;
v_token_hash := encode(
  extensions.digest(trim(p_token), 'sha256'),
  'hex'
);
UPDATE public.desktop_provision_tokens
SET consumed_count = consumed_count + 1
WHERE token_hash = v_token_hash
  AND revoked_at IS NULL
  AND expires_at > v_now
  AND consumed_count < max_uses
RETURNING id,
  tenant_id,
  max_uses,
  consumed_count INTO v_provision;
IF NOT FOUND THEN PERFORM 1
FROM public.desktop_provision_tokens
WHERE token_hash = v_token_hash
LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'check_violation';
END IF;
PERFORM 1
FROM public.desktop_provision_tokens
WHERE token_hash = v_token_hash
  AND revoked_at IS NOT NULL
LIMIT 1;
IF FOUND THEN RAISE EXCEPTION 'token_revoked' USING ERRCODE = 'check_violation';
END IF;
PERFORM 1
FROM public.desktop_provision_tokens
WHERE token_hash = v_token_hash
  AND expires_at <= v_now
LIMIT 1;
IF FOUND THEN RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
END IF;
RAISE EXCEPTION 'token_exhausted' USING ERRCODE = 'check_violation';
END IF;
SELECT plan::text,
  expires_at,
  suspended INTO v_tenant_plan,
  v_tenant_expires,
  v_tenant_suspended
FROM public.tenants
WHERE id = v_provision.tenant_id;
IF v_tenant_suspended THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
END IF;
IF v_tenant_expires IS NOT NULL
AND v_tenant_expires <= v_now THEN RAISE EXCEPTION 'license_expired' USING ERRCODE = 'check_violation';
END IF;
BEGIN
INSERT INTO public.desktop_devices (
    tenant_id,
    device_name,
    machine_fingerprint,
    pair_token_hash,
    app_version,
    os_version,
    registered_by_user_id,
    last_verified_at,
    last_seen_at,
    pair_token_expires_at
  )
VALUES (
    v_provision.tenant_id,
    NULLIF(
      trim(COALESCE(p_device_name, 'Slide Center Server')),
      ''
    ),
    NULLIF(trim(p_machine_fingerprint), ''),
    p_pair_token_hash,
    NULLIF(trim(p_app_version), ''),
    NULLIF(trim(p_os_version), ''),
    NULL,
    v_now,
    v_now,
    v_expires_at
  )
RETURNING id INTO v_device_id;
EXCEPTION
WHEN unique_violation THEN IF p_machine_fingerprint IS NOT NULL THEN
UPDATE public.desktop_devices
SET pair_token_hash = p_pair_token_hash,
  device_name = COALESCE(NULLIF(trim(p_device_name), ''), device_name),
  app_version = COALESCE(NULLIF(trim(p_app_version), ''), app_version),
  os_version = COALESCE(NULLIF(trim(p_os_version), ''), os_version),
  status = 'active',
  revoked_at = NULL,
  last_verified_at = v_now,
  last_seen_at = v_now,
  pair_token_expires_at = v_expires_at
WHERE tenant_id = v_provision.tenant_id
  AND machine_fingerprint = p_machine_fingerprint
RETURNING id INTO v_device_id;
IF v_device_id IS NULL THEN RAISE EXCEPTION 'pair_token_collision' USING ERRCODE = 'unique_violation';
END IF;
ELSE RAISE EXCEPTION 'pair_token_collision' USING ERRCODE = 'unique_violation';
END IF;
END;
BEGIN
INSERT INTO public.activity_log (
    tenant_id,
    event_id,
    actor,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
VALUES (
    v_provision.tenant_id,
    NULL,
    'agent',
    v_device_id::text,
    'desktop_provision_consumed',
    'tenant',
    v_provision.tenant_id,
    jsonb_build_object(
      'provision_token_id',
      v_provision.id,
      'device_id',
      v_device_id,
      'pair_token_expires_at',
      v_expires_at
    )
  );
EXCEPTION
WHEN OTHERS THEN NULL;
END;
RETURN jsonb_build_object(
  'device_id',
  v_device_id,
  'tenant_id',
  v_provision.tenant_id,
  'license',
  jsonb_build_object(
    'plan',
    v_tenant_plan,
    'expires_at',
    v_tenant_expires,
    'suspended',
    v_tenant_suspended
  ),
  'pair_token_expires_at',
  v_expires_at
);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_consume_desktop_provision_token(text, text, text, text, text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_consume_desktop_provision_token(text, text, text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.rpc_consume_desktop_provision_token(text, text, text, text, text, text) IS 'Sprint D1 + Sprint SR: consume desktop provision token; inizializza ' 'pair_token_expires_at = now() + 1 anno sia su INSERT che su re-bind UPDATE.';
-- ── 3. Modifica rpc_desktop_license_verify ──────────────────────────────────
-- Logica nuova:
--   - se `pair_token_expires_at < now()` → RAISE `pair_token_expired`
--     (il client deve chiamare desktop-license-renew, non e'' un revoke);
--   - calcoliamo `pair_token_status` ∈ {ok, expiring_soon, expired_grace, expired}
--     a partire dai giorni residui (≤7 → expiring_soon);
--   - rispondiamo con `pair_token_expires_at` + `pair_token_expires_in_days`.
CREATE OR REPLACE FUNCTION public.rpc_desktop_license_verify(
    p_pair_token_hash TEXT,
    p_app_version TEXT DEFAULT NULL
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_device RECORD;
v_tenant RECORD;
v_now TIMESTAMPTZ := now();
v_days_remaining INT;
v_pair_status TEXT;
BEGIN IF p_pair_token_hash IS NULL
OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = 'check_violation';
END IF;
SELECT id,
  tenant_id,
  status,
  device_name,
  pair_token_expires_at INTO v_device
FROM public.desktop_devices
WHERE pair_token_hash = p_pair_token_hash;
IF v_device IS NULL THEN RAISE EXCEPTION 'device_unknown' USING ERRCODE = 'check_violation';
END IF;
IF v_device.status <> 'active' THEN RAISE EXCEPTION 'device_revoked' USING ERRCODE = 'check_violation';
END IF;
IF v_device.pair_token_expires_at <= v_now THEN RAISE EXCEPTION 'pair_token_expired' USING ERRCODE = 'check_violation';
END IF;
SELECT plan::text AS plan,
  expires_at,
  suspended,
  name INTO v_tenant
FROM public.tenants
WHERE id = v_device.tenant_id;
IF v_tenant.suspended THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
END IF;
IF v_tenant.expires_at IS NOT NULL
AND v_tenant.expires_at <= v_now THEN RAISE EXCEPTION 'license_expired' USING ERRCODE = 'check_violation';
END IF;
v_days_remaining := GREATEST(
  0,
  EXTRACT(
    DAY
    FROM (v_device.pair_token_expires_at - v_now)
  )::INT
);
v_pair_status := CASE
  WHEN v_days_remaining <= 7 THEN 'expiring_soon'
  ELSE 'ok'
END;
UPDATE public.desktop_devices
SET last_verified_at = v_now,
  last_seen_at = v_now,
  app_version = COALESCE(NULLIF(trim(p_app_version), ''), app_version)
WHERE id = v_device.id;
RETURN jsonb_build_object(
  'ok',
  true,
  'device_id',
  v_device.id,
  'device_name',
  v_device.device_name,
  'tenant_id',
  v_device.tenant_id,
  'tenant_name',
  v_tenant.name,
  'plan',
  v_tenant.plan,
  'expires_at',
  v_tenant.expires_at,
  'verified_at',
  v_now,
  'grace_until',
  v_now + interval '30 days',
  'pair_token_expires_at',
  v_device.pair_token_expires_at,
  'pair_token_expires_in_days',
  v_days_remaining,
  'pair_token_status',
  v_pair_status
);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_desktop_license_verify(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_desktop_license_verify(text, text) TO service_role;
COMMENT ON FUNCTION public.rpc_desktop_license_verify(text, text) IS 'Sprint D1 + Sprint SR: verifica licenza desktop. Aggiunto check ' 'pair_token_expires_at + pair_token_status (ok|expiring_soon) nella response. ' 'Se token scaduto -> pair_token_expired (renew necessario, non revoke).';
-- ── 4. RPC rpc_desktop_renew_token (service_role) ───────────────────────────
-- Rotazione atomica: il client desktop genera un NUOVO pair_token, ne calcola
-- sha256, e chiama desktop-license-renew (Bearer = vecchio token). L'edge
-- function chiama questa con i due hash.
--
-- Tolleranza: accettiamo renew anche fino a 30gg DOPO la scadenza, per non
-- bloccare PC che sono stati offline a lungo (allineato a `grace_until`
-- lato client). Oltre, serve re-bind manuale (admin genera nuovo magic-link).
CREATE OR REPLACE FUNCTION public.rpc_desktop_renew_token(
    p_old_pair_token_hash TEXT,
    p_new_pair_token_hash TEXT
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_device RECORD;
v_tenant RECORD;
v_now TIMESTAMPTZ := now();
v_new_expires_at TIMESTAMPTZ := v_now + interval '1 year';
v_renew_grace INTERVAL := interval '30 days';
BEGIN IF p_old_pair_token_hash IS NULL
OR p_old_pair_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_old_pair_token_hash' USING ERRCODE = 'check_violation';
END IF;
IF p_new_pair_token_hash IS NULL
OR p_new_pair_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_new_pair_token_hash' USING ERRCODE = 'check_violation';
END IF;
IF p_old_pair_token_hash = p_new_pair_token_hash THEN RAISE EXCEPTION 'identical_pair_tokens' USING ERRCODE = 'check_violation';
END IF;
SELECT id,
  tenant_id,
  status,
  device_name,
  pair_token_expires_at INTO v_device
FROM public.desktop_devices
WHERE pair_token_hash = p_old_pair_token_hash;
IF v_device IS NULL THEN RAISE EXCEPTION 'device_unknown' USING ERRCODE = 'check_violation';
END IF;
IF v_device.status <> 'active' THEN RAISE EXCEPTION 'device_revoked' USING ERRCODE = 'check_violation';
END IF;
IF v_device.pair_token_expires_at + v_renew_grace <= v_now THEN -- Scaduto da troppo: serve re-bind manuale (admin genera magic-link nuovo).
RAISE EXCEPTION 'pair_token_renew_expired' USING ERRCODE = 'check_violation';
END IF;
-- Verifica tenant sano (defense in depth, allineato a verify).
SELECT plan::text AS plan,
  expires_at,
  suspended,
  name INTO v_tenant
FROM public.tenants
WHERE id = v_device.tenant_id;
IF v_tenant.suspended THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
END IF;
IF v_tenant.expires_at IS NOT NULL
AND v_tenant.expires_at <= v_now THEN RAISE EXCEPTION 'license_expired' USING ERRCODE = 'check_violation';
END IF;
-- Atomic swap: nuovo hash + nuova scadenza + last_verified_at refresh.
-- Se il nuovo hash collide con un altro device (improbabilissimo: 32 byte
-- random) → unique_violation propagata al chiamante che decide retry.
UPDATE public.desktop_devices
SET pair_token_hash = p_new_pair_token_hash,
  pair_token_expires_at = v_new_expires_at,
  last_verified_at = v_now,
  last_seen_at = v_now
WHERE id = v_device.id;
BEGIN
INSERT INTO public.activity_log (
    tenant_id,
    event_id,
    actor,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
VALUES (
    v_device.tenant_id,
    NULL,
    'agent',
    v_device.id::text,
    'desktop_pair_token_renewed',
    'desktop_device',
    v_device.id,
    jsonb_build_object(
      'previous_expires_at',
      v_device.pair_token_expires_at,
      'new_expires_at',
      v_new_expires_at
    )
  );
EXCEPTION
WHEN OTHERS THEN NULL;
END;
RETURN jsonb_build_object(
  'ok',
  true,
  'device_id',
  v_device.id,
  'device_name',
  v_device.device_name,
  'tenant_id',
  v_device.tenant_id,
  'tenant_name',
  v_tenant.name,
  'plan',
  v_tenant.plan,
  'expires_at',
  v_tenant.expires_at,
  'pair_token_expires_at',
  v_new_expires_at,
  'pair_token_expires_in_days',
  365,
  'pair_token_status',
  'ok'
);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_desktop_renew_token(text, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_desktop_renew_token(text, text) TO service_role;
COMMENT ON FUNCTION public.rpc_desktop_renew_token(text, text) IS 'Sprint SR: rotazione atomica del pair_token desktop. Tolleranza 30gg post ' 'scadenza per recupero PC offline. Oltre serve re-bind manuale.';
-- ── 5. RPC rpc_admin_extend_desktop_token (admin/tech) ──────────────────────
-- Estensione manuale dal pannello "Centri Slide" → es. "Estendi 12 mesi".
-- L'admin del tenant puo' prolungare la scadenza di un device attivo senza
-- forzare un renew lato client (utile se sa che il PC restera' offline a lungo).
CREATE OR REPLACE FUNCTION public.rpc_admin_extend_desktop_token(
    p_device_id UUID,
    p_extra_months INT DEFAULT 12
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_caller_uid UUID := auth.uid();
v_tenant_id UUID := public.app_tenant_id();
v_months INT;
v_now TIMESTAMPTZ := now();
v_record RECORD;
v_new_expires TIMESTAMPTZ;
BEGIN IF v_caller_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
END IF;
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'check_violation';
END IF;
IF public.app_user_role() NOT IN ('admin', 'tech') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = 'check_violation';
END IF;
IF public.current_tenant_suspended() THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
END IF;
v_months := COALESCE(p_extra_months, 12);
IF v_months < 1 THEN v_months := 1;
END IF;
IF v_months > 60 THEN v_months := 60;
END IF;
-- cap 5 anni
-- Estende a partire dal MAX(now(), pair_token_expires_at): se il device
-- e'' gia'' scaduto, il nuovo expiry parte da OGGI; se ha ancora 6 mesi,
-- aggiunge 12 mesi al residuo (finestra che si allunga, non resetta).
UPDATE public.desktop_devices
SET pair_token_expires_at = GREATEST(v_now, pair_token_expires_at) + (v_months || ' months')::interval
WHERE id = p_device_id
  AND tenant_id = v_tenant_id
  AND status = 'active'
RETURNING id,
  tenant_id,
  device_name,
  pair_token_expires_at INTO v_record;
IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found_or_revoked' USING ERRCODE = 'check_violation';
END IF;
v_new_expires := v_record.pair_token_expires_at;
BEGIN
INSERT INTO public.activity_log (
    tenant_id,
    event_id,
    actor,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
VALUES (
    v_record.tenant_id,
    NULL,
    'user',
    v_caller_uid::text,
    'desktop_pair_token_extended',
    'desktop_device',
    v_record.id,
    jsonb_build_object(
      'extra_months',
      v_months,
      'new_expires_at',
      v_new_expires
    )
  );
EXCEPTION
WHEN OTHERS THEN NULL;
END;
RETURN jsonb_build_object(
  'ok',
  true,
  'id',
  v_record.id,
  'pair_token_expires_at',
  v_new_expires
);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_admin_extend_desktop_token(uuid, int)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_extend_desktop_token(uuid, int) TO authenticated;
COMMENT ON FUNCTION public.rpc_admin_extend_desktop_token(uuid, int) IS 'Sprint SR: admin/tech del tenant prolungano la scadenza di un desktop_device ' 'attivo (default +12 mesi, max +60). GREATEST(now, expiry)+N mesi.';
-- ── 6. RPC rpc_admin_list_expiring_desktop_devices (super_admin/cron) ───────
-- Pattern identico a list_tenants_for_license_warning (Sprint 7): scan dei
-- device in scadenza che NON hanno gia' ricevuto email per la stessa
-- pair_token_expires_at (anti-spam idempotente via email_log.metadata).
-- Chiamata da edge function cron `email-cron-desktop-tokens`.
CREATE OR REPLACE FUNCTION public.rpc_admin_list_expiring_desktop_devices(
    p_days_min INT,
    p_days_max INT,
    p_email_kind TEXT
  ) RETURNS TABLE (
    device_id UUID,
    device_name TEXT,
    tenant_id UUID,
    tenant_name TEXT,
    admin_email TEXT,
    admin_full_name TEXT,
    pair_token_expires_at TIMESTAMPTZ,
    days_remaining INT,
    machine_fingerprint TEXT
  ) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN v_role := (auth.jwt()->'app_metadata'->>'role');
IF v_role IS NULL
OR v_role <> 'super_admin' THEN RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
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
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_expiring_desktop_devices(int, int, text) TO service_role;
COMMENT ON FUNCTION public.rpc_admin_list_expiring_desktop_devices(int, int, text) IS 'Sprint SR: lista desktop_devices in scadenza che NON hanno ancora ricevuto ' 'email del kind specificato (idempotente). Service role only.';
