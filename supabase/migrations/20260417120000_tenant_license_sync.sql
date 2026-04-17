-- Sprint 4 — Live WORKS APP: sync centralizzato licenze ↔ tenants Slide Center.
-- Aggiunge i campi necessari per ricondurre un tenant Supabase alla licenza
-- emessa da Live WORKS APP (chiave commerciale, scadenza, quote operative).
-- ── 1. Estensioni colonne tenants ────────────────────────────────────────
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS license_key TEXT,
  ADD COLUMN IF NOT EXISTS license_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_devices_per_room INT NOT NULL DEFAULT 10;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_license_key ON public.tenants(license_key)
WHERE license_key IS NOT NULL;
COMMENT ON COLUMN public.tenants.license_key IS 'Chiave licenza Live WORKS APP (XXXX-XXXX-XXXX-XXXX). NULL per tenant trial/manuali.';
COMMENT ON COLUMN public.tenants.license_synced_at IS 'Timestamp ultimo push dei quota da Live WORKS APP.';
COMMENT ON COLUMN public.tenants.expires_at IS 'Scadenza commerciale; oltre questa data il tenant viene sospeso automaticamente.';
COMMENT ON COLUMN public.tenants.max_devices_per_room IS 'Numero massimo di Room Agent (PC sala) appaiabili per stanza, propagato dalla licenza.';
-- ── 2. Helper: max devices per room ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_max_devices_per_room(p_tenant_id uuid) RETURNS INT LANGUAGE sql STABLE
SET search_path = public AS $$
SELECT max_devices_per_room
FROM tenants
WHERE id = p_tenant_id;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_max_devices_per_room(uuid) TO authenticated;
-- ── 3. Trigger: scadenza licenza → tenants.suspended ─────────────────────
-- Reagisce SOLO a UPDATE OF expires_at e INSERT, NON a UPDATE OF suspended:
-- in quel modo un super-admin che fa `UPDATE tenants SET suspended=false` non
-- viene mai sovrascritto se sta tentando una riattivazione manuale di emergenza.
CREATE OR REPLACE FUNCTION public.tenant_apply_expiry() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$ BEGIN IF NEW.expires_at IS NOT NULL
  AND NEW.expires_at < now() THEN NEW.suspended := true;
END IF;
RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS apply_license_expiry ON public.tenants;
CREATE TRIGGER apply_license_expiry BEFORE
INSERT
  OR
UPDATE OF expires_at ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.tenant_apply_expiry();
-- ── 4. RPC: licensing_apply_quota (chiamata da Edge Function) ────────────
-- SECURITY DEFINER: bypassa RLS, chiamata solo da `service_role` via edge.
-- Aggiorna le quote del tenant esistente. NON crea il tenant: deve essere
-- pre-creato via signup. Errore esplicito se la coppia license_key/tenant_id
-- non risolve a un tenant.
--
-- COMPORTAMENTO SUSPENDED (anti-override sospensione manuale super-admin):
--   - status ∈ {suspended, expired, revoked} → suspended := true (forza)
--   - status = 'active' o altro → suspended NON viene toccato. Cosi' una
--     sospensione manuale precedente sopravvive a un sync di rinnovo licenza.
--     Per riattivare bisogna farlo esplicitamente (tools admin).
CREATE OR REPLACE FUNCTION public.licensing_apply_quota(
    p_license_key TEXT,
    p_tenant_id UUID,
    p_plan tenant_plan,
    p_storage_limit_bytes BIGINT,
    p_max_rooms_per_event INT,
    p_max_devices_per_room INT,
    p_expires_at TIMESTAMPTZ,
    p_status TEXT
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_target_id UUID;
v_should_suspend BOOLEAN;
v_suspended_after BOOLEAN;
BEGIN IF p_license_key IS NULL
OR length(p_license_key) < 4 THEN RAISE EXCEPTION 'license_key_required';
END IF;
-- Validazioni numeriche difensive (la Edge Function valida ma double-check).
IF p_storage_limit_bytes IS NOT NULL
AND p_storage_limit_bytes < -1 THEN RAISE EXCEPTION 'invalid_storage_limit';
END IF;
IF p_max_rooms_per_event IS NOT NULL
AND p_max_rooms_per_event < 0 THEN RAISE EXCEPTION 'invalid_max_rooms';
END IF;
IF p_max_devices_per_room IS NOT NULL
AND p_max_devices_per_room < 0 THEN RAISE EXCEPTION 'invalid_max_devices';
END IF;
-- 1) Risolvi tenant: priorita' a license_key gia' bound, poi tenant_id esplicito.
SELECT id INTO v_target_id
FROM tenants
WHERE license_key = p_license_key;
IF v_target_id IS NULL
AND p_tenant_id IS NOT NULL THEN v_target_id := p_tenant_id;
END IF;
IF v_target_id IS NULL THEN RAISE EXCEPTION 'tenant_not_resolved' USING HINT = 'Provide existing tenant_id or pre-bind license_key.';
END IF;
-- 2) Mappa status → forza-suspend solo per stati negativi
v_should_suspend := p_status IN ('suspended', 'expired', 'revoked');
-- 3) UPDATE: suspended viene scritto SOLO se status negativo.
--    Status positivo (active/altro): suspended resta com'e' (no override manuale).
UPDATE tenants
SET plan = p_plan,
  storage_limit_bytes = COALESCE(p_storage_limit_bytes, storage_limit_bytes),
  max_rooms_per_event = COALESCE(p_max_rooms_per_event, max_rooms_per_event),
  max_devices_per_room = COALESCE(p_max_devices_per_room, max_devices_per_room),
  expires_at = p_expires_at,
  license_key = p_license_key,
  license_synced_at = now(),
  suspended = CASE
    WHEN v_should_suspend THEN true
    ELSE suspended
  END,
  updated_at = now()
WHERE id = v_target_id
RETURNING suspended INTO v_suspended_after;
IF NOT FOUND THEN RAISE EXCEPTION 'tenant_not_found' USING HINT = 'Create tenant via signup before assigning a license.';
END IF;
RETURN jsonb_build_object(
  'ok',
  true,
  'tenant_id',
  v_target_id,
  'license_key',
  p_license_key,
  'suspended',
  v_suspended_after,
  'suspended_by_license',
  v_should_suspend
);
END;
$$;
REVOKE ALL ON FUNCTION public.licensing_apply_quota(
  TEXT,
  UUID,
  tenant_plan,
  BIGINT,
  INT,
  INT,
  TIMESTAMPTZ,
  TEXT
)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.licensing_apply_quota(
    TEXT,
    UUID,
    tenant_plan,
    BIGINT,
    INT,
    INT,
    TIMESTAMPTZ,
    TEXT
  ) TO service_role;
