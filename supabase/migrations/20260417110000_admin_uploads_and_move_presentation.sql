-- Sprint 2 (NUOVO) — Upload diretto admin/coordinator + spostamento presentazioni.
-- Contenuti:
--  1) Storage RLS: authenticated tenant può INSERT su path nel proprio tenant in version 'uploading'
--  2) Helper has_tenant_admin_role() per restringere RPC a admin/coordinator/super_admin
--  3) Vincolo idempotente UNIQUE(speaker_id) su presentations per scongiurare race
--  4) RPC SECURITY DEFINER per upload diretto da utenti loggati (no upload_token):
--     - init_upload_version_admin(p_speaker_id, p_filename, p_size, p_mime)
--     - finalize_upload_version_admin(p_version_id, p_sha256)
--     - abort_upload_version_admin(p_version_id)
--  5) RPC rpc_move_presentation(p_presentation_id, p_target_speaker_id):
--     sposta presentation tra speaker dello stesso evento/tenant.
-- ── 1. Storage RLS: INSERT da authenticated tenant ────────────────────────
-- Permette upload diretto da admin/coordinator tenant, vincolato a una
-- presentation_versions in stato 'uploading' e tenant_id == app_tenant_id().
DO $$ BEGIN CREATE POLICY "tenant_insert_uploading_version" ON storage.objects FOR
INSERT TO authenticated WITH CHECK (
    bucket_id = 'presentations'
    AND EXISTS (
      SELECT 1
      FROM public.presentation_versions pv
      WHERE pv.storage_key = storage.objects.name
        AND pv.status = 'uploading'
        AND pv.tenant_id = public.app_tenant_id()
    )
  );
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
-- ── 1b. Helper has_tenant_admin_role: solo admin/coordinator/super_admin ─
-- Usato dalle RPC *_admin per rifiutare ruolo 'tech' (sola lettura).
CREATE OR REPLACE FUNCTION public.has_tenant_admin_role() RETURNS boolean LANGUAGE sql STABLE
SET search_path = public AS $$
SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = (auth.jwt()->>'sub')::uuid
      AND u.tenant_id = public.app_tenant_id()
      AND u.role IN ('admin', 'coordinator', 'super_admin')
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_tenant_admin_role() TO authenticated;
-- ── 1c. Vincolo unicita' speaker → presentation (idempotente) ───────────
-- Modello 1:1 documentato altrove. Necessario per UPSERT/race protection.
DO $$ BEGIN IF NOT EXISTS (
  SELECT 1
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'presentations_speaker_unique'
) THEN -- Se esistono duplicati legacy, fail loud: vanno bonificati prima.
CREATE UNIQUE INDEX presentations_speaker_unique ON public.presentations(speaker_id);
END IF;
END $$;
-- ── 2. init_upload_version_admin — versione draft da admin tenant ────────
-- Prerequisiti applicati prima dell'INSERT:
--   1) JWT con tenant valido    2) ruolo admin/coordinator/super_admin
--   3) tenant non sospeso       4) speaker stesso tenant
--   5) evento non chiuso/archiviato
--   6) file size entro plan cap 7) storage entro quota tenant
--   8) idempotenza presentation: ON CONFLICT(speaker_id) DO UPDATE per evitare race
CREATE OR REPLACE FUNCTION public.init_upload_version_admin(
    p_speaker_id uuid,
    p_filename text,
    p_size bigint,
    p_mime text
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant_id uuid;
v_speaker RECORD;
v_event_status event_status;
v_max_file BIGINT;
v_storage_used BIGINT;
v_storage_limit BIGINT;
v_presentation_id UUID;
v_version_id UUID;
v_storage_key TEXT;
v_user uuid;
BEGIN v_tenant_id := public.app_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
END IF;
IF NOT public.has_tenant_admin_role() THEN RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
END IF;
IF public.current_tenant_suspended() THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
END IF;
IF p_speaker_id IS NULL
OR p_filename IS NULL
OR p_size IS NULL
OR p_size <= 0 THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
END IF;
IF length(p_filename) > 255 THEN RAISE EXCEPTION 'filename_too_long' USING ERRCODE = 'check_violation';
END IF;
SELECT sp.id,
  sp.session_id,
  sp.event_id,
  sp.tenant_id INTO v_speaker
FROM speakers sp
WHERE sp.id = p_speaker_id
  AND sp.tenant_id = v_tenant_id
LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'speaker_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
END IF;
SELECT status INTO v_event_status
FROM events
WHERE id = v_speaker.event_id;
IF v_event_status IN ('closed', 'archived') THEN RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
END IF;
v_max_file := public.tenant_max_file_size(v_tenant_id);
IF v_max_file IS NOT NULL
AND p_size > v_max_file THEN RAISE EXCEPTION 'file_too_large' USING ERRCODE = 'check_violation';
END IF;
SELECT storage_used_bytes,
  storage_limit_bytes INTO v_storage_used,
  v_storage_limit
FROM tenants
WHERE id = v_tenant_id;
IF v_storage_limit >= 0
AND (v_storage_used + p_size) > v_storage_limit THEN RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'check_violation';
END IF;
-- UPSERT idempotente: il vincolo UNIQUE(speaker_id) garantisce no duplicati anche su race.
INSERT INTO presentations (
    speaker_id,
    session_id,
    event_id,
    tenant_id,
    status
  )
VALUES (
    v_speaker.id,
    v_speaker.session_id,
    v_speaker.event_id,
    v_tenant_id,
    'pending'
  ) ON CONFLICT (speaker_id) DO
UPDATE
SET updated_at = now()
RETURNING id INTO v_presentation_id;
v_version_id := gen_random_uuid();
v_storage_key := format(
  '%s/%s/%s/%s-%s',
  v_tenant_id,
  v_speaker.event_id,
  v_presentation_id,
  v_version_id,
  regexp_replace(p_filename, '[^A-Za-z0-9._-]', '_', 'g')
);
INSERT INTO presentation_versions (
    id,
    presentation_id,
    tenant_id,
    version_number,
    storage_key,
    file_name,
    file_size_bytes,
    mime_type,
    uploaded_by_speaker,
    upload_source,
    status
  )
VALUES (
    v_version_id,
    v_presentation_id,
    v_tenant_id,
    0,
    v_storage_key,
    p_filename,
    p_size,
    COALESCE(p_mime, 'application/octet-stream'),
    false,
    'web_portal',
    'uploading'
  );
v_user := (auth.jwt()->>'sub')::uuid;
INSERT INTO activity_log (
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
    v_tenant_id,
    v_speaker.event_id,
    'user',
    COALESCE(v_user::text, ''),
    'upload_init_admin',
    'presentation_version',
    v_version_id,
    jsonb_build_object(
      'file_name',
      p_filename,
      'size',
      p_size,
      'speaker_id',
      v_speaker.id
    )
  );
RETURN jsonb_build_object(
  'version_id',
  v_version_id,
  'presentation_id',
  v_presentation_id,
  'storage_key',
  v_storage_key,
  'bucket',
  'presentations'
);
END;
$$;
REVOKE ALL ON FUNCTION public.init_upload_version_admin(uuid, text, bigint, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.init_upload_version_admin(uuid, text, bigint, text) TO authenticated;
-- ── 3. finalize_upload_version_admin — promuove a 'ready' ────────────────
CREATE OR REPLACE FUNCTION public.finalize_upload_version_admin(p_version_id uuid, p_sha256 text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant_id uuid;
v_version RECORD;
v_object RECORD;
v_user uuid;
v_event uuid;
BEGIN v_tenant_id := public.app_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
END IF;
IF NOT public.has_tenant_admin_role() THEN RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
END IF;
IF public.current_tenant_suspended() THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
END IF;
IF p_version_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
END IF;
IF p_sha256 IS NULL
OR p_sha256 !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_sha256' USING ERRCODE = 'check_violation';
END IF;
SELECT pv.id,
  pv.presentation_id,
  pv.tenant_id,
  pv.storage_key,
  pv.status,
  pv.file_size_bytes INTO v_version
FROM presentation_versions pv
WHERE pv.id = p_version_id
  AND pv.tenant_id = v_tenant_id
LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'version_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
END IF;
IF v_version.status <> 'uploading' THEN RAISE EXCEPTION 'version_not_uploading' USING ERRCODE = 'check_violation';
END IF;
SELECT o.name,
  (o.metadata->>'size')::bigint AS size INTO v_object
FROM storage.objects o
WHERE o.bucket_id = 'presentations'
  AND o.name = v_version.storage_key
LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'object_missing' USING ERRCODE = 'check_violation';
END IF;
UPDATE presentation_versions
SET status = 'ready',
  file_hash_sha256 = p_sha256,
  file_size_bytes = COALESCE(v_object.size, file_size_bytes)
WHERE id = p_version_id;
UPDATE presentations
SET current_version_id = p_version_id,
  total_versions = total_versions + 1,
  status = CASE
    WHEN status = 'pending' THEN 'uploaded'
    ELSE status
  END
WHERE id = v_version.presentation_id
RETURNING event_id INTO v_event;
-- Le altre versioni 'ready' della stessa presentation diventano 'superseded'
UPDATE presentation_versions
SET status = 'superseded'
WHERE presentation_id = v_version.presentation_id
  AND id <> p_version_id
  AND status = 'ready';
v_user := (auth.jwt()->>'sub')::uuid;
INSERT INTO activity_log (
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
    v_tenant_id,
    v_event,
    'user',
    COALESCE(v_user::text, ''),
    'upload_finalize_admin',
    'presentation_version',
    p_version_id,
    jsonb_build_object(
      'sha256',
      p_sha256,
      'size',
      COALESCE(v_object.size, v_version.file_size_bytes)
    )
  );
RETURN jsonb_build_object('ok', true, 'version_id', p_version_id);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_upload_version_admin(uuid, text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_upload_version_admin(uuid, text) TO authenticated;
-- ── 4. abort_upload_version_admin — cleanup su errore client ─────────────
-- NOTA: ammette anche tenant suspended (per non lasciare versioni 'uploading'
--       orfane se la sospensione è arrivata mentre un upload era in corso).
CREATE OR REPLACE FUNCTION public.abort_upload_version_admin(p_version_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant_id uuid;
BEGIN v_tenant_id := public.app_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
END IF;
IF NOT public.has_tenant_admin_role() THEN RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
END IF;
IF p_version_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
END IF;
UPDATE presentation_versions
SET status = 'failed'
WHERE id = p_version_id
  AND tenant_id = v_tenant_id
  AND status = 'uploading';
RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.abort_upload_version_admin(uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abort_upload_version_admin(uuid) TO authenticated;
-- ── 5. rpc_move_presentation — sposta presentation tra speaker ───────────
-- Validazione: stesso tenant, stesso evento, ruolo admin/coordinator/super_admin,
--              tenant non sospeso, evento non chiuso/archiviato,
--              presentation non in stato 'archived' (immutabile post-evento).
-- Speaker target non deve avere gia' una presentation (vincolo presentations_speaker_unique).
-- La presentation segue: speaker_id e session_id si aggiornano allo speaker target.
CREATE OR REPLACE FUNCTION public.rpc_move_presentation(
    p_presentation_id uuid,
    p_target_speaker_id uuid
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant_id uuid;
v_pres RECORD;
v_event_status event_status;
v_target_speaker RECORD;
v_existing_target_pres uuid;
v_user uuid;
BEGIN v_tenant_id := public.app_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
END IF;
IF NOT public.has_tenant_admin_role() THEN RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
END IF;
IF public.current_tenant_suspended() THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
END IF;
IF p_presentation_id IS NULL
OR p_target_speaker_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
END IF;
-- Lock advisory transazionale per scongiurare two-move concorrenti su stessa presentation.
PERFORM pg_advisory_xact_lock(
  hashtext(
    'rpc_move_presentation:' || p_presentation_id::text
  )
);
SELECT id,
  tenant_id,
  event_id,
  speaker_id,
  session_id,
  status INTO v_pres
FROM presentations
WHERE id = p_presentation_id
  AND tenant_id = v_tenant_id FOR
UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'presentation_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
END IF;
IF v_pres.status = 'archived' THEN RAISE EXCEPTION 'presentation_archived' USING ERRCODE = 'check_violation';
END IF;
SELECT status INTO v_event_status
FROM events
WHERE id = v_pres.event_id;
IF v_event_status IN ('closed', 'archived') THEN RAISE EXCEPTION 'event_closed_or_archived' USING ERRCODE = 'check_violation';
END IF;
SELECT id,
  tenant_id,
  event_id,
  session_id INTO v_target_speaker
FROM speakers
WHERE id = p_target_speaker_id
  AND tenant_id = v_tenant_id
LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'target_speaker_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
END IF;
IF v_target_speaker.event_id <> v_pres.event_id THEN RAISE EXCEPTION 'cross_event_move_not_allowed' USING ERRCODE = 'check_violation';
END IF;
IF v_target_speaker.id = v_pres.speaker_id THEN RAISE EXCEPTION 'same_speaker_no_op' USING ERRCODE = 'check_violation';
END IF;
SELECT id INTO v_existing_target_pres
FROM presentations
WHERE speaker_id = p_target_speaker_id
LIMIT 1;
IF v_existing_target_pres IS NOT NULL THEN RAISE EXCEPTION 'target_speaker_has_presentation' USING ERRCODE = 'check_violation';
END IF;
UPDATE presentations
SET speaker_id = p_target_speaker_id,
  session_id = v_target_speaker.session_id,
  updated_at = now()
WHERE id = p_presentation_id;
v_user := (auth.jwt()->>'sub')::uuid;
INSERT INTO activity_log (
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
    v_tenant_id,
    v_pres.event_id,
    'user',
    COALESCE(v_user::text, ''),
    'move_presentation',
    'presentation',
    p_presentation_id,
    jsonb_build_object(
      'from_speaker_id',
      v_pres.speaker_id,
      'to_speaker_id',
      p_target_speaker_id,
      'from_session_id',
      v_pres.session_id,
      'to_session_id',
      v_target_speaker.session_id
    )
  );
RETURN jsonb_build_object(
  'ok',
  true,
  'presentation_id',
  p_presentation_id,
  'speaker_id',
  p_target_speaker_id,
  'session_id',
  v_target_speaker.session_id
);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_move_presentation(uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_move_presentation(uuid, uuid) TO authenticated;
