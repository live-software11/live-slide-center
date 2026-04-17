-- Sprint 8 — Audit log esposto agli admin del tenant.
-- Contenuti:
--  1) RPC list_tenant_activity(filters, pagination) → activity_log filtrato
--     per tenant corrente, accessibile solo agli admin del tenant
--  2) Indice di supporto per query con filtro action+actor
--
-- Differenza dalla pagina super-admin /admin/audit:
--   - super_admin vede TUTTI i tenant (cross-tenant).
--   - admin tenant vede SOLO il proprio tenant.
-- Entrambe scrivono nella stessa activity_log esistente.
-- ════════════════════════════════════════════════════════════════════════════
-- ── 1. Indice di supporto: query frequenti per (tenant, action, created_at) ─
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_action_created ON public.activity_log(tenant_id, action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_tenant_actor_created ON public.activity_log(tenant_id, actor_id, created_at DESC);
-- ── 2. RPC list_tenant_activity: lista paginata audit log del tenant ────────
-- SECURITY DEFINER, admin tenant only.
-- Restituisce JSONB { rows: [...], total: int, has_more: bool }.
-- Filtri opzionali: from/to (timestamp), action (LIKE), actor_id, entity_type.
-- Paginazione: limit (default 50, max 200), offset.
-- NOTA: p_actor_id e' TEXT (non UUID) perche' activity_log.actor_id e' TEXT
-- (puo' contenere 'system', 'cron', oltre agli UUID utenti).
CREATE OR REPLACE FUNCTION public.list_tenant_activity(
    p_from TIMESTAMPTZ DEFAULT NULL,
    p_to TIMESTAMPTZ DEFAULT NULL,
    p_action TEXT DEFAULT NULL,
    p_actor_id TEXT DEFAULT NULL,
    p_entity_type TEXT DEFAULT NULL,
    p_limit INT DEFAULT 50,
    p_offset INT DEFAULT 0
  ) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant UUID;
v_user UUID;
v_role TEXT;
v_limit INT;
v_offset INT;
v_total INT;
v_rows JSONB;
BEGIN v_tenant := public.app_tenant_id();
IF v_tenant IS NULL THEN RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
END IF;
v_user := (auth.jwt()->>'sub')::uuid;
SELECT u.role INTO v_role
FROM public.users u
WHERE u.id = v_user
  AND u.tenant_id = v_tenant;
-- Solo admin tenant: gli editor/viewer non vedono l'audit.
IF v_role IS DISTINCT
FROM 'admin' THEN RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
END IF;
-- Sanitize limiti per evitare query troppo costose.
v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
v_offset := GREATEST(COALESCE(p_offset, 0), 0);
-- Conteggio totale rispettando i filtri.
SELECT COUNT(*) INTO v_total
FROM public.activity_log al
WHERE al.tenant_id = v_tenant
  AND (
    p_from IS NULL
    OR al.created_at >= p_from
  )
  AND (
    p_to IS NULL
    OR al.created_at <= p_to
  )
  AND (
    p_action IS NULL
    OR al.action ILIKE '%' || p_action || '%'
  )
  AND (
    p_actor_id IS NULL
    OR al.actor_id = p_actor_id
  )
  AND (
    p_entity_type IS NULL
    OR al.entity_type = p_entity_type
  );
-- Pagina richiesta.
SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO v_rows
FROM (
    SELECT al.id,
      al.created_at,
      al.actor,
      al.actor_id,
      al.actor_name,
      al.action,
      al.entity_type,
      al.entity_id,
      al.event_id,
      al.metadata
    FROM public.activity_log al
    WHERE al.tenant_id = v_tenant
      AND (
        p_from IS NULL
        OR al.created_at >= p_from
      )
      AND (
        p_to IS NULL
        OR al.created_at <= p_to
      )
      AND (
        p_action IS NULL
        OR al.action ILIKE '%' || p_action || '%'
      )
      AND (
        p_actor_id IS NULL
        OR al.actor_id = p_actor_id
      )
      AND (
        p_entity_type IS NULL
        OR al.entity_type = p_entity_type
      )
    ORDER BY al.created_at DESC
    LIMIT v_limit OFFSET v_offset
  ) t;
RETURN jsonb_build_object(
  'rows',
  v_rows,
  'total',
  v_total,
  'has_more',
  (v_offset + v_limit) < v_total,
  'limit',
  v_limit,
  'offset',
  v_offset
);
END;
$$;
REVOKE ALL ON FUNCTION public.list_tenant_activity(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  INT,
  INT
)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_tenant_activity(
    TIMESTAMPTZ,
    TIMESTAMPTZ,
    TEXT,
    TEXT,
    TEXT,
    INT,
    INT
  ) TO authenticated;
COMMENT ON FUNCTION public.list_tenant_activity(
  TIMESTAMPTZ,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT,
  INT,
  INT
) IS 'Sprint 8: lista paginata di activity_log per il tenant corrente (admin only). Filtri: from/to/action/actor/entity_type.';
