-- ════════════════════════════════════════════════════════════════════════════
-- Security hardening: principio del minimo privilegio per `anon`.
-- ════════════════════════════════════════════════════════════════════════════
-- CONTESTO STORICO:
--   In `init_slide_center.sql` (2025-04-11) abbiamo il GRANT massivo:
--     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
--       TO anon, authenticated;
--   Coperto dalle RLS, ma viola "deny by default" (PostgREST best practice).
--
-- ROTTA: il PC sala (Room Player) viene mostrato come `anon` (no JWT utente)
--   ma NON parla mai direttamente con PostgREST: passa SEMPRE da Edge Function
--   (room-player-bootstrap, room-player-rename, room-player-set-current,
--   pair-init, pair-poll, pair-claim) che internamente usano `service_role`
--   bypassando RLS dopo aver validato il `device_token`.
--
--   Quindi `anon` puo' essere ridotto a:
--     - SELECT su `tenants` (per /pair: leggere stato suspended del tenant)
--       NB: gia' filtrato da RLS che limita id = app_tenant_id() OR super_admin.
--           Anon non passa la WHERE → 0 righe ritornate. Comportamento OK.
--     - INSERT/UPDATE/DELETE su `paired_devices` → SOLO per pair-claim/pair-poll
--       che girano come `anon` per disegno (la prima call non ha JWT user).
--       Necessario.
--     - INSERT/UPDATE/DELETE su `pairing_codes` → idem (consume + generate).
--     - INSERT su `presentation_versions` → NO, non serve (init_upload_version
--       gira come SECURITY DEFINER e fa il INSERT con permessi elevati).
--     - INSERT su `presentations` → idem.
--     - Tutto il resto: NO.
--
-- IMPATTO: anche se le RLS bloccano comunque, in caso di bug futuro nelle
--   policy (umano), `anon` non puo' nemmeno provare a scrivere. Defense-in-depth.
-- ════════════════════════════════════════════════════════════════════════════
-- ── 1) Revoke massiccio: punto zero ─────────────────────────────────────────
REVOKE
INSERT,
  UPDATE,
  DELETE ON ALL TABLES IN SCHEMA public
FROM anon;
-- ── 2) Re-grant SOLO sulle tabelle effettivamente accedute da anon ──────────
-- 2.1 paired_devices: pair-claim crea il device, room-player-bootstrap aggiorna last_seen
GRANT INSERT,
  UPDATE ON public.paired_devices TO anon;
-- 2.2 pairing_codes: pair-init genera un code, pair-claim lo consuma
-- (UPDATE per impostare consumed_at; DELETE per cleanup-expired-codes via cron)
GRANT INSERT,
  UPDATE,
  DELETE ON public.pairing_codes TO anon;
-- 2.3 pair_claim_rate_events: anti-brute-force counter (RPC SECURITY DEFINER)
-- La policy DENY restrittiva blocca comunque, ma rimuovo i grant per chiarezza.
-- (Gia' coperto dal REVOKE generale; nessun nuovo GRANT.)
-- ── 3) GDPR sanity: NESSUN INSERT da anon su email_log/activity_log ─────────
-- Erano coperti dal REVOKE generale; verifichiamo l'assenza di re-grant.
-- Nulla da fare: non rilascio grant.
-- ── 4) Storage objects: politica gia' restrittiva (anon_insert_uploading_version)
-- Lo storage.objects non e' nello schema public, quindi il REVOKE sopra non lo
-- tocca. Rimane regolato dalle policy in 20250416090000_phase3_upload_portal.sql.
-- ── 5) authenticated: lascio i grant generali ───────────────────────────────
-- Per `authenticated` non revochiamo: l'utente loggato ha sempre RLS attiva,
-- ed e' coperto dalle policy `tenant_or_super` consolidate in
-- 20260417170000_perf_consolidate_policies.sql.
-- ── 6) Documentazione delle decisioni ───────────────────────────────────────
COMMENT ON ROLE anon IS 'Role usato dal Room Player (PC sala) e dal portal speaker prima della pair. Ha solo INSERT/UPDATE su paired_devices e INSERT/UPDATE/DELETE su pairing_codes; tutto il resto passa da Edge Functions con service_role.';
