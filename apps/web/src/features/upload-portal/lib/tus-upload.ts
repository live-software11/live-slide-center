// Wrapper tus-js-client per Supabase Storage TUS endpoint.
// Supabase espone TUS resumable a {SUPABASE_URL}/storage/v1/upload/resumable.
// Documentazione: https://supabase.com/docs/guides/storage/uploads/resumable-uploads
//
// BUGFIX 2026-04-19 (Sprint X-1): per il flusso ADMIN authenticated il Bearer
// del TUS DEVE essere il JWT dell'utente (`access_token`), NON l'anon key.
// Motivo: la policy storage `anon_insert_uploading_version` esegue una
// subquery su `presentation_versions` che — sotto ruolo Postgres `anon` —
// non vede nessuna riga (l'unica policy esistente su quella tabella è per
// `authenticated`). Risultato: HTTP 403 "new row violates row-level security
// policy" e nessun oggetto creato in Storage.
//
// Per upload-portal pubblico (relatore senza account) il Bearer resta anon
// key: la policy `anon_insert_uploading_version` viene affiancata da una
// `anon_can_select_uploading_version` (vedi migration sprint X-1) che
// permette ad anon di SELECT solo su versioni in stato `uploading`,
// rendendo possibile l'INSERT su storage.objects anche per relatori anonimi.

import * as tus from 'tus-js-client';

export interface TusUploadOptions {
  supabaseUrl: string;
  /** Anon key Supabase (header `apikey` sempre richiesto dal gateway PostgREST). */
  anonKey: string;
  /**
   * Access token JWT dell'utente loggato. Quando presente diventa il Bearer
   * del TUS upload e fa scattare la policy `tenant_insert_uploading_version`
   * (authenticated). Se assente (es. upload-portal pubblico) si usa l'anon
   * key come Bearer.
   */
  accessToken?: string | null;
  bucket: string;
  objectName: string;
  file: File;
  onProgress: (uploaded: number, total: number) => void;
  onSuccess: () => void;
  onError: (err: Error) => void;
}

export interface TusHandle {
  abort(): void;
}

const CHUNK_SIZE = 6 * 1024 * 1024; // richiesto dallo Storage: 6 MiB fissi

export function startTusUpload(opts: TusUploadOptions): TusHandle {
  const bearer = opts.accessToken && opts.accessToken.length > 0 ? opts.accessToken : opts.anonKey;
  const upload = new tus.Upload(opts.file, {
    endpoint: `${opts.supabaseUrl}/storage/v1/upload/resumable`,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    headers: {
      authorization: `Bearer ${bearer}`,
      apikey: opts.anonKey,
      'x-upsert': 'true',
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName: opts.bucket,
      objectName: opts.objectName,
      contentType: opts.file.type || 'application/octet-stream',
      cacheControl: '3600',
    },
    chunkSize: CHUNK_SIZE,
    onError: (err) => {
      opts.onError(err instanceof Error ? err : new Error(String(err)));
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      opts.onProgress(bytesUploaded, bytesTotal);
    },
    onSuccess: () => {
      opts.onSuccess();
    },
  });

  // findPreviousUploads cerca un fingerprint precedente nello storage del
  // browser (localStorage di default) per riprendere un upload interrotto.
  // Se la lookup fallisce (storage disabilitato, quota piena, exception
  // tus-js-client) PRIMA fix questa promise rimaneva pending senza .catch:
  // upload.start() non veniva mai chiamato e l'UI restava in stato
  // "uploading" eterno. Catch + start sempre, fallback su nuovo upload.
  upload
    .findPreviousUploads()
    .then((previous) => {
      if (previous.length > 0 && previous[0]) {
        try {
          upload.resumeFromPreviousUpload(previous[0]);
        } catch {
          // resume fallito (fingerprint corrotto): partiamo fresh.
        }
      }
      upload.start();
    })
    .catch((err) => {
      // Loggo per diagnostica ma NON blocco l'upload: parto da zero.
      console.warn('[tus-upload] findPreviousUploads failed, starting fresh', err);
      try {
        upload.start();
      } catch (startErr) {
        opts.onError(
          startErr instanceof Error ? startErr : new Error(String(startErr)),
        );
      }
    });

  return {
    abort() {
      void upload.abort(true);
    },
  };
}
