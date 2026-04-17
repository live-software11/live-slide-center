-- ════════════════════════════════════════════════════════════════════════════
-- Performance: consolidamento policy multi-permissive (270 warning advisor)
-- ════════════════════════════════════════════════════════════════════════════
-- Strategia:
--   1) Per ogni tabella che oggi ha 2 policy PERMISSIVE FOR ALL
--      (`super_admin_all` + `tenant_isolation`), unisco in una singola policy
--      `tenant_or_super` con USING/WITH CHECK combinati con OR.
--      Risultato: PostgreSQL valuta una sola espressione invece di due,
--      eliminando il warning multiple_permissive_policies (4 ruoli × 5 cmd
--      = 20 warning per tabella).
--
--   2) Wrappo le funzioni helper in `(SELECT ...)` per consentire al planner
--      di applicare InitPlan caching: ogni chiamata SELECT vede la sub-query
--      come scalare costante per tutta la query (vedi Supabase RLS perf docs).
--
--   3) Per tenants/users dove esistono policy split per cmd diversi, riscrivo
--      con policy separate per SELECT/INSERT/UPDATE/DELETE in modo da NON
--      sommare permissive sullo stesso (ruolo, cmd).
--
--   4) Fix delle 2 auth_rls_initplan su email_log e tenant_data_exports:
--      `auth.jwt()` → `(SELECT auth.jwt())` per InitPlan caching.
--
-- Nessun cambio di SEMANTICA: le condizioni rimangono identiche, cambia
-- solo come Postgres le valuta (più efficiente). Verificato manualmente
-- che le combinazioni OR coprono ESATTAMENTE l'unione delle policy attuali.
-- ════════════════════════════════════════════════════════════════════════════
-- ── Sezione A: 12 tabelle multi-tenant con pattern uniforme ───────────────
-- Tabelle: activity_log, events, local_agents, paired_devices, pairing_codes,
-- presentation_versions, presentations, room_state, rooms, sessions, speakers,
-- team_invitations.
-- Pattern attuale (per ognuna):
--   - super_admin_all     (PERMISSIVE, ALL): is_super_admin()
--   - tenant_isolation    (PERMISSIVE, ALL): tenant_id = app_tenant_id()
--                                            AND NOT current_tenant_suspended()
-- Pattern nuovo (per ognuna):
--   - tenant_or_super     (PERMISSIVE, ALL):
--       (SELECT public.is_super_admin())
--       OR (tenant_id = (SELECT public.app_tenant_id())
--           AND NOT (SELECT public.current_tenant_suspended()))
DO $$
DECLARE v_tables TEXT [] := ARRAY [
    'activity_log','events','local_agents','paired_devices','pairing_codes',
    'presentation_versions','presentations','room_state','rooms','sessions',
    'speakers','team_invitations'
  ];
v_table TEXT;
BEGIN FOREACH v_table IN ARRAY v_tables LOOP EXECUTE format(
  'DROP POLICY IF EXISTS super_admin_all ON public.%I',
  v_table
);
EXECUTE format(
  'DROP POLICY IF EXISTS tenant_isolation ON public.%I',
  v_table
);
EXECUTE format(
  $f$ CREATE POLICY tenant_or_super ON public.%I FOR ALL TO authenticated USING (
    (
      SELECT public.is_super_admin()
    )
    OR (
      tenant_id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  ) WITH CHECK (
    (
      SELECT public.is_super_admin()
    )
    OR (
      tenant_id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  ) $f$,
  v_table
);
EXECUTE format(
  $f$ COMMENT ON POLICY tenant_or_super ON public.%I IS 'Consolidata da super_admin_all+tenant_isolation per ridurre overhead RLS (Sprint 8 perf).' $f$,
  v_table
);
END LOOP;
END $$;
-- ── Sezione B: tabella `tenants` ──────────────────────────────────────────
-- Pattern attuale:
--   - super_admin_all          (PERMISSIVE, ALL):    is_super_admin()
--   - tenant_select_own        (PERMISSIVE, SELECT): id = app_tenant_id()
--   - tenant_update_own_active (PERMISSIVE, UPDATE): id = app_tenant_id()
--                                                    AND NOT suspended
-- Pattern nuovo: 4 policy separate per cmd (1 permissive ciascuna).
DROP POLICY IF EXISTS super_admin_all ON public.tenants;
DROP POLICY IF EXISTS tenant_select_own ON public.tenants;
DROP POLICY IF EXISTS tenant_update_own_active ON public.tenants;
CREATE POLICY tenants_select ON public.tenants FOR
SELECT TO authenticated USING (
    (
      SELECT public.is_super_admin()
    )
    OR id = (
      SELECT public.app_tenant_id()
    )
  );
CREATE POLICY tenants_update ON public.tenants FOR
UPDATE TO authenticated USING (
    (
      SELECT public.is_super_admin()
    )
    OR (
      id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  ) WITH CHECK (
    (
      SELECT public.is_super_admin()
    )
    OR (
      id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  );
CREATE POLICY tenants_insert ON public.tenants FOR
INSERT TO authenticated WITH CHECK (
    (
      SELECT public.is_super_admin()
    )
  );
CREATE POLICY tenants_delete ON public.tenants FOR DELETE TO authenticated USING (
  (
    SELECT public.is_super_admin()
  )
);
-- ── Sezione C: tabella `users` ────────────────────────────────────────────
-- Pattern attuale:
--   - super_admin_all              (PERMISSIVE, ALL):    is_super_admin()
--   - tenant_users_select_own      (PERMISSIVE, SELECT): tenant_id = app_tenant_id()
--   - tenant_users_mutate_active   (PERMISSIVE, ALL):    tenant_id = app_tenant_id()
--                                                        AND NOT suspended
-- Pattern nuovo: 4 policy separate (SELECT/INSERT/UPDATE/DELETE).
DROP POLICY IF EXISTS super_admin_all ON public.users;
DROP POLICY IF EXISTS tenant_users_select_own ON public.users;
DROP POLICY IF EXISTS tenant_users_mutate_active ON public.users;
CREATE POLICY users_select ON public.users FOR
SELECT TO authenticated USING (
    (
      SELECT public.is_super_admin()
    )
    OR tenant_id = (
      SELECT public.app_tenant_id()
    )
  );
CREATE POLICY users_insert ON public.users FOR
INSERT TO authenticated WITH CHECK (
    (
      SELECT public.is_super_admin()
    )
    OR (
      tenant_id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  );
CREATE POLICY users_update ON public.users FOR
UPDATE TO authenticated USING (
    (
      SELECT public.is_super_admin()
    )
    OR (
      tenant_id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  ) WITH CHECK (
    (
      SELECT public.is_super_admin()
    )
    OR (
      tenant_id = (
        SELECT public.app_tenant_id()
      )
      AND NOT (
        SELECT public.current_tenant_suspended()
      )
    )
  );
CREATE POLICY users_delete ON public.users FOR DELETE TO authenticated USING (
  (
    SELECT public.is_super_admin()
  )
  OR (
    tenant_id = (
      SELECT public.app_tenant_id()
    )
    AND NOT (
      SELECT public.current_tenant_suspended()
    )
  )
);
-- ── Sezione D: fix auth_rls_initplan su email_log/tenant_data_exports ─────
-- Sostituisco auth.jwt() / current_setting() diretti con (SELECT ...).
DROP POLICY IF EXISTS email_log_super_admin_select ON public.email_log;
CREATE POLICY email_log_super_admin_select ON public.email_log FOR
SELECT TO authenticated USING (
    (
      (
        (
          SELECT auth.jwt()
        )->'app_metadata'
      )->>'role'
    ) = 'super_admin'
  );
DROP POLICY IF EXISTS tenant_data_exports_admin_select ON public.tenant_data_exports;
CREATE POLICY tenant_data_exports_admin_select ON public.tenant_data_exports FOR
SELECT TO authenticated USING (
    tenant_id = (
      SELECT public.app_tenant_id()
    )
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (
          (
            SELECT auth.jwt()
          )->>'sub'
        )::uuid
        AND u.tenant_id = (
          SELECT public.app_tenant_id()
        )
        AND u.role = 'admin'::public.user_role
    )
  );
