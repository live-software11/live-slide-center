-- ============================================================================
-- Sprint D1 — Sistema licenze unificato cloud/desktop
-- ============================================================================
-- Andrea 18/04/2026: "sistema licenze del pc server deve funzionare come in
-- cloud, stesse licenze condivise". Il PC desktop server (Tauri 2 + server
-- Axum locale) e' un device "tenant-wide" (non legato a un singolo evento)
-- che condivide la licenza del tenant cloud Slide Center: niente SKU
-- separato, niente abbonamento extra, niente fingerprint hardware come negli
-- agent legacy.
--
-- Modello:
--   - 1 tenant cloud + N PC desktop server (1 per ufficio fisico tipico).
--   - Ogni PC desktop e' rappresentato da un record `desktop_devices` con un
--     `pair_token` random (32 byte) generato durante il bind.
--   - Il bind avviene via "magic link" identico a quello dei PC sala (Sprint
--     U-4): admin loggato genera un `desktop_provision_tokens`, l'utente
--     incolla il magic URL nell'app desktop o lo apre nel browser embedded,
--     l'edge function `desktop-bind-claim` consuma il token e restituisce
--     pair_token + tenant info.
--   - Il PC desktop salva il pair_token cifrato AES-256-GCM localmente in
--     `~/.slidecenter/license.enc` e lo usa come Bearer per future chiamate.
--   - Verifica licenza periodica (1x/24h) chiama un edge function
--     `desktop-license-verify` che controlla:
--        a) pair_token_hash esiste in `desktop_devices` AND status='active'
--        b) tenants.expires_at > now() AND NOT suspended
--      → ritorna `{ok, plan, expires_at, grace_until}`.
--   - Grace period offline: 30 giorni dall'ultimo verify riuscito (lato Rust).
--     Oltre, le funzioni cloud-dipendenti vengono disabilitate (LAN continua
--     a funzionare per l'evento in corso).
--
-- Architettura di riuso massimo:
--   - Tabelle DEDICATE (`desktop_devices`, `desktop_provision_tokens`) per
--     isolamento e per non perturbare le RLS gia' a regime su `paired_devices`
--     (event_id NOT NULL li' e' un invariante usato da decine di RPC).
--   - Stesso pattern token plain/hash di `room_provision_tokens` (sha256,
--     plain mai persistito).
--   - Stesso pattern `current_tenant_suspended()` + `super_admin_all` delle
--     altre tabelle operative (regola data-isolation).
--
-- IDEMPOTENTE.
-- ============================================================================

-- ── 1. Tabella desktop_devices ──────────────────────────────────────────────
-- Un record per PC desktop server installato. Un tenant puo' avere N device
-- (es. ufficio Roma + ufficio Milano). Il `pair_token_hash` (sha256 del
-- token plain) e' la chiave di autenticazione persistente del PC desktop:
-- vive finche' status = 'active', si revoca da UI admin.
CREATE TABLE IF NOT EXISTS public.desktop_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_name TEXT NOT NULL,
  machine_fingerprint TEXT,
  pair_token_hash TEXT NOT NULL UNIQUE,
  app_version TEXT,
  os_version TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  registered_by_user_id UUID REFERENCES public.users(id),
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_verified_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (tenant_id, machine_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_desktop_devices_tenant ON public.desktop_devices(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_desktop_devices_active_seen ON public.desktop_devices(tenant_id, last_seen_at DESC)
  WHERE status = 'active';

COMMENT ON TABLE public.desktop_devices IS
  'Sprint D1: PC desktop server installati per tenant Slide Center. '
  'Un device rappresenta un PC fisico che esegue Live SLIDE CENTER Desktop '
  '(Tauri 2 + server Axum locale). pair_token_hash = sha256 del bearer token '
  'salvato cifrato AES-256-GCM in ~/.slidecenter/license.enc lato client.';

ALTER TABLE public.desktop_devices ENABLE ROW LEVEL SECURITY;

-- ── 1-bis. Policy RLS multi-tenant + super_admin ────────────────────────────
DROP POLICY IF EXISTS desktop_devices_select ON public.desktop_devices;
CREATE POLICY desktop_devices_select ON public.desktop_devices FOR SELECT
  TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );

DROP POLICY IF EXISTS desktop_devices_update ON public.desktop_devices;
CREATE POLICY desktop_devices_update ON public.desktop_devices FOR UPDATE
  TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
    AND public.app_user_role() IN ('admin', 'tech')
  ) WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );

DROP POLICY IF EXISTS desktop_devices_delete ON public.desktop_devices;
CREATE POLICY desktop_devices_delete ON public.desktop_devices FOR DELETE
  TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
    AND public.app_user_role() IN ('admin', 'tech')
  );

DROP POLICY IF EXISTS super_admin_all ON public.desktop_devices;
CREATE POLICY super_admin_all ON public.desktop_devices FOR ALL
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

GRANT SELECT, UPDATE, DELETE ON public.desktop_devices TO authenticated;

-- ── 2. Tabella desktop_provision_tokens ─────────────────────────────────────
-- Magic-link token per onboarding zero-friction di un nuovo PC desktop.
-- Pattern identico a room_provision_tokens (Sprint U-4) ma senza event_id/
-- room_id. Plain mai persistito (solo sha256), one-shot di default.
CREATE TABLE IF NOT EXISTS public.desktop_provision_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT,
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 10),
  consumed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_desktop_provision_tokens_tenant
  ON public.desktop_provision_tokens(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_desktop_provision_tokens_expires
  ON public.desktop_provision_tokens(expires_at)
  WHERE revoked_at IS NULL AND consumed_count < max_uses;

ALTER TABLE public.desktop_provision_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON public.desktop_provision_tokens;
CREATE POLICY tenant_isolation ON public.desktop_provision_tokens FOR ALL
  TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  ) WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );

DROP POLICY IF EXISTS super_admin_all ON public.desktop_provision_tokens;
CREATE POLICY super_admin_all ON public.desktop_provision_tokens FOR ALL
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.desktop_provision_tokens TO authenticated;

COMMENT ON TABLE public.desktop_provision_tokens IS
  'Sprint D1: magic-link token per zero-friction onboarding di PC desktop server. '
  'Plain mai persistito (sha256 in token_hash). Riusato pattern di '
  'room_provision_tokens (Sprint U-4) ma senza event_id/room_id.';

-- ── 3. RPC admin: genera magic-link bind ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_create_desktop_provision_token(
    p_label TEXT DEFAULT NULL,
    p_expires_minutes INTEGER DEFAULT 1440,
    p_max_uses INTEGER DEFAULT 1
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_tenant_id UUID := public.app_tenant_id();
  v_caller_uid UUID := auth.uid();
  v_token_plain TEXT;
  v_token_hash TEXT;
  v_id UUID;
  v_now TIMESTAMPTZ := now();
  v_expires_at TIMESTAMPTZ;
  v_minutes INTEGER;
  v_max_uses INTEGER;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF public.app_user_role() NOT IN ('admin', 'tech') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF public.current_tenant_suspended() THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
  END IF;

  v_minutes := COALESCE(p_expires_minutes, 1440);
  IF v_minutes < 5 THEN v_minutes := 5; END IF;
  IF v_minutes > 43200 THEN v_minutes := 43200; END IF;

  v_max_uses := COALESCE(p_max_uses, 1);
  IF v_max_uses < 1 THEN v_max_uses := 1; END IF;
  IF v_max_uses > 10 THEN v_max_uses := 10; END IF;

  v_token_plain := encode(extensions.gen_random_bytes(32), 'base64');
  v_token_plain := replace(replace(replace(v_token_plain, '+', '-'), '/', '_'), '=', '');
  v_token_hash := encode(extensions.digest(v_token_plain, 'sha256'), 'hex');
  v_expires_at := v_now + make_interval(mins => v_minutes);

  INSERT INTO public.desktop_provision_tokens (
    tenant_id, token_hash, label, max_uses, expires_at, created_by_user_id
  ) VALUES (
    v_tenant_id, v_token_hash,
    NULLIF(trim(COALESCE(p_label, '')), ''),
    v_max_uses, v_expires_at, v_caller_uid
  ) RETURNING id INTO v_id;

  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_tenant_id, NULL, 'user', v_caller_uid::text,
      'desktop_provision_token_created', 'tenant', v_tenant_id,
      jsonb_build_object('token_id', v_id, 'expires_at', v_expires_at, 'max_uses', v_max_uses, 'label', p_label)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'id', v_id,
    'token', v_token_plain,
    'expires_at', v_expires_at,
    'max_uses', v_max_uses,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_create_desktop_provision_token(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_desktop_provision_token(text, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_create_desktop_provision_token(text, integer, integer) IS
  'Sprint D1: genera magic-link token per bind PC desktop server. '
  'Ritorna token plain una volta sola (sha256 in DB). Admin/tech only.';

-- ── 4. RPC consume: l'edge function chiama questa per fare il bind ──────────
CREATE OR REPLACE FUNCTION public.rpc_consume_desktop_provision_token(
    p_token TEXT,
    p_pair_token_hash TEXT,
    p_device_name TEXT DEFAULT NULL,
    p_machine_fingerprint TEXT DEFAULT NULL,
    p_app_version TEXT DEFAULT NULL,
    p_os_version TEXT DEFAULT NULL
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_token_hash TEXT;
  v_provision RECORD;
  v_device_id UUID;
  v_now TIMESTAMPTZ := now();
  v_tenant_plan TEXT;
  v_tenant_expires TIMESTAMPTZ;
  v_tenant_suspended BOOLEAN;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'missing_token' USING ERRCODE = 'check_violation';
  END IF;
  IF p_pair_token_hash IS NULL OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = 'check_violation';
  END IF;

  v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  UPDATE public.desktop_provision_tokens
    SET consumed_count = consumed_count + 1
    WHERE token_hash = v_token_hash
      AND revoked_at IS NULL
      AND expires_at > v_now
      AND consumed_count < max_uses
    RETURNING id, tenant_id, max_uses, consumed_count INTO v_provision;

  IF NOT FOUND THEN
    PERFORM 1 FROM public.desktop_provision_tokens WHERE token_hash = v_token_hash LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM public.desktop_provision_tokens WHERE token_hash = v_token_hash AND revoked_at IS NOT NULL LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'token_revoked' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM public.desktop_provision_tokens WHERE token_hash = v_token_hash AND expires_at <= v_now LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'token_exhausted' USING ERRCODE = 'check_violation';
  END IF;

  -- Verifica tenant attivo (defense in depth - l'admin che ha generato il
  -- token potrebbe essere stato sospeso nel frattempo).
  SELECT plan::text, expires_at, suspended
    INTO v_tenant_plan, v_tenant_expires, v_tenant_suspended
    FROM public.tenants WHERE id = v_provision.tenant_id;
  IF v_tenant_suspended THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
  END IF;
  IF v_tenant_expires IS NOT NULL AND v_tenant_expires <= v_now THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = 'check_violation';
  END IF;

  -- Crea il desktop_device. Se machine_fingerprint duplicato per lo stesso
  -- tenant (UNIQUE constraint), l'utente sta re-binding lo stesso PC →
  -- aggiorniamo il record esistente invece di creare duplicato.
  BEGIN
    INSERT INTO public.desktop_devices (
      tenant_id, device_name, machine_fingerprint, pair_token_hash,
      app_version, os_version, registered_by_user_id, last_verified_at, last_seen_at
    ) VALUES (
      v_provision.tenant_id,
      NULLIF(trim(COALESCE(p_device_name, 'Slide Center Server')), ''),
      NULLIF(trim(p_machine_fingerprint), ''),
      p_pair_token_hash,
      NULLIF(trim(p_app_version), ''),
      NULLIF(trim(p_os_version), ''),
      NULL, v_now, v_now
    ) RETURNING id INTO v_device_id;
  EXCEPTION WHEN unique_violation THEN
    -- Caso 1: stesso machine_fingerprint per lo stesso tenant → re-bind: UPDATE
    -- Caso 2: collisione SHA-256 di pair_token_hash random → 'pair_token_collision'
    -- Distinguiamo tramite SELECT mirato.
    IF p_machine_fingerprint IS NOT NULL THEN
      UPDATE public.desktop_devices
        SET pair_token_hash = p_pair_token_hash,
            device_name = COALESCE(NULLIF(trim(p_device_name), ''), device_name),
            app_version = COALESCE(NULLIF(trim(p_app_version), ''), app_version),
            os_version = COALESCE(NULLIF(trim(p_os_version), ''), os_version),
            status = 'active',
            revoked_at = NULL,
            last_verified_at = v_now,
            last_seen_at = v_now
        WHERE tenant_id = v_provision.tenant_id
          AND machine_fingerprint = p_machine_fingerprint
        RETURNING id INTO v_device_id;
      IF v_device_id IS NULL THEN
        RAISE EXCEPTION 'pair_token_collision' USING ERRCODE = 'unique_violation';
      END IF;
    ELSE
      RAISE EXCEPTION 'pair_token_collision' USING ERRCODE = 'unique_violation';
    END IF;
  END;

  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_provision.tenant_id, NULL, 'agent', v_device_id::text,
      'desktop_provision_consumed', 'tenant', v_provision.tenant_id,
      jsonb_build_object('provision_token_id', v_provision.id, 'device_id', v_device_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'tenant_id', v_provision.tenant_id,
    'license', jsonb_build_object(
      'plan', v_tenant_plan,
      'expires_at', v_tenant_expires,
      'suspended', v_tenant_suspended
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_consume_desktop_provision_token(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_consume_desktop_provision_token(text, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.rpc_consume_desktop_provision_token(text, text, text, text, text, text) IS
  'Sprint D1: consume desktop provision token (chiamata da edge function desktop-bind-claim). '
  'Crea desktop_devices o re-bind se machine_fingerprint duplicato.';

-- ── 5. RPC admin: revoca token attivo ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_desktop_provision_token(p_token_id UUID)
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_record RECORD;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  UPDATE public.desktop_provision_tokens
    SET revoked_at = v_now
    WHERE id = p_token_id
      AND tenant_id = public.app_tenant_id()
      AND revoked_at IS NULL
    RETURNING id, tenant_id INTO v_record;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found_or_already_revoked' USING ERRCODE = 'check_violation';
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_record.id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_revoke_desktop_provision_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_revoke_desktop_provision_token(uuid) TO authenticated;

-- ── 6. RPC admin: revoca un desktop_device installato ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_desktop_device(p_device_id UUID)
  RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_record RECORD;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  UPDATE public.desktop_devices
    SET status = 'revoked', revoked_at = now()
    WHERE id = p_device_id
      AND tenant_id = public.app_tenant_id()
      AND status = 'active'
    RETURNING id, tenant_id, device_name INTO v_record;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found_or_already_revoked' USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_record.tenant_id, NULL, 'user', v_caller_uid::text,
      'desktop_device_revoked', 'desktop_device', v_record.id,
      jsonb_build_object('device_name', v_record.device_name)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_record.id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_revoke_desktop_device(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_revoke_desktop_device(uuid) TO authenticated;

-- ── 7. RPC service-role: verifica licenza per heartbeat lato desktop ────────
-- Chiamata dall'edge function `desktop-license-verify` che riceve il
-- pair_token in Authorization Bearer, ne fa sha256 e chiama questa con
-- service_role. Aggiorna anche last_verified_at + last_seen_at atomicamente.
CREATE OR REPLACE FUNCTION public.rpc_desktop_license_verify(
    p_pair_token_hash TEXT,
    p_app_version TEXT DEFAULT NULL
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_device RECORD;
  v_tenant RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_pair_token_hash IS NULL OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, tenant_id, status, device_name
    INTO v_device
    FROM public.desktop_devices
    WHERE pair_token_hash = p_pair_token_hash;

  IF v_device IS NULL THEN
    RAISE EXCEPTION 'device_unknown' USING ERRCODE = 'check_violation';
  END IF;
  IF v_device.status <> 'active' THEN
    RAISE EXCEPTION 'device_revoked' USING ERRCODE = 'check_violation';
  END IF;

  SELECT plan::text AS plan, expires_at, suspended, name
    INTO v_tenant
    FROM public.tenants
    WHERE id = v_device.tenant_id;

  IF v_tenant.suspended THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'check_violation';
  END IF;
  IF v_tenant.expires_at IS NOT NULL AND v_tenant.expires_at <= v_now THEN
    RAISE EXCEPTION 'license_expired' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.desktop_devices
    SET last_verified_at = v_now,
        last_seen_at = v_now,
        app_version = COALESCE(NULLIF(trim(p_app_version), ''), app_version)
    WHERE id = v_device.id;

  RETURN jsonb_build_object(
    'ok', true,
    'device_id', v_device.id,
    'device_name', v_device.device_name,
    'tenant_id', v_device.tenant_id,
    'tenant_name', v_tenant.name,
    'plan', v_tenant.plan,
    'expires_at', v_tenant.expires_at,
    'verified_at', v_now,
    -- 30 giorni di grace lato client (allineato a docs/desktop-tauri.mdc).
    'grace_until', v_now + interval '30 days'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_desktop_license_verify(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_desktop_license_verify(text, text) TO service_role;

COMMENT ON FUNCTION public.rpc_desktop_license_verify(text, text) IS
  'Sprint D1: verifica licenza PC desktop server (chiamata da edge function desktop-license-verify). '
  'Aggiorna last_verified_at/last_seen_at. Ritorna grace_until = now() + 30 giorni.';
