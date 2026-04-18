-- ════════════════════════════════════════════════════════════════════════════
-- Sprint Hardening Pre-Field-Test — Allineamento trigger quota a semantica TS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Fix drift tra check client-side TS e trigger DB:
--   • TS `isUnlimitedRoomsPerEvent(plan, max)` → unlimited se `plan='enterprise' OR max <= 0`
--     (apps/web/src/features/tenant/lib/quota-usage.ts)
--   • Trigger DB pre-fix → unlimited solo se `max < 0` (rifiuta `max = 0` con 0 sale,
--     producendo `400 Bad Request` su POST /rest/v1/rooms)
--
-- Sintomo riprodotto: tenant `Live Works App` (plan=enterprise, max_rooms_per_event=0)
-- → POST /rest/v1/rooms 400 Bad Request perche' `0 >= 0` solleva `check_violation`.
-- Stesso problema, latente, su check_events_quota.
--
-- Decisione: il DB diventa autoritativo MA in modo coerente con il client.
-- `enterprise` plan = sempre illimitato (a prescindere dal valore numerico).
-- `max <= 0` = illimitato (sentinel value supportato, allineato a TS).
--
-- Nota timestamp: questa migration e' applicata su Supabase con version
-- 20260418195911 (vedi MCP list_migrations) ma viene salvata nel repo con
-- timestamp 20260418300000 per restare consecutiva alla sequenza locale
-- post-Sprint D1 (20260418290000_desktop_devices_licensing.sql).
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.check_events_quota() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE v_plan public.tenant_plan;
v_max INT;
v_count INT;
BEGIN
SELECT plan,
  max_events_per_month INTO v_plan,
  v_max
FROM public.tenants
WHERE id = NEW.tenant_id;
IF v_plan = 'enterprise' THEN RETURN NEW;
END IF;
IF v_max IS NULL
OR v_max <= 0 THEN RETURN NEW;
END IF;
SELECT COUNT(*) INTO v_count
FROM public.events
WHERE tenant_id = NEW.tenant_id
  AND date_trunc('month', start_date) = date_trunc('month', NEW.start_date);
IF v_count >= v_max THEN RAISE EXCEPTION 'Events per month quota exceeded for tenant' USING ERRCODE = 'check_violation';
END IF;
RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.check_rooms_quota() RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE v_plan public.tenant_plan;
v_max INT;
v_count INT;
BEGIN
SELECT plan,
  max_rooms_per_event INTO v_plan,
  v_max
FROM public.tenants
WHERE id = NEW.tenant_id;
IF v_plan = 'enterprise' THEN RETURN NEW;
END IF;
IF v_max IS NULL
OR v_max <= 0 THEN RETURN NEW;
END IF;
SELECT COUNT(*) INTO v_count
FROM public.rooms
WHERE event_id = NEW.event_id;
IF v_count >= v_max THEN RAISE EXCEPTION 'Rooms per event quota exceeded for tenant' USING ERRCODE = 'check_violation';
END IF;
RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.check_events_quota() IS 'Sprint Hardening Pre-Field-Test: enterprise plan + sentinel <= 0 sono illimitati (allineato a TS).';
COMMENT ON FUNCTION public.check_rooms_quota() IS 'Sprint Hardening Pre-Field-Test: enterprise plan + sentinel <= 0 sono illimitati (allineato a TS).';
