import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadCloud, X } from 'lucide-react';
import { formatBytes } from '@/features/upload-portal/lib/format-bytes';
import { computeFileSha256 } from '@/features/upload-portal/lib/sha256';
import { startSimpleUpload, type SimpleUploadHandle } from '@/features/upload-portal/lib/simple-upload';
import { startTusUpload, type TusHandle } from '@/features/upload-portal/lib/tus-upload';
import {
  abortAdminUpload,
  finalizeAdminUpload,
  initAdminUpload,
} from '@/features/presentations/repository';
import { getBackendMode } from '@/lib/backend-mode';
import { getCachedDesktopBackendInfo } from '@/lib/desktop-backend-init';
import { getSupabaseBrowserClient } from '@/lib/supabase';

// Sprint X-1 (parita' UX desktop): handle generico TUS o SimpleUpload — vedi
// `useUploadQueue.ts` per il razionale dietro la ramificazione cloud/desktop.
type UploadHandleAny = TusHandle | SimpleUploadHandle;

// Upload diretto da admin/coordinator tenant per uno specifico speaker.
// Riusa lo stack TUS di Fase 3, ma chiama le RPC *_admin che validano
// tenant_id dal JWT (no upload_token speaker richiesto).

interface AdminUploaderInlineProps {
  speakerId: string;
  speakerName: string;
  onUploaded?: () => void;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; uploaded: number; total: number }
  | { kind: 'hashing'; total: number }
  | { kind: 'finalizing' }
  | { kind: 'done' }
  | { kind: 'error'; messageKey: string; params?: Record<string, string> };

const ERROR_MAP: Record<string, string> = {
  file_too_large: 'presentation.adminUpload.errorTooLarge',
  storage_quota_exceeded: 'presentation.adminUpload.errorQuotaExceeded',
  speaker_not_found_or_cross_tenant: 'presentation.adminUpload.errorSpeakerInvalid',
  no_tenant_in_jwt: 'presentation.adminUpload.errorTenantMissing',
  role_forbidden: 'presentation.adminUpload.errorRoleForbidden',
  tenant_suspended: 'presentation.adminUpload.errorTenantSuspended',
  event_closed_or_archived: 'presentation.adminUpload.errorEventClosed',
  filename_too_long: 'presentation.adminUpload.errorFilenameTooLong',
  invalid_input: 'presentation.adminUpload.errorGeneric',
  invalid_sha256: 'presentation.adminUpload.errorGeneric',
  version_not_uploading: 'presentation.adminUpload.errorGeneric',
  object_missing: 'presentation.adminUpload.errorObjectMissing',
};

export function AdminUploaderInline({
  speakerId,
  speakerName,
  onUploaded,
}: AdminUploaderInlineProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';

  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadHandleRef = useRef<UploadHandleAny | null>(null);
  const hashAbortRef = useRef<AbortController | null>(null);
  const versionIdRef = useRef<string | null>(null);
  // Guard anti-double-submit: bloccca prima che setState propaghi.
  const startingRef = useRef(false);
  // Tracker mount: evita warning "setState on unmounted" se l'utente naviga via.
  const mountedRef = useRef(true);

  const supabaseUrl = useMemo(() => import.meta.env.VITE_SUPABASE_URL as string, []);
  const anonKey = useMemo(() => import.meta.env.VITE_SUPABASE_ANON_KEY as string, []);
  const backendMode = useMemo(() => getBackendMode(), []);

  const cancelEverything = useCallback(() => {
    uploadHandleRef.current?.abort();
    uploadHandleRef.current = null;
    hashAbortRef.current?.abort();
    hashAbortRef.current = null;
  }, []);

  // Cleanup completo all'unmount: abort upload + hash, e abort anche lato server
  // per non lasciare presentation_versions in stato 'uploading' orfane.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      uploadHandleRef.current?.abort();
      uploadHandleRef.current = null;
      hashAbortRef.current?.abort();
      hashAbortRef.current = null;
      const orphanVersionId = versionIdRef.current;
      if (orphanVersionId) {
        // fire-and-forget: best effort, non possiamo attendere su unmount
        void abortAdminUpload(orphanVersionId).catch(() => undefined);
        versionIdRef.current = null;
      }
    };
  }, []);

  const safeSetState = useCallback((next: UploadState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const reset = useCallback(() => {
    cancelEverything();
    setFile(null);
    setState({ kind: 'idle' });
    versionIdRef.current = null;
  }, [cancelEverything]);

  const handlePick = useCallback((f: File | null) => {
    if (!f) return;
    setFile(f);
    setState({ kind: 'idle' });
  }, []);

  const mapError = useCallback((rawMessage: string | undefined): { messageKey: string } => {
    const msg = rawMessage ?? '';
    for (const [code, key] of Object.entries(ERROR_MAP)) {
      if (msg.includes(code)) return { messageKey: key };
    }
    return { messageKey: 'presentation.adminUpload.errorGeneric' };
  }, []);

  const startUpload = useCallback(async () => {
    if (!file) return;
    // Guard anti-doppio-click: blocca prima che lo state-setter propaghi.
    if (startingRef.current) return;
    startingRef.current = true;
    try {
      // Sprint X-1: validazione config differenziata cloud vs desktop.
      // - cloud: serve VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (build Vercel)
      // - desktop: serve `getCachedDesktopBackendInfo()` popolato (gia' fatto da
      //   `ensureDesktopBackendReady()` in main.tsx pre-render)
      if (backendMode === 'desktop') {
        const info = getCachedDesktopBackendInfo();
        if (!info?.base_url || !info?.admin_token) {
          safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorConfig' });
          return;
        }
      } else if (!supabaseUrl || !anonKey) {
        safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorConfig' });
        return;
      }

      safeSetState({ kind: 'uploading', uploaded: 0, total: file.size });

      let init;
      try {
        init = await initAdminUpload({
          speakerId,
          filename: file.name,
          size: file.size,
          mime: file.type || 'application/octet-stream',
        });
      } catch (err) {
        safeSetState({ kind: 'error', ...mapError((err as { message?: string })?.message) });
        return;
      }
      versionIdRef.current = init.version_id;

      const hashAbort = new AbortController();
      hashAbortRef.current = hashAbort;
      const sha256Promise = computeFileSha256(file, undefined, hashAbort.signal).catch((err) => {
        if ((err as DOMException).name === 'AbortError') return null;
        throw err;
      });

      // Sprint X-1 (audit chirurgico upload, 19 aprile 2026):
      // ramificazione cloud (TUS resumable) vs desktop (simple POST).
      // Vedi commenti dettagliati in `useUploadQueue.ts` runJob.
      const uploadPromise = new Promise<void>((resolve, reject) => {
        const onProgress = (uploaded: number, total: number) => {
          safeSetState({ kind: 'uploading', uploaded, total });
        };

        if (backendMode === 'desktop') {
          const info = getCachedDesktopBackendInfo();
          if (!info?.base_url || !info?.admin_token) {
            reject(new Error('desktop_backend_not_ready'));
            return;
          }
          uploadHandleRef.current = startSimpleUpload({
            baseUrl: info.base_url,
            adminToken: info.admin_token,
            bucket: init.bucket,
            objectName: init.storage_key,
            file,
            onProgress,
            onSuccess: () => resolve(),
            onError: (err) => reject(err),
          });
        } else {
          // Cloud: JWT authenticated come Bearer TUS (vedi tus-upload.ts).
          const supabaseClient = getSupabaseBrowserClient();
          supabaseClient.auth.getSession().then(({ data: sessionData }) => {
            const accessToken = sessionData.session?.access_token ?? null;
            uploadHandleRef.current = startTusUpload({
              supabaseUrl,
              anonKey,
              accessToken,
              bucket: init.bucket,
              objectName: init.storage_key,
              file,
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
        safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorNetwork' });
        try {
          await abortAdminUpload(init.version_id);
        } catch {
          // best-effort
        }
        versionIdRef.current = null;
        return;
      }

      safeSetState({ kind: 'hashing', total: file.size });
      const sha256 = await sha256Promise;
      if (!sha256) {
        safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorGeneric' });
        try {
          await abortAdminUpload(init.version_id);
        } catch {
          // best-effort
        }
        versionIdRef.current = null;
        return;
      }

      safeSetState({ kind: 'finalizing' });
      try {
        await finalizeAdminUpload(init.version_id, sha256);
      } catch (err) {
        safeSetState({ kind: 'error', ...mapError((err as { message?: string })?.message) });
        try {
          await abortAdminUpload(init.version_id);
        } catch {
          // best-effort
        }
        versionIdRef.current = null;
        return;
      }

      versionIdRef.current = null;
      safeSetState({ kind: 'done' });
      if (mountedRef.current) setFile(null);
      onUploaded?.();
    } finally {
      startingRef.current = false;
    }
  }, [anonKey, backendMode, file, mapError, onUploaded, safeSetState, speakerId, supabaseUrl]);

  const busy =
    state.kind === 'uploading' || state.kind === 'hashing' || state.kind === 'finalizing';

  const onCancel = useCallback(() => {
    cancelEverything();
    if (versionIdRef.current) {
      void abortAdminUpload(versionIdRef.current).catch(() => { });
      versionIdRef.current = null;
    }
    setState({ kind: 'idle' });
  }, [cancelEverything]);

  return (
    <div
      className="space-y-2 rounded-xl border border-dashed border-sc-primary/30 bg-sc-bg/40 p-3"
      data-testid="admin-uploader-inline"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-sc-text-muted">
          {t('presentation.adminUpload.sectionTitle')}
        </p>
        {state.kind === 'done' ? (
          <span className="rounded border border-sc-success/30 bg-sc-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sc-success">
            {t('presentation.adminUpload.uploaded')}
          </span>
        ) : null}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (busy) return;
          const dropped = e.dataTransfer.files?.[0] ?? null;
          handlePick(dropped);
        }}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-center transition ${dragOver
          ? 'border-sc-primary bg-sc-primary/15'
          : 'border-sc-primary/20 bg-sc-surface/40'
          } ${busy ? 'opacity-60' : ''}`}
      >
        <UploadCloud className="h-5 w-5 text-sc-primary" aria-hidden="true" />
        {file ? (
          <div className="space-y-0.5 text-xs">
            <p className="truncate font-medium text-sc-text" title={file.name}>
              {file.name}
            </p>
            <p className="text-[11px] text-sc-text-dim">
              {formatBytes(file.size, locale)} · {file.type || 'application/octet-stream'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            <p className="text-xs font-medium text-sc-text">
              {t('presentation.adminUpload.dropTitle', { name: speakerName })}
            </p>
            <p className="text-[11px] text-sc-text-dim">{t('presentation.adminUpload.dropHint')}</p>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={busy}
          onChange={(e) => handlePick(e.target.files?.[0] ?? null)}
        />
        <div className="mt-1 flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border border-sc-primary/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:cursor-not-allowed disabled:opacity-50"
          >
            {file
              ? t('presentation.adminUpload.replaceFile')
              : t('presentation.adminUpload.selectFile')}
          </button>
          {file && state.kind !== 'done' ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void startUpload()}
              className="rounded-xl bg-sc-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('presentation.adminUpload.startUpload')}
            </button>
          ) : null}
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-xl border border-sc-danger/30 px-2 py-1 text-xs text-sc-danger hover:bg-sc-danger/10"
              aria-label={t('presentation.adminUpload.cancel')}
            >
              <X className="h-3 w-3" />
              {t('presentation.adminUpload.cancel')}
            </button>
          ) : null}
        </div>
      </div>

      {state.kind === 'error' ? (
        <p className="rounded border border-sc-danger/20 bg-sc-danger/10 px-2.5 py-1.5 text-[11px] text-sc-danger">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      {state.kind === 'uploading' ? (
        <UploadProgress
          uploaded={state.uploaded}
          total={state.total}
          locale={locale}
          label={t('presentation.adminUpload.uploading')}
        />
      ) : null}
      {state.kind === 'hashing' ? (
        <p className="text-[11px] text-sc-text-muted">{t('presentation.adminUpload.hashing')}</p>
      ) : null}
      {state.kind === 'finalizing' ? (
        <p className="text-[11px] text-sc-text-muted">{t('presentation.adminUpload.finalizing')}</p>
      ) : null}
      {state.kind === 'done' ? (
        <button
          type="button"
          className="text-[11px] font-medium text-sc-primary hover:underline"
          onClick={reset}
        >
          {t('presentation.adminUpload.uploadAnother')}
        </button>
      ) : null}
    </div>
  );
}

function UploadProgress({
  uploaded,
  total,
  locale,
  label,
}: {
  uploaded: number;
  total: number;
  locale: string;
  label: string;
}) {
  const pct = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-[11px] text-sc-text-muted">
        <span>{label}</span>
        <span>
          {pct}% · {formatBytes(uploaded, locale)} / {formatBytes(total, locale)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-sc-elevated">
        <div
          className="h-full bg-sc-primary transition-[width]"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}
