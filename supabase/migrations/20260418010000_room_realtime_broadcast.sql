-- Sprint B (GUIDA_OPERATIVA_v3 §2.B) — Realtime broadcast per il PC sala.
--
-- PROBLEMA: il Room Player NON ha sessione utente Supabase (e' autenticato
-- via `device_token` su Edge Functions). Le RLS `tenant_isolation` su
-- `presentation_versions` e `room_state` impediscono ad anon di leggere,
-- quindi `postgres_changes` filtrato non riceverebbe alcun evento.
--
-- SOLUZIONE: trigger PostgreSQL che, ad ogni INSERT/UPDATE/DELETE delle
-- tabelle rilevanti, pubblica un broadcast Realtime sul topic `room:<id>`.
-- I broadcast pubblicati con `private = false` NON sono filtrati dalle RLS
-- e qualunque client subscribed al topic li riceve. La sicurezza e'
-- garantita dal fatto che il `room_id` e' un UUID v4 (non enumerable) e
-- viene comunicato al client SOLO dalla Edge Function `room-player-bootstrap`
-- dopo aver validato il `device_token`.
--
-- Topic: `room:<room_uuid>` (es. `room:5f8d4e2b-...`).
-- Eventi: `presentation_changed` (versioni file), `room_state_changed`.
-- Payload minimale (l'unico scopo e' triggerare un `refreshNow()` lato client).
--
-- IDEMPOTENTE: usa CREATE OR REPLACE per le funzioni e DROP TRIGGER IF EXISTS
-- prima di CREATE TRIGGER.
--
-- DEFENSIVE: se lo schema `realtime` non espone `send` (Supabase vecchio o
-- self-hosted senza upgrade), il PERFORM fallisce silenziosamente e NON
-- blocca le INSERT/UPDATE applicative. EXCEPTION WHEN OTHERS NULL.
-- ============================================================================
-- 1. Funzione: broadcast a tutte le room collegate a una presentation
-- ============================================================================
CREATE OR REPLACE FUNCTION public.broadcast_presentation_version_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
  realtime,
  pg_temp AS $$
DECLARE v_presentation_id uuid := COALESCE(NEW.presentation_id, OLD.presentation_id);
v_room_id uuid;
BEGIN -- Una presentation appartiene a UNA session che appartiene a UNA room.
-- Quindi al massimo broadcast 1 messaggio per riga (non un loop pesante).
SELECT s.room_id INTO v_room_id
FROM public.presentations p
  JOIN public.sessions s ON s.id = p.session_id
WHERE p.id = v_presentation_id
  AND s.room_id IS NOT NULL
LIMIT 1;
IF v_room_id IS NULL THEN RETURN COALESCE(NEW, OLD);
END IF;
BEGIN PERFORM realtime.send(
  jsonb_build_object(
    'table',
    'presentation_versions',
    'op',
    TG_OP,
    'version_id',
    COALESCE(NEW.id, OLD.id),
    'presentation_id',
    v_presentation_id
  ),
  'presentation_changed',
  'room:' || v_room_id::text,
  false -- pubblico: nessuna RLS sui realtime.messages
);
EXCEPTION
WHEN OTHERS THEN -- Mai bloccare INSERT/UPDATE/DELETE applicativo per un broadcast fallito.
NULL;
END;
RETURN COALESCE(NEW, OLD);
END;
$$;
COMMENT ON FUNCTION public.broadcast_presentation_version_change IS 'Sprint B: emette broadcast Realtime su `room:<room_id>` quando una presentation_version cambia, cosi'' il Room Player anonimo riceve la notifica senza bisogno di SELECT su tabelle protette da RLS.';
-- ============================================================================
-- 2. Funzione: broadcast su update di room_state (sync_status, current_session_id, ecc.)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.broadcast_room_state_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
  realtime,
  pg_temp AS $$ BEGIN IF NEW.room_id IS NULL THEN RETURN NEW;
END IF;
BEGIN PERFORM realtime.send(
  jsonb_build_object(
    'table',
    'room_state',
    'op',
    TG_OP,
    'room_id',
    NEW.room_id
  ),
  'room_state_changed',
  'room:' || NEW.room_id::text,
  false
);
EXCEPTION
WHEN OTHERS THEN NULL;
END;
RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.broadcast_room_state_change IS 'Sprint B: emette broadcast Realtime su `room:<room_id>` quando room_state cambia (es. current_session_id, sync_status).';
-- ============================================================================
-- 3. Trigger su presentation_versions
-- ============================================================================
DROP TRIGGER IF EXISTS broadcast_presentation_version_change_trg ON public.presentation_versions;
CREATE TRIGGER broadcast_presentation_version_change_trg
AFTER
INSERT
  OR
UPDATE
  OR DELETE ON public.presentation_versions FOR EACH ROW EXECUTE FUNCTION public.broadcast_presentation_version_change();
-- ============================================================================
-- 4. Trigger su room_state (solo UPDATE: l'INSERT iniziale per ogni room
--    avviene una sola volta in fase di provisioning ed e' poco interessante)
-- ============================================================================
DROP TRIGGER IF EXISTS broadcast_room_state_change_trg ON public.room_state;
CREATE TRIGGER broadcast_room_state_change_trg
AFTER
UPDATE ON public.room_state FOR EACH ROW EXECUTE FUNCTION public.broadcast_room_state_change();
