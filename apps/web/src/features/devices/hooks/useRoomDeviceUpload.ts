import { useCallback, useEffect, useRef, useState } from 'react';
import { computeFileSha256 } from '@/features/upload-portal/lib/sha256';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import {
  invokeRoomDeviceUploadAbort,
  invokeRoomDeviceUploadFinalize,
  invokeRoomDeviceUploadInit,
} from '../repository';

/**
 * Sprint R-3 (G3) — Upload da PC sala (relatore last-minute).
 *
 * Flusso completo gestito da questo hook:
 *   1) `init` Edge Function `room-device-upload-init`:
 *      - validazione lato RPC SECURITY DEFINER (room_id, session.room_id, quota, ecc.)
 *      - generazione signed upload URL Storage (validita' 2h)
 *   2) `upload` PUT diretto su Storage via `supabase.storage.uploadToSignedUrl`
 *      - progress tracking via fetch reader (Web Streams)
 *   3) `hash` calcolo SHA-256 in parallelo (chunked, 8 MiB per chunk)
 *   4) `finalize` Edge Function `room-device-upload-finalize`:
 *      - promuove version 'uploading' → 'ready'
 *      - presentation status: pending → uploaded
 *      - altre versions 'ready' → 'superseded'
 *      - broadcast realtime `room:<roomId>` event 'room_device_upload_completed'
 *
 * STATI:
 *   idle → preparing → uploading → hashing → finalizing → done
 *                                                       \→ error (con messageKey)
 *                                                       \→ cancelled
 *
 * CANCELLAZIONE:
 *   - `cancel()` aborta upload + hash + chiama abort Edge Function (cleanup orfano).
 *
 * IDEMPOTENZA / FAULT TOLERANCE:
 *   - Cleanup unmount: aborta upload in corso e libera version_id orfani.
 *   - Singolo upload alla volta (busy guard): per evitare race su quota tenant.
 */

export type RoomDeviceUploadStatus =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'hashing'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';

export interface RoomDeviceUploadJob {
  fileName: string;
  fileSize: number;
  /** 0..1 percentuale upload PUT — solo durante 'uploading'. */
  progress: number;
  /** Bytes caricati (per UI MB/MB). */
  uploaded: number;
  status: RoomDeviceUploadStatus;
  /** i18n key (popolata solo su 'error'). */
  errorKey?: string;
}

export interface UseRoomDeviceUploadOptions {
  deviceToken: string;
  /**
   * Callback chiamata su success per consentire al chiamante di refreshare la
   * lista files locali (es. `useFileSync.refreshNow()`).
   */
  onUploadComplete?: (info: {
    versionId: string;
    presentationId: string;
    fileName: string;
    sessionId: string | null;
  }) => void;
}

export interface UseRoomDeviceUploadResult {
  job: RoomDeviceUploadJob | null;
  /** True se c'e' un upload in corso (stati attivi). */
  busy: boolean;
  /**
   * Avvia l'upload di un file su una sessione della propria sala.
   * Skip se busy=true (single-job guard).
   */
  upload: (file: File, sessionId: string) => Promise<void>;
  /** Aborta upload in corso. Idempotente. */
  cancel: () => void;
  /** Resetta lo stato (toglie il toast/banner success/error). */
  reset: () => void;
}

const ERROR_MAP: Record<string, string> = {
  invalid_token: 'roomPlayer.upload.error.invalidToken',
  device_no_room_assigned: 'roomPlayer.upload.error.noRoomAssigned',
  session_cross_room: 'roomPlayer.upload.error.sessionCrossRoom',
  session_not_found: 'roomPlayer.upload.error.sessionNotFound',
  tenant_suspended: 'roomPlayer.upload.error.tenantSuspended',
  event_closed: 'roomPlayer.upload.error.eventClosed',
  file_too_large: 'roomPlayer.upload.error.fileTooLarge',
  storage_quota_exceeded: 'roomPlayer.upload.error.storageQuota',
  filename_too_long: 'roomPlayer.upload.error.filenameTooLong',
  invalid_size: 'roomPlayer.upload.error.invalidSize',
  invalid_sha256: 'roomPlayer.upload.error.generic',
  object_missing: 'roomPlayer.upload.error.objectMissing',
  version_not_uploading: 'roomPlayer.upload.error.versionNotUploading',
  version_not_found: 'roomPlayer.upload.error.versionNotFound',
};

function mapErrorKey(rawMessage: string | undefined | null): string {
  const msg = String(rawMessage ?? '');
  for (const [code, key] of Object.entries(ERROR_MAP)) {
    if (msg.includes(code)) return key;
  }
  return 'roomPlayer.upload.error.generic';
}

export function useRoomDeviceUpload(opts: UseRoomDeviceUploadOptions): UseRoomDeviceUploadResult {
  const { deviceToken, onUploadComplete } = opts;
  const [job, setJob] = useState<RoomDeviceUploadJob | null>(null);
  const mountedRef = useRef(true);
  const versionIdRef = useRef<string | null>(null);
  const cancelControllerRef = useRef<AbortController | null>(null);
  const onCompleteRef = useRef(onUploadComplete);

  useEffect(() => {
    onCompleteRef.current = onUploadComplete;
  }, [onUploadComplete]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelControllerRef.current?.abort();
      // Cleanup orfano su unmount
      const orphan = versionIdRef.current;
      if (orphan && deviceToken) {
        void invokeRoomDeviceUploadAbort({ deviceToken, versionId: orphan }).catch(() => undefined);
      }
    };
    // deviceToken e' stabile per tutta la sessione del PC sala — non serve dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const safeSetJob = useCallback((updater: (prev: RoomDeviceUploadJob | null) => RoomDeviceUploadJob | null) => {
    if (!mountedRef.current) return;
    setJob(updater);
  }, []);

  const reset = useCallback(() => {
    safeSetJob(() => null);
  }, [safeSetJob]);

  const cancel = useCallback(() => {
    cancelControllerRef.current?.abort();
    const orphan = versionIdRef.current;
    if (orphan && deviceToken) {
      void invokeRoomDeviceUploadAbort({ deviceToken, versionId: orphan })
        .catch(() => undefined)
        .finally(() => {
          versionIdRef.current = null;
        });
    }
    safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
  }, [deviceToken, safeSetJob]);

  const upload = useCallback(
    async (file: File, sessionId: string): Promise<void> => {
      if (!deviceToken) {
        safeSetJob(() => ({
          fileName: file.name,
          fileSize: file.size,
          progress: 0,
          uploaded: 0,
          status: 'error',
          errorKey: 'roomPlayer.upload.error.invalidToken',
        }));
        return;
      }
      // Single-job guard: se gia' attivo, ignora.
      if (job && (job.status === 'preparing' || job.status === 'uploading' ||
                  job.status === 'hashing' || job.status === 'finalizing')) {
        return;
      }
      if (file.size <= 0) {
        safeSetJob(() => ({
          fileName: file.name,
          fileSize: file.size,
          progress: 0,
          uploaded: 0,
          status: 'error',
          errorKey: 'roomPlayer.upload.error.invalidSize',
        }));
        return;
      }

      const controller = new AbortController();
      cancelControllerRef.current = controller;
      versionIdRef.current = null;

      safeSetJob(() => ({
        fileName: file.name,
        fileSize: file.size,
        progress: 0,
        uploaded: 0,
        status: 'preparing',
      }));

      // 1) Init via Edge Function
      let init;
      try {
        init = await invokeRoomDeviceUploadInit({
          deviceToken,
          sessionId,
          filename: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });
      } catch (err) {
        if (controller.signal.aborted) {
          safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
          return;
        }
        const errorKey = mapErrorKey((err as Error).message);
        safeSetJob((prev) => (prev ? { ...prev, status: 'error', errorKey } : null));
        return;
      }
      versionIdRef.current = init.version_id;

      if (controller.signal.aborted) {
        await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
        versionIdRef.current = null;
        safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
        return;
      }

      // 2) Upload PUT diretto su Storage (signed URL) + 3) Hash in parallelo
      safeSetJob((prev) => (prev ? { ...prev, status: 'uploading', progress: 0, uploaded: 0 } : null));

      const supabase = getSupabaseBrowserClient();
      const hashAbort = new AbortController();
      // Se cancella l'utente, abortiamo anche l'hash worker.
      controller.signal.addEventListener('abort', () => hashAbort.abort(), { once: true });

      const sha256Promise = computeFileSha256(file, undefined, hashAbort.signal).catch((err) => {
        if ((err as DOMException).name === 'AbortError') return null;
        throw err;
      });

      // Upload con progress: usiamo `uploadToSignedUrl` di supabase-js v2.
      // Pero' supabase-js NON espone progress nativo: replichiamo con fetch
      // PUT + ReadableStream/upload-progress polyfill. Soluzione: uso fetch
      // direttamente sul signedUrl. Schema noto: PUT con header
      // `Authorization: Bearer <token>` e body file.
      const uploadPromise = (async () => {
        // Pattern signed URL Supabase Storage v3:
        // PUT https://...sign.../?token=<jwt>  body=<file bytes>
        // header: x-upsert: false, content-type, cache-control opzionale.
        // Fetch supporta upload progress solo via stream, ma su PUT body=File
        // non c'e' callback. Fallback: split in chunk via XHR (XMLHttpRequest)
        // che ha `upload.onprogress` nativo.
        return await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', init.signed_url, true);
          xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
          xhr.setRequestHeader('x-upsert', 'false');
          xhr.upload.onprogress = (ev) => {
            if (!ev.lengthComputable || controller.signal.aborted) return;
            const pct = ev.total > 0 ? ev.loaded / ev.total : 0;
            safeSetJob((prev) => prev ? { ...prev, progress: pct, uploaded: ev.loaded } : null);
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`storage_put_${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error('storage_put_network'));
          xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
          controller.signal.addEventListener('abort', () => xhr.abort(), { once: true });
          xhr.send(file);
        });
      })();

      try {
        await uploadPromise;
      } catch (err) {
        if (controller.signal.aborted || (err as DOMException)?.name === 'AbortError') {
          await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
          versionIdRef.current = null;
          safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
          return;
        }
        // Cleanup version orfana lato DB (best-effort)
        await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
        versionIdRef.current = null;
        safeSetJob((prev) => prev ? { ...prev, status: 'error', errorKey: 'roomPlayer.upload.error.network' } : null);
        return;
      }

      if (controller.signal.aborted) {
        await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
        versionIdRef.current = null;
        safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
        return;
      }

      // 3) Wait per SHA256 (gia' lavorato in parallelo)
      safeSetJob((prev) => prev ? { ...prev, status: 'hashing' } : null);
      const sha256 = await sha256Promise;
      if (!sha256) {
        // Hash abort — utente ha cancellato
        await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
        versionIdRef.current = null;
        safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
        return;
      }

      if (controller.signal.aborted) {
        await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
        versionIdRef.current = null;
        safeSetJob((prev) => (prev ? { ...prev, status: 'cancelled' } : null));
        return;
      }

      // 4) Finalize via Edge Function
      safeSetJob((prev) => prev ? { ...prev, status: 'finalizing' } : null);
      try {
        const result = await invokeRoomDeviceUploadFinalize({
          deviceToken,
          versionId: init.version_id,
          sha256,
        });
        versionIdRef.current = null;
        safeSetJob((prev) => prev ? {
          ...prev,
          status: 'done',
          progress: 1,
          uploaded: file.size,
        } : null);
        onCompleteRef.current?.({
          versionId: result.version_id,
          presentationId: result.presentation_id,
          fileName: result.file_name,
          sessionId: result.session_id,
        });
      } catch (err) {
        const errorKey = mapErrorKey((err as Error).message);
        // Su finalize fallita, version rimane 'uploading' lato DB. Tentiamo
        // abort esplicito cosi' non resta in stato sospeso.
        await invokeRoomDeviceUploadAbort({ deviceToken, versionId: init.version_id }).catch(() => undefined);
        versionIdRef.current = null;
        safeSetJob((prev) => prev ? { ...prev, status: 'error', errorKey } : null);
      }

      // Reference unused per futuro riuso
      void supabase;
    },
    [deviceToken, job, safeSetJob],
  );

  const busy = job?.status === 'preparing' || job?.status === 'uploading' ||
               job?.status === 'hashing' || job?.status === 'finalizing';

  return { job, busy: !!busy, upload, cancel, reset };
}
