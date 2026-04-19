-- Audit UI nomenclatura quote 2026-04-20.
--
-- Rinomina semantica: `max_devices_per_room` -> `max_devices_per_event`.
-- Motivazione business: il limite va imposto a livello di EVENTO (totale di
-- Room Agent appaiabili nell'intero evento), non per singola stanza. Cosi'
-- l'admin puo' distribuire (es. 10 PC in sala plenaria + 2 in una secondaria)
-- mantenendo un budget totale per il tenant/evento.
--
-- Strategia SAFE coesistenza per finestra deploy multi-stack:
--   1. ADD nuova colonna `max_devices_per_event` (NOT NULL DEFAULT 10).
--   2. UPDATE: copia 1:1 valori da `max_devices_per_room` -> `max_devices_per_event`.
--   3. RPC `licensing_apply_quota`: drop firma vecchia (9 arg) + crea nuova
--      con 10 arg, dove ENTRAMBI `p_max_devices_per_event` e
--      `p_max_devices_per_room` hanno DEFAULT NULL. Cosi' Edge Function
--      vecchia (passa solo `p_max_devices_per_room`) e nuova (passa solo
--      `p_max_devices_per_event`) continuano a funzionare. La RPC scrive su
--      ENTRAMBE le colonne con il valore canonico calcolato come
--      COALESCE(per_event, per_room).
--   4. Trigger `_internal_notify_works_on_tenant_change`: include il nuovo
--      campo nel diff change-detector (vecchio resta per safety).
--   5. Helper SQL `tenant_max_devices_per_event(uuid)` (la funzione vecchia
--      `tenant_max_devices_per_room` resta per backward compat finche' non
--      verra' rimossa in cleanup futuro).
--   6. NON DROPPIAMO ancora la colonna vecchia: cleanup separato dopo che
--      WORKS Functions e SC frontend hanno deployato il nuovo nome.
--
-- Compatibilita' Edge Functions:
--   - `licensing-sync` (v4+): accetta sia `max_devices_per_room` che
--     `max_devices_per_event` nel body, prefer nuovo. Passa SEMPRE alla RPC
--     nuova con `p_max_devices_per_event`.
--   - `licensing-callback` / `licensing-shadow` (v4+): nel payload shadow
--     riportano ENTRAMBI i field `maxDevicesPerRoom` (deprecated, =
--     maxDevicesPerEvent) e `maxDevicesPerEvent` (nuovo) per non rompere
--     consumatori non ancora deployati.
-- ── 1) ADD nuova colonna + COPY dati ────────────────────────────────────
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS max_devices_per_event INTEGER NOT NULL DEFAULT 10;
UPDATE public.tenants
SET max_devices_per_event = max_devices_per_room
WHERE max_devices_per_event IS DISTINCT
FROM max_devices_per_room;
COMMENT ON COLUMN public.tenants.max_devices_per_event IS 'Canonical 2026-04-19: maximum devices/PCs per event (sum across all rooms in the event).';
COMMENT ON COLUMN public.tenants.max_devices_per_room IS 'DEPRECATED 2026-04-19: use max_devices_per_event. Kept in sync via licensing_apply_quota for backward compatibility with older Edge Function isolates.';
-- ── 2) RPC: drop firme legacy + create nuova con 10-arg ────────────────────
DROP FUNCTION IF EXISTS public.licensing_apply_quota(
  text,
  uuid,
  tenant_plan,
  bigint,
  integer,
  integer,
  timestamp with time zone,
  text,
  integer
);
DROP FUNCTION IF EXISTS public.licensing_apply_quota(
  text,
  uuid,
  tenant_plan,
  bigint,
  integer,
  integer,
  timestamp with time zone,
  text,
  integer,
  integer
);
CREATE OR REPLACE FUNCTION public.licensing_apply_quota(
    p_license_key text,
    p_tenant_id uuid,
    p_plan tenant_plan,
    p_storage_limit_bytes bigint,
    p_max_rooms_per_event integer,
    p_expires_at timestamp with time zone,
    p_status text,
    p_max_active_events integer DEFAULT NULL,
    p_max_devices_per_event integer DEFAULT NULL,
    p_max_devices_per_room integer DEFAULT NULL
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $function$
DECLARE v_target_id UUID;
v_should_suspend BOOLEAN;
v_suspended_after BOOLEAN;
v_devices INTEGER;
BEGIN -- Anti-loop Phase 3.3 (GAP-1): skippa il callback verso WORKS quando il
-- cambio quota proviene da WORKS stessa (push via licensing-sync Edge Fn).
PERFORM set_config('app.licensing_callback_skip', 'true', true);
IF p_license_key IS NULL
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
IF p_max_devices_per_event IS NOT NULL
AND p_max_devices_per_event < 0 THEN RAISE EXCEPTION 'invalid_max_devices_per_event';
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
-- Canonical devices: prefer new param (event), fallback to legacy param (room).
-- La RPC scrive sempre su ENTRAMBE le colonne durante la finestra di rollout.
v_devices := COALESCE(p_max_devices_per_event, p_max_devices_per_room);
UPDATE tenants
SET plan = p_plan,
  storage_limit_bytes = COALESCE(p_storage_limit_bytes, storage_limit_bytes),
  max_rooms_per_event = COALESCE(p_max_rooms_per_event, max_rooms_per_event),
  max_devices_per_room = COALESCE(v_devices, max_devices_per_room),
  max_devices_per_event = COALESCE(v_devices, max_devices_per_event),
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
$function$;
REVOKE ALL ON FUNCTION public.licensing_apply_quota(
  text,
  uuid,
  tenant_plan,
  bigint,
  integer,
  timestamp with time zone,
  text,
  integer,
  integer,
  integer
)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.licensing_apply_quota(
    text,
    uuid,
    tenant_plan,
    bigint,
    integer,
    timestamp with time zone,
    text,
    integer,
    integer,
    integer
  ) TO service_role;
-- ── 3) Trigger callback: includi anche max_devices_per_event nel diff ──────
CREATE OR REPLACE FUNCTION public._internal_notify_works_on_tenant_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public',
  'extensions',
  'net' AS $function$
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
  OR NEW.max_devices_per_event IS DISTINCT
FROM OLD.max_devices_per_event
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
  body := jsonb_build_object('tenant_id', NEW.id, 'source_op', TG_OP),
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
$function$;
REVOKE ALL ON FUNCTION public._internal_notify_works_on_tenant_change()
FROM PUBLIC;
-- ── 4) Helper SQL nuova ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_max_devices_per_event(p_tenant_id uuid) RETURNS INTEGER LANGUAGE sql STABLE
SET search_path = public AS $$
SELECT max_devices_per_event
FROM tenants
WHERE id = p_tenant_id;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_max_devices_per_event(uuid) TO authenticated;
