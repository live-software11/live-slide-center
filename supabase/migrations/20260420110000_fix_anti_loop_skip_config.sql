-- Audit bidirezionalita licensing — 2026-04-19 — GAP-1.
--
-- Ripristina il PERFORM set_config('app.licensing_callback_skip', 'true', true)
-- come PRIMA istruzione del corpo BEGIN di public.licensing_apply_quota.
--
-- Contesto del bug:
--   La migration 20260420100000_max_active_events.sql ha ricreato la
--   licensing_apply_quota con la nuova firma a 9 parametri (per supportare
--   p_max_active_events) ma per omissione NON ha riportato la riga
--   PERFORM set_config(...) che era presente nella versione precedente
--   (20260420090000_sprint_xy_licensing_callback_trigger.sql).
--
--   Effetto in produzione:
--     - Ogni push WORKS -> SC (UPDATE tenants via questa RPC) faceva ri-scattare
--       il trigger _internal_notify_works_on_tenant_change, che chiamava
--       l'Edge Function licensing-callback, che ri-notificava WORKS via HMAC
--       HTTP. Risultato: 1 callback "fantasma" per ogni push, con shadow
--       ridondante e un record extra in cross_project_sync_log su WORKS.
--     - WORKS evitava il re-push grazie alla finestra anti-loop 5s su
--       _lastSyncedFromBackend, ma la simmetria del design Phase 3.3 richiedeva
--       il flag set_config (vedi commento 20260420090000:12-19).
--
-- Fix:
--   DROP + CREATE OR REPLACE della funzione con identica signature/return,
--   identico SET search_path e identico GRANT, aggiungendo il PERFORM come
--   prima istruzione del BEGIN.
--
-- Idempotenza: la migration sostituisce integralmente il body della funzione;
-- riapplicazioni non hanno effetti collaterali.
--
-- Sicurezza: nessuna modifica allo schema, nessun cambio dati. Il trigger
-- gemello (_internal_notify_works_on_tenant_change) e' invariato.
CREATE OR REPLACE FUNCTION public.licensing_apply_quota(
        p_license_key TEXT,
        p_tenant_id UUID,
        p_plan tenant_plan,
        p_storage_limit_bytes BIGINT,
        p_max_rooms_per_event INT,
        p_max_devices_per_room INT,
        p_expires_at TIMESTAMPTZ,
        p_status TEXT,
        p_max_active_events INT DEFAULT NULL
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE v_target_id UUID;
v_should_suspend BOOLEAN;
v_suspended_after BOOLEAN;
BEGIN -- Audit bidirezionalita 2026-04-19: anti-loop Phase 3.3.
-- Setta flag di sessione che il trigger notify_works_on_tenant_change
-- legge per skippare il callback verso WORKS quando il cambio quota
-- proviene da WORKS stessa (push via licensing-sync Edge Function).
-- Scope LOCAL (true) = vale solo per questa transaction.
PERFORM set_config('app.licensing_callback_skip', 'true', true);
IF p_license_key IS NULL
OR length(p_license_key) < 4 THEN RAISE EXCEPTION 'license_key_required';
END IF;
IF p_storage_limit_bytes IS NOT NULL
AND p_storage_limit_bytes < -1 THEN RAISE EXCEPTION 'invalid_storage_limit';
END IF;
IF p_max_rooms_per_event IS NOT NULL
AND p_max_rooms_per_event < 0 THEN RAISE EXCEPTION 'invalid_max_rooms';
END IF;
IF p_max_devices_per_room IS NOT NULL
AND p_max_devices_per_room < 0 THEN RAISE EXCEPTION 'invalid_max_devices';
END IF;
IF p_max_active_events IS NOT NULL
AND p_max_active_events < -1 THEN RAISE EXCEPTION 'invalid_max_active_events';
END IF;
SELECT id INTO v_target_id
FROM tenants
WHERE license_key = p_license_key;
IF v_target_id IS NULL
AND p_tenant_id IS NOT NULL THEN v_target_id := p_tenant_id;
END IF;
IF v_target_id IS NULL THEN RAISE EXCEPTION 'tenant_not_resolved' USING HINT = 'Provide existing tenant_id or pre-bind license_key.';
END IF;
v_should_suspend := p_status IN ('suspended', 'expired', 'revoked');
UPDATE tenants
SET plan = p_plan,
    storage_limit_bytes = COALESCE(p_storage_limit_bytes, storage_limit_bytes),
    max_rooms_per_event = COALESCE(p_max_rooms_per_event, max_rooms_per_event),
    max_devices_per_room = COALESCE(p_max_devices_per_room, max_devices_per_room),
    max_active_events = COALESCE(p_max_active_events, max_active_events),
    expires_at = p_expires_at,
    license_key = p_license_key,
    license_synced_at = now(),
    suspended = CASE
        WHEN v_should_suspend THEN true
        ELSE suspended
    END,
    updated_at = now()
WHERE id = v_target_id
RETURNING suspended INTO v_suspended_after;
IF NOT FOUND THEN RAISE EXCEPTION 'tenant_not_found' USING HINT = 'Create tenant via signup before assigning a license.';
END IF;
RETURN jsonb_build_object(
    'ok',
    true,
    'tenant_id',
    v_target_id,
    'license_key',
    p_license_key,
    'suspended',
    v_suspended_after,
    'suspended_by_license',
    v_should_suspend
);
END;
$$;
