import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeFileSha256 } from '@/features/upload-portal/lib/sha256';
import { startSimpleUpload, type SimpleUploadHandle } from '@/features/upload-portal/lib/simple-upload';
import { startTusUpload, type TusHandle } from '@/features/upload-portal/lib/tus-upload';
import {
  abortAdminUpload,
  finalizeAdminUpload,
  initSessionUpload,
} from '@/features/presentations/repository';
import { getBackendMode } from '@/lib/backend-mode';
import { getCachedDesktopBackendInfo } from '@/lib/desktop-backend-init';
import { getSupabaseBrowserClient } from '@/lib/supabase';

/** Handle abort comune ai due upload: TUS (cloud) e Simple POST (desktop). */
type UploadHandle = TusHandle | SimpleUploadHandle;

/**
 * Sprint H (GUIDA_OPERATIVA_v3 §3.C C2) — coda upload multi-file.
 *
 * RATIONALE:
 *  - Upload singolo (Sprint base) bloccava la UI: il drop di N file faceva
 *    partire SOLO il primo, gli altri venivano ignorati.
 *  - Per evitare race su `init_upload_version_admin` (che ha lock advisory
 *    + ON CONFLICT su `speaker_id`), processiamo SEQUENZIALMENTE (concurrency
 *    = 1). Su Pro plan i singoli upload TUS gia' usano parallelism interno
 *    sui chunk; serializzare i FILE evita di saturare bandwidth e di accodare
 *    decine di lock advisory contemporanei.
 *  - Se in futuro vogliamo concurrency > 1, basta cambiare `MAX_PARALLEL`
 *    e estendere `runningJobIds` da `string | null` a `Set<string>`.
 *
 * STATI JOB:
 *   pending → uploading → hashing → finalizing → done
 *                    \__→ error (con messageKey i18n)
 *                    \__→ cancelled (utente clicca X)
 *
 * CANCELLAZIONE:
 *  - Job pending: rimosso dalla coda al volo, niente network.
 *  - Job in corso: uploadHandle.abort() + hashAbort.abort() + abortAdminUpload
 *    se versionId gia' creato (cleanup orfano lato DB).
 *
 * IDEMPOTENZA / FAULT TOLERANCE:
 *  - Cleanup unmount: aborta tutti i job in corso e libera versionId orfani.
 *  - mountedRef per evitare setState dopo unmount.
 */

const MAX_PARALLEL = 1;

export type UploadJobStatus =
  | 'pending'
  | 'uploading'
  | 'hashing'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface UploadJob {
  id: string;
  fileName: string;
  fileSize: number;
  /** 0..1 percentuale upload (TUS) — solo durante 'uploading'. */
  progress: number;
  /** Bytes caricati (per UI con MB/MB). */
  uploaded: number;
  status: UploadJobStatus;
  /** i18n key, popolata solo su 'error'. */
  errorKey?: string;
}

interface InternalJob extends UploadJob {
  file: File;
  versionId: string | null;
  /**
   * Handle dell'upload in corso. In cloud e' un `TusHandle` (tus-js-client),
   * in desktop e' un `SimpleUploadHandle` (XHR). Entrambi espongono `abort()`.
   */
  uploadHandle: UploadHandle | null;
  hashAbort: AbortController | null;
  /** Marker per saltare init/finalize quando l'utente ha gia' cancellato. */
  cancelled: boolean;
}

const ERROR_MAP: Record<string, string> = {
  file_too_large: 'presentation.adminUpload.errorTooLarge',
  storage_quota_exceeded: 'presentation.adminUpload.errorQuotaExceeded',
  session_not_found_or_cross_tenant: 'session.errors.missingContext',
  no_tenant_in_jwt: 'presentation.adminUpload.errorTenantMissing',
  role_forbidden: 'presentation.adminUpload.errorRoleForbidden',
  tenant_suspended: 'presentation.adminUpload.errorTenantSuspended',
  event_closed_or_archived: 'presentation.adminUpload.errorEventClosed',
  filename_too_long: 'presentation.adminUpload.errorFilenameTooLong',
  invalid_input: 'presentation.adminUpload.errorGeneric',
};

function mapErrorKey(rawMessage: string | undefined): string {
  const msg = rawMessage ?? '';
  for (const [code, key] of Object.entries(ERROR_MAP)) {
    if (msg.includes(code)) return key;
  }
  return 'presentation.adminUpload.errorGeneric';
}

function newJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface UploadJobDoneInfo {
  /** ID della presentation creata dall'init (sempre presente quando done). */
  presentationId: string;
  /** ID della version creata. */
  versionId: string;
  /** Nome file caricato (post sanitize browser, NON dopo SQL sanitize storage_key). */
  fileName: string;
  /** Sessione di destinazione usata per l'upload. */
  sessionId: string;
}

export interface UseUploadQueueOptions {
  sessionId: string;
  supabaseUrl: string;
  anonKey: string;
  /** Chiamato dopo che TUTTI i job in coda sono terminati (anche con error). */
  onAllDone?: () => void;
  /**
   * Chiamato dopo OGNI job done. Riceve i metadati del file appena finalizzato
   * (Sprint U-3: serve a `FileExplorerView` per spostare la presentation in
   * folder corrente DOPO la creazione, dato che `init_upload_version_for_session`
   * non accetta ancora `p_folder_id`). Rimane retro-compatibile: il chiamante
   * puo' ignorare l'argomento e usarlo come `() => void` (es. `SessionFilesPanel`
   * che fa solo refetch).
   */
  onJobDone?: (info: UploadJobDoneInfo) => void;
}

export interface UseUploadQueueResult {
  /** Snapshot pubblico per la UI (senza file/handle interni). */
  jobs: UploadJob[];
  /** Aggiunge file alla coda. Skip se size==0 o nome vuoto. */
  enqueue: (files: File[] | FileList) => void;
  /** Rimuove un job: pending → solo splice, in corso → abort completo. */
  cancel: (jobId: string) => void;
  /** Rimuove tutti i job in stato terminale (done/error/cancelled). */
  clearFinished: () => void;
  /** True se almeno un job e' attivo (uploading/hashing/finalizing). */
  busy: boolean;
  /** Conteggio per stato (utile per badge "3 in coda · 1 in upload"). */
  counts: {
    total: number;
    pending: number;
    active: number;
    done: number;
    error: number;
  };
}

export function useUploadQueue(opts: UseUploadQueueOptions): UseUploadQueueResult {
  const { sessionId, supabaseUrl, anonKey, onAllDone, onJobDone } = opts;

  // Stato pubblico (read-only) e ref interno (con `file`, `uploadHandle`, ecc.).
  // Teniamo entrambi per: (1) la UI re-renderizza solo su cambio "leggero",
  // (2) il worker accede ai bytes/handle senza ri-cercarli ogni volta.
  const [publicJobs, setPublicJobs] = useState<UploadJob[]>([]);
  const internalJobsRef = useRef<InternalJob[]>([]);
  const mountedRef = useRef(true);
  const runningJobIdRef = useRef<string | null>(null);
  // Latest callback refs per evitare stale closure nel worker async.
  // Sync via useEffect (la lint rule `react-hooks/refs` di React 19 vieta
  // l'assegnazione `ref.current = ...` durante il render).
  const onAllDoneRef = useRef(onAllDone);
  const onJobDoneRef = useRef(onJobDone);
  useEffect(() => {
    onAllDoneRef.current = onAllDone;
    onJobDoneRef.current = onJobDone;
  }, [onAllDone, onJobDone]);

  // Tick contatore per re-trigger il worker effect quando lo stato cambia
  // (es. nuovo enqueue, job done). Pattern alternativa al "watch jobs.length"
  // che e' fragile (push + splice possono lasciare la stessa length).
  const [tick, setTick] = useState(0);
  const bumpTick = useCallback(() => setTick((t) => t + 1), []);

  // Sincronizza snapshot pubblico dai job interni. Chiamato dopo ogni
  // mutation rilevante per la UI.
  const syncPublic = useCallback(() => {
    if (!mountedRef.current) return;
    setPublicJobs(
      internalJobsRef.current.map((j) => ({
        id: j.id,
        fileName: j.fileName,
        fileSize: j.fileSize,
        progress: j.progress,
        uploaded: j.uploaded,
        status: j.status,
        errorKey: j.errorKey,
      })),
    );
  }, []);

  const enqueue = useCallback(
    (files: File[] | FileList) => {
      const arr = Array.from(files);
      if (arr.length === 0) return;
      const fresh: InternalJob[] = arr
        .filter((f) => f && f.size > 0 && f.name.length > 0)
        .map((f) => ({
          id: newJobId(),
          fileName: f.name,
          fileSize: f.size,
          progress: 0,
          uploaded: 0,
          status: 'pending' as UploadJobStatus,
          file: f,
          versionId: null,
          uploadHandle: null,
          hashAbort: null,
          cancelled: false,
        }));
      if (fresh.length === 0) return;
      internalJobsRef.current = [...internalJobsRef.current, ...fresh];
      syncPublic();
      bumpTick();
    },
    [bumpTick, syncPublic],
  );

  const cancel = useCallback(
    (jobId: string) => {
      const job = internalJobsRef.current.find((j) => j.id === jobId);
      if (!job) return;
      job.cancelled = true;
      // Pending: rimuovo dalla coda subito, niente network.
      if (job.status === 'pending') {
        internalJobsRef.current = internalJobsRef.current.filter((j) => j.id !== jobId);
        syncPublic();
        bumpTick();
        return;
      }
      // In corso: abort tutto, lascia il job visibile come 'cancelled'.
      job.uploadHandle?.abort();
      job.hashAbort?.abort();
      const orphan = job.versionId;
      if (orphan) void abortAdminUpload(orphan).catch(() => undefined);
      job.status = 'cancelled';
      job.uploadHandle = null;
      job.hashAbort = null;
      job.versionId = null;
      syncPublic();
      bumpTick();
    },
    [bumpTick, syncPublic],
  );

  const clearFinished = useCallback(() => {
    internalJobsRef.current = internalJobsRef.current.filter(
      (j) => j.status !== 'done' && j.status !== 'error' && j.status !== 'cancelled',
    );
    syncPublic();
    bumpTick();
  }, [bumpTick, syncPublic]);

  // Cleanup unmount: aborta tutto e libera versionId orfani.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const j of internalJobsRef.current) {
        j.cancelled = true;
        j.uploadHandle?.abort();
        j.hashAbort?.abort();
        const orphan = j.versionId;
        if (orphan) void abortAdminUpload(orphan).catch(() => undefined);
      }
    };
  }, []);

  // ────────────────────────────────────────────────────────────────────
  // Worker loop: consuma `pending` un job alla volta (concurrency 1).
  // Triggerato da `tick` (cambia su enqueue, cancel, job done).
  // ────────────────────────────────────────────────────────────────────
  // Sprint X-1 (parita' UX desktop): ramifichiamo l'upload sotto.
  // - cloud: TUS verso Supabase Storage, supabaseUrl + anonKey + accessToken JWT
  // - desktop: simple POST verso server Rust, base_url + admin_token
  // La validazione "config presente" cambia di conseguenza: in desktop NON
  // servono `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (anzi spesso non sono
  // settate), serve invece che `getCachedDesktopBackendInfo()` ritorni info.
  const backendMode = getBackendMode();

  useEffect(() => {
    if (!mountedRef.current) return;
    if (runningJobIdRef.current !== null) return; // gia' in upload

    // Validazione config differenziata cloud vs desktop. Senza questi check
    // i job restavano "pending" eternamente lasciando l'utente senza
    // feedback visibile.
    let configError: string | null = null;
    if (backendMode === 'desktop') {
      const info = getCachedDesktopBackendInfo();
      if (!info?.base_url || !info?.admin_token) {
        configError = 'desktop_backend_not_ready';
      }
    } else {
      if (!supabaseUrl || !anonKey) {
        configError = 'cloud_supabase_missing';
      }
    }
    if (configError) {
      const pendingJobs = internalJobsRef.current.filter(
        (j) => j.status === 'pending' && !j.cancelled,
      );
      if (pendingJobs.length > 0) {
        for (const job of pendingJobs) {
          job.status = 'error';
          job.errorKey = 'presentation.adminUpload.errorConfig';
        }
        syncPublic();
        console.error(`[useUploadQueue] config error: ${configError} — upload disabled`);
      }
      return;
    }
    if (MAX_PARALLEL !== 1) {
      // Guard di sicurezza: il loop attuale e' single-job; se cambi
      // MAX_PARALLEL > 1 devi rifattorizzare in un Set di running.
    }

    const next = internalJobsRef.current.find((j) => j.status === 'pending' && !j.cancelled);
    if (!next) {
      // Niente di pending → se la coda non e' completamente vuota e
      // tutti gli ultimi job sono terminali, segnala "tutto fatto".
      const anyActive = internalJobsRef.current.some(
        (j) => j.status === 'uploading' || j.status === 'hashing' || j.status === 'finalizing',
      );
      const hasJobs = internalJobsRef.current.length > 0;
      if (hasJobs && !anyActive) onAllDoneRef.current?.();
      return;
    }

    runningJobIdRef.current = next.id;
    void runJob(next).finally(() => {
      runningJobIdRef.current = null;
      if (mountedRef.current) bumpTick();
    });

    async function runJob(job: InternalJob) {
      // Helper interno: aggiorna lo stato del job e sincronizza UI.
      const update = (patch: Partial<InternalJob>) => {
        if (!mountedRef.current) return;
        Object.assign(job, patch);
        syncPublic();
      };

      update({ status: 'uploading', progress: 0, uploaded: 0 });

      let init;
      try {
        init = await initSessionUpload({
          sessionId,
          filename: job.file.name,
          size: job.file.size,
          mime: job.file.type || 'application/octet-stream',
        });
      } catch (err) {
        if (job.cancelled) {
          update({ status: 'cancelled' });
          return;
        }
        update({
          status: 'error',
          errorKey: mapErrorKey((err as { message?: string })?.message),
        });
        return;
      }
      if (job.cancelled) {
        try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
        update({ status: 'cancelled' });
        return;
      }
      job.versionId = init.version_id;

      // Hash in parallelo all'upload TUS (le due operazioni sono indipendenti
      // e questo dimezza il tempo totale per file ≥100 MB).
      const hashAbort = new AbortController();
      job.hashAbort = hashAbort;
      const sha256Promise = computeFileSha256(job.file, undefined, hashAbort.signal).catch((err) => {
        if ((err as DOMException).name === 'AbortError') return null;
        throw err;
      });

      // Sprint X-1 (audit chirurgico upload, 19 aprile 2026):
      // ramificazione cloud (TUS resumable) vs desktop (simple POST).
      //
      // CLOUD: Supabase Storage parla TUS Resumable. Bearer = JWT utente
      // (admin authenticated) per soddisfare la policy
      // `tenant_insert_uploading_version` su `storage.objects`. Senza JWT
      // scatta `anon_insert_uploading_version` la cui subquery
      // su `presentation_versions` non e' visibile ad anon → HTTP 403 RLS.
      //
      // DESKTOP: il server Rust embedded espone solo
      // `POST /storage/v1/object/{bucket}/{*key}` (no TUS). Bearer = admin
      // token UUID (vedi `apps/web/src/lib/supabase.ts` per la genesi del
      // token in `getCachedDesktopBackendInfo()`). Senza questo branch,
      // l'upload desktop colpiva `/storage/v1/upload/resumable` → 404 →
      // version 'uploading' orfana → abort → utente vedeva "errore di rete".
      const uploadPromise = new Promise<void>((resolve, reject) => {
        const onProgress = (uploaded: number, total: number) => {
          if (job.cancelled) return;
          const pct = total > 0 ? uploaded / total : 0;
          update({ progress: pct, uploaded });
        };

        if (backendMode === 'desktop') {
          const info = getCachedDesktopBackendInfo();
          if (!info?.base_url || !info?.admin_token) {
            reject(new Error('desktop_backend_not_ready'));
            return;
          }
          job.uploadHandle = startSimpleUpload({
            baseUrl: info.base_url,
            adminToken: info.admin_token,
            bucket: init.bucket,
            objectName: init.storage_key,
            file: job.file,
            onProgress,
            onSuccess: () => resolve(),
            onError: (err) => reject(err),
          });
        } else {
          // Cloud: recupero JWT utente authenticated; in upload-portal pubblico
          // (mai usato in questa coda admin) sarebbe `null`.
          const supabaseClient = getSupabaseBrowserClient();
          supabaseClient.auth.getSession().then(({ data: sessionData }) => {
            // BUGFIX 2026-04-19 (race condition cancel): durante l'await asincrono
            // di `getSession()` l'utente puo' aver cliccato "Cancel" sul job. Senza
            // questo check, `startTusUpload` partirebbe comunque e occuperebbe
            // bandwidth (potenzialmente 100MB+ su 4G) prima che il handle .abort()
            // possa arrivare. Il `cancel()` setta gia' `job.cancelled = true` e
            // chiama `abortAdminUpload(versionId)` sul backend, quindi qui basta
            // rejectare con un errore riconoscibile: il `catch` upper vede
            // `job.cancelled` e marca il job come 'cancelled' senza riportare
            // un finto errore di rete all'UI.
            if (job.cancelled) {
              reject(new Error('upload_cancelled'));
              return;
            }
            const accessToken = sessionData.session?.access_token ?? null;
            job.uploadHandle = startTusUpload({
              supabaseUrl,
              anonKey,
              accessToken,
              bucket: init.bucket,
              objectName: init.storage_key,
              file: job.file,
              onProgress,
              onSuccess: () => resolve(),
              onError: (err) => reject(err),
            });
          }).catch((err) => reject(err instanceof Error ? err : new Error(String(err))));
        }
      });

      try {
        await uploadPromise;
      } catch {
        if (job.cancelled) {
          try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
          update({ status: 'cancelled' });
          return;
        }
        update({ status: 'error', errorKey: 'presentation.adminUpload.errorNetwork' });
        try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
        job.versionId = null;
        return;
      }

      if (job.cancelled) {
        try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
        update({ status: 'cancelled' });
        return;
      }

      update({ status: 'hashing' });
      const sha256 = await sha256Promise;
      if (!sha256) {
        // sha256Promise null = abort (rari sovrascritti da cancel)
        update({ status: job.cancelled ? 'cancelled' : 'error', errorKey: 'presentation.adminUpload.errorGeneric' });
        try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
        job.versionId = null;
        return;
      }

      if (job.cancelled) {
        try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
        update({ status: 'cancelled' });
        return;
      }

      update({ status: 'finalizing' });
      try {
        await finalizeAdminUpload(init.version_id, sha256);
      } catch (err) {
        update({
          status: 'error',
          errorKey: mapErrorKey((err as { message?: string })?.message),
        });
        try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
        job.versionId = null;
        return;
      }

      const finalizedInfo: UploadJobDoneInfo = {
        presentationId: init.presentation_id,
        versionId: init.version_id,
        fileName: job.file.name,
        sessionId,
      };
      job.versionId = null;
      update({ status: 'done', progress: 1, uploaded: job.fileSize });
      onJobDoneRef.current?.(finalizedInfo);
    }
  }, [tick, sessionId, supabaseUrl, anonKey, backendMode, bumpTick, syncPublic]);

  const counts = useMemo(() => {
    let pending = 0;
    let active = 0;
    let done = 0;
    let error = 0;
    for (const j of publicJobs) {
      if (j.status === 'pending') pending += 1;
      else if (j.status === 'done') done += 1;
      else if (j.status === 'error' || j.status === 'cancelled') error += 1;
      else active += 1;
    }
    return { total: publicJobs.length, pending, active, done, error };
  }, [publicJobs]);

  const busy = counts.active > 0;

  return { jobs: publicJobs, enqueue, cancel, clearFinished, busy, counts };
}
