-- ============================================================================
-- Sprint T-3-A (G10) — File error checking automatico (warn-only)
-- ============================================================================
--
-- Aggiunge alle versions un campo `validation_warnings` (JSONB array) con
-- gli "issue" rilevati dal validator (font non embedded, video broken,
-- file corrotto, mime mismatch, ecc.). NON blocca l'upload: e' solo
-- informativo per l'admin.
--
-- Architettura pull-based on-demand:
--  1) UI admin/PC sala apre la lista file della sessione.
--  2) React hook `useValidationWarnings` filtra versions con
--     `status='ready' AND validation_warnings IS NULL`.
--  3) Se trova versioni "non validate", invoca Edge Function
--     `slide-validator` con i version_id (max 10 per call, throttle).
--  4) Edge Function scarica blob, parsa, e chiama RPC
--     `record_validation_warnings` per scrivere il risultato.
--  5) UI mostra badge giallo `⚠ N issue` accanto al filename.
--
-- VANTAGGI rispetto a pg_cron+pg_net:
--   - Nessuna dipendenza da extension non sempre disponibili (pg_net non e' ancora abilitato).
--   - Validation lazy: paghiamo Edge function solo quando l'admin guarda davvero.
--   - Idempotente: la RPC fa UPDATE solo se validated_at IS NULL.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Colonne nuove su presentation_versions
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.presentation_versions
  ADD COLUMN IF NOT EXISTS validation_warnings JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.presentation_versions.validation_warnings IS
  'Sprint T-3-A: array JSONB di issue rilevati dal validator. NULL = non ancora validato. [] = validato senza issue. Schema item: {code:text, severity:"info"|"warning"|"error", message:text, details?:jsonb}.';
COMMENT ON COLUMN public.presentation_versions.validated_at IS
  'Sprint T-3-A: timestamp ultima validazione. NULL = mai validato. Setato sempre insieme a validation_warnings.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Indice partial per query "trova versions da validare"
-- ────────────────────────────────────────────────────────────────────────────
-- Cardinalita' attesa BASSA (le versioni vengono validate quasi subito dopo
-- upload). Index parziale = piccolo + sempre fresh.
CREATE INDEX IF NOT EXISTS idx_pv_unvalidated_ready
  ON public.presentation_versions (created_at)
  WHERE status = 'ready' AND validation_warnings IS NULL;

COMMENT ON INDEX public.idx_pv_unvalidated_ready IS
  'Sprint T-3-A: lookup veloce versioni ready ancora da validare. Partial index = footprint minimo.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) RPC: record_validation_warnings (chiamata dall Edge Function)
-- ────────────────────────────────────────────────────────────────────────────
-- L'Edge Function gira con SUPABASE_SERVICE_ROLE_KEY: passerebbe RLS, ma
-- vogliamo comunque centralizzare la write logic in una RPC per:
--   - validare schema dei warnings (no payload arbitrari su una colonna JSONB)
--   - garantire idempotenza (no doppio-write se 2 client triggherano l'Edge in parallelo)
--   - audit log opzionale futuro
CREATE OR REPLACE FUNCTION public.record_validation_warnings(
    p_version_id uuid,
    p_warnings jsonb
  ) RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing_validated_at timestamptz;
  v_warning jsonb;
  v_severity text;
BEGIN
  -- Validazione input minima
  IF p_version_id IS NULL THEN
    RAISE EXCEPTION 'invalid_version_id' USING ERRCODE = 'check_violation';
  END IF;
  IF p_warnings IS NULL OR jsonb_typeof(p_warnings) <> 'array' THEN
    RAISE EXCEPTION 'invalid_warnings_payload' USING ERRCODE = 'check_violation';
  END IF;

  -- Validazione struttura ogni warning: deve avere {code, severity, message}.
  FOR v_warning IN SELECT * FROM jsonb_array_elements(p_warnings) LOOP
    IF jsonb_typeof(v_warning) <> 'object' THEN
      RAISE EXCEPTION 'invalid_warning_item_not_object' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (v_warning ? 'code' AND v_warning ? 'severity' AND v_warning ? 'message') THEN
      RAISE EXCEPTION 'invalid_warning_item_missing_fields' USING ERRCODE = 'check_violation';
    END IF;
    v_severity := v_warning->>'severity';
    IF v_severity NOT IN ('info', 'warning', 'error') THEN
      RAISE EXCEPTION 'invalid_warning_severity' USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Idempotenza: se gia' validato non sovrascriviamo (return current state).
  SELECT validated_at INTO v_existing_validated_at
  FROM presentation_versions
  WHERE id = p_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'version_not_found' USING ERRCODE = 'check_violation';
  END IF;

  IF v_existing_validated_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'skipped', true,
      'reason', 'already_validated',
      'validated_at', v_existing_validated_at
    );
  END IF;

  UPDATE presentation_versions
  SET validation_warnings = p_warnings,
      validated_at = now()
  WHERE id = p_version_id
    AND validated_at IS NULL;  -- double-check race-safe

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'warnings_count', jsonb_array_length(p_warnings)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_validation_warnings(uuid, jsonb) FROM PUBLIC;
-- Solo Edge Functions (con service_role) possono chiamarla.
GRANT EXECUTE ON FUNCTION public.record_validation_warnings(uuid, jsonb) TO service_role;

COMMENT ON FUNCTION public.record_validation_warnings(uuid, jsonb) IS
  'Sprint T-3-A: scrittura idempotente dei warnings di validazione su una version. SECURITY DEFINER + GRANT solo service_role: l Edge Function slide-validator e l unico chiamante.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4) RPC: list_unvalidated_versions_for_session
-- ────────────────────────────────────────────────────────────────────────────
-- Usata dal client web (admin) per sapere quali version_id triggerare verso
-- l'Edge Function. RLS naturale via tenant_isolation.
CREATE OR REPLACE FUNCTION public.list_unvalidated_versions_for_session(
    p_session_id uuid,
    p_limit int DEFAULT 10
  ) RETURNS TABLE (
    version_id uuid,
    presentation_id uuid,
    file_name text,
    storage_key text
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY INVOKER  -- rispetta RLS: solo membri del tenant vedono i propri file
  SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'invalid_session_id' USING ERRCODE = 'check_violation';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 50 THEN
    p_limit := 10;
  END IF;

  RETURN QUERY
  SELECT pv.id, pv.presentation_id, pv.file_name, pv.storage_key
  FROM presentation_versions pv
  JOIN presentations p ON p.id = pv.presentation_id
  WHERE p.session_id = p_session_id
    AND pv.status = 'ready'
    AND pv.validation_warnings IS NULL
  ORDER BY pv.created_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.list_unvalidated_versions_for_session(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_unvalidated_versions_for_session(uuid, int) TO authenticated;

COMMENT ON FUNCTION public.list_unvalidated_versions_for_session(uuid, int) IS
  'Sprint T-3-A: ritorna fino a N versions ready non ancora validate per una sessione. RLS-isolato. Usata dal hook useValidationTrigger lato web.';
