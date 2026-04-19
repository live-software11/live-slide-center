-- Sprint X-1 (19 aprile 2026, audit chirurgico upload):
--   Fix BUG CRITICO #1: l'upload admin authenticated falliva con HTTP 403
--   "new row violates row-level security policy" durante il TUS POST verso
--   `/storage/v1/upload/resumable`.
--
--   Causa: il client React passava `anon_key` come Bearer al TUS, quindi
--   Storage applicava la policy `anon_insert_uploading_version` la cui
--   subquery `EXISTS (SELECT 1 FROM presentation_versions pv WHERE ...)`
--   girava sotto ruolo `anon`. Su `presentation_versions` esiste UNA SOLA
--   policy `tenant_or_super` per `authenticated` => anon vede 0 righe =>
--   EXISTS = FALSE => INSERT su storage.objects rifiutato => TUS errore =>
--   l'oggetto Storage non veniva mai creato => `useUploadQueue` chiamava
--   `abort_upload_version_admin` (status='failed') => UI nasconde la riga
--   (filtro `if (!current_version_id && status !== 'ready')`) => l'utente
--   percepisce "non vedo i file caricati".
--
--   Soluzione completa:
--     1) Lato CLIENT (`apps/web/.../tus-upload.ts` + `useUploadQueue.ts` +
--        `AdminUploaderInline.tsx`): passare `access_token` JWT come Bearer
--        per TUS quando l'utente e' authenticated. Cosi' scatta la policy
--        `tenant_insert_uploading_version` (authenticated) e funziona.
--     2) Lato DB (questa migration): rifattorizzare le DUE policy storage
--        (anon + authenticated) per usare funzioni SECURITY DEFINER al
--        posto delle subquery dirette. In questo modo:
--          - upload-portal pubblico (anon, link `/u/:token`) torna a
--            funzionare senza esporre `presentation_versions` ad anon
--            (la funzione gira con privilegi owner e ritorna solo boolean);
--          - admin authenticated continua a funzionare con tenant scope
--            (la funzione tenant-aware controlla `pv.tenant_id =
--            app_tenant_id()`).
--
--   Scope sicurezza:
--     - `storage_can_upload_object_anon(text)`: ritorna TRUE se esiste una
--       `presentation_versions` con quella `storage_key` e `status =
--       'uploading'`. NESSUN dato esposto: solo boolean.
--     - `storage_can_upload_object_tenant(text)`: come sopra MA aggiunge
--       `tenant_id = app_tenant_id()` (admin di tenant A non puo' scrivere
--       su file di tenant B).
--
-- Idempotente: usa CREATE OR REPLACE / DROP IF EXISTS / DO $$.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Funzione SECURITY DEFINER per check anon (no tenant scope, ritorna
--    boolean — evita il leak di metadata di `presentation_versions`).
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storage_can_upload_object_anon(p_object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.presentation_versions pv
    WHERE pv.storage_key = p_object_name
      AND pv.status = 'uploading'
  );
$$;

REVOKE ALL ON FUNCTION public.storage_can_upload_object_anon(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_can_upload_object_anon(text) TO anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Funzione SECURITY DEFINER per check authenticated (tenant scope,
--    ritorna boolean). Applica `app_tenant_id()` quindi resta tenant-safe
--    anche se la subquery non e' visibile direttamente al ruolo client.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.storage_can_upload_object_tenant(p_object_name text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.presentation_versions pv
    WHERE pv.storage_key = p_object_name
      AND pv.status = 'uploading'
      AND pv.tenant_id = public.app_tenant_id()
  );
$$;

REVOKE ALL ON FUNCTION public.storage_can_upload_object_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_can_upload_object_tenant(text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Drop e ricrea le 2 policy storage usando le nuove funzioni.
--    `anon_insert_uploading_version` torna a funzionare; quella
--    `tenant_insert_uploading_version` resta tenant-safe.
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "anon_insert_uploading_version" ON storage.objects;
CREATE POLICY "anon_insert_uploading_version" ON storage.objects
  FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'presentations'
    AND public.storage_can_upload_object_anon(storage.objects.name)
  );

DROP POLICY IF EXISTS "tenant_insert_uploading_version" ON storage.objects;
CREATE POLICY "tenant_insert_uploading_version" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'presentations'
    AND public.storage_can_upload_object_tenant(storage.objects.name)
  );

-- ────────────────────────────────────────────────────────────────────────
-- 4. Activity log: registra l'applicazione del fix per audit trail.
-- ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE 'Sprint X-1: storage RLS policies refactored to use SECURITY DEFINER functions.';
END $$;
