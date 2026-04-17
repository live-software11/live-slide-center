import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Trash2, UploadCloud, X } from 'lucide-react';
import { formatBytes } from '@/features/upload-portal/lib/format-bytes';
import { computeFileSha256 } from '@/features/upload-portal/lib/sha256';
import { startTusUpload, type TusHandle } from '@/features/upload-portal/lib/tus-upload';
import {
  abortAdminUpload,
  createVersionDownloadUrl,
  deletePresentationAdmin,
  finalizeAdminUpload,
  initSessionUpload,
  type Presentation,
  type PresentationVersion,
} from '@/features/presentations/repository';
import { getSupabaseBrowserClient } from '@/lib/supabase';

interface SessionFilesPanelProps {
  sessionId: string;
  /** Nome sessione, per label drop-zone. */
  sessionTitle: string;
  /** True quando la sessione e' visibile (panel collapsed gestisce parent). */
  enabled: boolean;
}

interface FileRow {
  presentationId: string;
  versionId: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  storageKey: string;
  speakerName: string | null;
  status: PresentationVersion['status'];
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; uploaded: number; total: number; fileName: string }
  | { kind: 'hashing'; total: number; fileName: string }
  | { kind: 'finalizing'; fileName: string }
  | { kind: 'done' }
  | { kind: 'error'; messageKey: string };

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

export function SessionFilesPanel({ sessionId, sessionTitle, enabled }: SessionFilesPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const supabaseUrl = useMemo(() => import.meta.env.VITE_SUPABASE_URL as string, []);
  const anonKey = useMemo(() => import.meta.env.VITE_SUPABASE_ANON_KEY as string, []);

  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const tusRef = useRef<TusHandle | null>(null);
  const hashAbortRef = useRef<AbortController | null>(null);
  const versionIdRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);

  const loadFiles = useCallback(async () => {
    if (!enabled || !sessionId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: presentations, error: pErr } = await supabase
        .from('presentations')
        .select('id, speaker_id, current_version_id')
        .eq('session_id', sessionId);
      if (pErr) throw pErr;

      const presList = (presentations ?? []) as Pick<Presentation, 'id' | 'speaker_id' | 'current_version_id'>[];
      if (presList.length === 0) {
        setFiles([]);
        return;
      }

      const presIds = presList.map((p) => p.id);
      const speakerIds = presList
        .map((p) => p.speaker_id)
        .filter((id): id is string => typeof id === 'string');

      const [{ data: versions, error: vErr }, { data: speakers, error: sErr }] = await Promise.all([
        supabase
          .from('presentation_versions')
          .select('id, presentation_id, file_name, file_size_bytes, created_at, storage_key, status')
          .in('presentation_id', presIds)
          .order('created_at', { ascending: false }),
        speakerIds.length > 0
          ? supabase.from('speakers').select('id, full_name').in('id', speakerIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (vErr) throw vErr;
      if (sErr) throw sErr;

      const speakerNameById = new Map<string, string>(
        (speakers ?? []).map((s) => [s.id as string, s.full_name as string]),
      );

      const versionsList = (versions ?? []) as Array<{
        id: string;
        presentation_id: string;
        file_name: string;
        file_size_bytes: number;
        created_at: string;
        storage_key: string;
        status: PresentationVersion['status'];
      }>;

      const presentationById = new Map(presList.map((p) => [p.id, p]));

      const rows: FileRow[] = versionsList
        .map((v) => {
          const pres = presentationById.get(v.presentation_id);
          if (!pres) return null;
          // Mostriamo solo la versione corrente (per non confondere con storico)
          if (pres.current_version_id && pres.current_version_id !== v.id) return null;
          // Se la presentation non ha current_version_id ma v non e' 'ready', skip:
          // potrebbe essere upload in corso o fallito.
          if (!pres.current_version_id && v.status !== 'ready') return null;
          const speakerName = pres.speaker_id ? speakerNameById.get(pres.speaker_id) ?? null : null;
          return {
            presentationId: pres.id,
            versionId: v.id,
            fileName: v.file_name,
            fileSize: v.file_size_bytes,
            createdAt: v.created_at,
            storageKey: v.storage_key,
            speakerName,
            status: v.status,
          };
        })
        .filter((r): r is FileRow => r !== null)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      if (mountedRef.current) setFiles(rows);
    } catch (e) {
      if (mountedRef.current) setLoadError((e as { message?: string })?.message ?? 'load_failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      tusRef.current?.abort();
      hashAbortRef.current?.abort();
      const orphan = versionIdRef.current;
      if (orphan) void abortAdminUpload(orphan).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const safeSetState = useCallback((next: UploadState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const startUpload = useCallback(
    async (file: File) => {
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        if (!supabaseUrl || !anonKey) {
          safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorConfig' });
          return;
        }

        safeSetState({ kind: 'uploading', uploaded: 0, total: file.size, fileName: file.name });

        let init;
        try {
          init = await initSessionUpload({
            sessionId,
            filename: file.name,
            size: file.size,
            mime: file.type || 'application/octet-stream',
          });
        } catch (err) {
          safeSetState({ kind: 'error', messageKey: mapErrorKey((err as { message?: string })?.message) });
          return;
        }
        versionIdRef.current = init.version_id;

        const hashAbort = new AbortController();
        hashAbortRef.current = hashAbort;
        const sha256Promise = computeFileSha256(file, undefined, hashAbort.signal).catch((err) => {
          if ((err as DOMException).name === 'AbortError') return null;
          throw err;
        });

        const uploadPromise = new Promise<void>((resolve, reject) => {
          tusRef.current = startTusUpload({
            supabaseUrl,
            anonKey,
            bucket: init.bucket,
            objectName: init.storage_key,
            file,
            onProgress: (uploaded, total) => {
              safeSetState({ kind: 'uploading', uploaded, total, fileName: file.name });
            },
            onSuccess: () => resolve(),
            onError: (err) => reject(err),
          });
        });

        try {
          await uploadPromise;
        } catch {
          safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorNetwork' });
          try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
          versionIdRef.current = null;
          return;
        }

        safeSetState({ kind: 'hashing', total: file.size, fileName: file.name });
        const sha256 = await sha256Promise;
        if (!sha256) {
          safeSetState({ kind: 'error', messageKey: 'presentation.adminUpload.errorGeneric' });
          try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
          versionIdRef.current = null;
          return;
        }

        safeSetState({ kind: 'finalizing', fileName: file.name });
        try {
          await finalizeAdminUpload(init.version_id, sha256);
        } catch (err) {
          safeSetState({ kind: 'error', messageKey: mapErrorKey((err as { message?: string })?.message) });
          try { await abortAdminUpload(init.version_id); } catch { /* noop */ }
          versionIdRef.current = null;
          return;
        }

        versionIdRef.current = null;
        safeSetState({ kind: 'done' });
        await loadFiles();
        // Reset transitorio dopo 1.5s per non lasciare il "done" sticky
        window.setTimeout(() => {
          if (mountedRef.current && state.kind === 'done') safeSetState({ kind: 'idle' });
        }, 1500);
      } finally {
        startingRef.current = false;
      }
    },
    [anonKey, loadFiles, safeSetState, sessionId, state.kind, supabaseUrl],
  );

  const onPick = useCallback(
    (file: File | null) => {
      if (!file) return;
      void startUpload(file);
    },
    [startUpload],
  );

  const onDownload = useCallback(async (storageKey: string, versionId: string) => {
    setActionBusy(`dl:${versionId}`);
    try {
      const url = await createVersionDownloadUrl(storageKey);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setActionBusy(null);
    }
  }, []);

  const onDelete = useCallback(
    async (presentationId: string) => {
      setActionBusy(`del:${presentationId}`);
      try {
        await deletePresentationAdmin(presentationId);
        setPendingDelete(null);
        await loadFiles();
      } finally {
        setActionBusy(null);
      }
    },
    [loadFiles],
  );

  const busy =
    state.kind === 'uploading' || state.kind === 'hashing' || state.kind === 'finalizing';

  if (!enabled) return null;

  return (
    <div className="mt-3 rounded-xl border border-sc-primary/12 bg-sc-bg/40 p-3 space-y-3">
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
          onPick(dropped);
        }}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-center transition ${
          dragOver
            ? 'border-sc-primary bg-sc-primary/15'
            : 'border-sc-primary/20 bg-sc-surface/40'
        } ${busy ? 'opacity-60' : ''}`}
      >
        <UploadCloud className="h-5 w-5 text-sc-primary" aria-hidden="true" />
        <p className="text-xs font-medium text-sc-text">
          {t('sessionFiles.dropTitle', { name: sessionTitle })}
        </p>
        <p className="text-[11px] text-sc-text-dim">{t('sessionFiles.dropHint')}</p>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = '';
            onPick(f);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-sc-primary/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('sessionFiles.pickFile')}
        </button>
      </div>

      {state.kind === 'uploading' ? (
        <UploadProgress
          uploaded={state.uploaded}
          total={state.total}
          locale={locale}
          label={t('presentation.adminUpload.uploading', { defaultValue: 'Upload…' })}
          fileName={state.fileName}
        />
      ) : state.kind === 'hashing' ? (
        <p className="text-[11px] text-sc-text-muted">
          {t('presentation.adminUpload.hashing', { defaultValue: 'Calcolo hash…' })} — {state.fileName}
        </p>
      ) : state.kind === 'finalizing' ? (
        <p className="text-[11px] text-sc-text-muted">
          {t('presentation.adminUpload.finalizing', { defaultValue: 'Finalizzazione…' })} — {state.fileName}
        </p>
      ) : state.kind === 'done' ? (
        <p className="text-[11px] text-sc-success">{t('sessionFiles.uploadDone')}</p>
      ) : state.kind === 'error' ? (
        <div className="flex items-start justify-between gap-2 rounded border border-sc-danger/20 bg-sc-danger/10 px-2.5 py-1.5 text-[11px] text-sc-danger">
          <span>{t(state.messageKey)}</span>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setState({ kind: 'idle' })}
            className="text-sc-danger hover:text-sc-danger/80"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : null}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-sc-text-muted">
          {t('sessionFiles.listTitle', { count: files.length })}
        </h4>
        {loading && files.length === 0 ? (
          <p className="mt-2 text-xs text-sc-text-dim">{t('common.loading')}</p>
        ) : loadError ? (
          <p className="mt-2 text-xs text-sc-danger">{loadError}</p>
        ) : files.length === 0 ? (
          <p className="mt-2 text-xs text-sc-text-dim">{t('sessionFiles.empty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-sc-primary/12 rounded border border-sc-primary/12">
            {files.map((f) => (
              <li key={f.versionId} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="break-all text-sm text-sc-text" title={f.fileName}>
                    {f.fileName}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-sc-text-dim">
                    <span>{dateTimeFmt.format(new Date(f.createdAt))}</span>
                    <span>·</span>
                    <span>{formatBytes(f.fileSize, locale)}</span>
                    {f.speakerName ? (
                      <>
                        <span>·</span>
                        <span className="rounded-full border border-sc-primary/20 bg-sc-surface px-1.5 py-0.5 text-[10px] text-sc-text-muted">
                          {t('sessionFiles.bySpeaker', { name: f.speakerName })}
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={actionBusy === `dl:${f.versionId}`}
                    onClick={() => void onDownload(f.storageKey, f.versionId)}
                    className="inline-flex items-center gap-1 rounded-xl border border-sc-primary/20 px-2 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:opacity-50"
                  >
                    <Download className="h-3 w-3" />
                    {t('sessionFiles.download')}
                  </button>
                  {pendingDelete === f.presentationId ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={actionBusy === `del:${f.presentationId}`}
                        onClick={() => void onDelete(f.presentationId)}
                        className="rounded-xl bg-sc-danger px-2 py-1 text-xs font-medium text-white hover:bg-sc-danger/80 disabled:opacity-50"
                      >
                        {t('common.confirmDelete')}
                      </button>
                      <button
                        type="button"
                        disabled={actionBusy === `del:${f.presentationId}`}
                        onClick={() => setPendingDelete(null)}
                        className="rounded-xl border border-sc-primary/20 px-2 py-1 text-xs text-sc-text-secondary hover:bg-sc-elevated"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(f.presentationId)}
                      aria-label={t('sessionFiles.deleteAria', { name: f.fileName })}
                      className="inline-flex items-center gap-1 rounded-xl border border-sc-danger/30 px-2 py-1 text-xs text-sc-danger hover:bg-sc-danger/10"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('common.delete')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function UploadProgress({
  uploaded,
  total,
  locale,
  label,
  fileName,
}: {
  uploaded: number;
  total: number;
  locale: string;
  label: string;
  fileName: string;
}) {
  const pct = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-sc-text-muted">
        <span className="truncate">
          {label} · {fileName}
        </span>
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
