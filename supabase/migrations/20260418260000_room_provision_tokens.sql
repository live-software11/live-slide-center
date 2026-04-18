-- Sprint U-4 (UX redesign V2.0) — "Zero-friction room PCs".
--
-- Obiettivo: eliminare il dover-digitare-codice-6-cifre da parte
-- dell'operatore di sala. L'admin in regia genera un MAGIC LINK (URL
-- + QR stampabile) per una specifica coppia evento+sala; il PC sala
-- apre il link UNA volta, viene paired in background e si trova
-- direttamente nella RoomPlayerView, senza UI di pairing.
--
-- Architettura:
--   - tabella `room_provision_tokens` con `token_hash` (sha256 del token
--     visibile nell'URL; il plain non viene mai persistito).
--   - rpc_admin_create_room_provision_token: SECURITY DEFINER, callable
--     dall'admin loggato del tenant (RLS verifica via app_tenant_id()).
--     Genera 32 byte random, ritorna {token_plain, expires_at, ...}.
--   - rpc_consume_room_provision_token: SECURITY DEFINER, callable da
--     anon (l'edge function `room-provision-claim` la chiama). Verifica
--     hash, scadenza, max_uses, e crea atomicamente un nuovo
--     `paired_devices` con il pair_token nuovo (separato dal magic
--     token). Garantisce che il magic token non possa essere riutilizzato
--     oltre `max_uses`.
--
-- Sicurezza:
--   - Token plain (32 byte = ~43 caratteri base64url) non bruteforceable
--     in tempo umano; hash sha256 in DB previene leak da query log/dump.
--   - Rate limit lato edge (PostgREST + edge function) sulla CLAIM RPC.
--   - `revoked_at` per kill-switch immediato (admin clicca "revoca").
--   - Multi-tenant isolation via `tenant_id` + RLS policy.
--
-- IDEMPOTENTE.

-- ============================================================================
-- 1. Tabella room_provision_tokens
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.room_provision_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  -- sha256 del token plain (esattamente 64 caratteri esadecimali).
  token_hash TEXT NOT NULL UNIQUE,
  -- Etichetta human-readable mostrata all'admin nella lista token attivi
  -- (es. "Sala A — postazione regia"). Opzionale.
  label TEXT,
  -- Quante volte il token puo' essere consumato (utile per palco con
  -- piu' PC: regia + cabina + backup → max_uses = 3). Default 1.
  max_uses INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 10),
  consumed_count INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index per cleanup periodico dei token scaduti (cron, vedi sotto).
CREATE INDEX IF NOT EXISTS idx_room_provision_tokens_expires
  ON public.room_provision_tokens(expires_at)
  WHERE revoked_at IS NULL AND consumed_count < max_uses;

-- Index per lookup admin "lista token attivi della mia sala/evento".
CREATE INDEX IF NOT EXISTS idx_room_provision_tokens_room
  ON public.room_provision_tokens(room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_room_provision_tokens_event
  ON public.room_provision_tokens(event_id, created_at DESC);

ALTER TABLE public.room_provision_tokens ENABLE ROW LEVEL SECURITY;

-- Multi-tenant: admin vede solo i token del proprio tenant.
DROP POLICY IF EXISTS tenant_isolation ON public.room_provision_tokens;
CREATE POLICY tenant_isolation ON public.room_provision_tokens
  FOR ALL USING (tenant_id = public.app_tenant_id());

-- Super-admin (debug platform) vede tutti.
DROP POLICY IF EXISTS super_admin_all ON public.room_provision_tokens;
CREATE POLICY super_admin_all ON public.room_provision_tokens
  FOR ALL USING (public.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.room_provision_tokens TO authenticated;

COMMENT ON TABLE public.room_provision_tokens IS
  'Sprint U-4: magic-link tokens per zero-friction provisioning di PC sala. Token plain mai persistito (sha256 in token_hash).';

-- ============================================================================
-- 2. RPC admin: genera nuovo token (SECURITY DEFINER)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_create_room_provision_token(
    p_event_id UUID,
    p_room_id UUID,
    p_expires_minutes INTEGER DEFAULT 1440,  -- default 24 ore
    p_max_uses INTEGER DEFAULT 1,
    p_label TEXT DEFAULT NULL
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tenant_id UUID;
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

  IF p_event_id IS NULL OR p_room_id IS NULL THEN
    RAISE EXCEPTION 'missing_required_args' USING ERRCODE = 'check_violation';
  END IF;

  -- Min 5 minuti, max 30 giorni (43200 minuti). Hard cap evita che
  -- un admin distratto generi un token "infinito".
  v_minutes := COALESCE(p_expires_minutes, 1440);
  IF v_minutes < 5 THEN v_minutes := 5; END IF;
  IF v_minutes > 43200 THEN v_minutes := 43200; END IF;

  v_max_uses := COALESCE(p_max_uses, 1);
  IF v_max_uses < 1 THEN v_max_uses := 1; END IF;
  IF v_max_uses > 10 THEN v_max_uses := 10; END IF;

  -- Verifica che la sala esista e che il chiamante appartenga al tenant
  -- proprietario di quella sala. RLS sui SELECT evita di leakare
  -- l'esistenza della room a tenant diversi.
  SELECT r.tenant_id INTO v_tenant_id
  FROM public.rooms r
  WHERE r.id = p_room_id
    AND r.event_id = p_event_id
    AND r.tenant_id = public.app_tenant_id();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'room_not_found_or_forbidden' USING ERRCODE = 'check_violation';
  END IF;

  -- Genera 32 byte random + base64url (no padding). Il client riceve
  -- v_token_plain ma il DB conserva solo l'hash sha256 (collision-safe).
  v_token_plain := encode(extensions.gen_random_bytes(32), 'base64');
  -- Strip padding e base64 → base64url
  v_token_plain := replace(replace(replace(v_token_plain, '+', '-'), '/', '_'), '=', '');
  v_token_hash := encode(extensions.digest(v_token_plain, 'sha256'), 'hex');

  v_expires_at := v_now + make_interval(mins => v_minutes);

  INSERT INTO public.room_provision_tokens (
    tenant_id, event_id, room_id, token_hash, label, max_uses,
    expires_at, created_by_user_id
  ) VALUES (
    v_tenant_id, p_event_id, p_room_id, v_token_hash,
    NULLIF(trim(COALESCE(p_label, '')), ''),
    v_max_uses, v_expires_at, v_caller_uid
  )
  RETURNING id INTO v_id;

  -- Activity log per audit (chi ha generato cosa). Il token plain non
  -- viene loggato (solo l'id e il numero di usi consentiti).
  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type,
      entity_id, metadata
    ) VALUES (
      v_tenant_id, p_event_id, 'user', v_caller_uid::text,
      'room_provision_token_created', 'room', p_room_id,
      jsonb_build_object(
        'token_id', v_id,
        'expires_at', v_expires_at,
        'max_uses', v_max_uses,
        'label', NULLIF(trim(COALESCE(p_label, '')), '')
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'id', v_id,
    'token', v_token_plain,
    'expires_at', v_expires_at,
    'max_uses', v_max_uses,
    'tenant_id', v_tenant_id,
    'event_id', p_event_id,
    'room_id', p_room_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_create_room_provision_token(uuid, uuid, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_create_room_provision_token(uuid, uuid, integer, integer, text) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_create_room_provision_token(uuid, uuid, integer, integer, text) IS
  'Sprint U-4: genera magic-link token per provisioning PC sala. Ritorna token plain una volta sola; in DB solo sha256.';

-- ============================================================================
-- 3. RPC consume: il PC sala apre il magic link e viene paired
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_consume_room_provision_token(
    p_token TEXT,
    p_pair_token_hash TEXT,
    p_device_name TEXT DEFAULT NULL,
    p_device_type TEXT DEFAULT NULL,
    p_browser TEXT DEFAULT NULL,
    p_user_agent TEXT DEFAULT NULL,
    p_last_ip TEXT DEFAULT NULL
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_token_hash TEXT;
  v_provision RECORD;
  v_device_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'missing_token' USING ERRCODE = 'check_violation';
  END IF;
  IF p_pair_token_hash IS NULL OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = 'check_violation';
  END IF;

  v_token_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');

  -- Update atomico: incrementiamo consumed_count solo se token e' valido
  -- (non scaduto, non revocato, non esaurito). Il primo consume vince
  -- (no race), gli altri ricevono "exhausted".
  UPDATE public.room_provision_tokens
  SET consumed_count = consumed_count + 1
  WHERE token_hash = v_token_hash
    AND revoked_at IS NULL
    AND expires_at > v_now
    AND consumed_count < max_uses
  RETURNING id, tenant_id, event_id, room_id, max_uses, consumed_count
  INTO v_provision;

  IF NOT FOUND THEN
    -- Distinguiamo i casi (UI piu' chiara per l'operatore di sala):
    --  - token inesistente / errato → 'token_invalid'
    --  - token revocato → 'token_revoked'
    --  - scaduto → 'token_expired'
    --  - max_uses raggiunto → 'token_exhausted'
    PERFORM 1 FROM public.room_provision_tokens
    WHERE token_hash = v_token_hash
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM public.room_provision_tokens
    WHERE token_hash = v_token_hash AND revoked_at IS NOT NULL
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'token_revoked' USING ERRCODE = 'check_violation';
    END IF;
    PERFORM 1 FROM public.room_provision_tokens
    WHERE token_hash = v_token_hash AND expires_at <= v_now
    LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
    END IF;
    RAISE EXCEPTION 'token_exhausted' USING ERRCODE = 'check_violation';
  END IF;

  -- Crea il paired_devices. Il client ha gia' generato 32 byte random
  -- localmente (li conserva solo lui in localStorage), ce ne passa
  -- l'hash sha256.
  INSERT INTO public.paired_devices (
    tenant_id, event_id, room_id, device_name, device_type,
    browser, user_agent, pair_token_hash, last_ip, last_seen_at,
    status, paired_by_user_id, role
  ) VALUES (
    v_provision.tenant_id, v_provision.event_id, v_provision.room_id,
    NULLIF(trim(COALESCE(p_device_name, 'Sala')), ''),
    p_device_type, p_browser, p_user_agent, p_pair_token_hash,
    NULLIF(p_last_ip, '')::inet, v_now,
    'online', NULL, 'room'
  )
  RETURNING id INTO v_device_id;

  -- Activity log
  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type,
      entity_id, metadata
    ) VALUES (
      v_provision.tenant_id, v_provision.event_id, 'agent',
      v_device_id::text, 'room_provision_consumed', 'room',
      v_provision.room_id,
      jsonb_build_object(
        'provision_token_id', v_provision.id,
        'device_id', v_device_id,
        'consumed_count', v_provision.consumed_count,
        'max_uses', v_provision.max_uses
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'tenant_id', v_provision.tenant_id,
    'event_id', v_provision.event_id,
    'room_id', v_provision.room_id,
    'max_uses', v_provision.max_uses,
    'consumed_count', v_provision.consumed_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_consume_room_provision_token(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_consume_room_provision_token(text, text, text, text, text, text, text) TO service_role;

COMMENT ON FUNCTION public.rpc_consume_room_provision_token(text, text, text, text, text, text, text) IS
  'Sprint U-4: consume di magic-link token (chiamata da edge function room-provision-claim). Crea paired_devices atomicamente.';

-- ============================================================================
-- 4. RPC admin: revoca token attivo
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_revoke_room_provision_token(
    p_token_id UUID
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_caller_uid UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_record RECORD;
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  UPDATE public.room_provision_tokens
  SET revoked_at = v_now
  WHERE id = p_token_id
    AND tenant_id = public.app_tenant_id()
    AND revoked_at IS NULL
  RETURNING id, tenant_id, event_id, room_id INTO v_record;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found_or_already_revoked' USING ERRCODE = 'check_violation';
  END IF;

  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type,
      entity_id, metadata
    ) VALUES (
      v_record.tenant_id, v_record.event_id, 'user', v_caller_uid::text,
      'room_provision_token_revoked', 'room', v_record.room_id,
      jsonb_build_object('token_id', v_record.id)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'id', v_record.id);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_revoke_room_provision_token(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_revoke_room_provision_token(uuid) TO authenticated;

COMMENT ON FUNCTION public.rpc_admin_revoke_room_provision_token(uuid) IS
  'Sprint U-4: revoca un magic-link token attivo (admin-only).';
