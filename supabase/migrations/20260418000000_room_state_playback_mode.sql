-- Sprint A (GUIDA_OPERATIVA_v3 §2.A) — Modalita LIVE / TURBO / AUTO sul PC sala.
--
-- Aggiunge l'enum `playback_mode` e la colonna `room_state.playback_mode`
-- in modo che l'admin VEDA in tempo reale in che modalita di sync e' il
-- PC sala (LIVE = sync rallentato + throttle download per non disturbare
-- la proiezione, TURBO = sync aggressivo per il setup pre-evento, AUTO =
-- comportamento di default).
--
-- - Default 'auto' su tutte le righe esistenti.
-- - Il PC sala persiste anche localmente la scelta (`localStorage`), ma
--   il valore qui in DB e' la fonte di verita' lato admin (Sprint D).
-- - RLS gia' attivo via tenant_isolation di room_state (init migration).
--
-- Idempotente: usa IF NOT EXISTS / DO blocks per consentire ri-deploy.
DO $$ BEGIN IF NOT EXISTS (
  SELECT 1
  FROM pg_type
  WHERE typname = 'playback_mode'
) THEN CREATE TYPE public.playback_mode AS ENUM ('auto', 'live', 'turbo');
END IF;
END $$;
ALTER TABLE public.room_state
ADD COLUMN IF NOT EXISTS playback_mode public.playback_mode NOT NULL DEFAULT 'auto';
COMMENT ON COLUMN public.room_state.playback_mode IS 'Modalita di playback dichiarata dal PC sala: auto (default, polling 12s, download a banda piena), live (durante proiezione: polling 60s, throttle download, priority bassa), turbo (setup: polling 5s, concurrency 3, priority alta). Dichiarata dal client, persistita per la dashboard admin.';
-- Index leggero usato dalla dashboard admin per filtrare/ordinare PC sala
-- in modalita LIVE (Sprint D). Non strettamente necessario per la query
-- per `room_id`, che e' gia' coperto dalla PRIMARY KEY.
CREATE INDEX IF NOT EXISTS idx_room_state_playback_mode ON public.room_state(playback_mode);
