-- =============================================================================
-- Sprint U-3 (File Explorer V2 — "stile Esplora Risorse"):
-- RPC `rename_presentation_version_file_name`
-- =============================================================================
-- Andrea ha richiesto un file manager con UX "stile Windows Esplora Risorse":
-- una delle azioni cardine e' la **rinomina** di un file (F2 / context menu /
-- doppio-click sul nome). Lo schema attuale espone `presentation_versions.
-- file_name TEXT (max 255)` come display name dell'utente; lo `storage_key`
-- resta IMMUTATO (UUID-based, sicuro per RLS storage.objects).
--
-- DESIGN:
--  - Rinominiamo SOLO il `file_name` (display); lo `storage_key` non si tocca
--    (toccarlo significherebbe muovere l'oggetto storage = costoso, e
--    rischierebbe di lasciare dangling reference se la move fallisce a meta').
--  - Ruolo: admin/tech del tenant (stesso check di tutti gli altri RPC admin).
--  - Tenant scoping: la version deve appartenere al tenant del JWT.
--  - Validazione nome: trim + length 1..255 + niente caratteri di controllo.
--  - Idempotente: se il nome e' identico al precedente, no-op + ok=true.
--  - Activity log per audit.
--
-- COSA NON FACCIAMO:
--  - Non ricalcoliamo lo sha256 (i byte non cambiano).
--  - Non re-incrementiamo `version_number` (non e' un nuovo upload).
--  - Non triggeriamo alcun side-effect storage.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rename_presentation_version_file_name(
  p_version_id uuid,
  p_new_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_version RECORD;
  v_clean_name text;
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
  IF p_version_id IS NULL OR p_new_name IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;

  -- Trim + sanity check (no characteri di controllo come \n \r \t).
  v_clean_name := regexp_replace(trim(p_new_name), '[\x00-\x1F]', '', 'g');
  IF length(v_clean_name) = 0 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_clean_name) > 255 THEN
    RAISE EXCEPTION 'filename_too_long' USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, presentation_id, tenant_id, file_name
    INTO v_version
  FROM presentation_versions
  WHERE id = p_version_id AND tenant_id = v_tenant_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
  END IF;

  -- No-op se il nome non cambia (idempotenza, evita activity log spam).
  IF v_version.file_name = v_clean_name THEN
    RETURN jsonb_build_object(
      'ok', true,
      'version_id', p_version_id,
      'file_name', v_clean_name,
      'changed', false
    );
  END IF;

  UPDATE presentation_versions
  SET file_name = v_clean_name
  WHERE id = p_version_id;

  v_user := (auth.jwt()->>'sub')::uuid;
  INSERT INTO activity_log (
    tenant_id, actor, actor_id, action,
    entity_type, entity_id, metadata
  )
  VALUES (
    v_tenant_id, 'user',
    COALESCE(v_user::text, ''), 'rename_presentation_version',
    'presentation_version', p_version_id,
    jsonb_build_object(
      'old_name', v_version.file_name,
      'new_name', v_clean_name,
      'presentation_id', v_version.presentation_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'version_id', p_version_id,
    'file_name', v_clean_name,
    'changed', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rename_presentation_version_file_name(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_presentation_version_file_name(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.rename_presentation_version_file_name(uuid, text) IS
  'Sprint U-3 (File Explorer V2): rinomina display name di una version. Tenant-scoped, admin/tech only. Storage_key NON viene toccato.';
