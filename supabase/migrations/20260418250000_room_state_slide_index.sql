-- Sprint U-3 (UX redesign V2.0) — "On Air slide N/M".
--
-- Aggiunge a `room_state` due colonne opzionali per tenere il numero slide
-- corrente e il totale slide del file in onda, in modo che la nuova
-- `OnAirView` (regia) possa mostrare a colpo d'occhio "slide 12 / 87" della
-- sala selezionata, senza dover dipendere da render lato server.
--
-- Estende `rpc_room_player_set_current` per accettare due parametri opzionali
-- `p_current_slide_index` e `p_current_slide_total`. Se omessi (o NULL), il
-- comportamento resta identico a prima (back-compat con i PC sala vecchi
-- che ancora non riportano la posizione).
--
-- IDEMPOTENTE.

-- ============================================================================
-- 1. Schema: nuove colonne su room_state
-- ============================================================================

ALTER TABLE public.room_state
  ADD COLUMN IF NOT EXISTS current_slide_index integer,
  ADD COLUMN IF NOT EXISTS current_slide_total integer;

COMMENT ON COLUMN public.room_state.current_slide_index IS 'Sprint U-3: indice 1-based della slide attualmente visibile sul PC sala (NULL se sconosciuto / nulla in onda).';
COMMENT ON COLUMN public.room_state.current_slide_total IS 'Sprint U-3: numero totale di slide del file in onda (NULL se sconosciuto).';

-- ============================================================================
-- 2. Setter aggiornato: nuovi parametri opzionali, backcompat preservata
-- ============================================================================
--
-- ⚠️ PostgreSQL considera funzioni con signature diverse come funzioni
-- distinte. La vecchia `rpc_room_player_set_current(text, uuid)` non viene
-- sovrascritta da `CREATE OR REPLACE` perche' aggiungiamo due parametri.
-- Per evitare di lasciare in giro la versione vecchia (che il client non
-- chiama piu' ma che resterebbe richiamabile via PostgREST), la droppiamo
-- esplicitamente. Idempotente.
DROP FUNCTION IF EXISTS public.rpc_room_player_set_current(text, uuid);

CREATE OR REPLACE FUNCTION public.rpc_room_player_set_current(
    p_token text,
    p_presentation_id uuid,
    p_current_slide_index integer DEFAULT NULL,
    p_current_slide_total integer DEFAULT NULL
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

  v_token_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  SELECT pd.id, pd.tenant_id, pd.event_id, pd.room_id
  INTO v_device
  FROM public.paired_devices pd
  WHERE pd.pair_token_hash = v_token_hash;

  IF v_device.id IS NULL THEN
    RAISE EXCEPTION 'device_not_found';
  END IF;

  IF v_device.room_id IS NULL THEN
    RAISE EXCEPTION 'device_not_in_room';
  END IF;

  IF p_presentation_id IS NOT NULL THEN
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

  -- Sanity check sui due slide-counter: se forniti, devono essere positivi e
  -- consistenti (index <= total quando entrambi presenti). Se inconsistenti,
  -- li ignoriamo silenziosamente (non vogliamo bloccare il PC sala se manda
  -- un payload buggy: meglio "stato sconosciuto" che HTTP 400 ricorrente).
  IF p_current_slide_index IS NOT NULL AND p_current_slide_index < 1 THEN
    p_current_slide_index := NULL;
  END IF;
  IF p_current_slide_total IS NOT NULL AND p_current_slide_total < 1 THEN
    p_current_slide_total := NULL;
  END IF;
  IF p_current_slide_index IS NOT NULL
     AND p_current_slide_total IS NOT NULL
     AND p_current_slide_index > p_current_slide_total THEN
    p_current_slide_index := NULL;
    p_current_slide_total := NULL;
  END IF;

  -- Se la trasmissione e' stata fermata (presentation_id NULL), azzeriamo
  -- anche i contatori slide (non avrebbero senso senza un file in onda).
  IF p_presentation_id IS NULL THEN
    p_current_slide_index := NULL;
    p_current_slide_total := NULL;
  END IF;

  UPDATE public.room_state
  SET current_presentation_id = p_presentation_id,
      last_play_started_at    = CASE WHEN p_presentation_id IS NULL THEN NULL ELSE v_now END,
      current_slide_index     = p_current_slide_index,
      current_slide_total     = p_current_slide_total,
      updated_at              = v_now
  WHERE room_id = v_device.room_id;

  BEGIN
    INSERT INTO public.activity_log (
      tenant_id, event_id, actor, actor_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_device.tenant_id,
      v_device.event_id,
      'agent',
      v_device.id::text,
      'room_now_playing',
      'room',
      v_device.room_id,
      jsonb_build_object(
        'device_id', v_device.id,
        'presentation_id', p_presentation_id,
        'started_at', CASE WHEN p_presentation_id IS NULL THEN NULL ELSE v_now END,
        'slide_index', p_current_slide_index,
        'slide_total', p_current_slide_total
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'room_id', v_device.room_id,
    'presentation_id', p_presentation_id,
    'started_at', CASE WHEN p_presentation_id IS NULL THEN NULL ELSE v_now END,
    'slide_index', p_current_slide_index,
    'slide_total', p_current_slide_total
  );
END;
$$;

COMMENT ON FUNCTION public.rpc_room_player_set_current(text, uuid, integer, integer) IS 'Sprint U-3: variante che accetta indice/totale slide della presentazione in onda. Le slide-counter sono opzionali e tollerate ai NULL per back-compat con PC sala vecchi.';

GRANT EXECUTE ON FUNCTION public.rpc_room_player_set_current(text, uuid, integer, integer) TO service_role;
