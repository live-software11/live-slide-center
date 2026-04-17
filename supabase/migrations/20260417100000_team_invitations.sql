-- Sprint 1 / Fase 14: inviti team + aggiornamento handle_new_user per utenti invitati.
-- Utente invitato = creato da Edge Function con app_metadata.tenant_id + app_metadata.role già presenti.
-- Il trigger detect questo e non crea un nuovo tenant.

-- ───── tabella inviti ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.team_invitations (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email                    TEXT        NOT NULL,
  role                     public.user_role NOT NULL DEFAULT 'coordinator',
  invited_by_user_id       UUID        NOT NULL REFERENCES public.users(id),
  invite_token             TEXT        NOT NULL UNIQUE,
  invite_token_expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at              TIMESTAMPTZ,
  accepted_by_user_id      UUID        REFERENCES public.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email, accepted_at)
);

CREATE INDEX IF NOT EXISTS idx_invites_token
  ON public.team_invitations(invite_token)
  WHERE accepted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_invites_tenant
  ON public.team_invitations(tenant_id);

-- ───── RLS inviti ─────────────────────────────────────────────────────────────

ALTER TABLE public.team_invitations ENABLE ROW LEVEL SECURITY;

-- Tenant attivo: tutte le operazioni CRUD (admin crea/legge/cancella inviti propri)
CREATE POLICY tenant_isolation ON public.team_invitations
  FOR ALL
  USING (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  )
  WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND NOT public.current_tenant_suspended()
  );

-- Super-admin: cross-tenant read/write
CREATE POLICY super_admin_all ON public.team_invitations
  FOR ALL
  USING (public.is_super_admin());

-- ───── trigger handle_new_user: ramo invitato ─────────────────────────────────
-- Se il nuovo auth.users ha già raw_app_meta_data.tenant_id E raw_app_meta_data.role
-- (caso: Edge Function team-invite-accept crea l'utente con service role),
-- si limita a inserire la riga public.users nel tenant esistente senza creare tenant.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tenant_id  uuid;
  v_role       text;
  v_full_name  text;
  base_slug    text;
  final_slug   text;
  org_name     text;
BEGIN
  v_tenant_id := (NEW.raw_app_meta_data ->> 'tenant_id')::uuid;
  v_role      := NEW.raw_app_meta_data ->> 'role';

  -- ── Percorso invito: join tenant esistente ──────────────────────────────────
  IF v_tenant_id IS NOT NULL AND v_role IS NOT NULL
    AND v_role IN ('admin', 'coordinator', 'tech')
  THEN
    v_full_name := COALESCE(
      NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      split_part(NEW.email, '@', 1),
      'Utente'
    );

    INSERT INTO public.users (id, tenant_id, email, full_name, role)
    VALUES (
      NEW.id,
      v_tenant_id,
      NEW.email,
      v_full_name,
      v_role::public.user_role
    )
    ON CONFLICT (id) DO NOTHING;  -- idempotente

    RETURN NEW;
  END IF;

  -- ── Percorso normale: crea nuovo tenant ────────────────────────────────────
  org_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(NEW.email, '@', 1),
    'Organizzazione'
  );

  base_slug := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-zA-Z0-9]+', '-', 'g'));
  base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
  IF base_slug IS NULL OR length(trim(base_slug)) = 0 THEN
    base_slug := 'tenant';
  END IF;

  final_slug := base_slug || '-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.tenants (name, slug)
  VALUES (org_name, final_slug)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.users (id, tenant_id, email, full_name, role)
  VALUES (NEW.id, v_tenant_id, NEW.email, org_name, 'admin'::public.user_role);

  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('tenant_id', v_tenant_id::text, 'role', 'admin')
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$;
-- Il trigger on_auth_user_created già esiste (migration 20250415130000); nessun DROP/CREATE necessario.
