-- ============================================================================
-- Sprint Z (post-field-test) — Gap B: sposta PC sala tra eventi
-- ============================================================================
-- Obiettivo: dare a admin/tech del tenant un'azione atomica per spostare un
-- PC sala (paired_devices) da un evento a un altro, senza forzare l'utente a
-- rifare il pairing fisico (codice 6 cifre o magic link).
--
-- Caso d'uso reale (Andrea):
--   "ho 3 PC paired con l'evento del weekend, finito quello li sposto sull'evento
--   della settimana prossima senza dover rigenerare i token e ri-binder un mini-PC
--   gia' configurato in sala".
--
-- Riferimento progettuale:
--   - docs/AUDIT_FINALE_E_PIANO_TEST_v1.md §3.4 (Gap B — Sposta PC tra eventi).
--
-- Sicurezza:
--   - SECURITY DEFINER: bypass RLS solo per il check tenant_isolation atomico
--     (event_id appartiene allo stesso tenant) e l'UPDATE finale.
--   - Caller deve essere admin o tech del tenant (oppure super_admin globale).
--   - p_target_event_id deve appartenere allo stesso tenant del device.
--   - Lascia FK `paired_devices.event_id NOT NULL` invariata: NON permette di
--     "scollegare" un device dal mondo eventi (per quello c'e' il pannello
--     "Centri Slide" che lo demuove a 'control_center' o lo elimina).
--
-- Audit:
--   - Una riga in `activity_log` per ogni move (action='paired_device_moved').
--   - Metadata: {target_event, target_room, prev_event, prev_room}.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_move_paired_device(
    p_device_id uuid,
    p_target_event_id uuid,
    p_target_room_id uuid DEFAULT NULL
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
  pg_temp AS $$
DECLARE v_caller_uid uuid := auth.uid();
v_caller_role public.user_role;
v_tenant_id uuid := public.app_tenant_id();
v_event_tenant uuid;
v_room_event uuid;
v_prev_event_id uuid;
v_prev_room_id uuid;
BEGIN IF v_caller_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'invalid_authorization_specification';
END IF;
IF v_tenant_id IS NULL
AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'no_tenant' USING ERRCODE = 'check_violation';
END IF;
v_caller_role := public.app_user_role();
IF NOT public.is_super_admin()
AND v_caller_role NOT IN ('admin', 'tech') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
END IF;
-- 1) verifica evento target appartiene allo stesso tenant del caller
SELECT tenant_id INTO v_event_tenant
FROM public.events
WHERE id = p_target_event_id;
IF v_event_tenant IS NULL THEN RAISE EXCEPTION 'event_not_found' USING ERRCODE = 'P0002';
END IF;
IF NOT public.is_super_admin()
AND v_event_tenant <> v_tenant_id THEN RAISE EXCEPTION 'event_not_in_tenant' USING ERRCODE = '42501';
END IF;
-- 2) se room target specificata, verifica che appartenga all'evento target
IF p_target_room_id IS NOT NULL THEN
SELECT event_id INTO v_room_event
FROM public.rooms
WHERE id = p_target_room_id;
IF v_room_event IS NULL THEN RAISE EXCEPTION 'room_not_found' USING ERRCODE = 'P0002';
END IF;
IF v_room_event <> p_target_event_id THEN RAISE EXCEPTION 'room_not_in_target_event' USING ERRCODE = 'check_violation';
END IF;
END IF;
-- 3) snapshot prev per audit, poi UPDATE
SELECT event_id,
  room_id INTO v_prev_event_id,
  v_prev_room_id
FROM public.paired_devices
WHERE id = p_device_id
  AND (
    public.is_super_admin()
    OR tenant_id = v_tenant_id
  );
IF NOT FOUND THEN RAISE EXCEPTION 'device_not_found' USING ERRCODE = 'P0002';
END IF;
UPDATE public.paired_devices
SET event_id = p_target_event_id,
  room_id = p_target_room_id,
  updated_at = now()
WHERE id = p_device_id
  AND (
    public.is_super_admin()
    OR tenant_id = v_tenant_id
  );
-- 4) audit (best-effort, non blocca la move se activity_log fallisce)
BEGIN
INSERT INTO public.activity_log (
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
    COALESCE(v_tenant_id, v_event_tenant),
    p_target_event_id,
    'user',
    v_caller_uid::text,
    'paired_device_moved',
    'paired_device',
    p_device_id,
    jsonb_build_object(
      'target_event',
      p_target_event_id,
      'target_room',
      p_target_room_id,
      'prev_event',
      v_prev_event_id,
      'prev_room',
      v_prev_room_id
    )
  );
EXCEPTION
WHEN OTHERS THEN NULL;
END;
RETURN jsonb_build_object(
  'ok',
  true,
  'device_id',
  p_device_id,
  'target_event_id',
  p_target_event_id,
  'target_room_id',
  p_target_room_id,
  'prev_event_id',
  v_prev_event_id,
  'prev_room_id',
  v_prev_room_id
);
END $$;
REVOKE ALL ON FUNCTION public.rpc_admin_move_paired_device(uuid, uuid, uuid)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_move_paired_device(uuid, uuid, uuid) TO authenticated;
COMMENT ON FUNCTION public.rpc_admin_move_paired_device(uuid, uuid, uuid) IS 'Sprint Z (post-field-test) Gap B — sposta atomicamente un paired_device ' 'su un evento (e opzionalmente una sala) target dello stesso tenant. ' 'Admin/tech only. Audita ogni move su activity_log con prev_event/prev_room.';
