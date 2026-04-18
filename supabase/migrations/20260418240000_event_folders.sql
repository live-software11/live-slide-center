-- =============================================================================
-- Sprint U-2 (UX redesign V2.0): event folders + folder_id su presentations
-- =============================================================================
-- Andrea ha esplicitato la nuova UI: in modalita' "Production" l'admin
-- vede i file dell'evento in stile OneDrive/Drive con CARTELLE annidate
-- (la struttura tipica e' "Sala Plenaria > Sessione mattino > nome_speaker").
-- Per ora il modello dati ha solo session_id come gerarchia: aggiungiamo
-- folder_id su presentations + tabella event_folders ricorsiva.
--
-- Vincoli:
--  * folder_id e' OPZIONALE: una presentation puo' vivere SENZA cartella
--    (root della sessione, retro-compatibile con i 4 sprint S precedenti).
--  * tenant scoping forte (RLS) + ruolo admin/tech per CRUD.
--  * cascade: cancellando un evento, cancello anche le folders. Cancellando
--    una folder, le presentations dentro NON spariscono (folder_id va a NULL).
-- =============================================================================

-- 1. tabella event_folders (gerarchia ricorsiva con parent_id)
CREATE TABLE IF NOT EXISTS public.event_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.event_folders(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Una cartella deve avere nome unico nel suo livello (parent_id+name).
  -- NULLS NOT DISTINCT (PG15+) tratta NULL come uguale → root unique.
  CONSTRAINT event_folders_unique_per_parent
    UNIQUE NULLS NOT DISTINCT (event_id, parent_id, name)
);

CREATE INDEX IF NOT EXISTS event_folders_event_id_idx
  ON public.event_folders (event_id);

CREATE INDEX IF NOT EXISTS event_folders_parent_id_idx
  ON public.event_folders (parent_id) WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS event_folders_tenant_id_idx
  ON public.event_folders (tenant_id);

COMMENT ON TABLE public.event_folders IS
  'Sprint U-2: gerarchia cartelle Production view per organizzare presentations OneDrive-style.';

-- 2. trigger updated_at
CREATE OR REPLACE FUNCTION public.event_folders_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_folders_set_updated_at_trg ON public.event_folders;
CREATE TRIGGER event_folders_set_updated_at_trg
BEFORE UPDATE ON public.event_folders
FOR EACH ROW
EXECUTE FUNCTION public.event_folders_set_updated_at();

-- 3. colonna folder_id su presentations
ALTER TABLE public.presentations
  ADD COLUMN IF NOT EXISTS folder_id uuid
    REFERENCES public.event_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS presentations_folder_id_idx
  ON public.presentations (folder_id) WHERE folder_id IS NOT NULL;

COMMENT ON COLUMN public.presentations.folder_id IS
  'Sprint U-2: cartella opzionale per organizzazione Production. NULL = root.';

-- 4. RLS event_folders
ALTER TABLE public.event_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_folders_select ON public.event_folders;
CREATE POLICY event_folders_select ON public.event_folders
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.app_tenant_id());

DROP POLICY IF EXISTS event_folders_insert ON public.event_folders;
CREATE POLICY event_folders_insert ON public.event_folders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.app_tenant_id()
    AND public.app_user_role() IN ('admin', 'tech')
  );

DROP POLICY IF EXISTS event_folders_update ON public.event_folders;
CREATE POLICY event_folders_update ON public.event_folders
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.app_tenant_id()
    AND public.app_user_role() IN ('admin', 'tech')
  )
  WITH CHECK (tenant_id = public.app_tenant_id());

DROP POLICY IF EXISTS event_folders_delete ON public.event_folders;
CREATE POLICY event_folders_delete ON public.event_folders
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.app_tenant_id()
    AND public.app_user_role() IN ('admin', 'tech')
  );

-- service_role bypassa RLS (uso negli edge functions / admin tools).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_folders TO authenticated, service_role;

-- 5. RPC atomica: muovi N presentations in folder con tenant+event check
CREATE OR REPLACE FUNCTION public.move_presentations_to_folder(
  p_presentation_ids uuid[],
  p_folder_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant uuid := public.app_tenant_id();
  v_role public.user_role := public.app_user_role();
  v_count integer := 0;
  v_folder_event_id uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no_tenant' USING ERRCODE = '42501';
  END IF;

  IF v_role NOT IN ('admin', 'tech') THEN
    RAISE EXCEPTION 'forbidden_role' USING ERRCODE = '42501';
  END IF;

  IF p_folder_id IS NOT NULL THEN
    SELECT event_id INTO v_folder_event_id
      FROM public.event_folders
     WHERE id = p_folder_id
       AND tenant_id = v_tenant
     LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'folder_not_found' USING ERRCODE = '23503';
    END IF;
  END IF;

  -- Aggiorna solo le presentations dello stesso tenant; se folder_id e' NOT NULL,
  -- richiede anche event_id matching (no spostamento cross-event).
  UPDATE public.presentations p
     SET folder_id = p_folder_id,
         updated_at = now()
   WHERE p.id = ANY(p_presentation_ids)
     AND p.tenant_id = v_tenant
     AND (p_folder_id IS NULL OR p.event_id = v_folder_event_id);

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Log activity
  INSERT INTO public.activity_log (tenant_id, actor, action, entity_type, entity_id, metadata)
  VALUES (
    v_tenant,
    'user',
    'presentations.move_to_folder',
    'event_folder',
    p_folder_id,
    jsonb_build_object(
      'presentation_ids', p_presentation_ids,
      'folder_id', p_folder_id,
      'count', v_count
    )
  );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_presentations_to_folder(uuid[], uuid)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.move_presentations_to_folder(uuid[], uuid)
  FROM PUBLIC, anon;

COMMENT ON FUNCTION public.move_presentations_to_folder(uuid[], uuid) IS
  'Sprint U-2: muove N presentations in folder atomicamente con tenant+event scope. Ritorna count.';
