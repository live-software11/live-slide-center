-- Fase 1-2 hardening: super_admin_all su tutte le tabelle operative,
-- enforcement DB quote eventi/mese e sale/evento,
-- RPC atomica per reorder sessioni.
-- ── 1. super_admin_all sulle tabelle mancanti ──────────────────────────────
DO $$ BEGIN CREATE POLICY super_admin_all ON users FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON rooms FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON sessions FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON speakers FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON presentations FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON presentation_versions FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON room_state FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN CREATE POLICY super_admin_all ON local_agents FOR ALL USING (public.is_super_admin());
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
-- ── 2. Enforcement DB: max eventi/mese per tenant ─────────────────────────
CREATE OR REPLACE FUNCTION public.check_events_quota() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE v_max INT;
v_count INT;
BEGIN
SELECT max_events_per_month INTO v_max
FROM tenants
WHERE id = NEW.tenant_id;
IF v_max < 0 THEN RETURN NEW;
END IF;
SELECT COUNT(*) INTO v_count
FROM events
WHERE tenant_id = NEW.tenant_id
  AND date_trunc('month', start_date) = date_trunc('month', NEW.start_date);
IF v_count >= v_max THEN RAISE EXCEPTION 'Events per month quota exceeded for tenant' USING ERRCODE = 'check_violation';
END IF;
RETURN NEW;
END;
$$;
DO $$ BEGIN CREATE TRIGGER enforce_events_quota BEFORE
INSERT ON events FOR EACH ROW EXECUTE FUNCTION public.check_events_quota();
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
-- ── 3. Enforcement DB: max sale/evento per tenant ─────────────────────────
CREATE OR REPLACE FUNCTION public.check_rooms_quota() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE v_max INT;
v_count INT;
BEGIN
SELECT max_rooms_per_event INTO v_max
FROM tenants
WHERE id = NEW.tenant_id;
IF v_max < 0 THEN RETURN NEW;
END IF;
SELECT COUNT(*) INTO v_count
FROM rooms
WHERE event_id = NEW.event_id;
IF v_count >= v_max THEN RAISE EXCEPTION 'Rooms per event quota exceeded for tenant' USING ERRCODE = 'check_violation';
END IF;
RETURN NEW;
END;
$$;
DO $$ BEGIN CREATE TRIGGER enforce_rooms_quota BEFORE
INSERT ON rooms FOR EACH ROW EXECUTE FUNCTION public.check_rooms_quota();
EXCEPTION
WHEN duplicate_object THEN NULL;
END $$;
-- ── 4. RPC atomica reorder sessioni (RLS rispettata: SECURITY INVOKER) ────
CREATE OR REPLACE FUNCTION public.rpc_reorder_sessions(p_ids uuid [], p_event_id uuid) RETURNS void LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE i INT;
BEGIN FOR i IN 1..array_length(p_ids, 1) LOOP
UPDATE sessions
SET display_order = i - 1
WHERE id = p_ids [i]
  AND event_id = p_event_id;
END LOOP;
END;
$$;
