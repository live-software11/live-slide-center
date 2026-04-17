-- Security hardening migration (post-audit Supabase advisors)
-- ════════════════════════════════════════════════════════════════════════════
--  1) Fix `function_search_path_mutable` per 2 funzioni trigger esistenti:
--     - public.auto_version_number  (trigger versioni presentazioni)
--     - public.trigger_set_updated_at (trigger generico updated_at)
--     Aggiunge `SET search_path = public` per evitare schema-shadowing.
--  2) Fix `rls_enabled_no_policy` su `public.pair_claim_rate_events`:
--     RLS attivo ma nessuna policy => deny-all implicito per gli utenti
--     authenticated/anon. La tabella e' usata SOLO via RPC SECURITY DEFINER
--     `pair_claim_rate_check()` quindi va bene avere deny-all esplicito,
--     ma per chiarezza aggiungiamo una policy DENY esplicita documentata.
-- ════════════════════════════════════════════════════════════════════════════
-- (1) Fix auto_version_number — preserva logica originale, aggiunge search_path
CREATE OR REPLACE FUNCTION public.auto_version_number() RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $function$ BEGIN NEW.version_number := COALESCE(
    (
      SELECT MAX(version_number)
      FROM presentation_versions
      WHERE presentation_id = NEW.presentation_id
    ),
    0
  ) + 1;
RETURN NEW;
END;
$function$;
-- (2) Fix trigger_set_updated_at — preserva logica, aggiunge search_path
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at() RETURNS trigger LANGUAGE plpgsql
SET search_path = public AS $function$ BEGIN NEW.updated_at = now();
RETURN NEW;
END;
$function$;
-- (3) Policy DENY esplicita su pair_claim_rate_events.
-- La tabella tiene il rate-limit per i tentativi di pairing (anti brute-force).
-- Deve essere accessibile SOLO da SECURITY DEFINER functions, mai dai client.
DROP POLICY IF EXISTS deny_all_pair_claim_rate_events ON public.pair_claim_rate_events;
CREATE POLICY deny_all_pair_claim_rate_events ON public.pair_claim_rate_events AS RESTRICTIVE FOR ALL TO authenticated,
anon USING (false) WITH CHECK (false);
COMMENT ON POLICY deny_all_pair_claim_rate_events ON public.pair_claim_rate_events IS 'Deny all client access. Tabella usata solo da RPC SECURITY DEFINER pair_claim_rate_check.';
