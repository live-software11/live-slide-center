-- ════════════════════════════════════════════════════════════════════════════
-- Sprint R-2 (G2) — Integrazione bidirezionale Lemon Squeezy ↔ Slide Center
-- ════════════════════════════════════════════════════════════════════════════
-- CONTESTO COMMERCIALE:
--   Andrea vende Slide Center attraverso Live WORKS APP (`liveworksapp.com`),
--   piattaforma che usa Lemon Squeezy come merchant of record (gestisce
--   IVA UE, subscription billing, customer portal). Quando un cliente
--   compra/rinnova/cancella su Live WORKS APP, Lemon Squeezy invia il
--   webhook all'Edge Function `lemon-squeezy-webhook` di Slide Center, che:
--     1) verifica HMAC SHA-256 con `LEMON_SQUEEZY_WEBHOOK_SECRET`
--     2) idempotency: scarta eventi gia' processati (per X-Event-Id)
--     3) chiama RPC `lemon_squeezy_apply_subscription_event` che:
--        - subscription_created → crea tenant via admin_create_tenant_with_invite
--        - subscription_updated → aggiorna plan + quote
--        - subscription_cancelled/expired → suspend tenant
--        - subscription_resumed → unsuspend
--     4) se nuovo tenant: invia email kind='admin-invite' al primo admin
--
-- FLUSSO BIDIREZIONALE (parita Live WORKS APP):
--   - PURCHASE: cliente paga su Live WORKS APP → tenant nasce automaticamente
--   - RENEWAL/UPGRADE/DOWNGRADE: subscription_updated → quote ricalcolate
--   - CANCEL: tenant suspended ma dati conservati 30gg (rules su `delete-tenant`
--     sono in Sprint S/T, qui solo flag suspended)
--
-- IDEMPOTENZA STRICT:
--   - Lemon Squeezy puo' inviare lo stesso webhook fino a 5 volte (retry su
--     timeout/5xx). Tabella `lemon_squeezy_event_log` con UNIQUE(event_id)
--     blocca esecuzioni duplicate. Status: received → processed | skipped | failed
--
-- MAPPING PRODUCT → PLAN:
--   Live WORKS APP vende N variant Lemon Squeezy. Ogni variant_id e' mappato a
--   un plan (trial/starter/pro/enterprise) + quote. La tabella
--   `lemon_squeezy_plan_mapping` rende il mapping configurabile senza redeploy.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1) Estensioni schema tenants ────────────────────────────────────────────
-- Aggiungiamo i 3 ID Lemon Squeezy per binding bidirezionale completo.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS lemon_squeezy_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS lemon_squeezy_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS lemon_squeezy_variant_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_ls_subscription
  ON public.tenants(lemon_squeezy_subscription_id)
  WHERE lemon_squeezy_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenants_ls_customer
  ON public.tenants(lemon_squeezy_customer_id)
  WHERE lemon_squeezy_customer_id IS NOT NULL;

COMMENT ON COLUMN public.tenants.lemon_squeezy_subscription_id IS
  'Lemon Squeezy subscription ID (one-to-one con tenant). UNIQUE per evitare doppi binding.';
COMMENT ON COLUMN public.tenants.lemon_squeezy_customer_id IS
  'Lemon Squeezy customer ID. Puo'' essere shared tra piu'' tenant (azienda multi-prodotto).';
COMMENT ON COLUMN public.tenants.lemon_squeezy_variant_id IS
  'Variant ID dell''ultima subscription attiva, per audit/debug del mapping plan.';

-- ── 2) Tabella mapping variant_id → plan + quote ────────────────────────────
-- Resa CONFIGURABILE da super-admin (NO hard-code Edge Function: ogni cambio
-- prezzo Lemon Squeezy → solo UPDATE su questa tabella, niente redeploy).
CREATE TABLE IF NOT EXISTS public.lemon_squeezy_plan_mapping (
  variant_id TEXT PRIMARY KEY,
  plan public.tenant_plan NOT NULL,
  storage_limit_bytes BIGINT NOT NULL,
  max_events_per_month INT NOT NULL,
  max_rooms_per_event INT NOT NULL,
  max_devices_per_room INT NOT NULL,
  display_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lemon_squeezy_plan_mapping IS
  'Mapping variant_id Lemon Squeezy → piano interno + quote. Editabile da super-admin senza redeploy.';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_lemon_squeezy_plan_mapping()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lemon_squeezy_plan_mapping_touch ON public.lemon_squeezy_plan_mapping;
CREATE TRIGGER lemon_squeezy_plan_mapping_touch
  BEFORE UPDATE ON public.lemon_squeezy_plan_mapping
  FOR EACH ROW EXECUTE FUNCTION public.touch_lemon_squeezy_plan_mapping();

-- RLS: solo super-admin in lettura/scrittura
ALTER TABLE public.lemon_squeezy_plan_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lsm_super_admin_all ON public.lemon_squeezy_plan_mapping;
CREATE POLICY lsm_super_admin_all ON public.lemon_squeezy_plan_mapping
  FOR ALL TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- service_role bypassa RLS by default; nessun grant esplicito.

-- ── 3) Tabella event log per idempotency webhook ────────────────────────────
CREATE TABLE IF NOT EXISTS public.lemon_squeezy_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  event_name TEXT NOT NULL,
  subscription_id TEXT,
  customer_id TEXT,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'skipped', 'failed')),
  payload JSONB NOT NULL,
  error_message TEXT
);

COMMENT ON TABLE public.lemon_squeezy_event_log IS
  'Log idempotente di tutti i webhook Lemon Squeezy ricevuti. UNIQUE(event_id) blocca duplicati.';

CREATE INDEX IF NOT EXISTS idx_ls_event_subscription
  ON public.lemon_squeezy_event_log(subscription_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_ls_event_status
  ON public.lemon_squeezy_event_log(processing_status, received_at DESC);

ALTER TABLE public.lemon_squeezy_event_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lsel_super_admin_read ON public.lemon_squeezy_event_log;
CREATE POLICY lsel_super_admin_read ON public.lemon_squeezy_event_log
  FOR SELECT TO authenticated
  USING (public.is_super_admin());

-- ── 4) RPC: idempotency check ───────────────────────────────────────────────
-- Chiamato dall'Edge Function PRIMA di processare l'evento.
-- Ritorna: { is_new: bool, log_id: uuid, previous_status?: string }
CREATE OR REPLACE FUNCTION public.record_lemon_squeezy_event(
    p_event_id TEXT,
    p_event_name TEXT,
    p_subscription_id TEXT,
    p_customer_id TEXT,
    p_payload JSONB
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_existing_id UUID;
  v_existing_status TEXT;
  v_new_id UUID;
BEGIN
  -- Check idempotency
  SELECT id, processing_status INTO v_existing_id, v_existing_status
  FROM lemon_squeezy_event_log
  WHERE event_id = p_event_id;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'is_new', false,
      'log_id', v_existing_id,
      'previous_status', v_existing_status
    );
  END IF;

  -- Insert nuovo log
  INSERT INTO lemon_squeezy_event_log (
    event_id, event_name, subscription_id, customer_id, payload, processing_status
  ) VALUES (
    p_event_id, p_event_name, p_subscription_id, p_customer_id, p_payload, 'received'
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'is_new', true,
    'log_id', v_new_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_lemon_squeezy_event(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_lemon_squeezy_event(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ── 5) RPC: marca evento come processato (success/failed/skipped) ───────────
CREATE OR REPLACE FUNCTION public.mark_lemon_squeezy_event_processed(
    p_log_id UUID,
    p_status TEXT,
    p_tenant_id UUID,
    p_error_message TEXT
  ) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('processed', 'skipped', 'failed') THEN
    RAISE EXCEPTION 'invalid_status' USING HINT = 'Allowed: processed, skipped, failed';
  END IF;

  UPDATE lemon_squeezy_event_log
  SET processing_status = p_status,
      processed_at = now(),
      tenant_id = COALESCE(p_tenant_id, tenant_id),
      error_message = p_error_message
  WHERE id = p_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_lemon_squeezy_event_processed(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_lemon_squeezy_event_processed(UUID, TEXT, UUID, TEXT) TO service_role;

-- ── 6) RPC: applica subscription_event al tenant ────────────────────────────
-- Centro logico R-2: gestisce TUTTI gli eventi subscription Lemon Squeezy.
--
-- INPUT:
--   p_event_name         es. 'subscription_created', 'subscription_updated', ...
--   p_subscription_id    Lemon Squeezy subscription ID
--   p_customer_id        Lemon Squeezy customer ID
--   p_variant_id         Lemon Squeezy variant ID (mappato → plan)
--   p_customer_email     Email cliente (= primo admin del nuovo tenant)
--   p_customer_name      Nome cliente / azienda (per generare slug)
--   p_status             'active' | 'cancelled' | 'expired' | 'paused' | 'on_trial'
--   p_renews_at          Prossimo rinnovo (per expires_at)
--   p_ends_at            Data fine subscription (cancelled)
--   p_app_url            Per costruire invite_url (R-1.b)
--
-- OUTPUT:
--   { action: 'created'|'updated'|'suspended'|'resumed'|'noop',
--     tenant_id: uuid,
--     invite_url?: string,    -- presente solo se action='created'
--     invite_token?: string,
--     admin_email?: string }
CREATE OR REPLACE FUNCTION public.lemon_squeezy_apply_subscription_event(
    p_event_name TEXT,
    p_subscription_id TEXT,
    p_customer_id TEXT,
    p_variant_id TEXT,
    p_customer_email TEXT,
    p_customer_name TEXT,
    p_status TEXT,
    p_renews_at TIMESTAMPTZ,
    p_ends_at TIMESTAMPTZ,
    p_app_url TEXT
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_id UUID;
  v_existing_subscription TEXT;
  v_mapping RECORD;
  v_normalized_email TEXT;
  v_normalized_name TEXT;
  v_slug TEXT;
  v_invite_token TEXT;
  v_invite_id UUID;
  v_invite_expires TIMESTAMPTZ;
  v_invite_url TEXT;
  v_action TEXT;
  v_should_suspend BOOLEAN;
BEGIN
  -- ── A) Normalize + validate ───────────────────────────────────────────────
  IF p_subscription_id IS NULL OR length(trim(p_subscription_id)) = 0 THEN
    RAISE EXCEPTION 'subscription_id_required';
  END IF;

  v_normalized_email := lower(trim(COALESCE(p_customer_email, '')));
  IF v_normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid_email' USING HINT = 'Lemon Squeezy customer email malformed.';
  END IF;

  -- ── B) Resolve plan mapping ───────────────────────────────────────────────
  SELECT * INTO v_mapping
  FROM lemon_squeezy_plan_mapping
  WHERE variant_id = p_variant_id AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_variant_id'
      USING HINT = format('Variant %s non mappato. Aggiungi riga in lemon_squeezy_plan_mapping.', p_variant_id);
  END IF;

  -- ── C) Look up tenant esistente per subscription_id ───────────────────────
  SELECT id INTO v_tenant_id
  FROM tenants
  WHERE lemon_squeezy_subscription_id = p_subscription_id;

  -- ── D) Dispatch per event_name ────────────────────────────────────────────
  v_should_suspend := p_status IN ('cancelled', 'expired', 'paused', 'unpaid');

  IF p_event_name = 'subscription_created' AND v_tenant_id IS NULL THEN
    -- ── D.1 NUOVO tenant ────────────────────────────────────────────────────
    -- Genera slug da customer_name, uniqueness check.
    v_normalized_name := COALESCE(NULLIF(trim(p_customer_name), ''), split_part(v_normalized_email, '@', 1));
    v_slug := lower(regexp_replace(v_normalized_name, '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := regexp_replace(v_slug, '^-+|-+$', '', 'g');
    v_slug := substring(v_slug FROM 1 FOR 48);

    -- Se slug gia' esistente, appendi suffisso numerico (max 99 tentativi)
    IF EXISTS (SELECT 1 FROM tenants WHERE slug = v_slug) THEN
      DECLARE v_suffix INT := 2;
      BEGIN
        WHILE EXISTS (SELECT 1 FROM tenants WHERE slug = v_slug || '-' || v_suffix) LOOP
          v_suffix := v_suffix + 1;
          IF v_suffix > 99 THEN
            RAISE EXCEPTION 'slug_collision_unrecoverable'
              USING HINT = 'Customer name genera slug ambiguo, intervento manuale richiesto.';
          END IF;
        END LOOP;
        v_slug := v_slug || '-' || v_suffix;
      END;
    END IF;

    -- INSERT tenant con quote dal mapping
    INSERT INTO tenants (
      name, slug, plan,
      storage_limit_bytes, max_events_per_month, max_rooms_per_event, max_devices_per_room,
      expires_at, suspended,
      lemon_squeezy_subscription_id, lemon_squeezy_customer_id, lemon_squeezy_variant_id,
      license_synced_at,
      settings
    ) VALUES (
      v_normalized_name, v_slug, v_mapping.plan,
      v_mapping.storage_limit_bytes, v_mapping.max_events_per_month,
      v_mapping.max_rooms_per_event, v_mapping.max_devices_per_room,
      p_renews_at, v_should_suspend,
      p_subscription_id, p_customer_id, p_variant_id,
      now(),
      jsonb_build_object(
        'created_via', 'lemon_squeezy_webhook',
        'event_name', p_event_name,
        'created_at', now()
      )
    ) RETURNING id INTO v_tenant_id;

    -- Crea invito primo admin
    v_invite_token := encode(gen_random_bytes(32), 'hex');
    v_invite_expires := now() + interval '14 days';

    INSERT INTO team_invitations (
      tenant_id, email, role,
      invited_by_user_id, invited_by_role,
      invite_token, invite_token_expires_at
    ) VALUES (
      v_tenant_id, v_normalized_email, 'admin'::public.user_role,
      NULL, 'super_admin',
      v_invite_token, v_invite_expires
    ) RETURNING id INTO v_invite_id;

    v_invite_url := COALESCE(NULLIF(rtrim(p_app_url, '/'), ''), '') ||
                    '/accept-invite/' || v_invite_token;

    -- Activity log
    INSERT INTO activity_log (
      tenant_id, actor, actor_id, actor_name,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_tenant_id, 'system'::public.actor_type, NULL, 'lemon_squeezy_webhook',
      'tenant.created_by_lemon_squeezy', 'tenant', v_tenant_id,
      jsonb_build_object(
        'subscription_id', p_subscription_id,
        'customer_id', p_customer_id,
        'variant_id', p_variant_id,
        'plan', v_mapping.plan,
        'admin_email', v_normalized_email,
        'slug', v_slug
      )
    );

    v_action := 'created';

    RETURN jsonb_build_object(
      'action', v_action,
      'tenant_id', v_tenant_id,
      'invite_url', v_invite_url,
      'invite_token', v_invite_token,
      'invite_expires_at', v_invite_expires,
      'admin_email', v_normalized_email,
      'tenant_name', v_normalized_name
    );

  ELSIF p_event_name IN ('subscription_updated', 'subscription_payment_success', 'subscription_resumed') AND v_tenant_id IS NOT NULL THEN
    -- ── D.2 UPDATE tenant esistente (plan / quote / status) ─────────────────
    UPDATE tenants SET
      plan = v_mapping.plan,
      storage_limit_bytes = v_mapping.storage_limit_bytes,
      max_events_per_month = v_mapping.max_events_per_month,
      max_rooms_per_event = v_mapping.max_rooms_per_event,
      max_devices_per_room = v_mapping.max_devices_per_room,
      expires_at = COALESCE(p_renews_at, expires_at),
      lemon_squeezy_variant_id = p_variant_id,
      license_synced_at = now(),
      suspended = CASE
        WHEN v_should_suspend THEN true
        WHEN p_event_name = 'subscription_resumed' THEN false
        ELSE suspended
      END,
      updated_at = now()
    WHERE id = v_tenant_id;

    INSERT INTO activity_log (
      tenant_id, actor, actor_name,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_tenant_id, 'system'::public.actor_type, 'lemon_squeezy_webhook',
      'tenant.updated_by_lemon_squeezy.' || p_event_name, 'tenant', v_tenant_id,
      jsonb_build_object(
        'event_name', p_event_name,
        'plan', v_mapping.plan,
        'status', p_status,
        'renews_at', p_renews_at
      )
    );

    v_action := CASE WHEN p_event_name = 'subscription_resumed' THEN 'resumed' ELSE 'updated' END;

  ELSIF p_event_name IN ('subscription_cancelled', 'subscription_expired', 'subscription_paused') AND v_tenant_id IS NOT NULL THEN
    -- ── D.3 SUSPEND (soft delete: dati restano ma accesso bloccato) ─────────
    -- Su subscription_cancelled, Lemon Squeezy invia ends_at futuro: il tenant
    -- resta attivo fino a quella data, poi expired triggera il vero suspend.
    -- Qui differenziamo cancelled (futuro) vs expired (immediato).
    UPDATE tenants SET
      suspended = CASE WHEN p_event_name = 'subscription_cancelled' THEN suspended ELSE true END,
      expires_at = COALESCE(p_ends_at, expires_at),
      license_synced_at = now(),
      updated_at = now()
    WHERE id = v_tenant_id;

    INSERT INTO activity_log (
      tenant_id, actor, actor_name,
      action, entity_type, entity_id, metadata
    ) VALUES (
      v_tenant_id, 'system'::public.actor_type, 'lemon_squeezy_webhook',
      'tenant.' || p_event_name, 'tenant', v_tenant_id,
      jsonb_build_object(
        'event_name', p_event_name,
        'status', p_status,
        'ends_at', p_ends_at
      )
    );

    v_action := 'suspended';

  ELSE
    -- ── D.4 NOOP: evento non gestito o tenant_id NULL su update ─────────────
    -- Es: subscription_updated arriva PRIMA di subscription_created (race condition
    -- Lemon Squeezy retry). Ritorniamo noop e l'Edge Function marca come 'skipped'
    -- senza errore: il prossimo created/updated lo gestira'.
    RETURN jsonb_build_object(
      'action', 'noop',
      'tenant_id', v_tenant_id,
      'reason', CASE
        WHEN v_tenant_id IS NULL THEN 'tenant_not_found_for_update'
        ELSE 'event_not_handled'
      END
    );
  END IF;

  RETURN jsonb_build_object(
    'action', v_action,
    'tenant_id', v_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lemon_squeezy_apply_subscription_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lemon_squeezy_apply_subscription_event(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT
) TO service_role;

-- ── 7) Seed mapping di default (commentato — Andrea li abilita manualmente) ──
-- Lemon Squeezy usa variant_id NUMERICI ma li gestiamo come TEXT per safety.
-- Gli ID reali vanno presi dalla dashboard Lemon Squeezy → Products → Variants.
--
-- ESEMPIO (commentato, da editare con i variant_id reali):
-- INSERT INTO public.lemon_squeezy_plan_mapping
--   (variant_id, plan, storage_limit_bytes, max_events_per_month, max_rooms_per_event, max_devices_per_room, display_name)
-- VALUES
--   ('123456', 'starter',    50 * 1024 * 1024 * 1024::BIGINT,  5,  5, 10,  'Slide Center Starter'),
--   ('123457', 'pro',       500 * 1024 * 1024 * 1024::BIGINT, 50, 20, 50,  'Slide Center Pro'),
--   ('123458', 'enterprise',                              -1, 999, 100, 200, 'Slide Center Enterprise')
-- ON CONFLICT (variant_id) DO NOTHING;
