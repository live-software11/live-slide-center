-- ────────────────────────────────────────────────────────────────────
-- Sprint G (GUIDA_OPERATIVA_v3 §3.B3) — Sposta presentation in altra
-- sessione (multi-select bulk action lato admin).
-- ────────────────────────────────────────────────────────────────────
--
-- WHY: il `rpc_move_presentation` esistente sposta tra speaker (e di
-- riflesso aggiorna la sessione del nuovo speaker), ma:
--   1) non funziona se la presentation NON ha uno speaker (caso comune:
--      file caricato dall'admin senza assegnare uno speaker);
--   2) richiede che lo speaker target NON abbia gia' una presentation,
--      vincolo logico per il flusso 1:1 ma scomodo per "sposta in sessione X"
--      da bulk action UI;
--   3) costringe a scegliere lo speaker, mentre la richiesta UX (Drive-like)
--      e' "scegli sessione" senza dover pensare allo speaker.
--
-- Questa RPC sposta la presentation impostando `session_id` alla nuova
-- sessione e *resetta* `speaker_id = NULL` perche' lo speaker e' legato
-- a una sessione specifica e non puo' "seguire" la presentation altrove.
-- L'admin potra' riassegnare uno speaker della sessione di destinazione
-- in un secondo momento se necessario.
--
-- Validazioni:
--   - JWT valido con tenant
--   - Ruolo admin/coordinator/super_admin (`has_tenant_admin_role()`)
--   - Tenant non sospeso (`current_tenant_suspended()`)
--   - Presentation non `archived` (immutabile post-evento)
--   - Sessione target stesso tenant + stesso evento + evento non chiuso/archiviato
--   - `same_session_no_op` se target == source (skip esplicito)
--
-- Audit: scrive `activity_log` con action `move_presentation_to_session` e
-- mantiene gli speaker_id/session_id originali nel `details` per rollback.
CREATE OR REPLACE FUNCTION public.rpc_move_presentation_to_session(
    p_presentation_id uuid,
    p_target_session_id uuid
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant_id uuid;
v_pres RECORD;
v_event_status event_status;
v_target_session RECORD;
v_user uuid;
BEGIN v_tenant_id := public.app_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'no_tenant_in_jwt' USING ERRCODE = 'check_violation';
END IF;
IF NOT public.has_tenant_admin_role() THEN RAISE EXCEPTION 'role_forbidden' USING ERRCODE = 'insufficient_privilege';
END IF;
IF public.current_tenant_suspended() THEN RAISE EXCEPTION 'tenant_suspended' USING ERRCODE = 'insufficient_privilege';
END IF;
IF p_presentation_id IS NULL
OR p_target_session_id IS NULL THEN RAISE EXCEPTION 'invalid_input' USING ERRCODE = 'check_violation';
END IF;
-- Lock advisory transazionale per scongiurare two-move concorrenti
-- sulla stessa presentation (stesso schema di rpc_move_presentation).
PERFORM pg_advisory_xact_lock(
  hashtext(
    'rpc_move_presentation_to_session:' || p_presentation_id::text
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
  event_id INTO v_target_session
FROM sessions
WHERE id = p_target_session_id
  AND tenant_id = v_tenant_id
LIMIT 1;
IF NOT FOUND THEN RAISE EXCEPTION 'target_session_not_found_or_cross_tenant' USING ERRCODE = 'check_violation';
END IF;
IF v_target_session.event_id <> v_pres.event_id THEN RAISE EXCEPTION 'cross_event_move_not_allowed' USING ERRCODE = 'check_violation';
END IF;
IF v_target_session.id = v_pres.session_id THEN -- Non e' un errore "duro": la UI bulk puo' chiamare per N file e
-- alcuni potrebbero gia' essere nella sessione target. Restituiamo
-- un risultato "skipped" cosi' la UI puo' contare e mostrare il summary.
RETURN jsonb_build_object(
  'ok',
  true,
  'skipped',
  true,
  'reason',
  'same_session_no_op',
  'presentation_id',
  p_presentation_id,
  'session_id',
  v_pres.session_id
);
END IF;
UPDATE presentations
SET session_id = p_target_session_id,
  -- Reset speaker: e' legato alla vecchia sessione, non puo' seguire.
  speaker_id = NULL,
  updated_at = now()
WHERE id = p_presentation_id;
v_user := (auth.jwt()->>'sub')::uuid;
INSERT INTO activity_log (
    tenant_id,
    event_id,
    actor_kind,
    actor_id,
    action,
    target_kind,
    target_id,
    details
  )
VALUES (
    v_tenant_id,
    v_pres.event_id,
    'user',
    COALESCE(v_user::text, ''),
    'move_presentation_to_session',
    'presentation',
    p_presentation_id,
    jsonb_build_object(
      'from_speaker_id',
      v_pres.speaker_id,
      'from_session_id',
      v_pres.session_id,
      'to_session_id',
      p_target_session_id
    )
  );
RETURN jsonb_build_object(
  'ok',
  true,
  'skipped',
  false,
  'presentation_id',
  p_presentation_id,
  'session_id',
  p_target_session_id
);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_move_presentation_to_session(uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_move_presentation_to_session(uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.rpc_move_presentation_to_session(uuid, uuid) IS 'Sprint G B3: sposta una presentation in altra sessione (stesso evento). Resetta speaker_id a NULL.';
