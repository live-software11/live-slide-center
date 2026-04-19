-- ============================================================================
-- Audit fix 2026-04-19 — Upload da PC sala: blocca init su device offline
-- ============================================================================
-- Bug rilevato in audit completo:
--   - `rpc_revoke_pair_self` (Sprint Z) marca `paired_devices.status = 'offline'`
--     ma NON rimuove `pair_token_hash`. Un device "disconnesso" puo' ancora
--     chiamare `init_upload_version_for_room_device` se l'utente conserva il
--     pair_token plain (es. caching localStorage del browser, file locale).
--   - Conseguenza: un PC sala revocato dall'admin puo' continuare a creare
--     presentation_versions e occupare quota storage del tenant.
--
-- Fix:
--   - `init_upload_version_for_room_device`: blocca con `device_offline` se
--     `paired_devices.status = 'offline'`. Lo stato `degraded` (rete instabile)
--     resta consentito perche' temporaneo e non revoca esplicita.
--   - `finalize_upload_version_for_room_device`: lascia passare anche `offline`
--     perche' l'upload era gia' in corso al momento della disconnessione e
--     vogliamo che l'utente possa completarlo (la version e' gia' 'uploading'
--     dal punto di vista DB, lo stato del device e' cambiato dopo l'init).
--   - `abort_upload_version_for_room_device`: lascia passare per cleanup.
--
-- Trade-off: non invalidiamo il `pair_token_hash` su revoke (eviterebbe alla
-- radice il problema) per non rompere lo Sprint Z (l'utente puo' rifare
-- "online" su PC sala riprendendo la sessione). Il check di status copre il
-- caso d'uso 99% (device esplicitamente revocato/spento dal pannello admin).
--
-- Impatto: zero data loss, nessuna policy RLS modificata, nessun GRANT cambiato.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.init_upload_version_for_room_device(
    p_token text,
    p_session_id uuid,
    p_filename text,
    p_size bigint,
    p_mime text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_hash TEXT;
  v_device RECORD;
  v_session RECORD;
  v_tenant_suspended BOOLEAN;
  v_event_status text;
  v_max_file BIGINT;
  v_storage_used BIGINT;
  v_storage_limit BIGINT;
  v_presentation_id UUID;
  v_version_id UUID;
  v_storage_key TEXT;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'check_violation';
  END IF;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT id, tenant_id, event_id, room_id, status, device_name
    INTO v_device
  FROM paired_devices
  WHERE pair_token_hash = v_hash
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = 'check_violation';
  END IF;

  -- AUDIT FIX 2026-04-19: rifiuta init se device esplicitamente offline.
  -- Lo stato 'offline' significa revoca utente (rpc_revoke_pair_self) o
  -- mancato heartbeat per >X minuti — in entrambi i casi l'upload non e'
  -- desiderato e potrebbe sfruttare quota di un device "spento".
  IF v_device.status = 'offline' THEN
    RAISE EXCEPTION 'device_offline' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_device.room_id IS NULL THEN
    RAISE EXCEPTION 'device_no_room_assigned' USING ERRCODE = 'check_violation';
  END IF;

  SELECT suspended INTO v_tenant_suspended
  FROM tenants WHERE id = v_device.tenant_id;
  IF v_tenant_suspended THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_session_id IS NULL OR p_filename IS NULL OR p_size IS NULL OR p_size <= 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_filename) > 255 THEN
    RAISE EXCEPTION 'filename_too_long' USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.id, s.event_id, s.tenant_id, s.room_id
    INTO v_session
  FROM sessions s
  WHERE s.id = p_session_id
    AND s.tenant_id = v_device.tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;
  IF v_session.room_id IS DISTINCT FROM v_device.room_id THEN
    RAISE EXCEPTION 'session_cross_room_not_allowed' USING ERRCODE = 'check_violation';
  END IF;
  IF v_session.event_id IS DISTINCT FROM v_device.event_id THEN
    RAISE EXCEPTION 'session_cross_event_not_allowed' USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_event_status FROM events WHERE id = v_session.event_id;
  IF v_event_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
  END IF;

  v_max_file := public.tenant_max_file_size(v_device.tenant_id);
  IF v_max_file IS NOT NULL AND p_size > v_max_file THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = 'check_violation';
  END IF;

  SELECT storage_used_bytes, storage_limit_bytes
    INTO v_storage_used, v_storage_limit
  FROM tenants WHERE id = v_device.tenant_id;
  IF v_storage_limit >= 0 AND (v_storage_used + p_size) > v_storage_limit THEN
    RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO presentations (speaker_id, session_id, event_id, tenant_id, status)
  VALUES (NULL, v_session.id, v_session.event_id, v_device.tenant_id, 'pending')
  RETURNING id INTO v_presentation_id;

  v_version_id := gen_random_uuid();
  v_storage_key := format(
    '%s/%s/%s/%s-%s',
    v_device.tenant_id,
    v_session.event_id,
    v_presentation_id,
    v_version_id,
    regexp_replace(p_filename, '[^A-Za-z0-9._-]', '_', 'g')
  );

  INSERT INTO presentation_versions (
    id, presentation_id, tenant_id, version_number,
    storage_key, file_name, file_size_bytes, mime_type,
    uploaded_by_speaker, upload_source, status
  )
  VALUES (
    v_version_id, v_presentation_id, v_device.tenant_id, 1,
    v_storage_key, p_filename, p_size, COALESCE(p_mime, 'application/octet-stream'),
    false, 'room_device', 'uploading'
  );

  INSERT INTO activity_log (
    tenant_id, event_id, actor, actor_id, actor_name, action,
    entity_type, entity_id, metadata
  )
  VALUES (
    v_device.tenant_id, v_session.event_id, 'device',
    v_device.id::text, v_device.device_name, 'upload_init_room_device',
    'presentation_version', v_version_id,
    jsonb_build_object(
      'file_name', p_filename,
      'size', p_size,
      'session_id', v_session.id,
      'room_id', v_device.room_id,
      'device_id', v_device.id
    )
  );

  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'presentation_id', v_presentation_id,
    'storage_key', v_storage_key,
    'bucket', 'presentations',
    'room_id', v_device.room_id,
    'device_id', v_device.id,
    'session_id', v_session.id,
    'tenant_id', v_device.tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.init_upload_version_for_room_device(text, uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.init_upload_version_for_room_device(text, uuid, text, bigint, text) TO service_role;

COMMENT ON FUNCTION public.init_upload_version_for_room_device IS
  'Sprint R-3 + audit-fix 2026-04-19: PC sala (auth via device_token hash) avvia upload nuova versione su sessione della propria sala. Rifiuta se device.status=offline (revoca esplicita o disconnessione). Ritorna metadata per signed upload URL Storage.';
