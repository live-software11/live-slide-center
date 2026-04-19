-- Audit edit-policy-per-software (Live WORKS APP) — 2026-04-19.
--
-- Aggiunge la quota `max_active_events` su `tenants`: limite per il numero di
-- eventi simultaneamente in stato 'active' di un tenant Slide Center. Distinto
-- da `max_events_per_month` che e' una quota mensile complessiva.
--
-- Convenzione valori:
--   NULL  = nessun limite esplicito (comportamento attuale: si usa il piano)
--   -1    = illimitato (Enterprise) — opzionale, NULL gia' coperto questo caso
--   >0    = numero di eventi simultanei consentiti
--
-- Cascata operativa:
--   1) ALTER TABLE tenants ADD COLUMN max_active_events INT NULL
--   2) DROP + RECREATE licensing_apply_quota con 9° parametro p_max_active_events
--      (postgres non permette di cambiare signature con CREATE OR REPLACE)
--   3) Aggiornamento trigger _internal_notify_works_on_tenant_change perche'
--      diff includa max_active_events e propaghi cambi a WORKS via callback.
--
-- Sicurezza/retrocompat: tutti i nuovi parametri sono opzionali. La Edge
-- Function `licensing-sync` viene aggiornata in deploy successivo e passera'
-- p_max_active_events solo se presente nel body. RPC accetta NULL come no-op.
-- ── 1) Colonna nuova ────────────────────────────────────────────────────────
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS max_active_events INT NULL;
COMMENT ON COLUMN public.tenants.max_active_events IS 'Numero massimo di eventi simultaneamente attivi (status = ''active''). NULL = nessun limite esplicito (si usa il piano), -1 = illimitato. Propagato dalla licenza WORKS (slideCenter.maxActiveEvents).';
-- ── 2) RPC: drop vecchia signature, ricreala con 9° param ──────────────────
DROP FUNCTION IF EXISTS public.licensing_apply_quota(
    TEXT,
    UUID,
    tenant_plan,
    BIGINT,
    INT,
    INT,
    TIMESTAMPTZ,
    TEXT
);
CREATE OR REPLACE FUNCTION public.licensing_apply_quota(
        p_license_key TEXT,
        p_tenant_id UUID,
        p_plan tenant_plan,
        p_storage_limit_bytes BIGINT,
        p_max_rooms_per_event INT,
        p_max_devices_per_room INT,
        p_expires_at TIMESTAMPTZ,
        p_status TEXT,
        p_max_active_events INT DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_target_id UUID;
v_should_suspend BOOLEAN;
v_suspended_after BOOLEAN;
BEGIN IF p_license_key IS NULL
OR length(p_license_key) < 4 THEN RAISE EXCEPTION 'license_key_required';
END IF;
IF p_storage_limit_bytes IS NOT NULL
AND p_storage_limit_bytes < -1 THEN RAISE EXCEPTION 'invalid_storage_limit';
END IF;
IF p_max_rooms_per_event IS NOT NULL
AND p_max_rooms_per_event < 0 THEN RAISE EXCEPTION 'invalid_max_rooms';
END IF;
IF p_max_devices_per_room IS NOT NULL
AND p_max_devices_per_room < 0 THEN RAISE EXCEPTION 'invalid_max_devices';
END IF;
IF p_max_active_events IS NOT NULL
AND p_max_active_events < -1 THEN RAISE EXCEPTION 'invalid_max_active_events';
END IF;
SELECT id INTO v_target_id
FROM tenants
WHERE license_key = p_license_key;
IF v_target_id IS NULL
AND p_tenant_id IS NOT NULL THEN v_target_id := p_tenant_id;
END IF;
IF v_target_id IS NULL THEN RAISE EXCEPTION 'tenant_not_resolved' USING HINT = 'Provide existing tenant_id or pre-bind license_key.';
END IF;
v_should_suspend := p_status IN ('suspended', 'expired', 'revoked');
UPDATE tenants
SET plan = p_plan,
    storage_limit_bytes = COALESCE(p_storage_limit_bytes, storage_limit_bytes),
    max_rooms_per_event = COALESCE(p_max_rooms_per_event, max_rooms_per_event),
    max_devices_per_room = COALESCE(p_max_devices_per_room, max_devices_per_room),
    max_active_events = COALESCE(p_max_active_events, max_active_events),
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
    TEXT,
    INT
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
        TEXT,
        INT
    ) TO service_role;
-- ── 3) Trigger: includi max_active_events nel diff per callback a WORKS ────
CREATE OR REPLACE FUNCTION public._internal_notify_works_on_tenant_change() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
    extensions,
    net AS $$
DECLARE v_url TEXT;
v_secret TEXT;
v_enabled BOOLEAN;
v_skip TEXT;
v_changed BOOLEAN := false;
v_request_id BIGINT;
v_cfg_row public._internal_licensing_callback_config %ROWTYPE;
BEGIN v_skip := current_setting('app.licensing_callback_skip', true);
IF v_skip = 'true' THEN RETURN COALESCE(NEW, OLD);
END IF;
SELECT * INTO v_cfg_row
FROM public._internal_licensing_callback_config
WHERE id = true
LIMIT 1;
v_enabled := COALESCE(v_cfg_row.enabled, false);
IF NOT v_enabled THEN RETURN COALESCE(NEW, OLD);
END IF;
IF TG_OP = 'INSERT' THEN IF NEW.license_key IS NOT NULL THEN v_changed := true;
END IF;
ELSIF TG_OP = 'UPDATE' THEN IF NEW.plan IS DISTINCT
FROM OLD.plan
    OR NEW.suspended IS DISTINCT
FROM OLD.suspended
    OR NEW.expires_at IS DISTINCT
FROM OLD.expires_at
    OR NEW.storage_limit_bytes IS DISTINCT
FROM OLD.storage_limit_bytes
    OR NEW.max_rooms_per_event IS DISTINCT
FROM OLD.max_rooms_per_event
    OR NEW.max_devices_per_room IS DISTINCT
FROM OLD.max_devices_per_room
    OR NEW.max_active_events IS DISTINCT
FROM OLD.max_active_events
    OR NEW.license_key IS DISTINCT
FROM OLD.license_key THEN v_changed := true;
END IF;
END IF;
IF NOT v_changed THEN RETURN COALESCE(NEW, OLD);
END IF;
v_url := v_cfg_row.edge_function_url;
v_secret := v_cfg_row.internal_secret;
IF v_url IS NULL
OR v_url = ''
OR v_secret IS NULL
OR v_secret = '' THEN RAISE WARNING 'licensing_callback: edge_function_url/internal_secret not configured; skipping notify for tenant %',
NEW.id;
RETURN COALESCE(NEW, OLD);
END IF;
v_request_id := net.http_post(
    url := v_url,
    body := jsonb_build_object(
        'tenant_id',
        NEW.id,
        'source_op',
        TG_OP
    ),
    headers := jsonb_build_object(
        'Content-Type',
        'application/json',
        'x-internal-secret',
        v_secret
    ),
    timeout_milliseconds := 5000
);
RETURN COALESCE(NEW, OLD);
EXCEPTION
WHEN OTHERS THEN RAISE WARNING 'licensing_callback notify failed for tenant %: %',
NEW.id,
SQLERRM;
RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._internal_notify_works_on_tenant_change()
FROM PUBLIC;
