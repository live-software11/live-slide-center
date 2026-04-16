-- Fase 14: RLS — tenant sospeso non vede né modifica dati operativi (stesso tenant_id).
-- Lettura riga `tenants` propria resta consentita (banner/UI sospensione).
-- Super-admin: policy esistenti `super_admin_all` (OR permissive) invariati.
CREATE OR REPLACE FUNCTION public.current_tenant_suspended() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
SELECT COALESCE(
    (
      SELECT t.suspended
      FROM public.tenants t
      WHERE t.id = public.app_tenant_id()
    ),
    false
  );
$$;
REVOKE ALL ON FUNCTION public.current_tenant_suspended()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_tenant_suspended() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_tenant_suspended() TO service_role;
-- tenants: SELECT sempre sulla propria org (anche se suspended); UPDATE solo se non sospeso
DROP POLICY IF EXISTS tenant_isolation ON public.tenants;
CREATE POLICY tenant_select_own ON public.tenants FOR
SELECT USING (id = public.app_tenant_id());
CREATE POLICY tenant_update_own_active ON public.tenants FOR
UPDATE USING (
    id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  ) WITH CHECK (
    id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );
-- tabelle operative: blocco dati se tenant sospeso
DROP POLICY IF EXISTS tenant_isolation ON public.events;
CREATE POLICY tenant_isolation ON public.events FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.rooms;
CREATE POLICY tenant_isolation ON public.rooms FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.sessions;
CREATE POLICY tenant_isolation ON public.sessions FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.speakers;
CREATE POLICY tenant_isolation ON public.speakers FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.presentations;
CREATE POLICY tenant_isolation ON public.presentations FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.presentation_versions;
CREATE POLICY tenant_isolation ON public.presentation_versions FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.room_state;
CREATE POLICY tenant_isolation ON public.room_state FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.local_agents;
CREATE POLICY tenant_isolation ON public.local_agents FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.activity_log;
CREATE POLICY tenant_isolation ON public.activity_log FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.users;
CREATE POLICY tenant_users_select_own ON public.users FOR
SELECT USING (tenant_id = public.app_tenant_id());
CREATE POLICY tenant_users_mutate_active ON public.users FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.pairing_codes;
CREATE POLICY tenant_isolation ON public.pairing_codes FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
DROP POLICY IF EXISTS tenant_isolation ON public.paired_devices;
CREATE POLICY tenant_isolation ON public.paired_devices FOR ALL USING (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
) WITH CHECK (
  tenant_id = public.app_tenant_id()
  AND NOT public.current_tenant_suspended()
);
