-- Room workflow refactor (Apr 2026):
--   1) presentations.speaker_id nullable -> upload diretto su sessione, senza relatori.
--   2) RPC init_upload_version_for_session(p_session_id, p_filename, p_size, p_mime)
--      crea presentation senza speaker, version 'uploading', validazioni quota/role.
--   3) RPC delete_presentation_admin(p_presentation_id) per rimozione file admin.
--   4) RPC rename_paired_device_by_token(p_token, p_name) per autonomia PC sala
--      (auth via hash token, no JWT richiesto).
--   5) Indice parziale: UNIQUE(speaker_id) WHERE speaker_id IS NOT NULL.
--
-- Compatibile con RPC esistenti (init_upload_version_admin/finalize/abort restano).

-- ── 1. speaker_id nullable + indice parziale unicita' ─────────────────────
ALTER TABLE public.presentations ALTER COLUMN speaker_id DROP NOT NULL;

DROP INDEX IF EXISTS public.presentations_speaker_unique;

CREATE UNIQUE INDEX presentations_speaker_unique
  ON public.presentations(speaker_id)
  WHERE speaker_id IS NOT NULL;

-- ── 2. init_upload_version_for_session ────────────────────────────────────
-- Crea (o riusa) una presentation legata SOLO alla sessione (speaker_id NULL).
-- Per supportare upload multipli per sessione senza relatore, ogni init crea
-- SEMPRE una nuova presentation (no UPSERT). Il vincolo unique parziale
-- esclude le righe con speaker_id NULL.
CREATE OR REPLACE FUNCTION public.init_upload_version_for_session(
    p_session_id uuid,
    p_filename text,
    p_size bigint,
    p_mime text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_session RECORD;
  v_event_status event_status;
  v_max_file BIGINT;
  v_storage_used BIGINT;
  v_storage_limit BIGINT;
  v_presentation_id UUID;
  v_version_id UUID;
  v_storage_key TEXT;
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
  IF p_session_id IS NULL OR p_filename IS NULL OR p_size IS NULL OR p_size <= 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_filename) > 255 THEN
    RAISE EXCEPTION 'filename_too_long' USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.id, s.event_id, s.tenant_id, s.room_id
    INTO v_session
  FROM sessions s
  WHERE s.id = p_session_id AND s.tenant_id = v_tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;

  SELECT status INTO v_event_status FROM events WHERE id = v_session.event_id;
  IF v_event_status IN ('closed', 'archived') THEN
    RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
  END IF;

  v_max_file := public.tenant_max_file_size(v_tenant_id);
  IF v_max_file IS NOT NULL AND p_size > v_max_file THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = 'check_violation';
  END IF;
  SELECT storage_used_bytes, storage_limit_bytes
    INTO v_storage_used, v_storage_limit
  FROM tenants WHERE id = v_tenant_id;
  IF v_storage_limit >= 0 AND (v_storage_used + p_size) > v_storage_limit THEN
    RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO presentations (speaker_id, session_id, event_id, tenant_id, status)
  VALUES (NULL, v_session.id, v_session.event_id, v_tenant_id, 'pending')
  RETURNING id INTO v_presentation_id;

  v_version_id := gen_random_uuid();
  v_storage_key := format(
    '%s/%s/%s/%s-%s',
    v_tenant_id,
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
    v_version_id, v_presentation_id, v_tenant_id, 0,
    v_storage_key, p_filename, p_size,
    COALESCE(p_mime, 'application/octet-stream'),
    false, 'web_portal', 'uploading'
  );

  v_user := (auth.jwt()->>'sub')::uuid;
  INSERT INTO activity_log (
    tenant_id, event_id, actor, actor_id, action,
    entity_type, entity_id, metadata
  )
  VALUES (
    v_tenant_id, v_session.event_id, 'user',
    COALESCE(v_user::text, ''), 'upload_init_session',
    'presentation_version', v_version_id,
    jsonb_build_object('file_name', p_filename, 'size', p_size, 'session_id', v_session.id)
  );

  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'presentation_id', v_presentation_id,
    'storage_key', v_storage_key,
    'bucket', 'presentations'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.init_upload_version_for_session(uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.init_upload_version_for_session(uuid, text, bigint, text) TO authenticated;

-- ── 3. delete_presentation_admin: rimuove presentation + versions + objects ─
-- Cancella la riga presentation (CASCADE su presentation_versions). Lo storage
-- viene ripulito da un trigger o via Edge Function: qui marchiamo la presentation
-- come archived per soft-delete; chiamante puo' poi rimuovere oggetti storage.
-- Ritorna lista storage_key da rimuovere lato Edge.
CREATE OR REPLACE FUNCTION public.delete_presentation_admin(p_presentation_id uuid)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_pres RECORD;
  v_storage_keys text[];
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
  IF p_presentation_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, event_id, tenant_id INTO v_pres
  FROM presentations
  WHERE id = p_presentation_id AND tenant_id = v_tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'presentation_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;

  SELECT array_agg(storage_key) INTO v_storage_keys
  FROM presentation_versions WHERE presentation_id = p_presentation_id;

  DELETE FROM presentations WHERE id = p_presentation_id;

  v_user := (auth.jwt()->>'sub')::uuid;
  INSERT INTO activity_log (
    tenant_id, event_id, actor, actor_id, action,
    entity_type, entity_id, metadata
  )
  VALUES (
    v_tenant_id, v_pres.event_id, 'user',
    COALESCE(v_user::text, ''), 'delete_presentation',
    'presentation', p_presentation_id,
    jsonb_build_object('storage_keys', COALESCE(v_storage_keys, ARRAY[]::text[]))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'storage_keys', COALESCE(to_jsonb(v_storage_keys), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_presentation_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_presentation_admin(uuid) TO authenticated;

-- ── 4. rename_paired_device_by_token: PC sala si autorinomina ─────────────
-- Auth: hash del device_token. Idempotente; aggiorna anche last_seen_at.
CREATE OR REPLACE FUNCTION public.rename_paired_device_by_token(
  p_token text,
  p_name text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_hash text;
  v_clean_name text;
  v_device RECORD;
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'invalid_token' USING ERRCODE = 'check_violation';
  END IF;
  IF p_name IS NULL THEN
    RAISE EXCEPTION 'invalid_name' USING ERRCODE = 'check_violation';
  END IF;
  v_clean_name := trim(both ' ' FROM p_name);
  IF length(v_clean_name) = 0 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'invalid_name_length' USING ERRCODE = 'check_violation';
  END IF;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT id, tenant_id, event_id INTO v_device
  FROM paired_devices
  WHERE pair_token_hash = v_hash
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'device_not_found' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE paired_devices
  SET device_name = v_clean_name,
      last_seen_at = now(),
      updated_at = now()
  WHERE id = v_device.id;

  RETURN jsonb_build_object('ok', true, 'device_id', v_device.id, 'device_name', v_clean_name);
END;
$$;

REVOKE ALL ON FUNCTION public.rename_paired_device_by_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rename_paired_device_by_token(text, text) TO anon, authenticated;
