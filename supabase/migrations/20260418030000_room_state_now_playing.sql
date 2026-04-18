-- Sprint I (GUIDA_OPERATIVA_v3 §3.E E3-E4) — "Now Playing" per sala.
--
-- Aggiunge a `room_state`:
--   - `current_presentation_id uuid` (FK opzionale a presentations) — il file
--     che il PC sala sta proiettando in questo momento. NULL se nulla in onda.
--   - `last_play_started_at timestamptz` — quando l'apertura e' stata segnalata.
--
-- Setter: nuova RPC `rpc_room_player_set_current(p_token, p_presentation_id)`
-- chiamata dalla Edge Function `room-player-set-current` (PC sala anonimo,
-- autenticato col solo `device_token`).
--
-- Propagazione: il trigger broadcast `broadcast_room_state_change_trg`
-- (Sprint B, migration 20260418010000) gia' emette `room_state_changed` su
-- ogni UPDATE di `room_state`. Quindi NON serve un nuovo trigger: l'admin
-- riceve l'aggiornamento in tempo reale gratis.
--
-- Activity log: ogni chiamata al setter scrive `action = 'room_now_playing'`
-- in `activity_log` per audit "chi ha proiettato cosa quando".
--
-- IDEMPOTENTE.

-- ============================================================================
-- 1. Schema: nuove colonne su room_state
-- ============================================================================

ALTER TABLE public.room_state
  ADD COLUMN IF NOT EXISTS current_presentation_id uuid REFERENCES public.presentations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_play_started_at timestamptz;

COMMENT ON COLUMN public.room_state.current_presentation_id IS 'Sprint I (now-playing): presentation che il PC sala sta proiettando. NULL = nulla in onda. ON DELETE SET NULL: se l''admin elimina la presentation, lo stato si autopulisce.';
COMMENT ON COLUMN public.room_state.last_play_started_at IS 'Sprint I (now-playing): quando il PC sala ha segnalato di aver aperto il file in onda. Usato per il badge "avviato Ns fa".';

-- ============================================================================
-- 2. Setter SECURITY DEFINER (autenticato col device_token, no JWT)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_room_player_set_current(
    p_token text,
    p_presentation_id uuid
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_token_hash text;
  v_device RECORD;
  v_pres RECORD;
  v_session_room uuid;
  v_now timestamptz := now();
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) = 0 THEN
    RAISE EXCEPTION 'missing_device_token';
  END IF;

  -- Hash del token: paired_devices conserva solo l'hash (Phase 4 security).
  -- pgcrypto vive nello schema `extensions` su Supabase: schema-qualified.
  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT pd.id, pd.tenant_id, pd.event_id, pd.room_id
  INTO v_device
  FROM public.paired_devices pd
  WHERE pd.pair_token_hash = v_token_hash;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'device_not_found';
  END IF;

  IF v_device.room_id IS NULL THEN
    -- Un device non assegnato a una sala non puo' "proiettare". UI e
    -- onboarding lo dovrebbero impedire, qui e' una difesa in profondita'.
    RAISE EXCEPTION 'device_not_in_room';
  END IF;

  IF p_presentation_id IS NOT NULL THEN
    -- Verifica che la presentation esista, sia dello stesso tenant ed evento
    -- e che la sua sessione viva nella sala del device. Non vogliamo che un
    -- PC sala possa "marcare in onda" un file di un'altra sala dello stesso
    -- evento (tipico setup multi-sala parallelo).
    SELECT p.id, s.room_id, p.event_id
    INTO v_pres
    FROM public.presentations p
    JOIN public.sessions s ON s.id = p.session_id
    WHERE p.id = p_presentation_id
      AND p.tenant_id = v_device.tenant_id
      AND p.event_id = v_device.event_id;

    IF v_pres.id IS NULL THEN
      RAISE EXCEPTION 'presentation_not_in_event';
    END IF;

    v_session_room := v_pres.room_id;
    IF v_session_room IS DISTINCT FROM v_device.room_id THEN
      RAISE EXCEPTION 'presentation_not_in_device_room';
    END IF;
  END IF;

  -- UPDATE atomico (il trigger broadcast Sprint B propaga ad admin).
  UPDATE public.room_state
  SET current_presentation_id = p_presentation_id,
      last_play_started_at = CASE WHEN p_presentation_id IS NULL THEN NULL ELSE v_now END,
      updated_at = v_now
  WHERE room_id = v_device.room_id;

  -- Audit (best-effort: se activity_log e' giu', non blocchiamo).
  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_device.tenant_id,
      v_device.event_id,
      'agent',                    -- PC sala = actor agent (non user, niente JWT)
      v_device.id::text,
      'room_now_playing',
      'room',
      v_device.room_id,
      jsonb_build_object(
        'device_id', v_device.id,
        'presentation_id', p_presentation_id,
        'started_at', CASE WHEN p_presentation_id IS NULL THEN NULL ELSE v_now END
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'room_id', v_device.room_id,
    'presentation_id', p_presentation_id,
    'started_at', CASE WHEN p_presentation_id IS NULL THEN NULL ELSE v_now END
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_room_player_set_current IS 'Sprint I: chiamata dalla Edge Function room-player-set-current. Autentica il PC sala via hash del device_token e aggiorna room_state.current_presentation_id + last_play_started_at. Verifica che la presentation appartenga a una sessione della STESSA sala del device (no cross-room).';

-- Esponi al ruolo `service_role` (la Edge Function la chiama via supabaseAdmin).
GRANT EXECUTE ON FUNCTION public.rpc_room_player_set_current(text, uuid) TO service_role;
