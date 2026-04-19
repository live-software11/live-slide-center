-- Sprint XY (Centro Controllo Licenze Phase 3.3)
-- =============================================================================
-- Trigger Postgres che notifica Live WORKS APP quando cambia lo stato licensing
-- di un tenant Slide Center. Il payload effettivo viene costruito e firmato
-- HMAC dalla edge function `licensing-callback` (vedi
-- `supabase/functions/licensing-callback/index.ts`).
--
-- ARCHITETTURA:
--   tenants UPDATE -> trigger DB -> pg_net.http_post -> licensing-callback
--   -> HMAC POST -> Live WORKS APP /api/webhook/sync-from-backend
--
-- ANTI-LOOP (a 2 livelli):
--   1) Quando WORKS spinge un cambio quota via licensing-sync edge function
--      (RPC licensing_apply_quota), la funzione setta una flag di sessione
--      `app.licensing_callback_skip='true'`. Il trigger qui sotto controlla
--      quella flag e skippa per evitare re-bound verso WORKS.
--   2) Anche se per qualche ragione il rebound parte, WORKS skippa il push
--      di ritorno verso SC se `_lastSyncedFromBackend < 5s` (vedi
--      `cross-project-push.ts` su WORKS, gia' presente in Phase 2.1+2.2).
--
-- CONFIG STORAGE: tabella `public._internal_licensing_callback_config`
--   - Schema-private, RLS deny-all (solo service_role / SECURITY DEFINER).
--   - Single row (id=true UNIQUE) con i 3 valori + flag enabled.
--   - Editing solo via SQL service_role (es. dashboard SQL editor o admin tools).
--
-- SAFETY ROLLOUT:
--   - Estensione pg_net + trigger creati SEMPRE (idempotente).
--   - L'invocazione effettiva e' gated da `enabled=false` (default).
--   - Per attivare:
--       UPDATE public._internal_licensing_callback_config
--       SET enabled = true,
--           callback_url = 'https://api-57fephgjwq-ew.a.run.app/api/webhook/sync-from-backend',
--           hmac_secret = '<stesso valore di SLIDECENTER_HMAC_SECRET su WORKS>',
--           internal_secret = '<random ≥32 char>'
--       WHERE id = true;
--
-- =============================================================================
-- ── 1) Estensione pg_net per chiamate HTTP da Postgres ──────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
-- ── 2) Tabella di config (single-row, RLS deny-all) ─────────────────────────
CREATE TABLE IF NOT EXISTS public._internal_licensing_callback_config (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id = true),
  enabled BOOLEAN NOT NULL DEFAULT false,
  callback_url TEXT,
  hmac_secret TEXT,
  internal_secret TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);
ALTER TABLE public._internal_licensing_callback_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON public._internal_licensing_callback_config;
CREATE POLICY deny_all ON public._internal_licensing_callback_config FOR ALL USING (false) WITH CHECK (false);
REVOKE ALL ON public._internal_licensing_callback_config
FROM PUBLIC,
  anon,
  authenticated;
GRANT SELECT,
  UPDATE,
  INSERT,
  DELETE ON public._internal_licensing_callback_config TO service_role;
COMMENT ON TABLE public._internal_licensing_callback_config IS 'Phase 3.3 Centro Controllo Licenze: config per trigger->callback->WORKS. Single row, RLS deny-all, accessibile solo da service_role o SECURITY DEFINER functions.';
-- Seed riga unica (idempotente)
INSERT INTO public._internal_licensing_callback_config (id, enabled, notes)
VALUES (
    true,
    false,
    'Phase 3.3 — popolare callback_url, hmac_secret, internal_secret e settare enabled=true per attivare.'
  ) ON CONFLICT (id) DO NOTHING;
-- ── 3) Re-deploy licensing_apply_quota con anti-loop flag ───────────────────
-- IMPORTANT: questa e' una sostituzione idempotente. La firma e il corpo
-- restano identici a `20260417120000_tenant_license_sync.sql`, aggiungiamo
-- SOLO la riga `PERFORM set_config('app.licensing_callback_skip','true',true);`
-- in cima al body. true (terzo arg) = scope LOCAL = solo per questa transaction.
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
BEGIN -- Anti-loop Phase 3.3: marca questa transaction come "sync proveniente da
-- WORKS", in modo che il trigger notify_works_on_tenant_change non
-- ri-emetta il rebound. Scope LOCAL (true) = solo per questa tx.
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
-- ── 4) RPC: _internal_get_licensing_callback_config ─────────────────────────
-- Letta dalla edge function `licensing-callback`. Ritorna i 4 campi in un
-- singolo jsonb. SECURITY DEFINER + GRANT solo service_role: NESSUN client
-- anon/authenticated puo' leggere i secret.
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
  NULLIF(v_row.hmac_secret, '')
);
END;
$$;
REVOKE ALL ON FUNCTION public._internal_get_licensing_callback_config()
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._internal_get_licensing_callback_config() TO service_role;
COMMENT ON FUNCTION public._internal_get_licensing_callback_config() IS 'Phase 3.3: ritorna la config completa per la edge function licensing-callback. Solo service_role.';
-- ── 5) Trigger function: notify_works_on_tenant_change ──────────────────────
-- SECURITY DEFINER per accedere a `extensions.net` se schema lockdown attivo.
-- Schema esplicito `net.http_post` (pg_net installa nello schema `net`).
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
BEGIN -- 1) Skip se la modifica viene da licensing_apply_quota (anti-loop).
v_skip := current_setting('app.licensing_callback_skip', true);
IF v_skip = 'true' THEN RETURN COALESCE(NEW, OLD);
END IF;
-- 2) Read config row (RLS bypassed via SECURITY DEFINER).
SELECT * INTO v_cfg_row
FROM public._internal_licensing_callback_config
WHERE id = true
LIMIT 1;
v_enabled := COALESCE(v_cfg_row.enabled, false);
IF NOT v_enabled THEN RETURN COALESCE(NEW, OLD);
END IF;
-- 3) Skip se nessun campo licensing-relevant e' cambiato.
IF TG_OP = 'INSERT' THEN -- INSERT con license_key impostato = bind iniziale, da notificare.
IF NEW.license_key IS NOT NULL THEN v_changed := true;
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
v_url := v_cfg_row.callback_url;
v_secret := v_cfg_row.internal_secret;
IF v_url IS NULL
OR v_url = ''
OR v_secret IS NULL
OR v_secret = '' THEN RAISE WARNING 'licensing_callback: callback_url/internal_secret not configured; skipping notify for tenant %',
NEW.id;
RETURN COALESCE(NEW, OLD);
END IF;
-- 4) Async POST verso edge function. pg_net mette in coda e ritorna
--    immediatamente: NESSUN blocco sul trigger.
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
WHEN OTHERS THEN -- Trigger non deve far fallire l'UPDATE: log warning e continua.
RAISE WARNING 'licensing_callback notify failed for tenant %: %',
NEW.id,
SQLERRM;
RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public._internal_notify_works_on_tenant_change()
FROM PUBLIC;
-- ── 6) Trigger AFTER INSERT/UPDATE su tenants ───────────────────────────────
-- Triggerato da: Lemon Squeezy webhook, super-admin tools, licensing-sync.
-- Anti-loop garantito da `app.licensing_callback_skip` settato da
-- licensing_apply_quota (vedi sopra).
DROP TRIGGER IF EXISTS notify_works_on_tenant_change ON public.tenants;
CREATE TRIGGER notify_works_on_tenant_change
AFTER
INSERT
  OR
UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public._internal_notify_works_on_tenant_change();
COMMENT ON TRIGGER notify_works_on_tenant_change ON public.tenants IS 'Phase 3.3 Centro Controllo Licenze: notifica WORKS via licensing-callback edge function quando cambiano i campi licensing-relevant. Gated da public._internal_licensing_callback_config.enabled (default false).';
COMMENT ON FUNCTION public._internal_notify_works_on_tenant_change() IS 'Trigger function per notify_works_on_tenant_change. Anti-loop via app.licensing_callback_skip; gating via _internal_licensing_callback_config.enabled. Async tramite pg_net.';
