-- Seed minimo per RLS audit in CI — Sprint 5
-- Inserisce due tenant con dati propri in tutte le tabelle operative
-- per cui rls_audit.sql verifica isolamento.
--
-- UUID DEVONO corrispondere ai \set di rls_audit.sql:
--   TENANT_A_ID  = 00000000-aaaa-0000-0000-000000000001
--   TENANT_B_ID  = 00000000-bbbb-0000-0000-000000000002
--   USER_A_ID    = 00000000-aaaa-0000-0000-000000000010
--   USER_B_ID    = 00000000-bbbb-0000-0000-000000000020
--
-- Eseguito SOLO in CI dopo `supabase db reset` (applica tutte le migration).
-- NON usare in produzione.

BEGIN;

-- ─── 1) Tenants ──────────────────────────────────────────────────────────────
INSERT INTO public.tenants (id, name, slug, plan, suspended)
VALUES
  ('00000000-aaaa-0000-0000-000000000001'::uuid, 'Tenant A (CI)', 'tenant-a-ci', 'pro', false),
  ('00000000-bbbb-0000-0000-000000000002'::uuid, 'Tenant B (CI)', 'tenant-b-ci', 'pro', false)
ON CONFLICT (id) DO NOTHING;

-- ─── 2) Auth users (FK auth.users(id) richiesta per public.users) ───────────
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  (
    '00000000-aaaa-0000-0000-000000000010'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated',
    'user-a@ci.local', crypt('not-used', gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('tenant_id', '00000000-aaaa-0000-0000-000000000001', 'role', 'admin'),
    '{}'::jsonb
  ),
  (
    '00000000-bbbb-0000-0000-000000000020'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated',
    'user-b@ci.local', crypt('not-used', gen_salt('bf')),
    now(), now(), now(),
    jsonb_build_object('tenant_id', '00000000-bbbb-0000-0000-000000000002', 'role', 'admin'),
    '{}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, tenant_id, email, full_name, role)
VALUES
  ('00000000-aaaa-0000-0000-000000000010'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   'user-a@ci.local', 'User A', 'admin'),
  ('00000000-bbbb-0000-0000-000000000020'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   'user-b@ci.local', 'User B', 'admin')
ON CONFLICT (id) DO NOTHING;

-- ─── 3) Events ──────────────────────────────────────────────────────────────
INSERT INTO public.events (id, tenant_id, name, start_date, end_date, status)
VALUES
  ('11111111-aaaa-0000-0000-000000000001'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   'Evento A CI', current_date, current_date + 1, 'draft'),
  ('11111111-bbbb-0000-0000-000000000002'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   'Evento B CI', current_date, current_date + 1, 'draft')
ON CONFLICT (id) DO NOTHING;

-- ─── 4) Rooms ───────────────────────────────────────────────────────────────
INSERT INTO public.rooms (id, event_id, tenant_id, name, display_order)
VALUES
  ('22222222-aaaa-0000-0000-000000000001'::uuid,
   '11111111-aaaa-0000-0000-000000000001'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   'Sala A', 1),
  ('22222222-bbbb-0000-0000-000000000002'::uuid,
   '11111111-bbbb-0000-0000-000000000002'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   'Sala B', 1)
ON CONFLICT (id) DO NOTHING;

-- ─── 5) Sessions ────────────────────────────────────────────────────────────
INSERT INTO public.sessions (id, room_id, event_id, tenant_id, title, scheduled_start, scheduled_end, display_order)
VALUES
  ('33333333-aaaa-0000-0000-000000000001'::uuid,
   '22222222-aaaa-0000-0000-000000000001'::uuid,
   '11111111-aaaa-0000-0000-000000000001'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   'Sessione A', now(), now() + interval '1 hour', 1),
  ('33333333-bbbb-0000-0000-000000000002'::uuid,
   '22222222-bbbb-0000-0000-000000000002'::uuid,
   '11111111-bbbb-0000-0000-000000000002'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   'Sessione B', now(), now() + interval '1 hour', 1)
ON CONFLICT (id) DO NOTHING;

-- ─── 6) Speakers ────────────────────────────────────────────────────────────
INSERT INTO public.speakers (id, session_id, event_id, tenant_id, full_name, display_order)
VALUES
  ('44444444-aaaa-0000-0000-000000000001'::uuid,
   '33333333-aaaa-0000-0000-000000000001'::uuid,
   '11111111-aaaa-0000-0000-000000000001'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   'Speaker A', 1),
  ('44444444-bbbb-0000-0000-000000000002'::uuid,
   '33333333-bbbb-0000-0000-000000000002'::uuid,
   '11111111-bbbb-0000-0000-000000000002'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   'Speaker B', 1)
ON CONFLICT (id) DO NOTHING;

-- ─── 7) Presentations ───────────────────────────────────────────────────────
INSERT INTO public.presentations (id, speaker_id, session_id, event_id, tenant_id, status)
VALUES
  ('55555555-aaaa-0000-0000-000000000001'::uuid,
   '44444444-aaaa-0000-0000-000000000001'::uuid,
   '33333333-aaaa-0000-0000-000000000001'::uuid,
   '11111111-aaaa-0000-0000-000000000001'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   'pending'),
  ('55555555-bbbb-0000-0000-000000000002'::uuid,
   '44444444-bbbb-0000-0000-000000000002'::uuid,
   '33333333-bbbb-0000-0000-000000000002'::uuid,
   '11111111-bbbb-0000-0000-000000000002'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   'pending')
ON CONFLICT (id) DO NOTHING;

-- ─── 8) Activity log (con actor enum) ──────────────────────────────────────
INSERT INTO public.activity_log (id, tenant_id, event_id, actor, actor_id, action, entity_type)
VALUES
  ('66666666-aaaa-0000-0000-000000000001'::uuid,
   '00000000-aaaa-0000-0000-000000000001'::uuid,
   '11111111-aaaa-0000-0000-000000000001'::uuid,
   'system'::actor_type,
   'ci',
   'rls.audit.seed',
   'tenant'),
  ('66666666-bbbb-0000-0000-000000000002'::uuid,
   '00000000-bbbb-0000-0000-000000000002'::uuid,
   '11111111-bbbb-0000-0000-000000000002'::uuid,
   'system'::actor_type,
   'ci',
   'rls.audit.seed',
   'tenant')
ON CONFLICT (id) DO NOTHING;

COMMIT;
