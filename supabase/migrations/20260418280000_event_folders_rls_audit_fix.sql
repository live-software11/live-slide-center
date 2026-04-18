-- ============================================================================
-- Audit-fix Sprint U-5+1 (Bug 2): hardening RLS event_folders
-- ============================================================================
-- La migration originale `20260418240000_event_folders.sql` (Sprint U-2)
-- ha definito le 4 policy (SELECT/INSERT/UPDATE/DELETE) con il solo check
-- `tenant_id = public.app_tenant_id()`, ma `event_folders` e' a tutti gli
-- effetti una tabella OPERATIVA (organizza presentations dell'evento, parte
-- del workflow Production view).
--
-- Per la regola `01-data-isolation.mdc` ("Sacralita dei dati e isolamento
-- tenant", sezione "tabelle operative"), tutte le tabelle operative devono
-- includere `AND NOT public.current_tenant_suspended()` nelle USING/WITH CHECK
-- delle policy RLS, in modo che un tenant sospeso non possa leggere ne'
-- modificare i propri dati operativi (vedi Fase 14, migration
-- `20250416140301_phase14_rls_tenant_suspended.sql` per il pattern applicato
-- su events/rooms/sessions/speakers/presentations/presentation_versions/
-- room_state).
--
-- Inoltre la migration originale NON aveva la policy `super_admin_all`
-- (richiesta dalla regola data-isolation per consentire al super-admin di
-- leggere cross-tenant per debug platform — dashboard /admin/tenants etc).
-- Aggiungiamo entrambe.
--
-- Comportamento:
--  * Tenant attivo (suspended=false): nessun cambiamento (policy continua a
--    permettere accesso al proprio tenant).
--  * Tenant sospeso: SELECT/INSERT/UPDATE/DELETE su event_folders bloccati.
--    Questo e' coerente col comportamento gia' attivo su events/sessions/
--    presentations/etc.
--  * Super-admin: vedeva gia' event_folders via service_role bypass; ora ha
--    anche policy esplicita `super_admin_all` per coerenza con la
--    convention del progetto.
--
-- IDEMPOTENTE: tutte le policy usano `DROP POLICY IF EXISTS` + `CREATE`.
-- ============================================================================
-- 1. SELECT: aggiunto check tenant_suspended
DROP POLICY IF EXISTS event_folders_select ON public.event_folders;
CREATE POLICY event_folders_select ON public.event_folders FOR
SELECT TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );
-- 2. INSERT: aggiunto check tenant_suspended
DROP POLICY IF EXISTS event_folders_insert ON public.event_folders;
CREATE POLICY event_folders_insert ON public.event_folders FOR
INSERT TO authenticated WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
    AND public.app_user_role() IN ('admin', 'tech')
  );
-- 3. UPDATE: aggiunto check tenant_suspended (USING + WITH CHECK)
DROP POLICY IF EXISTS event_folders_update ON public.event_folders;
CREATE POLICY event_folders_update ON public.event_folders FOR
UPDATE TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
    AND public.app_user_role() IN ('admin', 'tech')
  ) WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );
-- 4. DELETE: aggiunto check tenant_suspended
DROP POLICY IF EXISTS event_folders_delete ON public.event_folders;
CREATE POLICY event_folders_delete ON public.event_folders FOR DELETE TO authenticated USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
  AND public.app_user_role() IN ('admin', 'tech')
);
-- 5. super_admin_all: policy mancante per debug platform cross-tenant.
--    Permette al super_admin di leggere/modificare event_folders di QUALSIASI
--    tenant (audit, supporto, debug). Coerente col pattern degli altri tabelle
--    operative (events, rooms, sessions, ecc).
DROP POLICY IF EXISTS super_admin_all ON public.event_folders;
CREATE POLICY super_admin_all ON public.event_folders FOR ALL USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
-- ============================================================================
-- Note operative
-- ============================================================================
-- Dopo questa migration:
--   * Le folders di un tenant sospeso NON sono piu' leggibili dal client
--     dello stesso tenant (UI mostrera' lista vuota + banner sospensione
--     gia' attivo via TenantWarningBanners).
--   * Il super-admin (dashboard /admin/...) puo' leggere folders di tutti i
--     tenant per supporto e audit.
--   * Le RPC `move_presentations_to_folder` (SECURITY DEFINER) NON sono
--     impattate dal check tenant_suspended dentro la funzione, MA bypassano
--     RLS quando enumerano `event_folders` con `SELECT event_id ... WHERE id =
--     p_folder_id AND tenant_id = v_tenant`. Se in futuro vorremo bloccare
--     anche le RPC per tenant sospesi, va aggiunto un check esplicito dentro
--     la funzione (out of scope per questo fix).
COMMENT ON POLICY event_folders_select ON public.event_folders IS 'Audit-fix Sprint U-5+1: aggiunto check tenant_suspended (data-isolation rule).';
COMMENT ON POLICY event_folders_insert ON public.event_folders IS 'Audit-fix Sprint U-5+1: aggiunto check tenant_suspended.';
COMMENT ON POLICY event_folders_update ON public.event_folders IS 'Audit-fix Sprint U-5+1: aggiunto check tenant_suspended.';
COMMENT ON POLICY event_folders_delete ON public.event_folders IS 'Audit-fix Sprint U-5+1: aggiunto check tenant_suspended.';
COMMENT ON POLICY super_admin_all ON public.event_folders IS 'Audit-fix Sprint U-5+1: aggiunta policy super_admin_all (mancante in migration originale).';
