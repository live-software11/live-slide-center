-- Fase 3 — Upload Portal relatori (TUS).
-- Contenuti:
--  1) Bucket privato `presentations` (Supabase Storage)
--  2) Storage RLS: anon puo INSERT solo su path vincolati a una `presentation_versions` in stato 'uploading'
--  3) RPC SECURITY DEFINER per validazione upload_token, init versione draft, finalize versione
--  4) Rework contabilita storage_used_bytes: scatta al passaggio a 'ready' (non alla reservation)
--  5) Realtime: `presentations` pubblicata per la Vista Regia (Fase 5)

-- ── 1. Bucket privato `presentations` ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('presentations', 'presentations', false, NULL)
ON CONFLICT (id) DO NOTHING;

-- ── 2. Storage RLS: anon INSERT vincolato a version 'uploading' ──────────
-- NB: storage.objects.name contiene il path completo (senza prefisso bucket).
-- Il path e scelto dalla RPC init_upload_version e coincide con
-- presentation_versions.storage_key.
DO $$ BEGIN
  CREATE POLICY "anon_insert_uploading_version" ON storage.objects
    FOR INSERT TO anon
    WITH CHECK (
      bucket_id = 'presentations'
      AND EXISTS (
        SELECT 1 FROM public.presentation_versions pv
        WHERE pv.storage_key = storage.objects.name
          AND pv.status = 'uploading'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Lettura oggetti: solo utenti autenticati del tenant proprietario (via join)
-- Per Fase 3 il download avviene lato Edge Function/signed URL in fasi successive:
-- qui abilitiamo SELECT per 'authenticated' limitato al tenant del JWT.
DO $$ BEGIN
  CREATE POLICY "tenant_select_own_objects" ON storage.objects
    FOR SELECT TO authenticated
    USING (
      bucket_id = 'presentations'
      AND EXISTS (
        SELECT 1 FROM public.presentation_versions pv
        WHERE pv.storage_key = storage.objects.name
          AND pv.tenant_id = public.app_tenant_id()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "super_admin_select_objects" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'presentations' AND public.is_super_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 3. Rework storage_used_bytes: scatta sulla transizione a 'ready' ─────
-- L'attuale trigger AFTER INSERT contabilizza ogni draft, anche fallita.
-- Spostiamo la contabilita al momento in cui la versione diventa 'ready'
-- (via finalize) o torna da 'ready' ad altro stato (es. cleanup).
DROP TRIGGER IF EXISTS track_storage_used ON public.presentation_versions;

CREATE OR REPLACE FUNCTION public.update_storage_used() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'ready' AND OLD.status IS DISTINCT FROM 'ready' THEN
      UPDATE tenants SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes
        WHERE id = NEW.tenant_id;
    ELSIF OLD.status = 'ready' AND NEW.status IS DISTINCT FROM 'ready' THEN
      UPDATE tenants SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes)
        WHERE id = OLD.tenant_id;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'ready' THEN
      UPDATE tenants SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes)
        WHERE id = OLD.tenant_id;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER track_storage_used
  AFTER UPDATE OR DELETE ON public.presentation_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_storage_used();

-- ── 4. Helper plan cap: file size massimo per tenant ─────────────────────
CREATE OR REPLACE FUNCTION public.tenant_max_file_size(p_tenant_id uuid)
RETURNS BIGINT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE plan
    WHEN 'trial'      THEN 100::bigint * 1024 * 1024
    WHEN 'starter'    THEN 1::bigint * 1024 * 1024 * 1024
    WHEN 'pro'        THEN 2::bigint * 1024 * 1024 * 1024
    WHEN 'enterprise' THEN 5::bigint * 1024 * 1024 * 1024
  END
  FROM tenants WHERE id = p_tenant_id;
$$;

-- ── 5. RPC: validate_upload_token (lookup pubblico sicuro) ────────────────
-- Ritorna info minime necessarie al portale: evento, sessione, speaker,
-- plan caps, scadenza. Nessun dato cross-tenant. SECURITY DEFINER per
-- bypassare RLS di speakers/sessions/events quando chiamata da anon.
CREATE OR REPLACE FUNCTION public.validate_upload_token(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_row RECORD;
  v_max_file BIGINT;
  v_storage_used BIGINT;
  v_storage_limit BIGINT;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_token');
  END IF;

  SELECT sp.id AS speaker_id,
         sp.full_name AS speaker_name,
         sp.upload_token_expires_at,
         s.id AS session_id,
         s.title AS session_title,
         s.scheduled_start,
         e.id AS event_id,
         e.name AS event_name,
         e.start_date,
         e.end_date,
         t.id AS tenant_id,
         t.storage_used_bytes,
         t.storage_limit_bytes
    INTO v_row
    FROM speakers sp
    JOIN sessions s ON s.id = sp.session_id
    JOIN events e  ON e.id = sp.event_id
    JOIN tenants t ON t.id = sp.tenant_id
   WHERE sp.upload_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'not_found');
  END IF;

  IF v_row.upload_token_expires_at IS NOT NULL AND v_row.upload_token_expires_at < now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'expired');
  END IF;

  v_max_file := public.tenant_max_file_size(v_row.tenant_id);

  RETURN jsonb_build_object(
    'valid', true,
    'speaker_id', v_row.speaker_id,
    'speaker_name', v_row.speaker_name,
    'session_id', v_row.session_id,
    'session_title', v_row.session_title,
    'scheduled_start', v_row.scheduled_start,
    'event_id', v_row.event_id,
    'event_name', v_row.event_name,
    'event_start_date', v_row.start_date,
    'event_end_date', v_row.end_date,
    'max_file_size_bytes', v_max_file,
    'storage_remaining_bytes',
      CASE WHEN v_row.storage_limit_bytes < 0 THEN NULL
           ELSE GREATEST(0, v_row.storage_limit_bytes - v_row.storage_used_bytes) END,
    'expires_at', v_row.upload_token_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_upload_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_upload_token(text) TO anon, authenticated;

-- ── 6. RPC: init_upload_version — crea version draft ─────────────────────
-- Input: token + filename + size + mime. Valida cap file, cap storage,
-- crea (o riusa) presentations, crea presentation_version draft.
-- Ritorna {version_id, presentation_id, storage_key, bucket}.
CREATE OR REPLACE FUNCTION public.init_upload_version(
  p_token text,
  p_filename text,
  p_size bigint,
  p_mime text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_speaker RECORD;
  v_max_file BIGINT;
  v_storage_used BIGINT;
  v_storage_limit BIGINT;
  v_presentation_id UUID;
  v_version_id UUID;
  v_storage_key TEXT;
BEGIN
  IF p_token IS NULL OR p_filename IS NULL OR p_size IS NULL OR p_size <= 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_filename) > 255 THEN
    RAISE EXCEPTION 'filename_too_long' USING ERRCODE = 'check_violation';
  END IF;

  SELECT sp.id, sp.session_id, sp.event_id, sp.tenant_id, sp.upload_token_expires_at
    INTO v_speaker
    FROM speakers sp
   WHERE sp.upload_token = p_token
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'check_violation';
  END IF;
  IF v_speaker.upload_token_expires_at IS NOT NULL AND v_speaker.upload_token_expires_at < now() THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
  END IF;

  v_max_file := public.tenant_max_file_size(v_speaker.tenant_id);
  IF v_max_file IS NOT NULL AND p_size > v_max_file THEN
    RAISE EXCEPTION 'file_too_large' USING ERRCODE = 'check_violation';
  END IF;

  SELECT storage_used_bytes, storage_limit_bytes INTO v_storage_used, v_storage_limit
    FROM tenants WHERE id = v_speaker.tenant_id;
  IF v_storage_limit >= 0 AND (v_storage_used + p_size) > v_storage_limit THEN
    RAISE EXCEPTION 'storage_quota_exceeded' USING ERRCODE = 'check_violation';
  END IF;

  -- Idempotenza: 1 presentations per speaker (1:1 modello corrente)
  SELECT id INTO v_presentation_id FROM presentations
    WHERE speaker_id = v_speaker.id LIMIT 1;

  IF v_presentation_id IS NULL THEN
    INSERT INTO presentations (speaker_id, session_id, event_id, tenant_id, status)
    VALUES (v_speaker.id, v_speaker.session_id, v_speaker.event_id, v_speaker.tenant_id, 'pending')
    RETURNING id INTO v_presentation_id;
  END IF;

  v_version_id := gen_random_uuid();
  v_storage_key := format('%s/%s/%s/%s-%s',
    v_speaker.tenant_id, v_speaker.event_id, v_presentation_id,
    v_version_id, regexp_replace(p_filename, '[^A-Za-z0-9._-]', '_', 'g'));

  INSERT INTO presentation_versions (
    id, presentation_id, tenant_id, version_number, storage_key, file_name,
    file_size_bytes, mime_type, uploaded_by_speaker, upload_source, status
  ) VALUES (
    v_version_id, v_presentation_id, v_speaker.tenant_id, 0, v_storage_key, p_filename,
    p_size, COALESCE(p_mime, 'application/octet-stream'), true, 'web_portal', 'uploading'
  );
  -- version_number e riassegnato dal trigger BEFORE INSERT auto_version_number

  INSERT INTO activity_log (tenant_id, event_id, actor, actor_id, actor_name, action, entity_type, entity_id, metadata)
  VALUES (v_speaker.tenant_id, v_speaker.event_id, 'speaker', v_speaker.id::text, NULL,
          'upload_init', 'presentation_version', v_version_id,
          jsonb_build_object('file_name', p_filename, 'size', p_size));

  RETURN jsonb_build_object(
    'version_id', v_version_id,
    'presentation_id', v_presentation_id,
    'storage_key', v_storage_key,
    'bucket', 'presentations'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.init_upload_version(text,text,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.init_upload_version(text,text,bigint,text) TO anon, authenticated;

-- ── 7. RPC: finalize_upload_version — promuove a 'ready' ─────────────────
-- Input: token + version_id + sha256. Verifica appartenenza, setta status,
-- hash, dimensione reale (dall'oggetto su storage), aggiorna
-- presentations.current_version_id + status='uploaded'. Logga.
CREATE OR REPLACE FUNCTION public.finalize_upload_version(
  p_token text,
  p_version_id uuid,
  p_sha256 text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_speaker RECORD;
  v_version RECORD;
  v_object RECORD;
BEGIN
  IF p_token IS NULL OR p_version_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid_sha256' USING ERRCODE = 'check_violation';
  END IF;

  SELECT sp.id AS speaker_id, sp.tenant_id, sp.event_id, sp.upload_token_expires_at
    INTO v_speaker
    FROM speakers sp WHERE sp.upload_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'check_violation';
  END IF;
  IF v_speaker.upload_token_expires_at IS NOT NULL AND v_speaker.upload_token_expires_at < now() THEN
    RAISE EXCEPTION 'token_expired' USING ERRCODE = 'check_violation';
  END IF;

  SELECT pv.id, pv.presentation_id, pv.tenant_id, pv.storage_key, pv.status, pv.file_size_bytes
    INTO v_version
    FROM presentation_versions pv WHERE pv.id = p_version_id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'check_violation';
  END IF;
  IF v_version.tenant_id <> v_speaker.tenant_id THEN
    RAISE EXCEPTION 'tenant_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF v_version.status <> 'uploading' THEN
    RAISE EXCEPTION 'version_not_uploading' USING ERRCODE = 'check_violation';
  END IF;

  -- Verifica che l'oggetto esista davvero su Storage
  SELECT o.name, (o.metadata->>'size')::bigint AS size
    INTO v_object
    FROM storage.objects o
   WHERE o.bucket_id = 'presentations' AND o.name = v_version.storage_key
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'object_missing' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE presentation_versions
     SET status = 'ready',
         file_hash_sha256 = p_sha256,
         file_size_bytes = COALESCE(v_object.size, file_size_bytes)
   WHERE id = p_version_id;

  UPDATE presentations
     SET current_version_id = p_version_id,
         total_versions = total_versions + 1,
         status = 'uploaded'
   WHERE id = v_version.presentation_id;

  INSERT INTO activity_log (tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_speaker.tenant_id, v_speaker.event_id, 'speaker', v_speaker.speaker_id::text,
          'upload_finalize', 'presentation_version', p_version_id,
          jsonb_build_object('sha256', p_sha256, 'size', COALESCE(v_object.size, v_version.file_size_bytes)));

  RETURN jsonb_build_object('ok', true, 'version_id', p_version_id);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_upload_version(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_upload_version(text,uuid,text) TO anon, authenticated;

-- ── 8. RPC: abort_upload_version — cleanup su errore client ──────────────
CREATE OR REPLACE FUNCTION public.abort_upload_version(
  p_token text,
  p_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_tenant uuid;
BEGIN
  SELECT sp.tenant_id INTO v_tenant
    FROM speakers sp WHERE sp.upload_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'token_not_found' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE presentation_versions
     SET status = 'failed'
   WHERE id = p_version_id AND tenant_id = v_tenant AND status = 'uploading';

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.abort_upload_version(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.abort_upload_version(text,uuid) TO anon, authenticated;

-- ── 9. Realtime: pubblica presentations per Vista Regia (Fase 5) ─────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.presentations;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
