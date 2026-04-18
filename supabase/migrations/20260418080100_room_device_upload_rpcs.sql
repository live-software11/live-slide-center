-- ════════════════════════════════════════════════════════════════════════════
-- Sprint R-3 (G3) — RPC upload da PC sala (relatore last-minute)
-- ════════════════════════════════════════════════════════════════════════════
--
-- OBIETTIVO: relatore arriva ultimo-minuto in sala con la sua chiavetta USB e
-- vuole caricare/sostituire il file della propria sessione direttamente dal PC
-- sala (oggi solo `RoomPlayerView` read-only). Il device e' autenticato col
-- solo `device_token` (no JWT utente) → serve un percorso parallelo a
-- `init/finalize/abort_upload_version_admin` ma autenticato via hash token.
--
-- INVARIANTI:
--  • Il device deve avere `room_id NOT NULL` (no upload da device "spaiati").
--  • La sessione su cui si carica deve essere DELLA STESSA SALA del device
--    (no cross-room: relatore in sala A non puo' caricare per sala B).
--  • Stesse validazioni di `init_upload_version_for_session`: tenant suspended,
--    evento closed/archived, file_size, storage quota.
--  • Activity log con `actor='device'` + `actor_id=device_id` (audit chiaro).
--
-- COMPATIBILITA':
--  • Richiede `'room_device'` aggiunto all'enum `upload_source` da migration
--    20260418080000_room_device_upload_enum.sql (già committato).
--  • Tre RPC nuove, NON modifica le esistenti.
--
-- L'Edge Function `room-device-upload-init` chiamera' la RPC init e poi
-- generera' un signed upload URL Supabase Storage con service_role: cosi' il
-- PC sala (non authenticated) puo' fare PUT diretto senza forwardare via
-- Edge Function (che ha limite 6MB e raddoppierebbe la banda).

-- ── 1. RPC: init_upload_version_for_room_device ────────────────────────────
-- Auth: hash(p_token) vs paired_devices.pair_token_hash.
-- Crea una NUOVA presentation 'pending' (speaker_id NULL) + version 'uploading'.
-- Returns: jsonb { version_id, presentation_id, storage_key, bucket, room_id,
--                  device_id, session_id, tenant_id }
-- L'Edge Function userà i dati per generare il signed upload URL Storage.
CREATE OR REPLACE FUNCTION public.init_upload_version_for_room_device(
    p_token text,
    p_session_id uuid,
    p_filename text,
    p_size bigint,
    p_mime text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_hash text;
  v_device RECORD;
  v_tenant_suspended boolean;
  v_session RECORD;
  v_event_status event_status;
  v_max_file BIGINT;
  v_storage_used BIGINT;
  v_storage_limit BIGINT;
  v_presentation_id UUID;
  v_version_id UUID;
  v_storage_key TEXT;
BEGIN
  -- 1) Auth device via hash token
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
  IF v_device.room_id IS NULL THEN
    RAISE EXCEPTION 'device_no_room_assigned' USING ERRCODE = 'check_violation';
  END IF;

  -- 2) Tenant non sospeso
  SELECT suspended INTO v_tenant_suspended
  FROM tenants WHERE id = v_device.tenant_id;
  IF v_tenant_suspended THEN
    RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 3) Validazione input
  IF p_session_id IS NULL OR p_filename IS NULL OR p_size IS NULL OR p_size <= 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_filename) > 255 THEN
    RAISE EXCEPTION 'filename_too_long' USING ERRCODE = 'check_violation';
  END IF;

  -- 4) Sessione esiste, stesso tenant del device, STESSA SALA del device.
  --    Cross-room non ammesso: relatore in sala A NON puo' caricare per sala B.
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

  -- 5) Evento attivo
  SELECT status INTO v_event_status FROM events WHERE id = v_session.event_id;
  IF v_event_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
  END IF;

  -- 6) File size cap del piano
  v_max_file := public.tenant_max_file_size(v_device.tenant_id);
  IF v_max_file IS NOT NULL AND p_size > v_max_file THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = 'check_violation';
  END IF;

  -- 7) Quota storage tenant
  SELECT storage_used_bytes, storage_limit_bytes
    INTO v_storage_used, v_storage_limit
  FROM tenants WHERE id = v_device.tenant_id;
  IF v_storage_limit >= 0 AND (v_storage_used + p_size) > v_storage_limit THEN
    RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'check_violation';
  END IF;

  -- 8) Crea presentation (speaker_id NULL: il file e' della sessione, non
  --    legato a uno speaker specifico — lo sara' eventualmente l'admin in seguito)
  INSERT INTO presentations (speaker_id, session_id, event_id, tenant_id, status)
  VALUES (NULL, v_session.id, v_session.event_id, v_device.tenant_id, 'pending')
  RETURNING id INTO v_presentation_id;

  -- 9) Crea version 'uploading'
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
    v_version_id, v_presentation_id, v_device.tenant_id, 0,
    v_storage_key, p_filename, p_size,
    COALESCE(p_mime, 'application/octet-stream'),
    false, 'room_device', 'uploading'
  );

  -- 10) Activity log: actor='device' actor_id=device_id actor_name=PC name
  --     L'admin nel feed vede subito "PC sala 1 → upload_init_room_device" senza
  --     dover decodificare l'UUID.
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
-- Concesso solo a service_role: solo le Edge Function (con
-- SUPABASE_SERVICE_ROLE_KEY) possono invocare questa RPC. Il client web/mobile
-- NON la chiama mai direttamente — sempre via Edge Function
-- `room-device-upload-init`. Questo e' il pattern Sprint R-3 §0.11.
GRANT EXECUTE ON FUNCTION public.init_upload_version_for_room_device(text, uuid, text, bigint, text) TO service_role;

-- ── 2. RPC: finalize_upload_version_for_room_device ────────────────────────
-- Promuove version a 'ready', presentation a 'uploaded', altre versioni
-- 'superseded'. Identico a finalize_upload_version_admin ma auth via token hash.
CREATE OR REPLACE FUNCTION public.finalize_upload_version_for_room_device(
    p_token text,
    p_version_id uuid,
    p_sha256 text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_hash text;
  v_device RECORD;
  v_tenant_suspended boolean;
  v_version RECORD;
  v_object RECORD;
  v_event_id uuid;
  v_session_id uuid;
  v_presentation_id uuid;
  v_file_name text;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'check_violation';
  END IF;
  IF p_version_id IS NULL THEN
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

  -- Verifica che la version appartenga al tenant del device.
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

  -- Verifica che l'oggetto Storage esista (upload completato dal client)
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

  -- Le altre versioni 'ready' della stessa presentation diventano 'superseded'
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

-- ── 3. RPC: abort_upload_version_for_room_device ───────────────────────────
-- Cleanup su errore client. Marca version 'failed'. Non ha bisogno di
-- verificare tenant_suspended: serve a non lasciare orfani anche su sospensione
-- arrivata mentre upload in corso.
CREATE OR REPLACE FUNCTION public.abort_upload_version_for_room_device(
    p_token text,
    p_version_id uuid
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_hash text;
  v_device RECORD;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'check_violation';
  END IF;
  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  SELECT id, tenant_id INTO v_device
  FROM paired_devices
  WHERE pair_token_hash = v_hash
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE presentation_versions
  SET status = 'failed'
  WHERE id = p_version_id
    AND tenant_id = v_device.tenant_id
    AND status = 'uploading';

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.abort_upload_version_for_room_device(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abort_upload_version_for_room_device(text, uuid) TO service_role;

COMMENT ON FUNCTION public.init_upload_version_for_room_device IS
  'Sprint R-3: PC sala (auth via device_token hash) avvia upload nuova versione su sessione della propria sala. Ritorna metadata per signed upload URL Storage.';
COMMENT ON FUNCTION public.finalize_upload_version_for_room_device IS
  'Sprint R-3: PC sala finalizza upload, promuove version a ready e supersedes altre versions. Activity log con actor=device.';
COMMENT ON FUNCTION public.abort_upload_version_for_room_device IS
  'Sprint R-3: PC sala cleanup upload fallito. Marca version a failed anche su tenant suspended per non lasciare orfani.';
