-- ============================================================================
-- Sprint Z (post-field-test) — Gap D: "Disconnetti questo PC dall'evento"
-- ============================================================================
-- Obiettivo: dare al PC stesso (PC sala PWA o PC desktop server Tauri) la
-- possibilita di auto-revocare il proprio pair_token. Cosi' quando l'utente
-- in sala clicca "Esci dall'evento" il record cloud viene marcato offline /
-- revoked nello stesso istante, senza dover passare dal pannello admin.
--
-- Riferimento progettuale:
--   - docs/AUDIT_FINALE_E_PIANO_TEST_v1.md §3.6 (Gap D — Esci da PC).
--
-- Architettura:
--   - L'RPC e' SECURITY DEFINER e GRANT solo a `service_role` (NON a
--     `authenticated`). Viene chiamata da una edge function `pair-revoke-self`
--     che riceve il pair_token dal client in `Authorization: Bearer <token>`,
--     ne calcola sha256 lato edge e lo passa qui. In questo modo:
--       1. il client non ha bisogno di sapere il proprio tenant_id ne' di
--          autenticarsi con un JWT utente (i PC sala PWA non hanno utenti);
--       2. il pair_token plain non viene mai loggato in DB ne' in funzioni
--          intermedie (la edge fa solo digest e forward);
--       3. nessuna policy RLS deve essere allentata: il bypass via
--          SECURITY DEFINER + GRANT service_role e' confinato a questa singola
--          azione di self-revoke.
--
-- Comportamento:
--   - prima cerca in `paired_devices` (caso PC sala): se trova marca status
--     = 'offline' e bumpa updated_at (per realtime notify pannello admin).
--   - se non trova in paired_devices, cerca in `desktop_devices` (caso PC
--     desktop server): se trova marca status='revoked' + revoked_at = now().
--   - idempotente: se il device era gia' offline/revoked ritorna ok=false
--     ma non solleva eccezione (l'utente che clicca due volte "esci" non
--     vede errori).
--
-- NOTA: la cancellazione locale di file (`license.enc`, `device.json`,
-- `last-session.json`) avviene client-side (Tauri commands esistenti).
-- Questa RPC fa SOLO la pulizia del lato cloud.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_revoke_pair_self(p_pair_token_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public,
  pg_temp AS $$
DECLARE v_count_paired integer := 0;
v_count_desktop integer := 0;
v_tenant_id uuid;
v_device_name text;
v_kind text := 'unknown';
BEGIN -- Validazione formato (sha256 hex = 64 char). Difensivo: la edge function
-- gia' calcola sha256, ma se qualcuno chiamasse con service_role direttamente
-- evitiamo update con stringhe arbitrarie.
IF p_pair_token_hash IS NULL
OR p_pair_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_pair_token_hash' USING ERRCODE = '22023';
END IF;
-- 1) Tenta paired_devices (PC sala). status enum tipico: 'online'|'offline'|'degraded'.
UPDATE public.paired_devices
SET status = 'offline',
  updated_at = now()
WHERE pair_token_hash = p_pair_token_hash
  AND status <> 'offline'
RETURNING tenant_id,
  device_name INTO v_tenant_id,
  v_device_name;
GET DIAGNOSTICS v_count_paired = ROW_COUNT;
IF v_count_paired > 0 THEN v_kind := 'paired_device';
ELSE -- 2) Tenta desktop_devices (PC desktop server). status: 'active'|'revoked'.
UPDATE public.desktop_devices
SET status = 'revoked',
  revoked_at = now()
WHERE pair_token_hash = p_pair_token_hash
  AND status = 'active'
RETURNING tenant_id,
  device_name INTO v_tenant_id,
  v_device_name;
GET DIAGNOSTICS v_count_desktop = ROW_COUNT;
IF v_count_desktop > 0 THEN v_kind := 'desktop_device';
END IF;
END IF;
-- Audit (best-effort, no fail).
IF v_tenant_id IS NOT NULL THEN BEGIN
INSERT INTO public.activity_log (
    tenant_id,
    event_id,
    actor,
    actor_id,
    action,
    entity_type,
    entity_id,
    metadata
  )
VALUES (
    v_tenant_id,
    NULL,
    'agent',
    NULL,
    'pair_self_revoked',
    v_kind,
    NULL,
    jsonb_build_object('device_name', v_device_name, 'kind', v_kind)
  );
EXCEPTION
WHEN OTHERS THEN NULL;
END;
END IF;
RETURN jsonb_build_object(
  'ok',
  (v_count_paired + v_count_desktop) > 0,
  'kind',
  v_kind,
  'revoked_count',
  v_count_paired + v_count_desktop
);
END $$;
REVOKE ALL ON FUNCTION public.rpc_revoke_pair_self(text)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_pair_self(text) TO service_role;
COMMENT ON FUNCTION public.rpc_revoke_pair_self(text) IS 'Sprint Z (post-field-test) Gap D — auto-revoca del proprio pair_token. ' 'Chiamata SOLO da edge function pair-revoke-self con service_role (mai dal ' 'client direttamente). Marca paired_devices.status=offline o desktop_devices.' 'status=revoked per il pair_token_hash dato. Idempotente.';
