-- Sprint 7 — Operativita interna 100%: GDPR export + log email + storage/license summary.
-- Contenuti:
--  1) Tabella email_log (idempotenza + storico invii transazionali)
--  2) Tabella tenant_data_exports (richieste GDPR export ZIP con scadenza signed URL)
--  3) Bucket storage 'tenant-exports' privato + RLS (admin-only su prefix tenant_id/)
--  4) RPC export_tenant_data() SECURITY DEFINER → JSONB con tutti i dati del tenant
--  5) RPC tenant_storage_summary() → metric storage/quota per banner UI
--  6) RPC tenant_license_summary() → metric expires_at/plan per banner UI
--  7) RPC create_tenant_data_export(p_storage_path) → registra export in tenant_data_exports
--  8) RPC list_tenant_data_exports() → storico export del tenant (ultimi 10)
--  9) RPC log_email_sent(...) SECURITY DEFINER, role=service_role only → marca idempotenza email
-- 10) RPC list_tenants_for_license_warning(p_days_min, p_days_max) → super_admin only, scan tenant per cron email
-- Tutte le RPC: search_path=public, GRANT EXECUTE precisi.
-- ════════════════════════════════════════════════════════════════════════════
-- ── 1. Tabella email_log: idempotenza invii email transazionali ─────────────
CREATE TABLE IF NOT EXISTS public.email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  provider_message_id TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_log_idempotency ON public.email_log(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_email_log_tenant_kind ON public.email_log(tenant_id, kind, sent_at DESC);
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
-- Solo super_admin puo' leggere il log via UI; service_role bypassa RLS.
DROP POLICY IF EXISTS email_log_super_admin_select ON public.email_log;
CREATE POLICY email_log_super_admin_select ON public.email_log FOR
SELECT TO authenticated USING (
    (auth.jwt()->'app_metadata'->>'role') = 'super_admin'
  );
-- Niente policy INSERT/UPDATE per ruoli normali: scrittura via RPC SECURITY DEFINER.
COMMENT ON TABLE public.email_log IS 'Sprint 7: log invii email transazionali (welcome, license-expiring, storage-warning). Idempotenza via idempotency_key UNIQUE.';
-- ── 2. Tabella tenant_data_exports: storico richieste GDPR export ───────────
CREATE TABLE IF NOT EXISTS public.tenant_data_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by_user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE
  SET NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    storage_path TEXT,
    byte_size BIGINT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
    ready_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tenant_data_exports_tenant_requested ON public.tenant_data_exports(tenant_id, requested_at DESC);
ALTER TABLE public.tenant_data_exports ENABLE ROW LEVEL SECURITY;
-- Solo admin del tenant puo' vedere/elencare i propri export.
DROP POLICY IF EXISTS tenant_data_exports_admin_select ON public.tenant_data_exports;
CREATE POLICY tenant_data_exports_admin_select ON public.tenant_data_exports FOR
SELECT TO authenticated USING (
    tenant_id = public.app_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (auth.jwt()->>'sub')::uuid
        AND u.tenant_id = tenant_id
        AND u.role = 'admin'
    )
  );
COMMENT ON TABLE public.tenant_data_exports IS 'Sprint 7: registry GDPR data export. ZIP su Storage bucket "tenant-exports", scadenza 7 giorni.';
-- ── 3. Bucket storage tenant-exports (privato, no public read) ──────────────
-- Idempotente: se gia' esiste, ignora.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES (
    'tenant-exports',
    'tenant-exports',
    false,
    524288000
  ) -- 500 MB cap
  ON CONFLICT (id) DO NOTHING;
-- RLS storage: admin del tenant legge solo gli oggetti col proprio prefix tenant_id/.
DROP POLICY IF EXISTS tenant_exports_admin_select ON storage.objects;
CREATE POLICY tenant_exports_admin_select ON storage.objects FOR
SELECT TO authenticated USING (
    bucket_id = 'tenant-exports'
    AND (storage.foldername(name)) [1] = public.app_tenant_id()::text
    AND EXISTS (
      SELECT 1
      FROM public.users u
      WHERE u.id = (auth.jwt()->>'sub')::uuid
        AND u.tenant_id = public.app_tenant_id()
        AND u.role = 'admin'
    )
  );
-- Insert/Update/Delete sono lasciati a service_role (Edge Function).
-- ── 4. RPC export_tenant_data(): JSONB completo del tenant ──────────────────
-- SECURITY DEFINER, admin-only via JWT.
-- Restituisce un oggetto JSONB con tutto il dataset operativo del tenant
-- (eventi, sale, sessioni, speaker, presentations, versions metadata, team
-- inviti pendenti, audit log ultimi 90gg, quote licenza). NON include i blob
-- binari delle presentazioni (path su storage rimangono come riferimento).
CREATE OR REPLACE FUNCTION public.export_tenant_data() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant UUID;
v_user UUID;
v_result JSONB;
BEGIN v_tenant := public.app_tenant_id();
IF v_tenant IS NULL THEN RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
END IF;
v_user := (auth.jwt()->>'sub')::uuid;
IF NOT EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.id = v_user
    AND u.tenant_id = v_tenant
    AND u.role = 'admin'
) THEN RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
END IF;
SELECT jsonb_build_object(
    'meta',
    jsonb_build_object(
      'tenant_id',
      v_tenant,
      'exported_at',
      now(),
      'exported_by_user_id',
      v_user,
      'schema_version',
      'slide-center-7'
    ),
    'tenant',
    (
      SELECT to_jsonb(t.*) - 'license_key' -- escludo chiave commerciale per sicurezza
      FROM public.tenants t
      WHERE t.id = v_tenant
    ),
    'users',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(u.*) - 'last_seen_at'
            ORDER BY u.created_at
          )
        FROM public.users u
        WHERE u.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'team_invitations',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(ti.*) - 'invite_token'
            ORDER BY ti.created_at
          )
        FROM public.team_invitations ti
        WHERE ti.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'events',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(e.*)
            ORDER BY e.start_date
          )
        FROM public.events e
        WHERE e.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'rooms',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(r.*)
            ORDER BY r.event_id,
              r.display_order
          )
        FROM public.rooms r
        WHERE r.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'sessions',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(s.*)
            ORDER BY s.event_id,
              s.scheduled_start
          )
        FROM public.sessions s
        WHERE s.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'speakers',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(sp.*)
            ORDER BY sp.event_id,
              sp.display_order
          )
        FROM public.speakers sp
        WHERE sp.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'presentations',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(p.*)
            ORDER BY p.event_id
          )
        FROM public.presentations p
        WHERE p.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'presentation_versions',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(pv.*)
            ORDER BY pv.created_at
          )
        FROM public.presentation_versions pv
        WHERE pv.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'local_agents',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(la.*)
            ORDER BY la.registered_at
          )
        FROM public.local_agents la
        WHERE la.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'paired_devices',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(pd.*) - 'pair_token_hash'
            ORDER BY pd.paired_at
          )
        FROM public.paired_devices pd
        WHERE pd.tenant_id = v_tenant
      ),
      '[]'::jsonb
    ),
    'audit_log_90d',
    COALESCE(
      (
        SELECT jsonb_agg(
            to_jsonb(a.*)
            ORDER BY a.created_at DESC
          )
        FROM public.activity_log a
        WHERE a.tenant_id = v_tenant
          AND a.created_at >= now() - interval '90 days'
      ),
      '[]'::jsonb
    )
  ) INTO v_result;
RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.export_tenant_data() TO authenticated;
COMMENT ON FUNCTION public.export_tenant_data() IS 'Sprint 7: GDPR data export — JSONB completo del tenant del JWT. Admin only.';
-- ── 5. RPC tenant_storage_summary(): per banner storage warning UI ──────────
-- SECURITY DEFINER (legge tenants senza RLS); chiunque autenticato del tenant.
-- Restituisce { used_bytes, limit_bytes, percent (0-100 o null se unlimited),
-- threshold_warning ('none'|'warning'|'critical') }.
CREATE OR REPLACE FUNCTION public.tenant_storage_summary() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant UUID;
v_used BIGINT;
v_limit BIGINT;
v_percent NUMERIC;
v_threshold TEXT := 'none';
BEGIN v_tenant := public.app_tenant_id();
IF v_tenant IS NULL THEN RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
END IF;
SELECT COALESCE(storage_used_bytes, 0),
  COALESCE(storage_limit_bytes, 0) INTO v_used,
  v_limit
FROM public.tenants
WHERE id = v_tenant;
IF v_limit <= 0 THEN v_percent := NULL;
v_threshold := 'none';
ELSE v_percent := ROUND((v_used::NUMERIC / v_limit::NUMERIC) * 100.0, 1);
IF v_percent >= 95.0 THEN v_threshold := 'critical';
ELSIF v_percent >= 80.0 THEN v_threshold := 'warning';
ELSE v_threshold := 'none';
END IF;
END IF;
RETURN jsonb_build_object(
  'used_bytes',
  v_used,
  'limit_bytes',
  v_limit,
  'percent',
  v_percent,
  'threshold',
  v_threshold,
  'as_of',
  now()
);
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_storage_summary() TO authenticated;
COMMENT ON FUNCTION public.tenant_storage_summary() IS 'Sprint 7: storage usage del tenant per banner UI (warning >=80%, critical >=95%).';
-- ── 6. RPC tenant_license_summary(): per banner license expiry UI ───────────
-- Restituisce { expires_at, days_remaining (puo' essere negativo), threshold,
-- plan, suspended }.
CREATE OR REPLACE FUNCTION public.tenant_license_summary() RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant UUID;
v_expires TIMESTAMPTZ;
v_plan TEXT;
v_suspended BOOLEAN;
v_days INT;
v_threshold TEXT := 'none';
BEGIN v_tenant := public.app_tenant_id();
IF v_tenant IS NULL THEN RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
END IF;
SELECT expires_at,
  plan::text,
  COALESCE(suspended, false) INTO v_expires,
  v_plan,
  v_suspended
FROM public.tenants
WHERE id = v_tenant;
IF v_expires IS NULL THEN v_days := NULL;
v_threshold := 'none';
ELSE v_days := EXTRACT(
  DAY
  FROM (v_expires - now())
)::INT;
IF v_days < 0 THEN v_threshold := 'expired';
ELSIF v_days <= 1 THEN v_threshold := 'critical';
ELSIF v_days <= 7 THEN v_threshold := 'warning';
ELSIF v_days <= 30 THEN v_threshold := 'info';
ELSE v_threshold := 'none';
END IF;
END IF;
RETURN jsonb_build_object(
  'expires_at',
  v_expires,
  'days_remaining',
  v_days,
  'plan',
  v_plan,
  'suspended',
  v_suspended,
  'threshold',
  v_threshold,
  'as_of',
  now()
);
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_license_summary() TO authenticated;
COMMENT ON FUNCTION public.tenant_license_summary() IS 'Sprint 7: license expiry summary del tenant per banner UI (info <=30gg, warning <=7gg, critical <=1gg, expired <0).';
-- ── 7. RPC create_tenant_data_export(): admin registra export ───────────────
-- L'Edge Function gdpr-export crea record in pending, salva ZIP su Storage,
-- poi chiama UPDATE manuale (con service_role) per status='ready' + storage_path.
-- Questa RPC e' usata dal client per creare il record iniziale (admin-only).
CREATE OR REPLACE FUNCTION public.create_tenant_data_export() RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant UUID;
v_user UUID;
v_id UUID;
BEGIN v_tenant := public.app_tenant_id();
IF v_tenant IS NULL THEN RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
END IF;
v_user := (auth.jwt()->>'sub')::uuid;
IF NOT EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.id = v_user
    AND u.tenant_id = v_tenant
    AND u.role = 'admin'
) THEN RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
END IF;
-- Rate limit: max 1 export ogni 5 minuti per tenant (protezione costi storage).
IF EXISTS (
  SELECT 1
  FROM public.tenant_data_exports
  WHERE tenant_id = v_tenant
    AND requested_at > now() - interval '5 minutes'
) THEN RAISE EXCEPTION 'rate_limited_5min' USING ERRCODE = '53400';
END IF;
INSERT INTO public.tenant_data_exports (tenant_id, requested_by_user_id, status)
VALUES (v_tenant, v_user, 'pending')
RETURNING id INTO v_id;
RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_tenant_data_export() TO authenticated;
COMMENT ON FUNCTION public.create_tenant_data_export() IS 'Sprint 7: registra richiesta GDPR export (admin only, rate limit 5min).';
-- ── 8. RPC list_tenant_data_exports(): storico ultimi 10 export ─────────────
CREATE OR REPLACE FUNCTION public.list_tenant_data_exports() RETURNS TABLE (
    id UUID,
    requested_at TIMESTAMPTZ,
    status TEXT,
    storage_path TEXT,
    byte_size BIGINT,
    expires_at TIMESTAMPTZ,
    ready_at TIMESTAMPTZ,
    error_message TEXT
  ) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_tenant UUID;
BEGIN v_tenant := public.app_tenant_id();
IF v_tenant IS NULL THEN RAISE EXCEPTION 'missing_tenant' USING ERRCODE = '28000';
END IF;
IF NOT EXISTS (
  SELECT 1
  FROM public.users u
  WHERE u.id = (auth.jwt()->>'sub')::uuid
    AND u.tenant_id = v_tenant
    AND u.role = 'admin'
) THEN RAISE EXCEPTION 'forbidden_admin_only' USING ERRCODE = '42501';
END IF;
RETURN QUERY
SELECT e.id,
  e.requested_at,
  e.status,
  e.storage_path,
  e.byte_size,
  e.expires_at,
  e.ready_at,
  e.error_message
FROM public.tenant_data_exports e
WHERE e.tenant_id = v_tenant
ORDER BY e.requested_at DESC
LIMIT 10;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_tenant_data_exports() TO authenticated;
COMMENT ON FUNCTION public.list_tenant_data_exports() IS 'Sprint 7: ultimi 10 export GDPR del tenant (admin only).';
-- ── 9. RPC log_email_sent(): idempotenza invii email (service_role only) ────
-- Chiamata dall'Edge Function email-send DOPO successo Resend.
-- NB: anche se SECURITY DEFINER, non c'e' GRANT a authenticated: solo
-- service_role (Edge Function) puo' invocarla via PostgREST.
CREATE OR REPLACE FUNCTION public.log_email_sent(
    p_tenant_id UUID,
    p_kind TEXT,
    p_recipient TEXT,
    p_idempotency_key TEXT,
    p_status TEXT,
    p_provider_message_id TEXT DEFAULT NULL,
    p_error_message TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
  ) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
INSERT INTO public.email_log (
    tenant_id,
    kind,
    recipient,
    idempotency_key,
    status,
    provider_message_id,
    error_message,
    metadata
  )
VALUES (
    p_tenant_id,
    p_kind,
    p_recipient,
    p_idempotency_key,
    p_status,
    p_provider_message_id,
    p_error_message,
    p_metadata
  ) ON CONFLICT (idempotency_key) DO
UPDATE
SET status = EXCLUDED.status,
  provider_message_id = COALESCE(
    EXCLUDED.provider_message_id,
    email_log.provider_message_id
  ),
  error_message = EXCLUDED.error_message,
  metadata = email_log.metadata || EXCLUDED.metadata
RETURNING id INTO v_id;
RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.log_email_sent(
    UUID,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    TEXT,
    JSONB
  ) TO service_role;
COMMENT ON FUNCTION public.log_email_sent IS 'Sprint 7: log idempotente invii email (service_role only, chiamata da Edge email-send).';
-- ── 10. RPC list_tenants_for_license_warning(): scan tenant per cron email ──
-- Super_admin only (cron Edge Function service_role + super_admin context).
-- Restituisce tenant con expires_at tra now()+p_days_min e now()+p_days_max
-- che NON hanno ancora ricevuto un'email del tipo specificato per quella scadenza.
CREATE OR REPLACE FUNCTION public.list_tenants_for_license_warning(
    p_days_min INT,
    p_days_max INT,
    p_email_kind TEXT
  ) RETURNS TABLE (
    tenant_id UUID,
    tenant_name TEXT,
    admin_email TEXT,
    admin_full_name TEXT,
    expires_at TIMESTAMPTZ,
    plan TEXT,
    days_remaining INT
  ) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_role TEXT;
BEGIN v_role := (auth.jwt()->'app_metadata'->>'role');
IF v_role IS NULL
OR v_role <> 'super_admin' THEN RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
END IF;
RETURN QUERY
SELECT t.id AS tenant_id,
  t.name AS tenant_name,
  u.email AS admin_email,
  u.full_name AS admin_full_name,
  t.expires_at,
  t.plan::text AS plan,
  EXTRACT(
    DAY
    FROM (t.expires_at - now())
  )::INT AS days_remaining
FROM public.tenants t
  INNER JOIN LATERAL (
    SELECT email,
      full_name
    FROM public.users
    WHERE tenant_id = t.id
      AND role = 'admin'
    ORDER BY created_at ASC
    LIMIT 1
  ) u ON true
WHERE t.expires_at IS NOT NULL
  AND COALESCE(t.suspended, false) = false
  AND t.expires_at >= now() + (p_days_min || ' days')::interval
  AND t.expires_at <= now() + (p_days_max || ' days')::interval
  AND NOT EXISTS (
    SELECT 1
    FROM public.email_log el
    WHERE el.tenant_id = t.id
      AND el.kind = p_email_kind
      AND el.metadata->>'expires_at_iso' = to_char(t.expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  )
ORDER BY t.expires_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.list_tenants_for_license_warning(INT, INT, TEXT) TO service_role;
COMMENT ON FUNCTION public.list_tenants_for_license_warning IS 'Sprint 7: scan tenant in scadenza che NON hanno ancora ricevuto email del tipo specificato (anti-spam idempotente). Service role only.';
-- ── 11. Cleanup automatico export scaduti (mark expired) ────────────────────
-- Funzione di housekeeping invocabile periodicamente (manualmente o via pg_cron
-- se disponibile). NON cancella oggetti storage: lo fa l'Edge Function gdpr-export.
CREATE OR REPLACE FUNCTION public.expire_old_data_exports() RETURNS INT LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_count INT;
BEGIN WITH upd AS (
  UPDATE public.tenant_data_exports
  SET status = 'expired'
  WHERE status IN ('ready', 'pending')
    AND expires_at < now()
  RETURNING 1
)
SELECT count(*) INTO v_count
FROM upd;
RETURN v_count;
END;
$$;
GRANT EXECUTE ON FUNCTION public.expire_old_data_exports() TO service_role;
COMMENT ON FUNCTION public.expire_old_data_exports IS 'Sprint 7: marca expired gli export GDPR scaduti. Cleanup blob storage e'' demandato a Edge Function.';
