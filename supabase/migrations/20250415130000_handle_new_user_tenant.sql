-- Fase 1: primo signup → tenant + riga public.users + JWT app_metadata (tenant_id, role admin)
-- Coerente con docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md § 6 (Multi-tenancy/RBAC) — super_admin solo via SQL manuale.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
  auth AS $$
DECLARE new_tenant_id uuid;
base_slug text;
final_slug text;
org_name text;
BEGIN org_name := COALESCE(
  NULLIF(trim(NEW.raw_user_meta_data->>'full_name'), ''),
  split_part(NEW.email, '@', 1),
  'Organizzazione'
);
base_slug := lower(
  regexp_replace(
    split_part(NEW.email, '@', 1),
    '[^a-zA-Z0-9]+',
    '-',
    'g'
  )
);
base_slug := regexp_replace(base_slug, '^-+|-+$', '', 'g');
IF base_slug IS NULL
OR length(trim(base_slug)) = 0 THEN base_slug := 'tenant';
END IF;
final_slug := base_slug || '-' || replace(gen_random_uuid()::text, '-', '');
INSERT INTO public.tenants (name, slug)
VALUES (org_name, final_slug)
RETURNING id INTO new_tenant_id;
INSERT INTO public.users (id, tenant_id, email, full_name, role)
VALUES (
    NEW.id,
    new_tenant_id,
    NEW.email,
    org_name,
    'admin'::public.user_role
  );
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object(
    'tenant_id',
    new_tenant_id::text,
    'role',
    'admin'
  )
WHERE id = NEW.id;
RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
