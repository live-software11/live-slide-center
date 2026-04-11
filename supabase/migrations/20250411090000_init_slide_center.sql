-- Live SLIDE CENTER — schema iniziale multi-tenant
-- Nota: helper JWT in public (non in auth) per compatibilita Supabase.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE tenant_plan AS ENUM ('trial', 'starter', 'pro', 'enterprise');
CREATE TYPE user_role AS ENUM ('admin', 'tech', 'coordinator');
CREATE TYPE event_status AS ENUM ('draft', 'setup', 'active', 'closed', 'archived');
CREATE TYPE room_type AS ENUM ('main', 'breakout', 'preview', 'poster');
CREATE TYPE session_type AS ENUM ('talk', 'panel', 'workshop', 'break', 'ceremony');
CREATE TYPE presentation_status AS ENUM ('pending', 'uploaded', 'reviewed', 'approved', 'rejected');
CREATE TYPE version_status AS ENUM ('uploading', 'processing', 'ready', 'failed', 'superseded');
CREATE TYPE sync_status AS ENUM ('synced', 'syncing', 'outdated', 'offline');
CREATE TYPE connection_status AS ENUM ('online', 'offline', 'degraded');
CREATE TYPE actor_type AS ENUM ('user', 'speaker', 'agent', 'system');
CREATE TYPE upload_source AS ENUM ('web_portal', 'preview_room', 'agent_upload');

CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  plan tenant_plan NOT NULL DEFAULT 'trial',
  ls_customer_id TEXT,
  ls_subscription_id TEXT,
  storage_used_bytes BIGINT NOT NULL DEFAULT 0,
  storage_limit_bytes BIGINT NOT NULL DEFAULT 107374182400,
  max_events_per_month INT NOT NULL DEFAULT 2,
  max_rooms_per_event INT NOT NULL DEFAULT 5,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role user_role NOT NULL DEFAULT 'tech',
  avatar_url TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_tenant ON users(tenant_id);

CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  location TEXT,
  venue TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Rome',
  status event_status NOT NULL DEFAULT 'draft',
  settings JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_events_tenant ON events(tenant_id);
CREATE INDEX idx_events_status ON events(tenant_id, status);
CREATE INDEX idx_events_dates ON events(start_date, end_date);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT,
  floor TEXT,
  capacity INT,
  display_order INT NOT NULL DEFAULT 0,
  room_type room_type NOT NULL DEFAULT 'main',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_rooms_event ON rooms(event_id);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  title_en TEXT,
  session_type session_type NOT NULL DEFAULT 'talk',
  scheduled_start TIMESTAMPTZ NOT NULL,
  scheduled_end TIMESTAMPTZ NOT NULL,
  display_order INT NOT NULL DEFAULT 0,
  chair_name TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_room ON sessions(room_id);
CREATE INDEX idx_sessions_event ON sessions(event_id);
CREATE INDEX idx_sessions_schedule ON sessions(room_id, scheduled_start);

CREATE TABLE speakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  job_title TEXT,
  bio TEXT,
  upload_token TEXT UNIQUE,
  upload_token_expires_at TIMESTAMPTZ,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_speakers_session ON speakers(session_id);
CREATE INDEX idx_speakers_event ON speakers(event_id);
CREATE INDEX idx_speakers_token ON speakers(upload_token) WHERE upload_token IS NOT NULL;

CREATE TABLE presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  speaker_id UUID NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_version_id UUID,
  total_versions INT NOT NULL DEFAULT 0,
  status presentation_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_presentations_speaker ON presentations(speaker_id);
CREATE INDEX idx_presentations_session ON presentations(session_id);
CREATE INDEX idx_presentations_event ON presentations(event_id);

CREATE TABLE presentation_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,
  file_hash_sha256 TEXT,
  mime_type TEXT NOT NULL,
  uploaded_by_speaker BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_user_id UUID REFERENCES users(id),
  upload_source upload_source NOT NULL DEFAULT 'web_portal',
  status version_status NOT NULL DEFAULT 'uploading',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(presentation_id, version_number)
);
CREATE INDEX idx_versions_presentation ON presentation_versions(presentation_id);
CREATE INDEX idx_versions_status ON presentation_versions(status);

ALTER TABLE presentations
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES presentation_versions(id);

CREATE TABLE room_state (
  room_id UUID PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  current_session_id UUID REFERENCES sessions(id),
  current_presentation_id UUID REFERENCES presentations(id),
  current_version_id UUID REFERENCES presentation_versions(id),
  sync_status sync_status NOT NULL DEFAULT 'offline',
  agent_connection connection_status NOT NULL DEFAULT 'offline',
  last_sync_at TIMESTAMPTZ,
  assigned_agent_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE local_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  machine_id TEXT,
  lan_ip TEXT,
  lan_port INT NOT NULL DEFAULT 8080,
  status connection_status NOT NULL DEFAULT 'offline',
  last_heartbeat TIMESTAMPTZ,
  cached_files_count INT NOT NULL DEFAULT 0,
  cached_size_bytes BIGINT NOT NULL DEFAULT 0,
  agent_version TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agents_event ON local_agents(event_id);

CREATE TABLE activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID REFERENCES events(id),
  actor actor_type NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_event ON activity_log(event_id, created_at DESC);
CREATE INDEX idx_activity_tenant ON activity_log(tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    NULLIF(trim(both '"' from (auth.jwt() -> 'app_metadata' ->> 'tenant_id')), '')::uuid,
    NULLIF(trim(both '"' from (auth.jwt() -> 'user_metadata' ->> 'tenant_id')), '')::uuid
  );
$$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentations ENABLE ROW LEVEL SECURITY;
ALTER TABLE presentation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON events
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON rooms
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON sessions
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON speakers
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON presentations
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON presentation_versions
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON room_state
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON local_agents
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON activity_log
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON users
  FOR ALL USING (tenant_id = public.app_tenant_id());

CREATE POLICY tenant_isolation ON tenants
  FOR ALL USING (id = public.app_tenant_id());

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON presentations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON local_agents
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER set_updated_at BEFORE UPDATE ON room_state
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE OR REPLACE FUNCTION public.auto_version_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version_number := COALESCE(
    (SELECT MAX(version_number) FROM presentation_versions
     WHERE presentation_id = NEW.presentation_id), 0
  ) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_version_number BEFORE INSERT ON presentation_versions
  FOR EACH ROW EXECUTE FUNCTION public.auto_version_number();

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.room_state;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.presentation_versions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.local_agents;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- PostgREST: accesso alle tabelle con RLS applicata ai ruoli client
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;
