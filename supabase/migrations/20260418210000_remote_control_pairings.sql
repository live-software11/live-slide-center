-- ============================================================================
-- Sprint T-3-G (G10) — Remote slide control da tablet
-- ============================================================================
--
-- Scopo: abilitare un TELECOMANDO REMOTO via PWA/tablet per il regista in
-- regia. Il telecomando NON cambia la singola pagina di un PDF (impossibile
-- da fuori l'iframe Chrome PDF viewer senza riscrivere il viewer del PC sala
-- — vedi §0.22 STATO_E_TODO). Il telecomando agisce sulla SCALETTA della
-- sessione corrente: prossimo file, file precedente, vai a file specifico,
-- "schermo nero" (blank).
--
-- Architettura:
--   1) Admin genera un "pairing" -> token UUID 128-bit + URL `/remote/<token>`.
--   2) Token e' opaco; in DB salviamo SOLO l'hash SHA-256 (stesso pattern di
--      paired_devices.pair_token_hash).
--   3) Tablet apre `/remote/<token>` -> RPC `validate_remote_control_token`
--      restituisce metadati sala. Tablet usa anon-key + token nel body.
--   4) Tablet invia comando -> Edge Function `remote-control-dispatch` ->
--      RPC `dispatch_remote_command` (SECURITY DEFINER, rate-limited 60/min).
--   5) Dispatch aggiorna `room_state.current_presentation_id` -> trigger
--      Sprint B emette broadcast `room_state_changed` -> PC sala subscriber
--      reagisce automaticamente. ZERO modifiche al PC sala.
--
-- Sicurezza (difesa in profondita'):
--   - Token: UUID v4 (122 bit di entropia), hash SHA-256 in DB.
--   - TTL: 24h default, range valido 5min-7gg.
--   - Revoca immediata: set `revoked_at` (no DELETE per audit).
--   - Rate limit: 60 cmd/min per pairing (tabella rate-events).
--   - Cross-tenant guard: ogni RPC verifica tenant_id del pairing.
--   - Cross-room guard: comando `goto` valida che la presentation sia di una
--     sessione DELLA STESSA sala del pairing (no controllo cross-room).
--   - Audit: ogni create/revoke/dispatch va in `activity_log` con
--     `actor='remote_control'`, `actor_id=<pairing_id>`.
--
-- IDEMPOTENTE: usa CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
-- DROP POLICY IF EXISTS prima di CREATE POLICY.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Tabella remote_control_pairings
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.remote_control_pairings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  room_id uuid NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  token_hash text NOT NULL UNIQUE,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  commands_count integer NOT NULL DEFAULT 0,
  CONSTRAINT remote_control_pairings_expiry_after_creation CHECK (expires_at > created_at)
);

COMMENT ON TABLE public.remote_control_pairings IS
  'Sprint T-3-G: pairing token per telecomando remoto via tablet. Hash SHA-256 del token UUID. TTL configurabile, revoca immediata.';
COMMENT ON COLUMN public.remote_control_pairings.token_hash IS
  'SHA-256 hex del token UUID. Il token in chiaro viene mostrato all''admin SOLO al momento della creazione.';
COMMENT ON COLUMN public.remote_control_pairings.commands_count IS
  'Contatore totale comandi dispatchati. Solo metrica di osservabilita'', non sicurezza.';

CREATE INDEX IF NOT EXISTS idx_rcp_tenant_event_room
  ON public.remote_control_pairings (tenant_id, event_id, room_id);

CREATE INDEX IF NOT EXISTS idx_rcp_active_expiry
  ON public.remote_control_pairings (expires_at)
  WHERE revoked_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Tabella rate-limit eventi
-- ────────────────────────────────────────────────────────────────────────────
-- Cleanup periodico opzionale (DELETE WHERE created_at < now() - interval).
-- Tabella mantenuta piccola dal rate-limit stesso (60/min/pairing).
CREATE TABLE IF NOT EXISTS public.remote_control_rate_events (
  id bigserial PRIMARY KEY,
  pairing_id uuid NOT NULL REFERENCES public.remote_control_pairings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rcre_pairing_time
  ON public.remote_control_rate_events (pairing_id, created_at DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) RLS — solo SELECT per tenant admin del tenant proprietario
-- ────────────────────────────────────────────────────────────────────────────
-- Le mutazioni avvengono via RPC SECURITY DEFINER, quindi non serve INSERT/
-- UPDATE/DELETE policy per authenticated. Service_role bypassa RLS gia'.
ALTER TABLE public.remote_control_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remote_control_rate_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rcp_select_tenant_admin ON public.remote_control_pairings;
CREATE POLICY rcp_select_tenant_admin
  ON public.remote_control_pairings
  FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.app_tenant_id()
    AND public.has_tenant_admin_role()
  );

-- Nessuna SELECT policy per remote_control_rate_events (uso interno RPC).

-- ────────────────────────────────────────────────────────────────────────────
-- 4) RPC: rpc_create_remote_control_pairing
-- ────────────────────────────────────────────────────────────────────────────
-- Genera un token UUID, salva hash, ritorna token IN CHIARO una sola volta.
-- TTL configurabile via p_ttl_minutes (default 1440 = 24h, range 5-10080).
CREATE OR REPLACE FUNCTION public.rpc_create_remote_control_pairing(
    p_room_id uuid,
    p_name text,
    p_ttl_minutes integer DEFAULT 1440
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_room RECORD;
  v_event_status event_status;
  v_token uuid;
  v_token_hash text;
  v_expires_at timestamptz;
  v_pairing_id uuid;
  v_clean_name text;
  v_ttl integer;
BEGIN
  v_tenant_id := public.app_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.has_tenant_admin_role() THEN
    RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF public.current_tenant_suspended() THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_room_id IS NULL THEN
    RAISE EXCEPTION 'invalid_room_id' USING ERRCODE = 'check_violation';
  END IF;

  v_clean_name := trim(coalesce(p_name, ''));
  IF length(v_clean_name) = 0 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'check_violation';
  END IF;

  v_ttl := coalesce(p_ttl_minutes, 1440);
  IF v_ttl < 5 OR v_ttl > 10080 THEN  -- 5 min .. 7 giorni
    RAISE EXCEPTION 'invalid_ttl_minutes' USING ERRCODE = 'check_violation';
  END IF;

  -- Verifica che la room esista e sia del tenant + evento non closed/archived.
  SELECT r.id, r.event_id, e.status
    INTO v_room
  FROM public.rooms r
  JOIN public.events e ON e.id = r.event_id
  WHERE r.id = p_room_id
    AND r.tenant_id = v_tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'room_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;
  v_event_status := v_room.status;
  IF v_event_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
  END IF;

  v_token := gen_random_uuid();
  v_token_hash := encode(extensions.digest(v_token::text, 'sha256'), 'hex');
  v_expires_at := now() + make_interval(mins => v_ttl);

  INSERT INTO public.remote_control_pairings (
    tenant_id, event_id, room_id, name,
    token_hash, created_by_user_id, expires_at
  )
  VALUES (
    v_tenant_id, v_room.event_id, p_room_id, v_clean_name,
    v_token_hash, (auth.jwt()->>'sub')::uuid, v_expires_at
  )
  RETURNING id INTO v_pairing_id;

  v_user_id := (auth.jwt()->>'sub')::uuid;
  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action,
      entity_type, entity_id, metadata
    ) VALUES (
      v_tenant_id, v_room.event_id, 'user',
      coalesce(v_user_id::text, ''), 'remote_control_paired',
      'room', p_room_id,
      jsonb_build_object(
        'pairing_id', v_pairing_id,
        'name', v_clean_name,
        'ttl_minutes', v_ttl,
        'expires_at', v_expires_at
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'pairing_id', v_pairing_id,
    'token', v_token::text,
    'expires_at', v_expires_at,
    'room_id', p_room_id,
    'event_id', v_room.event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_create_remote_control_pairing(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_create_remote_control_pairing(uuid, text, integer) TO authenticated;

COMMENT ON FUNCTION public.rpc_create_remote_control_pairing(uuid, text, integer) IS
  'Sprint T-3-G: genera token telecomando remoto. Token UUID 128-bit, hash SHA-256, TTL 5min-7gg (default 24h). Solo tenant_admin.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5) RPC: rpc_revoke_remote_control_pairing
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_revoke_remote_control_pairing(
    p_pairing_id uuid
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_pairing RECORD;
  v_user_id uuid;
BEGIN
  v_tenant_id := public.app_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT public.has_tenant_admin_role() THEN
    RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_pairing_id IS NULL THEN
    RAISE EXCEPTION 'invalid_pairing_id' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, event_id, room_id, revoked_at
    INTO v_pairing
  FROM public.remote_control_pairings
  WHERE id = p_pairing_id
    AND tenant_id = v_tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'pairing_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.revoked_at IS NOT NULL THEN
    -- Idempotente: gia' revocato.
    RETURN jsonb_build_object('ok', true, 'already_revoked', true);
  END IF;

  UPDATE public.remote_control_pairings
  SET revoked_at = now()
  WHERE id = p_pairing_id;

  v_user_id := (auth.jwt()->>'sub')::uuid;
  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action,
      entity_type, entity_id, metadata
    ) VALUES (
      v_tenant_id, v_pairing.event_id, 'user',
      coalesce(v_user_id::text, ''), 'remote_control_revoked',
      'room', v_pairing.room_id,
      jsonb_build_object('pairing_id', p_pairing_id)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object('ok', true, 'revoked_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_revoke_remote_control_pairing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_remote_control_pairing(uuid) TO authenticated;

COMMENT ON FUNCTION public.rpc_revoke_remote_control_pairing(uuid) IS
  'Sprint T-3-G: revoca pairing telecomando. Idempotente. Audit in activity_log.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6) RPC: rpc_validate_remote_control_token (chiamata dal tablet)
-- ────────────────────────────────────────────────────────────────────────────
-- Anon-key + token nel body. SECURITY DEFINER per leggere la tabella
-- (RLS la nasconde ad anon). Update last_used_at ad ogni validate.
CREATE OR REPLACE FUNCTION public.rpc_validate_remote_control_token(
    p_token text
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash text;
  v_pairing RECORD;
  v_room_name text;
  v_event_title text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'missing_token' USING ERRCODE = 'check_violation';
  END IF;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT id, tenant_id, event_id, room_id, name, expires_at, revoked_at
    INTO v_pairing
  FROM public.remote_control_pairings
  WHERE token_hash = v_token_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.expires_at < now() THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
  END IF;

  -- Update last_used_at in modo non bloccante.
  UPDATE public.remote_control_pairings
  SET last_used_at = now()
  WHERE id = v_pairing.id;

  SELECT name INTO v_room_name FROM public.rooms WHERE id = v_pairing.room_id LIMIT 1;
  SELECT name INTO v_event_title FROM public.events WHERE id = v_pairing.event_id LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'pairing_id', v_pairing.id,
    'tenant_id', v_pairing.tenant_id,
    'event_id', v_pairing.event_id,
    'room_id', v_pairing.room_id,
    'name', v_pairing.name,
    'expires_at', v_pairing.expires_at,
    'room_name', v_room_name,
    'event_title', v_event_title
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_validate_remote_control_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_validate_remote_control_token(text) TO anon, authenticated;

COMMENT ON FUNCTION public.rpc_validate_remote_control_token(text) IS
  'Sprint T-3-G: valida token telecomando. Anon-callable. Aggiorna last_used_at. Lancia eccezione se invalido/revocato/scaduto.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7) RPC: rpc_get_room_schedule (per UI tablet, lista scaletta)
-- ────────────────────────────────────────────────────────────────────────────
-- Ritorna la scaletta della sessione corrente di una sala (current_session_id
-- da room_state). Anon-callable con token (validation interna), perche' il
-- tablet remote non ha JWT e RLS bloccherebbe la SELECT diretta.
CREATE OR REPLACE FUNCTION public.rpc_get_room_schedule_remote(
    p_token text
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash text;
  v_pairing RECORD;
  v_room_state RECORD;
  v_session_title text;
  v_schedule jsonb;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'missing_token' USING ERRCODE = 'check_violation';
  END IF;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT id, room_id, expires_at, revoked_at
    INTO v_pairing
  FROM public.remote_control_pairings
  WHERE token_hash = v_token_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.expires_at < now() THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
  END IF;

  SELECT current_session_id, current_presentation_id
    INTO v_room_state
  FROM public.room_state
  WHERE room_id = v_pairing.room_id
  LIMIT 1;

  IF v_room_state.current_session_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'session_id', NULL,
      'session_title', NULL,
      'current_presentation_id', NULL,
      'schedule', '[]'::jsonb
    );
  END IF;

  SELECT title INTO v_session_title
  FROM public.sessions
  WHERE id = v_room_state.current_session_id
  LIMIT 1;

  -- Ordinamento canonico: speakers.display_order ASC NULLS LAST, poi
  -- presentations.created_at ASC. Stesso criterio di getNextUpForRoom (T-3-E).
  SELECT coalesce(jsonb_agg(item ORDER BY display_order_norm, created_at), '[]'::jsonb)
    INTO v_schedule
  FROM (
    SELECT
      jsonb_build_object(
        'presentation_id', p.id,
        'version_id', pv.id,
        'file_name', pv.file_name,
        'speaker_name', sp.full_name,
        'display_order', sp.display_order
      ) AS item,
      coalesce(sp.display_order, 2147483647) AS display_order_norm,
      p.created_at AS created_at
    FROM public.presentations p
    JOIN public.presentation_versions pv ON pv.id = p.current_version_id
    LEFT JOIN public.speakers sp ON sp.id = p.speaker_id
    WHERE p.session_id = v_room_state.current_session_id
      AND pv.status = 'ready'
  ) ordered;

  RETURN jsonb_build_object(
    'ok', true,
    'session_id', v_room_state.current_session_id,
    'session_title', v_session_title,
    'current_presentation_id', v_room_state.current_presentation_id,
    'schedule', v_schedule
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_room_schedule_remote(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_get_room_schedule_remote(text) TO anon, authenticated;

COMMENT ON FUNCTION public.rpc_get_room_schedule_remote(text) IS
  'Sprint T-3-G: ritorna la scaletta della sessione corrente per UI telecomando. Auth via token (anon-callable). Ordering allineato a getNextUpForRoom.';

-- ────────────────────────────────────────────────────────────────────────────
-- 8) RPC: rpc_dispatch_remote_command (cuore del telecomando)
-- ────────────────────────────────────────────────────────────────────────────
-- Comandi supportati:
--   'next'   -> prossimo file in scaletta (in base a current_presentation_id)
--   'prev'   -> file precedente
--   'goto'   -> richiede p_target_presentation_id, valida cross-room
--   'blank'  -> set current_presentation_id = NULL ("schermo nero")
--   'first'  -> primo file della scaletta
--
-- Rate limit: 60 comandi/minuto per pairing. Tabella remote_control_rate_events.
-- Audit: ogni comando in activity_log come actor='remote_control'.
-- Effetto: UPDATE su room_state.current_presentation_id -> trigger broadcast
-- Sprint B emette `room_state_changed` -> PC sala reagisce automaticamente.
CREATE OR REPLACE FUNCTION public.rpc_dispatch_remote_command(
    p_token text,
    p_command text,
    p_target_presentation_id uuid DEFAULT NULL
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_token_hash text;
  v_pairing RECORD;
  v_room_state RECORD;
  v_rate_count integer;
  v_window_start timestamptz;
  v_target_id uuid;
  v_target_pres RECORD;
  v_now timestamptz := now();
  v_command text;
  v_idx integer;
  v_total integer;
  v_schedule_ids uuid[];
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'missing_token' USING ERRCODE = 'check_violation';
  END IF;

  v_command := lower(trim(coalesce(p_command, '')));
  IF v_command NOT IN ('next', 'prev', 'goto', 'blank', 'first') THEN
    RAISE EXCEPTION 'invalid_command' USING ERRCODE = 'check_violation';
  END IF;

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT id, tenant_id, event_id, room_id, expires_at, revoked_at, commands_count
    INTO v_pairing
  FROM public.remote_control_pairings
  WHERE token_hash = v_token_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_invalid' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'token_revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pairing.expires_at < v_now THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
  END IF;

  -- Rate limit: 60 cmd/min per pairing.
  v_window_start := v_now - interval '1 minute';
  SELECT count(*) INTO v_rate_count
  FROM public.remote_control_rate_events
  WHERE pairing_id = v_pairing.id
    AND created_at >= v_window_start;
  IF v_rate_count >= 60 THEN
    RAISE EXCEPTION 'rate_limited' USING ERRCODE = 'check_violation';
  END IF;

  -- Cleanup leggero: cancella eventi piu' vecchi di 5 min per quel pairing.
  DELETE FROM public.remote_control_rate_events
  WHERE pairing_id = v_pairing.id
    AND created_at < v_now - interval '5 minutes';

  INSERT INTO public.remote_control_rate_events (pairing_id) VALUES (v_pairing.id);

  -- Carica room_state corrente.
  SELECT current_session_id, current_presentation_id
    INTO v_room_state
  FROM public.room_state
  WHERE room_id = v_pairing.room_id
  LIMIT 1;

  -- Calcolo target in base a comando.
  IF v_command = 'blank' THEN
    v_target_id := NULL;
  ELSIF v_command = 'goto' THEN
    IF p_target_presentation_id IS NULL THEN
      RAISE EXCEPTION 'missing_target' USING ERRCODE = 'check_violation';
    END IF;
    -- Verifica che la presentation appartenga a una sessione di QUESTA sala.
    SELECT p.id, p.session_id, s.room_id, p.current_version_id, pv.status AS version_status
      INTO v_target_pres
    FROM public.presentations p
    JOIN public.sessions s ON s.id = p.session_id
    LEFT JOIN public.presentation_versions pv ON pv.id = p.current_version_id
    WHERE p.id = p_target_presentation_id
      AND p.tenant_id = v_pairing.tenant_id
      AND p.event_id = v_pairing.event_id
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'target_not_in_event' USING ERRCODE = 'check_violation';
    END IF;
    IF v_target_pres.room_id IS DISTINCT FROM v_pairing.room_id THEN
      RAISE EXCEPTION 'target_not_in_room' USING ERRCODE = 'check_violation';
    END IF;
    IF v_target_pres.current_version_id IS NULL OR v_target_pres.version_status <> 'ready' THEN
      RAISE EXCEPTION 'target_not_ready' USING ERRCODE = 'check_violation';
    END IF;
    v_target_id := p_target_presentation_id;
  ELSE
    -- next, prev, first: serve la scaletta della sessione corrente.
    IF v_room_state.current_session_id IS NULL THEN
      RAISE EXCEPTION 'no_active_session' USING ERRCODE = 'check_violation';
    END IF;

    -- Costruisce array ordinato dei presentation_id della sessione corrente.
    SELECT array_agg(presentation_id ORDER BY display_order_norm, created_at)
      INTO v_schedule_ids
    FROM (
      SELECT p.id AS presentation_id,
             coalesce(sp.display_order, 2147483647) AS display_order_norm,
             p.created_at AS created_at
      FROM public.presentations p
      JOIN public.presentation_versions pv ON pv.id = p.current_version_id
      LEFT JOIN public.speakers sp ON sp.id = p.speaker_id
      WHERE p.session_id = v_room_state.current_session_id
        AND pv.status = 'ready'
    ) ordered;

    IF v_schedule_ids IS NULL OR array_length(v_schedule_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'empty_schedule' USING ERRCODE = 'check_violation';
    END IF;
    v_total := array_length(v_schedule_ids, 1);

    IF v_command = 'first' THEN
      v_target_id := v_schedule_ids[1];
    ELSE
      -- Trova indice del current_presentation_id nella scaletta.
      v_idx := NULL;
      IF v_room_state.current_presentation_id IS NOT NULL THEN
        FOR i IN 1..v_total LOOP
          IF v_schedule_ids[i] = v_room_state.current_presentation_id THEN
            v_idx := i;
            EXIT;
          END IF;
        END LOOP;
      END IF;

      IF v_command = 'next' THEN
        IF v_idx IS NULL THEN
          -- Niente in onda (o blank): "next" parte dal primo.
          v_target_id := v_schedule_ids[1];
        ELSIF v_idx >= v_total THEN
          RAISE EXCEPTION 'end_of_schedule' USING ERRCODE = 'check_violation';
        ELSE
          v_target_id := v_schedule_ids[v_idx + 1];
        END IF;
      ELSE  -- prev
        IF v_idx IS NULL THEN
          v_target_id := v_schedule_ids[v_total];
        ELSIF v_idx <= 1 THEN
          RAISE EXCEPTION 'start_of_schedule' USING ERRCODE = 'check_violation';
        ELSE
          v_target_id := v_schedule_ids[v_idx - 1];
        END IF;
      END IF;
    END IF;
  END IF;

  -- UPDATE atomico su room_state -> trigger Sprint B propaga ad admin + sala.
  UPDATE public.room_state
  SET current_presentation_id = v_target_id,
      last_play_started_at = CASE WHEN v_target_id IS NULL THEN NULL ELSE v_now END,
      updated_at = v_now
  WHERE room_id = v_pairing.room_id;

  -- Aggiorna last_used_at + commands_count del pairing.
  UPDATE public.remote_control_pairings
  SET last_used_at = v_now,
      commands_count = commands_count + 1
  WHERE id = v_pairing.id;

  -- Audit log.
  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action,
      entity_type, entity_id, metadata
    ) VALUES (
      v_pairing.tenant_id, v_pairing.event_id, 'agent',
      v_pairing.id::text, 'remote_control_dispatch',
      'room', v_pairing.room_id,
      jsonb_build_object(
        'command', v_command,
        'target_presentation_id', v_target_id,
        'pairing_id', v_pairing.id
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'room_id', v_pairing.room_id,
    'command', v_command,
    'presentation_id', v_target_id,
    'started_at', CASE WHEN v_target_id IS NULL THEN NULL ELSE v_now END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_dispatch_remote_command(text, text, uuid) FROM PUBLIC;
-- Solo Edge Function (service_role) puo' chiamare. Il tablet NON la chiama
-- direttamente: passa attraverso `remote-control-dispatch` per CORS, audit
-- header e futura aggiunta di rate limit IP-based.
GRANT EXECUTE ON FUNCTION public.rpc_dispatch_remote_command(text, text, uuid) TO service_role;

COMMENT ON FUNCTION public.rpc_dispatch_remote_command(text, text, uuid) IS
  'Sprint T-3-G: dispatch comando telecomando. Comandi: next/prev/goto/blank/first. Rate-limited 60/min/pairing. Aggiorna room_state -> broadcast Sprint B.';

-- ────────────────────────────────────────────────────────────────────────────
-- 9) Cleanup utility: pulisce pairings scaduti da > 30 giorni (audit retention)
-- ────────────────────────────────────────────────────────────────────────────
-- Funzione invocabile manualmente dall'admin o da cron futuro. Default no-op
-- se non chiamata: i pairings scaduti restano per audit, ma non sono usabili.
CREATE OR REPLACE FUNCTION public.purge_old_remote_control_pairings(
    p_older_than_days integer DEFAULT 30
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff timestamptz;
  v_deleted integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_older_than_days IS NULL OR p_older_than_days < 7 THEN
    p_older_than_days := 30;
  END IF;
  v_cutoff := now() - make_interval(days => p_older_than_days);

  WITH deleted AS (
    DELETE FROM public.remote_control_pairings
    WHERE expires_at < v_cutoff
    RETURNING id
  )
  SELECT count(*) INTO v_deleted FROM deleted;

  RETURN jsonb_build_object('ok', true, 'deleted', v_deleted, 'cutoff', v_cutoff);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_remote_control_pairings(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_old_remote_control_pairings(integer) TO authenticated;

COMMENT ON FUNCTION public.purge_old_remote_control_pairings(integer) IS
  'Sprint T-3-G: cleanup pairings telecomando scaduti da > N giorni (default 30, min 7). Solo super_admin.';
