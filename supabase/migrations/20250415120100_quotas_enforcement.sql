-- Quote storage + default Trial come da docs/ARCHITETTURA_LIVE_SLIDE_CENTER.md § 6 (multi-tenancy) + § 21 (piani)
CREATE OR REPLACE FUNCTION public.check_storage_quota() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE v_used BIGINT;
v_limit BIGINT;
BEGIN
SELECT storage_used_bytes,
  storage_limit_bytes INTO v_used,
  v_limit
FROM tenants
WHERE id = NEW.tenant_id;
IF v_limit >= 0
AND (v_used + NEW.file_size_bytes) > v_limit THEN RAISE EXCEPTION 'Storage quota exceeded for tenant';
END IF;
RETURN NEW;
END;
$$;
CREATE TRIGGER enforce_storage_quota BEFORE
INSERT ON presentation_versions FOR EACH ROW EXECUTE FUNCTION public.check_storage_quota();
CREATE OR REPLACE FUNCTION public.update_storage_used() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$ BEGIN IF TG_OP = 'INSERT' THEN
UPDATE tenants
SET storage_used_bytes = storage_used_bytes + NEW.file_size_bytes
WHERE id = NEW.tenant_id;
ELSIF TG_OP = 'DELETE' THEN
UPDATE tenants
SET storage_used_bytes = GREATEST(0, storage_used_bytes - OLD.file_size_bytes)
WHERE id = OLD.tenant_id;
END IF;
RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER track_storage_used
AFTER
INSERT
  OR DELETE ON presentation_versions FOR EACH ROW EXECUTE FUNCTION public.update_storage_used();
ALTER TABLE tenants
ALTER COLUMN storage_limit_bytes
SET DEFAULT 5368709120;
ALTER TABLE tenants
ALTER COLUMN max_events_per_month
SET DEFAULT 2;
ALTER TABLE tenants
ALTER COLUMN max_rooms_per_event
SET DEFAULT 3;
