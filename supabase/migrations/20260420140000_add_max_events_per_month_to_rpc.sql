-- Audit allineamento WORKS<->SC quote 2026-04-20.
--
-- Estende RPC `licensing_apply_quota` con il parametro
-- `p_max_events_per_month` (limite eventi nel mese corrente per il tenant).
-- Estende il trigger callback `_internal_notify_works_on_tenant_change` per
-- includere `max_events_per_month` nel diff change-detector cosi' che ogni
-- modifica fatta da admin SC (UPDATE diretto su `tenants`) o da WORKS (push
-- via `licensing-sync` Edge Function) propaghi il nuovo valore a WORKS via
-- `licensing-callback` -> `sync-from-backend` -> `crossProjectShadow`.
--
-- Strategia SAFE coesistenza (replica del pattern usato nella migration
-- 20260420130000 per max_devices_per_event):
--   1. RPC: drop firma 10-arg + create nuova con 11-arg, dove
--      `p_max_events_per_month` ha DEFAULT NULL. Le Edge Functions WORKS
--      pre-deploy continuano a funzionare (passano solo i 10 vecchi param);
--      le nuove (post-deploy) passano anche il nuovo.
--   2. UPDATE su `tenants.max_events_per_month` con
--      `COALESCE(p_max_events_per_month, max_events_per_month)` -> assenza
--      del param non azzera la colonna NOT NULL.
--   3. Trigger callback: aggiunge `max_events_per_month IS DISTINCT FROM`
--      al diff. Cosi' anche un UPDATE diretto da SC admin UI propaga.
--
-- NOTA: la colonna `tenants.max_events_per_month` esiste gia' (NOT NULL).
-- Non servono modifiche al CreateTenantDialog SC (gia' lo passa via
-- `admin_create_tenant_with_invite` RPC) ne' all'UI Admin (gia' lo edita).
-- ── 1) RPC: drop firma 10-arg + create 11-arg con p_max_events_per_month ─
DROP FUNCTION IF EXISTS public.licensing_apply_quota(
  text, uuid, tenant_plan, bigint, integer,
  timestamp with time zone, text, integer, integer, integer
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
    p_max_devices_per_room integer DEFAULT NULL,
    p_max_events_per_month integer DEFAULT NULL
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public' AS $function$
DECLARE
  v_target_id UUID;
  v_should_suspend BOOLEAN;
  v_suspended_after BOOLEAN;
  v_devices INTEGER;
BEGIN
  -- Anti-loop Phase 3.3 (GAP-1): skippa il callback verso WORKS quando il
  -- cambio quota proviene da WORKS stessa (push via licensing-sync Edge Fn).
  PERFORM set_config('app.licensing_callback_skip', 'true', true);

  IF p_license_key IS NULL OR length(p_license_key) < 4 THEN
    RAISE EXCEPTION 'license_key_required';
  END IF;
  IF p_storage_limit_bytes IS NOT NULL AND p_storage_limit_bytes < -1 THEN
    RAISE EXCEPTION 'invalid_storage_limit';
  END IF;
  IF p_max_rooms_per_event IS NOT NULL AND p_max_rooms_per_event < 0 THEN
    RAISE EXCEPTION 'invalid_max_rooms';
  END IF;
  IF p_max_devices_per_room IS NOT NULL AND p_max_devices_per_room < 0 THEN
    RAISE EXCEPTION 'invalid_max_devices';
  END IF;
  IF p_max_devices_per_event IS NOT NULL AND p_max_devices_per_event < 0 THEN
    RAISE EXCEPTION 'invalid_max_devices_per_event';
  END IF;
  IF p_max_active_events IS NOT NULL AND p_max_active_events < -1 THEN
    RAISE EXCEPTION 'invalid_max_active_events';
  END IF;
  -- max_events_per_month: 0 = illimitato (convention pre-existing nel DB);
  -- valori negativi -> errore. Range max 1024 = sanity cap (allineato col
  -- frontend admin UI).
  IF p_max_events_per_month IS NOT NULL AND (p_max_events_per_month < 0 OR p_max_events_per_month > 1024) THEN
    RAISE EXCEPTION 'invalid_max_events_per_month';
  END IF;

  SELECT id INTO v_target_id FROM tenants WHERE license_key = p_license_key;
  IF v_target_id IS NULL AND p_tenant_id IS NOT NULL THEN
    v_target_id := p_tenant_id;
  END IF;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'tenant_not_resolved'
      USING HINT = 'Provide existing tenant_id or pre-bind license_key.';
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
      max_events_per_month = COALESCE(p_max_events_per_month, max_events_per_month),
      expires_at = p_expires_at,
      license_key = p_license_key,
      license_synced_at = now(),
      suspended = CASE WHEN v_should_suspend THEN true ELSE suspended END,
      updated_at = now()
  WHERE id = v_target_id
  RETURNING suspended INTO v_suspended_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant_not_found'
      USING HINT = 'Create tenant via signup before assigning a license.';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_id', v_target_id,
    'license_key', p_license_key,
    'suspended', v_suspended_after,
    'suspended_by_license', v_should_suspend
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.licensing_apply_quota(
  text, uuid, tenant_plan, bigint, integer,
  timestamp with time zone, text, integer, integer, integer, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.licensing_apply_quota(
  text, uuid, tenant_plan, bigint, integer,
  timestamp with time zone, text, integer, integer, integer, integer
) TO service_role;

-- ── 2) Trigger callback: aggiungi max_events_per_month al diff ────────────
CREATE OR REPLACE FUNCTION public._internal_notify_works_on_tenant_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'net' AS $function$
DECLARE
  v_url TEXT;
  v_secret TEXT;
  v_enabled BOOLEAN;
  v_skip TEXT;
  v_changed BOOLEAN := false;
  v_request_id BIGINT;
  v_cfg_row public._internal_licensing_callback_config%ROWTYPE;
BEGIN
  v_skip := current_setting('app.licensing_callback_skip', true);
  IF v_skip = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO v_cfg_row FROM public._internal_licensing_callback_config WHERE id = true LIMIT 1;
  v_enabled := COALESCE(v_cfg_row.enabled, false);
  IF NOT v_enabled THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.license_key IS NOT NULL THEN v_changed := true; END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.plan IS DISTINCT FROM OLD.plan
       OR NEW.suspended IS DISTINCT FROM OLD.suspended
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.storage_limit_bytes IS DISTINCT FROM OLD.storage_limit_bytes
       OR NEW.max_rooms_per_event IS DISTINCT FROM OLD.max_rooms_per_event
       OR NEW.max_devices_per_room IS DISTINCT FROM OLD.max_devices_per_room
       OR NEW.max_devices_per_event IS DISTINCT FROM OLD.max_devices_per_event
       OR NEW.max_active_events IS DISTINCT FROM OLD.max_active_events
       OR NEW.max_events_per_month IS DISTINCT FROM OLD.max_events_per_month
       OR NEW.license_key IS DISTINCT FROM OLD.license_key THEN
      v_changed := true;
    END IF;
  END IF;

  IF NOT v_changed THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_url := v_cfg_row.edge_function_url;
  v_secret := v_cfg_row.internal_secret;
  IF v_url IS NULL OR v_url = '' OR v_secret IS NULL OR v_secret = '' THEN
    RAISE WARNING 'licensing_callback: edge_function_url/internal_secret not configured; skipping notify for tenant %', NEW.id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_request_id := net.http_post(
    url := v_url,
    body := jsonb_build_object('tenant_id', NEW.id, 'source_op', TG_OP),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'licensing_callback notify failed for tenant %: %', NEW.id, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public._internal_notify_works_on_tenant_change() FROM PUBLIC;

-- ── 3) Backfill: tenant esistenti devono avere max_devices_per_event ──────
-- in linea con max_devices_per_room (la migration 20260420130000 lo faceva
-- gia' come ADD COLUMN UPDATE, ma se un INSERT manuale tramite la RPC
-- legacy `admin_create_tenant_with_invite` ha creato un tenant nel
-- frattempo, il default 10 della colonna potrebbe non corrispondere al
-- valore voluto). Idempotente.
UPDATE public.tenants
SET max_devices_per_event = max_devices_per_room
WHERE max_devices_per_event IS DISTINCT FROM max_devices_per_room;

-- ── 4) admin_create_tenant_with_invite: scrivi anche su max_devices_per_event ─
-- La RPC legacy (migration 20260418060000) scriveva solo su
-- `max_devices_per_room` lasciando `max_devices_per_event` al DEFAULT 10.
-- Dopo questa migration la RPC popola entrambe le colonne con lo stesso
-- valore (canonical = per-event). L'unico cambio funzionale e' il triggered
-- shadow callback verso WORKS che ora vede coerentemente il limite per
-- evento sin dalla creazione tenant.
--
-- NOTA: replichiamo la firma esistente identica (11 arg) per non rompere il
-- frontend admin che chiama via supabase.rpc(...). Manteniamo p_app_url.
-- Le validazioni e il path invite restano identici al body originale.
CREATE OR REPLACE FUNCTION public.admin_create_tenant_with_invite(
    p_name TEXT,
    p_slug TEXT,
    p_plan public.tenant_plan,
    p_storage_limit_bytes BIGINT,
    p_max_events_per_month INT,
    p_max_rooms_per_event INT,
    p_max_devices_per_room INT,
    p_expires_at TIMESTAMPTZ,
    p_license_key TEXT,
    p_admin_email TEXT,
    p_app_url TEXT
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $function$
DECLARE
  v_tenant_id UUID;
  v_normalized_slug TEXT;
  v_normalized_email TEXT;
  v_normalized_license TEXT;
  v_invite_id UUID;
  v_invite_token TEXT;
  v_invite_expires TIMESTAMPTZ;
  v_invite_url TEXT;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'forbidden_super_admin_only';
  END IF;
  IF p_name IS NULL OR length(trim(p_name)) < 2 THEN
    RAISE EXCEPTION 'invalid_name';
  END IF;
  IF p_slug IS NULL OR p_slug !~ '^[a-z0-9](-?[a-z0-9])*$' OR length(p_slug) < 2 OR length(p_slug) > 64 THEN
    RAISE EXCEPTION 'invalid_slug';
  END IF;
  IF p_plan IS NULL THEN
    RAISE EXCEPTION 'invalid_plan';
  END IF;
  IF p_storage_limit_bytes IS NULL OR p_storage_limit_bytes < -1 THEN
    RAISE EXCEPTION 'invalid_storage_limit';
  END IF;
  IF p_max_events_per_month IS NULL OR p_max_events_per_month < 0 OR p_max_events_per_month > 1024 THEN
    RAISE EXCEPTION 'invalid_max_events';
  END IF;
  IF p_max_rooms_per_event IS NULL OR p_max_rooms_per_event < 0 OR p_max_rooms_per_event > 1024 THEN
    RAISE EXCEPTION 'invalid_max_rooms';
  END IF;
  IF p_max_devices_per_room IS NULL OR p_max_devices_per_room < 0 OR p_max_devices_per_room > 1024 THEN
    RAISE EXCEPTION 'invalid_max_devices';
  END IF;
  IF p_admin_email IS NULL OR p_admin_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'invalid_email';
  END IF;
  v_normalized_slug := lower(trim(p_slug));
  v_normalized_email := lower(trim(p_admin_email));
  v_normalized_license := CASE
    WHEN p_license_key IS NULL OR length(trim(p_license_key)) = 0 THEN NULL
    ELSE upper(trim(p_license_key))
  END;
  IF v_normalized_license IS NOT NULL AND v_normalized_license !~ '^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$' THEN
    RAISE EXCEPTION 'invalid_license_key_format';
  END IF;
  IF v_normalized_license IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenants WHERE license_key = v_normalized_license
  ) THEN
    RAISE EXCEPTION 'license_key_already_assigned';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_normalized_slug) THEN
    RAISE EXCEPTION 'slug_already_exists';
  END IF;
  -- Audit UI nomenclatura quote 2026-04-20: scriviamo su ENTRAMBE le colonne
  -- max_devices_per_room (legacy) + max_devices_per_event (canonica) per
  -- mantenerle allineate sin dalla creazione del tenant.
  INSERT INTO public.tenants (
      name, slug, plan, storage_limit_bytes,
      max_events_per_month, max_rooms_per_event,
      max_devices_per_room, max_devices_per_event,
      expires_at, license_key, license_synced_at, suspended, settings
    )
  VALUES (
      trim(p_name), v_normalized_slug, p_plan, p_storage_limit_bytes,
      p_max_events_per_month, p_max_rooms_per_event,
      p_max_devices_per_room, p_max_devices_per_room,
      p_expires_at, v_normalized_license,
      CASE WHEN v_normalized_license IS NOT NULL THEN now() ELSE NULL END,
      false,
      jsonb_build_object(
        'created_by', 'super_admin',
        'created_via', 'admin_panel',
        'created_at', now()
      )
    )
  RETURNING id INTO v_tenant_id;
  v_invite_token := encode(gen_random_bytes(32), 'hex');
  v_invite_expires := now() + interval '14 days';
  IF EXISTS (
    SELECT 1 FROM public.team_invitations
    WHERE tenant_id = v_tenant_id
      AND email = v_normalized_email
      AND accepted_at IS NULL
      AND invite_token_expires_at > now()
  ) THEN
    RAISE EXCEPTION 'invite_already_pending';
  END IF;
  INSERT INTO public.team_invitations (
      tenant_id, email, role, invited_by_user_id, invited_by_role,
      invite_token, invite_token_expires_at
    )
  VALUES (
      v_tenant_id, v_normalized_email, 'admin'::public.user_role,
      NULL, 'super_admin', v_invite_token, v_invite_expires
    )
  RETURNING id INTO v_invite_id;
  INSERT INTO public.activity_log (
      tenant_id, actor, actor_id, actor_name, action,
      entity_type, entity_id, metadata
    )
  VALUES (
      v_tenant_id, 'user'::public.actor_type, (auth.jwt()->>'sub'),
      'super_admin', 'tenant.created_by_super_admin', 'tenant', v_tenant_id,
      jsonb_build_object(
        'slug', v_normalized_slug,
        'plan', p_plan,
        'has_license_key', v_normalized_license IS NOT NULL,
        'invited_admin_email', v_normalized_email
      )
    );
  v_invite_url := COALESCE(NULLIF(rtrim(p_app_url, '/'), ''), '') || '/accept-invite/' || v_invite_token;
  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'slug', v_normalized_slug,
    'invite_id', v_invite_id,
    'invite_token', v_invite_token,
    'invite_url', v_invite_url,
    'invite_expires_at', v_invite_expires,
    'admin_email', v_normalized_email,
    'license_key', v_normalized_license
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_tenant_with_invite(
  TEXT, TEXT, public.tenant_plan, BIGINT, INT, INT, INT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_tenant_with_invite(
  TEXT, TEXT, public.tenant_plan, BIGINT, INT, INT, INT, TIMESTAMPTZ, TEXT, TEXT, TEXT
) TO authenticated;
