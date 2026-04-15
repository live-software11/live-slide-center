-- Fase 4 — Versioning + storico.
-- Contenuti:
--  1) Colonne review su presentations (reviewed_by, reviewed_at, reviewer_note)
--  2) RPC atomica rpc_set_current_version (rollback / set current)
--  3) RPC atomica rpc_update_presentation_status (workflow)
--  4) Trigger: quando current_version_id cambia, versioni non-current vengono
--     marcate 'superseded' (append-only: no UPDATE su dati, solo su stato)
--  5) Guard append-only: blocca UPDATE di storage_key / file_size_bytes /
--     file_hash_sha256 / version_number / file_name dopo finalize

-- ── 1. Review metadata su presentations ──────────────────────────────────
ALTER TABLE public.presentations
  ADD COLUMN IF NOT EXISTS reviewer_note   TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- ── 2. rpc_set_current_version — rollback o set manuale ─────────────────
-- INVOKER: RLS tenant_isolation applicata; solo utenti del tenant possono invocarla.
CREATE OR REPLACE FUNCTION public.rpc_set_current_version(
  p_presentation_id uuid,
  p_version_id uuid
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_event  uuid;
  v_prev   uuid;
  v_version RECORD;
BEGIN
  SELECT tenant_id, event_id, current_version_id INTO v_tenant, v_event, v_prev
    FROM presentations WHERE id = p_presentation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'presentation_not_found' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, status, presentation_id, version_number INTO v_version
    FROM presentation_versions
    WHERE id = p_version_id;
  IF NOT FOUND OR v_version.presentation_id <> p_presentation_id THEN
    RAISE EXCEPTION 'version_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  IF v_version.status <> 'ready' THEN
    RAISE EXCEPTION 'version_not_ready' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE presentations
     SET current_version_id = p_version_id,
         status = CASE WHEN status = 'pending' THEN 'uploaded' ELSE status END
   WHERE id = p_presentation_id;

  -- Le altre versioni ready diventano 'superseded' a fini di UX (non distruttivo)
  UPDATE presentation_versions
     SET status = 'superseded'
   WHERE presentation_id = p_presentation_id
     AND id <> p_version_id
     AND status = 'ready';

  -- La versione appena selezionata torna 'ready' se era 'superseded'
  UPDATE presentation_versions
     SET status = 'ready'
   WHERE id = p_version_id AND status = 'superseded';

  INSERT INTO activity_log (tenant_id, event_id, actor, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, v_event, 'user', 'set_current_version', 'presentation', p_presentation_id,
          jsonb_build_object('version_id', p_version_id, 'previous_version_id', v_prev,
                             'version_number', v_version.version_number));

  RETURN jsonb_build_object('ok', true, 'current_version_id', p_version_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_current_version(uuid, uuid) TO authenticated;

-- ── 3. rpc_update_presentation_status — workflow review ──────────────────
CREATE OR REPLACE FUNCTION public.rpc_update_presentation_status(
  p_presentation_id uuid,
  p_status text,
  p_note text
) RETURNS jsonb LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_tenant uuid;
  v_event  uuid;
  v_user   uuid;
  v_prev   presentation_status;
BEGIN
  IF p_status NOT IN ('pending','uploaded','reviewed','approved','rejected') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'check_violation';
  END IF;

  SELECT tenant_id, event_id, status INTO v_tenant, v_event, v_prev
    FROM presentations WHERE id = p_presentation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'presentation_not_found' USING ERRCODE = 'check_violation';
  END IF;

  v_user := (auth.jwt() ->> 'sub')::uuid;

  UPDATE presentations
     SET status = p_status::presentation_status,
         reviewer_note = p_note,
         reviewed_at = CASE WHEN p_status IN ('reviewed','approved','rejected') THEN now() ELSE NULL END,
         reviewed_by_user_id = CASE WHEN p_status IN ('reviewed','approved','rejected') THEN v_user ELSE NULL END
   WHERE id = p_presentation_id;

  INSERT INTO activity_log (tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_tenant, v_event, 'user', COALESCE(v_user::text, ''),
          'presentation_status', 'presentation', p_presentation_id,
          jsonb_build_object('from', v_prev, 'to', p_status, 'note', p_note));

  RETURN jsonb_build_object('ok', true, 'status', p_status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_presentation_status(uuid, text, text) TO authenticated;

-- ── 4. Append-only guard su presentation_versions ────────────────────────
-- Dopo INSERT, storage_key / file_size_bytes / file_hash_sha256 / file_name /
-- version_number / presentation_id / tenant_id NON possono essere modificati.
-- Lo stato puo cambiare (uploading → ready → superseded / failed).
CREATE OR REPLACE FUNCTION public.guard_versions_immutable() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.storage_key IS DISTINCT FROM OLD.storage_key
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.presentation_id IS DISTINCT FROM OLD.presentation_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR (OLD.file_hash_sha256 IS NOT NULL AND NEW.file_hash_sha256 IS DISTINCT FROM OLD.file_hash_sha256)
  THEN
    RAISE EXCEPTION 'presentation_versions are append-only on identifying fields'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DO $$ BEGIN
  CREATE TRIGGER enforce_versions_immutable BEFORE UPDATE ON public.presentation_versions
    FOR EACH ROW EXECUTE FUNCTION public.guard_versions_immutable();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 5. Indice per lookup versioni per presentation ordinate ──────────────
CREATE INDEX IF NOT EXISTS idx_versions_presentation_order
  ON presentation_versions(presentation_id, version_number DESC);
