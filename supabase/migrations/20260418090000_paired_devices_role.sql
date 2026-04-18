-- Sprint S-4 (G7) — Centro Slide multi-room device role
-- ─────────────────────────────────────────────────────────────────────────
-- Aggiunge `paired_devices.role` per distinguere device "sala" (default,
-- 1 device = 1 sala) dai device "Centro Slide" (1 device = N sale,
-- room_id NULL, riceve i file di TUTTE le sale dell'evento).
--
-- Andrea 18/04/2026: "i pc assegnati al centro slide devono avere i dati
-- di tutte le sale e a fine evento devo poter scaricare tutto in modo
-- ordinato".
--
-- Scelta tecnica: TEXT con CHECK (NON enum) per evitare il problema
-- "ALTER TYPE ADD VALUE non puo' essere referenziato nella stessa
-- transaction" gia' incontrato in Sprint R-3 (vedi migrations
-- 20260418080000_room_device_upload_enum.sql + _rpcs.sql split). Il CHECK
-- e' ugualmente robusto e piu' facile da estendere in futuro.
--
-- Backward-compat: tutti i device esistenti restano `role='room'` di
-- default, comportamento invariato. Nessuna RLS o RPC esistente cambia
-- semantica per device 'room'.

ALTER TABLE public.paired_devices
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'room'
  CHECK (role IN ('room', 'control_center'));

COMMENT ON COLUMN public.paired_devices.role IS
  'Ruolo del device: "room" (default, 1 device = 1 sala specifica) o '
  '"control_center" (1 device = N sale, room_id NULL, riceve i file di '
  'tutte le sale dell evento per backup/export). '
  'Sprint S-4 (G7) — vedi docs/STATO_E_TODO.md §0.15.';

-- Indice parziale per query veloci sui Centri Slide di un evento
-- (cardinalita' bassa: tipicamente 1-3 Centri Slide per evento).
CREATE INDEX IF NOT EXISTS idx_devices_event_centers
  ON public.paired_devices (event_id)
  WHERE role = 'control_center';

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: update_device_role
-- ─────────────────────────────────────────────────────────────────────────
-- Promuove un device a 'control_center' o lo riporta a 'room'. Usata dalla
-- UI admin (DeviceList kebab "Promuovi a Centro Slide" / "Riporta a sala").
--
-- Validazioni:
--   - Solo admin del tenant (RLS lo verifica via SECURITY INVOKER tramite
--     update sulla riga del paired_devices, che gia' ha tenant_isolation).
--   - Quando role='control_center': forza room_id=NULL (un Centro Slide
--     non e' assegnato a una singola sala).
--   - Quando role='room': lascia room_id com'e' (admin lo riassegna via
--     drag&drop board).
--
-- Side effect: bumpa `updated_at` cosi' la subscription Realtime postgres_changes
-- in `usePairedDevices` notifica gli altri admin in <1s (gia' attivo da S-2).

CREATE OR REPLACE FUNCTION public.update_device_role(
  p_device_id UUID,
  p_new_role TEXT
)
RETURNS TABLE (
  id UUID,
  role TEXT,
  room_id UUID
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant UUID;
  v_device_tenant UUID;
BEGIN
  IF p_new_role NOT IN ('room', 'control_center') THEN
    RAISE EXCEPTION 'invalid_role: %', p_new_role
      USING ERRCODE = '22023';
  END IF;

  SELECT public.app_tenant_id() INTO v_caller_tenant;
  IF v_caller_tenant IS NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'unauthorized'
      USING ERRCODE = '42501';
  END IF;

  SELECT pd.tenant_id INTO v_device_tenant
  FROM public.paired_devices pd
  WHERE pd.id = p_device_id;

  IF v_device_tenant IS NULL THEN
    RAISE EXCEPTION 'device_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_super_admin() AND v_device_tenant <> v_caller_tenant THEN
    RAISE EXCEPTION 'cross_tenant_forbidden'
      USING ERRCODE = '42501';
  END IF;

  IF p_new_role = 'control_center' THEN
    UPDATE public.paired_devices
       SET role = 'control_center',
           room_id = NULL,
           updated_at = now()
     WHERE id = p_device_id;
  ELSE
    UPDATE public.paired_devices
       SET role = 'room',
           updated_at = now()
     WHERE id = p_device_id;
  END IF;

  RETURN QUERY
  SELECT pd.id, pd.role, pd.room_id
    FROM public.paired_devices pd
   WHERE pd.id = p_device_id;
END;
$$;

COMMENT ON FUNCTION public.update_device_role(UUID, TEXT) IS
  'Sprint S-4 (G7) — Promuove/demuove un device tra ruolo "room" e '
  '"control_center". SECURITY INVOKER (rispetta RLS tenant_isolation). '
  'Quando role=control_center forza room_id=NULL. Bumpa updated_at per '
  'realtime notify (postgres_changes su paired_devices gia attivo).';

GRANT EXECUTE ON FUNCTION public.update_device_role(UUID, TEXT) TO authenticated;
