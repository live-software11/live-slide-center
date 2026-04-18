-- ────────────────────────────────────────────────────────────────────
-- Audit chirurgico post-deploy 2026-04-18 — fix CRITICAL/HIGH
-- ────────────────────────────────────────────────────────────────────
-- Quattro fix consolidati identificati dall'audit del 18/04/2026:
--
-- 1. CRITICAL — `rpc_move_presentation_to_session`:
--    INSERT in `activity_log` usava colonne inesistenti (`actor_kind`,
--    `target_kind`, `target_id`, `details`). La funzione viene compilata
--    lazy da PL/pgSQL e fallisce SOLO alla prima invocazione runtime.
--    Schema reale: `actor` (enum actor_type), `entity_type` (text),
--    `entity_id` (uuid), `metadata` (jsonb).
--
-- 2. HIGH — `record_lemon_squeezy_event`:
--    Pattern "select then insert" non protetto da lock → due webhook
--    paralleli con stesso `event_id` possono entrambi superare il check
--    e tentare l'INSERT, uno fallisce per UNIQUE → 500 verso Lemon
--    Squeezy che retrya aggressivamente. Fix: INSERT ... ON CONFLICT
--    DO NOTHING RETURNING + fallback SELECT per branch idempotente.
--
-- 3. HIGH — `finalize_upload_version_for_room_device`:
--    Validava solo `tenant_id` della version, non la `room_id` del
--    device vs `sessions.room_id` della presentation. Un device con
--    token valido per un'altra sala dello stesso tenant + version_id
--    noto poteva finalizzare upload non suoi. Fix: join
--    presentations -> sessions e confronta `room_id`.
--
-- 4. CRITICAL — `pair-claim` Edge Function (TOCTOU race):
--    Read-then-write su `pairing_codes` permette a due richieste
--    parallele di consumare lo stesso codice 6-cifre, creando due
--    `paired_devices` e due token validi per la stessa sala.
--    Fix: nuova RPC SECURITY DEFINER `claim_pairing_code_atomic`
--    che fa UPDATE ... WHERE consumed_at IS NULL RETURNING (un solo
--    vincitore) + INSERT paired_devices nella stessa transazione.
--
-- Nessun rollback necessario: tutte CREATE OR REPLACE / nuova RPC.
-- Compatibilita backward: API SQL invariata su (1)(2)(3); (4) e' RPC
-- nuova affiancata (la Edge Function viene migrata separatamente).
-- ────────────────────────────────────────────────────────────────────

-- ── 1) Fix rpc_move_presentation_to_session: colonne activity_log ───────────
CREATE OR REPLACE FUNCTION public.rpc_move_presentation_to_session(
    p_presentation_id uuid,
    p_target_session_id uuid
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_pres RECORD;
  v_event_status event_status;
  v_target_session RECORD;
  v_user uuid;
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
  IF p_presentation_id IS NULL OR p_target_session_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('rpc_move_presentation_to_session:' || p_presentation_id::text)
  );

  SELECT id, tenant_id, event_id, speaker_id, session_id, status
    INTO v_pres
  FROM presentations
  WHERE id = p_presentation_id AND tenant_id = v_tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'presentation_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF v_pres.status = 'archived' THEN
    RAISE EXCEPTION 'presentation_archived' USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_event_status FROM events WHERE id = v_pres.event_id;
  IF v_event_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, tenant_id, event_id INTO v_target_session
  FROM sessions
  WHERE id = p_target_session_id AND tenant_id = v_tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_session_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF v_target_session.event_id <> v_pres.event_id THEN
    RAISE EXCEPTION 'cross_event_move_not_allowed' USING ERRCODE = 'check_violation';
  END IF;
  IF v_target_session.id = v_pres.session_id THEN
    RETURN jsonb_build_object(
      'ok', true, 'skipped', true, 'reason', 'same_session_no_op',
      'presentation_id', p_presentation_id, 'session_id', v_pres.session_id
    );
  END IF;

  UPDATE presentations
  SET session_id = p_target_session_id,
      speaker_id = NULL,
      updated_at = now()
  WHERE id = p_presentation_id;

  v_user := NULLIF(auth.jwt()->>'sub', '')::uuid;

  -- Audit-fix 2026-04-18: nomi colonne allineati allo schema reale activity_log
  -- (prima usava actor_kind/target_kind/target_id/details inesistenti).
  INSERT INTO activity_log (
    tenant_id, event_id, actor, actor_id, action,
    entity_type, entity_id, metadata
  )
  VALUES (
    v_tenant_id,
    v_pres.event_id,
    'user'::actor_type,
    COALESCE(v_user::text, ''),
    'move_presentation_to_session',
    'presentation',
    p_presentation_id,
    jsonb_build_object(
      'from_speaker_id', v_pres.speaker_id,
      'from_session_id', v_pres.session_id,
      'to_session_id', p_target_session_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'skipped', false,
    'presentation_id', p_presentation_id,
    'session_id', p_target_session_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_move_presentation_to_session(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_move_presentation_to_session(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.rpc_move_presentation_to_session(uuid, uuid) IS
  'Sprint G B3 + audit-fix 2026-04-18: sposta presentation in altra sessione (stesso evento). Audit log con nomi colonne corretti.';

-- ── 2) Fix record_lemon_squeezy_event: idempotency atomica ──────────────────
CREATE OR REPLACE FUNCTION public.record_lemon_squeezy_event(
    p_event_id TEXT,
    p_event_name TEXT,
    p_subscription_id TEXT,
    p_customer_id TEXT,
    p_payload JSONB
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_existing_id UUID;
  v_existing_status TEXT;
  v_new_id UUID;
BEGIN
  -- Audit-fix 2026-04-18: race-free via INSERT ... ON CONFLICT DO NOTHING.
  -- Se due webhook paralleli arrivano: il vincitore inserisce, il perdente
  -- ottiene RETURNING vuoto e cade sul SELECT successivo (sempre trova
  -- la riga inserita dal vincitore).
  INSERT INTO lemon_squeezy_event_log (
    event_id, event_name, subscription_id, customer_id, payload, processing_status
  ) VALUES (
    p_event_id, p_event_name, p_subscription_id, p_customer_id, p_payload, 'received'
  )
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN jsonb_build_object('is_new', true, 'log_id', v_new_id);
  END IF;

  -- Conflict: leggi il record esistente per ritornare il branch idempotente.
  SELECT id, processing_status INTO v_existing_id, v_existing_status
  FROM lemon_squeezy_event_log
  WHERE event_id = p_event_id;

  RETURN jsonb_build_object(
    'is_new', false,
    'log_id', v_existing_id,
    'previous_status', v_existing_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_lemon_squeezy_event(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_lemon_squeezy_event(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
COMMENT ON FUNCTION public.record_lemon_squeezy_event(TEXT, TEXT, TEXT, TEXT, JSONB) IS
  'Sprint R-2 + audit-fix 2026-04-18: idempotency atomica via ON CONFLICT (no race tra webhook paralleli).';

-- ── 3) Fix finalize_upload_version_for_room_device: cross-room check ────────
CREATE OR REPLACE FUNCTION public.finalize_upload_version_for_room_device(
    p_token text,
    p_version_id uuid,
    p_sha256 text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
  v_hash text;
  v_device RECORD;
  v_tenant_suspended boolean;
  v_version RECORD;
  v_object RECORD;
  v_event_id uuid;
  v_session_id uuid;
  v_session_room_id uuid;
  v_presentation_id uuid;
  v_file_name text;
BEGIN
  IF p_token IS NULL OR p_token = '' OR p_version_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_sha256' USING ERRCODE = 'check_violation';
  END IF;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  SELECT id, tenant_id, event_id, room_id, device_name INTO v_device
  FROM paired_devices
  WHERE pair_token_hash = v_hash
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = 'check_violation';
  END IF;

  SELECT suspended INTO v_tenant_suspended
  FROM tenants WHERE id = v_device.tenant_id;
  IF v_tenant_suspended THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT pv.id, pv.presentation_id, pv.tenant_id, pv.storage_key,
         pv.status, pv.file_size_bytes, pv.file_name
    INTO v_version
  FROM presentation_versions pv
  WHERE pv.id = p_version_id AND pv.tenant_id = v_device.tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF v_version.status <> 'uploading' THEN
    RAISE EXCEPTION 'version_not_uploading' USING ERRCODE = 'check_violation';
  END IF;

  -- Audit-fix 2026-04-18: cross-room check.
  -- Senza questo controllo un device di Sala A poteva finalizzare upload
  -- destinati a Sala B (stesso tenant) se conosceva il version_id.
  -- Recupera la room della presentation tramite session.room_id.
  SELECT s.room_id INTO v_session_room_id
  FROM presentations p
  LEFT JOIN sessions s ON s.id = p.session_id
  WHERE p.id = v_version.presentation_id;

  IF v_session_room_id IS NULL OR v_session_room_id IS DISTINCT FROM v_device.room_id THEN
    RAISE EXCEPTION 'cross_room_finalize_forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT o.name, (o.metadata->>'size')::bigint AS size INTO v_object
  FROM storage.objects o
  WHERE o.bucket_id = 'presentations' AND o.name = v_version.storage_key
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'object_missing' USING ERRCODE = 'check_violation';
  END IF;

  v_file_name := v_version.file_name;
  v_presentation_id := v_version.presentation_id;

  UPDATE presentation_versions
  SET status = 'ready',
      file_hash_sha256 = p_sha256,
      file_size_bytes = COALESCE(v_object.size, file_size_bytes)
  WHERE id = p_version_id;

  UPDATE presentations
  SET current_version_id = p_version_id,
      total_versions = total_versions + 1,
      status = CASE WHEN status = 'pending' THEN 'uploaded' ELSE status END
  WHERE id = v_presentation_id
  RETURNING event_id, session_id INTO v_event_id, v_session_id;

  UPDATE presentation_versions
  SET status = 'superseded'
  WHERE presentation_id = v_presentation_id
    AND id <> p_version_id
    AND status = 'ready';

  INSERT INTO activity_log (
    tenant_id, event_id, actor, actor_id, actor_name, action,
    entity_type, entity_id, metadata
  )
  VALUES (
    v_device.tenant_id, v_event_id, 'device',
    v_device.id::text, v_device.device_name, 'upload_finalize_room_device',
    'presentation_version', p_version_id,
    jsonb_build_object(
      'sha256', p_sha256,
      'size', COALESCE(v_object.size, v_version.file_size_bytes),
      'file_name', v_file_name,
      'session_id', v_session_id,
      'room_id', v_device.room_id,
      'device_id', v_device.id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'version_id', p_version_id,
    'presentation_id', v_presentation_id,
    'session_id', v_session_id,
    'room_id', v_device.room_id,
    'file_name', v_file_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_upload_version_for_room_device(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_upload_version_for_room_device(text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.finalize_upload_version_for_room_device(text, uuid, text) IS
  'Sprint R-3 + audit-fix 2026-04-18: cross-room check (device.room_id = session.room_id).';

-- ── 4) Nuova RPC claim_pairing_code_atomic per fix TOCTOU pair-claim ────────
-- L'attuale flusso pair-claim (Edge Function) fa SELECT + INSERT + UPDATE in
-- 3 step separati, permettendo a 2 richieste parallele di consumare lo stesso
-- codice 6-cifre. Questa RPC consolida tutto in 1 transazione: il primo
-- UPDATE atomico vince (RETURNING != NULL), il secondo perde (RETURNING NULL).
CREATE OR REPLACE FUNCTION public.claim_pairing_code_atomic(
    p_code text,
    p_token_hash text,
    p_device_name text,
    p_device_type text,
    p_browser text,
    p_user_agent text,
    p_last_ip text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_code RECORD;
  v_device_id uuid;
  v_now timestamptz := now();
BEGIN
  IF p_code IS NULL OR p_code !~ '^\d{6}$' THEN
    RAISE EXCEPTION 'invalid_code_format' USING ERRCODE = 'check_violation';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_token_hash' USING ERRCODE = 'check_violation';
  END IF;

  -- Consumo atomico: solo UNA transazione vince. La condizione consumed_at
  -- IS NULL e' valutata e settata atomicamente.
  UPDATE pairing_codes
  SET consumed_at = v_now
  WHERE code = p_code
    AND consumed_at IS NULL
    AND expires_at > v_now
  RETURNING tenant_id, event_id, room_id, generated_by_user_id
  INTO v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'code_invalid_or_expired' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO paired_devices (
    tenant_id, event_id, room_id, device_name, device_type,
    browser, user_agent, pair_token_hash, last_ip, last_seen_at,
    status, paired_by_user_id
  ) VALUES (
    v_code.tenant_id, v_code.event_id, v_code.room_id,
    NULLIF(trim(p_device_name), ''),
    p_device_type, p_browser, p_user_agent, p_token_hash, p_last_ip, v_now,
    'online', v_code.generated_by_user_id
  )
  RETURNING id INTO v_device_id;

  -- Aggiorna il codice con il device.id (UPDATE secondario nella stessa tx).
  UPDATE pairing_codes
  SET consumed_by_device_id = v_device_id
  WHERE code = p_code;

  RETURN jsonb_build_object(
    'device_id', v_device_id,
    'tenant_id', v_code.tenant_id,
    'event_id', v_code.event_id,
    'room_id', v_code.room_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pairing_code_atomic(text, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_pairing_code_atomic(text, text, text, text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.claim_pairing_code_atomic(text, text, text, text, text, text, text) IS
  'Audit-fix 2026-04-18: claim atomico pairing code (no TOCTOU race).';
