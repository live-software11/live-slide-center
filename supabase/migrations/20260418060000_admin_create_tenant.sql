-- ════════════════════════════════════════════════════════════════════════════
-- Sprint R-1 (G1) — Super-admin crea tenant + licenze direttamente da app
-- ════════════════════════════════════════════════════════════════════════════
-- CONTESTO:
--   Fino ad oggi i tenant Slide Center venivano creati SOLO via signup utente
--   (trigger `handle_new_user` in 20250415130000_handle_new_user_tenant.sql).
--   Per la vendita esterna serve che il super_admin (Andrea) possa creare un
--   tenant "vuoto" (azienda cliente) + spedire l'invito al primo admin di
--   quell'azienda, tutto da `apps/web/src/features/admin/`.
--
-- FLUSSO BUSINESS:
--   1. Andrea (super_admin) compila form: nome azienda, slug, plan, quote,
--      expires_at, license_key (opzionale, per binding manuale a Live WORKS APP),
--      email del primo admin.
--   2. RPC `admin_create_tenant_with_invite()` crea il tenant + l'invito con
--      ruolo 'admin' del primo utente, generando un `invite_token` UUID v4
--      crittografico (32 byte hex).
--   3. La RPC ritorna invite_url che il super-admin puo' copiare e mandare
--      all'utente, oppure (Sprint R-1.b) viene inviato automaticamente via
--      email-send con kind='admin_invite' (TODO: nuovo template Resend).
--   4. Quando il primo admin accetta l'invito (team-invite-accept esistente),
--      diventa admin del tenant appena creato. Il flusso esistente funziona
--      gia' senza modifiche.
--
-- AUTORIZZAZIONE:
--   - SECURITY DEFINER → bypassa RLS, tutta la verifica e' nel codice.
--   - Verifica is_super_admin() FIRST: se non super-admin, RAISE forbidden.
--   - GRANT EXECUTE solo a authenticated (i super-admin sono authenticated).
--   - Anon NON puo' chiamare (REVOKE explicit).
--
-- IDEMPOTENZA:
--   - Chiamate ripetute con stesso (slug, license_key) NON creano duplicati:
--     ON CONFLICT (slug) DO NOTHING ritorna `slug_already_exists`.
--   - Se l'invito al primo admin esiste gia' attivo (UNIQUE constraint), la
--     RPC ritorna `invite_already_pending` invece di duplicare.
--
-- LICENSE_KEY:
--   - Opzionale. Se passato, deve rispettare formato Live WORKS APP
--     (XXXX-XXXX-XXXX-XXXX, 19 char totali, alfanumerico maiuscolo).
--   - UNIQUE INDEX gia' esistente su tenants.license_key (Sprint 4).
-- ════════════════════════════════════════════════════════════════════════════
-- ── 1) Allow super_admin invitations (no public.users row) ──────────────────
-- Il super_admin esiste SOLO in auth.users con app_metadata.role='super_admin',
-- NON ha riga in public.users (per disegno: e' un admin globale, non appartiene
-- a nessun tenant). Quindi `team_invitations.invited_by_user_id NOT NULL`
-- impedisce di creare inviti da super-admin. Rendiamo la colonna nullable e
-- aggiungiamo `invited_by_role` per tracciare la provenienza.
ALTER TABLE public.team_invitations
ALTER COLUMN invited_by_user_id DROP NOT NULL;
ALTER TABLE public.team_invitations
ADD COLUMN IF NOT EXISTS invited_by_role TEXT NOT NULL DEFAULT 'admin';
COMMENT ON COLUMN public.team_invitations.invited_by_user_id IS 'NULL quando l''invito e'' creato da super_admin (che non ha riga in public.users).';
COMMENT ON COLUMN public.team_invitations.invited_by_role IS 'Ruolo del creatore dell''invito: admin (default, da admin del tenant) o super_admin (da Andrea via /admin).';
-- ── 2) RPC admin_create_tenant_with_invite ──────────────────────────────────
-- Input completo: tutti i parametri commerciali + email del primo admin.
-- Ritorna jsonb: { tenant_id, slug, invite_token, invite_url, invite_expires_at }.
-- Tutti gli errori sono codici stabili (NIENTE Postgres internals leak):
--   - forbidden_super_admin_only
--   - invalid_slug
--   - invalid_plan
--   - invalid_storage_limit
--   - invalid_max_rooms
--   - invalid_max_devices
--   - invalid_email
--   - invalid_license_key_format
--   - slug_already_exists
--   - license_key_already_assigned
--   - invite_already_pending
CREATE OR REPLACE FUNCTION public.admin_create_tenant_with_invite(
    p_name TEXT,
    p_slug TEXT,
    p_plan tenant_plan,
    p_storage_limit_bytes BIGINT,
    p_max_events_per_month INT,
    p_max_rooms_per_event INT,
    p_max_devices_per_room INT,
    p_expires_at TIMESTAMPTZ,
    p_license_key TEXT,
    p_admin_email TEXT,
    p_app_url TEXT
  ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
  pg_temp AS $$
DECLARE v_tenant_id UUID;
v_invite_token TEXT;
v_invite_id UUID;
v_invite_expires TIMESTAMPTZ;
v_invite_url TEXT;
v_normalized_slug TEXT;
v_normalized_email TEXT;
v_normalized_license TEXT;
BEGIN -- ── A) Authorization: super_admin only ────────────────────────────────────
IF NOT public.is_super_admin() THEN RAISE EXCEPTION 'forbidden_super_admin_only' USING ERRCODE = '42501';
END IF;
-- ── B) Input validation (sanitize prima, valida dopo) ─────────────────────
IF p_name IS NULL
OR length(trim(p_name)) < 2
OR length(trim(p_name)) > 200 THEN RAISE EXCEPTION 'invalid_name';
END IF;
v_normalized_slug := lower(trim(COALESCE(p_slug, '')));
IF v_normalized_slug !~ '^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$' THEN RAISE EXCEPTION 'invalid_slug' USING HINT = 'lowercase, 2-64 char, [a-z0-9-], no leading/trailing dash';
END IF;
IF p_plan IS NULL THEN RAISE EXCEPTION 'invalid_plan';
END IF;
IF p_storage_limit_bytes IS NULL
OR p_storage_limit_bytes < -1 THEN RAISE EXCEPTION 'invalid_storage_limit' USING HINT = '-1 = illimitato (Enterprise), altrimenti >= 0';
END IF;
IF p_max_events_per_month IS NULL
OR p_max_events_per_month < 0
OR p_max_events_per_month > 10000 THEN RAISE EXCEPTION 'invalid_max_events';
END IF;
IF p_max_rooms_per_event IS NULL
OR p_max_rooms_per_event < 0
OR p_max_rooms_per_event > 1024 THEN RAISE EXCEPTION 'invalid_max_rooms';
END IF;
IF p_max_devices_per_room IS NULL
OR p_max_devices_per_room < 0
OR p_max_devices_per_room > 1024 THEN RAISE EXCEPTION 'invalid_max_devices';
END IF;
v_normalized_email := lower(trim(COALESCE(p_admin_email, '')));
-- RFC 5322 lite: contiene esattamente una @, almeno 1 char prima e dopo, dot dopo @
IF v_normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN RAISE EXCEPTION 'invalid_email';
END IF;
-- License key opzionale ma se presente deve rispettare il formato.
IF p_license_key IS NOT NULL
AND length(trim(p_license_key)) > 0 THEN v_normalized_license := upper(trim(p_license_key));
IF v_normalized_license !~ '^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' THEN RAISE EXCEPTION 'invalid_license_key_format' USING HINT = 'XXXX-XXXX-XXXX-XXXX (alfanumerico maiuscolo)';
END IF;
-- Check unicita' license_key (UNIQUE index esiste gia', ma errore esplicito).
IF EXISTS (
  SELECT 1
  FROM public.tenants
  WHERE license_key = v_normalized_license
) THEN RAISE EXCEPTION 'license_key_already_assigned';
END IF;
ELSE v_normalized_license := NULL;
END IF;
-- ── C) Check slug uniqueness ──────────────────────────────────────────────
IF EXISTS (
  SELECT 1
  FROM public.tenants
  WHERE slug = v_normalized_slug
) THEN RAISE EXCEPTION 'slug_already_exists';
END IF;
-- ── D) INSERT tenant ──────────────────────────────────────────────────────
INSERT INTO public.tenants (
    name,
    slug,
    plan,
    storage_limit_bytes,
    max_events_per_month,
    max_rooms_per_event,
    max_devices_per_room,
    expires_at,
    license_key,
    license_synced_at,
    suspended,
    settings
  )
VALUES (
    trim(p_name),
    v_normalized_slug,
    p_plan,
    p_storage_limit_bytes,
    p_max_events_per_month,
    p_max_rooms_per_event,
    p_max_devices_per_room,
    p_expires_at,
    v_normalized_license,
    CASE
      WHEN v_normalized_license IS NOT NULL THEN now()
      ELSE NULL
    END,
    -- Trigger apply_license_expiry sospende automaticamente se expires_at < now,
    -- cosi' eviti di creare per sbaglio un tenant gia' scaduto attivo.
    false,
    jsonb_build_object(
      'created_by',
      'super_admin',
      'created_via',
      'admin_panel',
      'created_at',
      now()
    )
  )
RETURNING id INTO v_tenant_id;
-- ── E) Genera invite_token crittografico (32 byte = 64 hex char) ─────────
v_invite_token := encode(gen_random_bytes(32), 'hex');
v_invite_expires := now() + interval '14 days';
-- ── F) Check invito esistente attivo per stesso (tenant, email) ──────────
-- (Edge case: super-admin tenta di ricreare invito subito dopo crash UI;
-- la UNIQUE (tenant_id, email, accepted_at) gia' protegge ma vogliamo errore
-- pulito invece di "23505 duplicate key").
IF EXISTS (
  SELECT 1
  FROM public.team_invitations
  WHERE tenant_id = v_tenant_id
    AND email = v_normalized_email
    AND accepted_at IS NULL
    AND invite_token_expires_at > now()
) THEN -- Caso impossibile per come abbiamo appena creato il tenant, ma difensivo.
RAISE EXCEPTION 'invite_already_pending';
END IF;
-- ── G) INSERT team_invitation per il primo admin ──────────────────────────
-- invited_by_user_id = NULL perche' il super-admin non ha riga in public.users.
-- invited_by_role = 'super_admin' per audit/debug.
INSERT INTO public.team_invitations (
    tenant_id,
    email,
    role,
    invited_by_user_id,
    invited_by_role,
    invite_token,
    invite_token_expires_at
  )
VALUES (
    v_tenant_id,
    v_normalized_email,
    'admin'::public.user_role,
    NULL,
    'super_admin',
    v_invite_token,
    v_invite_expires
  )
RETURNING id INTO v_invite_id;
-- ── H) Activity log ───────────────────────────────────────────────────────
-- Tracciamo la creazione tenant per audit cross-tenant in /admin/audit.
INSERT INTO public.activity_log (
    tenant_id,
    actor,
    actor_id,
    actor_name,
    action,
    entity_type,
    entity_id,
    metadata
  )
VALUES (
    v_tenant_id,
    'user'::public.actor_type,
    (auth.jwt()->>'sub'),
    'super_admin',
    'tenant.created_by_super_admin',
    'tenant',
    v_tenant_id,
    jsonb_build_object(
      'slug',
      v_normalized_slug,
      'plan',
      p_plan,
      'has_license_key',
      v_normalized_license IS NOT NULL,
      'invited_admin_email',
      v_normalized_email
    )
  );
-- ── I) Costruisci invite URL ──────────────────────────────────────────────
-- p_app_url es. https://app.liveslidecenter.com (no trailing slash).
-- Path /accept-invite/:token esistente (apps/web/src/app/routes.tsx).
v_invite_url := COALESCE(NULLIF(rtrim(p_app_url, '/'), ''), '') || '/accept-invite/' || v_invite_token;
RETURN jsonb_build_object(
  'tenant_id',
  v_tenant_id,
  'slug',
  v_normalized_slug,
  'invite_id',
  v_invite_id,
  'invite_token',
  v_invite_token,
  'invite_url',
  v_invite_url,
  'invite_expires_at',
  v_invite_expires,
  'admin_email',
  v_normalized_email,
  'license_key',
  v_normalized_license
);
END;
$$;
-- ── 3) Permission grants ────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.admin_create_tenant_with_invite(
  TEXT,
  TEXT,
  tenant_plan,
  BIGINT,
  INT,
  INT,
  INT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT
)
FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_tenant_with_invite(
  TEXT,
  TEXT,
  tenant_plan,
  BIGINT,
  INT,
  INT,
  INT,
  TIMESTAMPTZ,
  TEXT,
  TEXT,
  TEXT
)
FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_create_tenant_with_invite(
    TEXT,
    TEXT,
    tenant_plan,
    BIGINT,
    INT,
    INT,
    INT,
    TIMESTAMPTZ,
    TEXT,
    TEXT,
    TEXT
  ) TO authenticated;
COMMENT ON FUNCTION public.admin_create_tenant_with_invite IS 'Sprint R-1 (G1): super_admin crea un tenant + invito per il primo admin in una transazione atomica. Verifica is_super_admin via JWT. Idempotente su (slug, license_key). Ritorna invite_url che il super-admin puo'' copiare o spedire via email.';
