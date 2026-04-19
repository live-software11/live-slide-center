-- Sprint XY Patch (Phase 3.3 fix): separa edge_function_url da callback_url.
-- =============================================================================
-- BUG FIX: il design originale usava `callback_url` per due scopi distinti:
--   1) URL chiamato dal trigger DB (pg_net) -> deve essere edge function
--   2) URL chiamato dalla edge function -> deve essere WORKS endpoint
--
-- Soluzione: aggiungo colonna `edge_function_url` per separare le 2 funzioni.
--   - edge_function_url: invocato dal trigger via pg_net.http_post
--                        (es. https://<project>.supabase.co/functions/v1/licensing-callback)
--   - callback_url:      invocato dalla edge function via fetch()
--                        (es. https://api-...run.app/api/webhook/sync-from-backend)
-- =============================================================================
-- ── 1) Aggiungo colonna edge_function_url ──────────────────────────────────
ALTER TABLE public._internal_licensing_callback_config
ADD COLUMN IF NOT EXISTS edge_function_url TEXT;
-- ── 2) Re-deploy trigger function: usa edge_function_url (non callback_url) ─
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
-- ── 3) Re-deploy RPC config: include edge_function_url nel JSON ─────────────
CREATE OR REPLACE FUNCTION public._internal_get_licensing_callback_config() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public AS $$
DECLARE v_row public._internal_licensing_callback_config %ROWTYPE;
BEGIN
SELECT * INTO v_row
FROM public._internal_licensing_callback_config
WHERE id = true
LIMIT 1;
IF NOT FOUND THEN RETURN jsonb_build_object(
  'enabled',
  false,
  'internal_secret',
  null,
  'callback_url',
  null,
  'hmac_secret',
  null,
  'edge_function_url',
  null
);
END IF;
RETURN jsonb_build_object(
  'enabled',
  COALESCE(v_row.enabled, false),
  'internal_secret',
  NULLIF(v_row.internal_secret, ''),
  'callback_url',
  NULLIF(v_row.callback_url, ''),
  'hmac_secret',
  NULLIF(v_row.hmac_secret, ''),
  'edge_function_url',
  NULLIF(v_row.edge_function_url, '')
);
END;
$$;
REVOKE ALL ON FUNCTION public._internal_get_licensing_callback_config()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._internal_get_licensing_callback_config() TO service_role;
COMMENT ON COLUMN public._internal_licensing_callback_config.edge_function_url IS 'URL della Supabase Edge Function licensing-callback. Chiamato dal trigger DB via pg_net. Distinto da callback_url che e'' WORKS endpoint.';
