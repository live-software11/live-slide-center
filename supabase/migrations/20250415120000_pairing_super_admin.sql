-- Pairing (paired_devices, pairing_codes) + super_admin + Realtime come da docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md § 9 (Device pairing)
DO $$ BEGIN IF NOT EXISTS (
  SELECT 1
  FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
  WHERE t.typname = 'user_role'
    AND e.enumlabel = 'super_admin'
) THEN ALTER TYPE user_role
ADD VALUE 'super_admin';
END IF;
END $$;
CREATE TABLE paired_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id) ON DELETE
  SET NULL,
    device_name TEXT NOT NULL,
    device_type TEXT,
    browser TEXT,
    user_agent TEXT,
    pair_token_hash TEXT NOT NULL UNIQUE,
    last_ip INET,
    last_seen_at TIMESTAMPTZ,
    status connection_status NOT NULL DEFAULT 'offline',
    paired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    paired_by_user_id UUID REFERENCES users(id),
    notes TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_devices_event ON paired_devices(event_id);
CREATE INDEX idx_devices_room ON paired_devices(room_id);
CREATE INDEX idx_devices_status ON paired_devices(tenant_id, status);
CREATE TABLE pairing_codes (
  code CHAR(6) PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id),
  generated_by_user_id UUID REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  consumed_by_device_id UUID REFERENCES paired_devices(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pairing_codes_expires ON pairing_codes(expires_at)
WHERE consumed_at IS NULL;
ALTER TABLE paired_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON paired_devices FOR ALL USING (tenant_id = public.app_tenant_id());
CREATE POLICY tenant_isolation ON pairing_codes FOR ALL USING (tenant_id = public.app_tenant_id());
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE
SET search_path = public AS $$
SELECT COALESCE(
    (auth.jwt()->'app_metadata'->>'role') = 'super_admin',
    false
  );
$$;
CREATE POLICY super_admin_all ON tenants FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON events FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON paired_devices FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON pairing_codes FOR ALL USING (public.is_super_admin());
CREATE POLICY super_admin_all ON activity_log FOR ALL USING (public.is_super_admin());
GRANT SELECT,
  INSERT,
  UPDATE,
  DELETE ON public.paired_devices TO anon,
  authenticated;
GRANT SELECT,
  INSERT,
  UPDATE,
  DELETE ON public.pairing_codes TO anon,
  authenticated;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime
ADD TABLE public.paired_devices;
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime DROP TABLE public.activity_log;
EXCEPTION
WHEN undefined_object THEN NULL;
END $$;
