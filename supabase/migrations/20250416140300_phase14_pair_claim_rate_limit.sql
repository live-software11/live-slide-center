-- Fase 14: rate limiting anon su pair-claim (IP hash, finestra 60s, max 30 richieste).
-- Tabella non esposta a PostgREST: nessun grant a anon/authenticated; solo service_role (Edge Function).

CREATE TABLE public.pair_claim_rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pair_claim_rate_events_ip_created_at
  ON public.pair_claim_rate_events (ip_hash, created_at DESC);

ALTER TABLE public.pair_claim_rate_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.pair_claim_rate_events FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON TABLE public.pair_claim_rate_events TO service_role;

COMMENT ON TABLE public.pair_claim_rate_events IS 'Fase 14: conteggio tentativi pair-claim per IP (hash), usato da Edge Function pair-claim con service role.';
