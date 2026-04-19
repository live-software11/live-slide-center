import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatBytes } from './lib/format-bytes';
import { computeFileSha256 } from './lib/sha256';
import { startTusUpload, type TusHandle } from './lib/tus-upload';

// Portale pubblico `/u/:token` — Fase 3.
// Flusso: validate_upload_token → selezione file → init_upload_version (RPC) →
// TUS upload verso Supabase Storage → computeSha256 client-side → finalize_upload_version.

type ValidateResult =
  | {
    valid: true;
    speaker_id: string;
    speaker_name: string;
    session_id: string;
    session_title: string;
    scheduled_start: string | null;
    event_id: string;
    event_name: string;
    event_start_date: string | null;
    event_end_date: string | null;
    max_file_size_bytes: number | null;
    storage_remaining_bytes: number | null;
    expires_at: string | null;
  }
  | { valid: false; reason?: 'invalid_token' | 'not_found' | 'expired' };

interface InitResult {
  version_id: string;
  presentation_id: string;
  storage_key: string;
  bucket: string;
}

type UploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; uploaded: number; total: number }
  | { kind: 'hashing'; hashed: number; total: number }
  | { kind: 'finalizing' }
  | { kind: 'done'; versionNumber: number | null }
  | { kind: 'error'; messageKey: string; params?: Record<string, string> };

export default function UploadPortalView() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [validation, setValidation] = useState<ValidateResult | null>(null);
  const [validationLoading, setValidationLoading] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<UploadState>({ kind: 'idle' });

  const tusRef = useRef<TusHandle | null>(null);
  const hashAbortRef = useRef<AbortController | null>(null);
  // Conserva il version_id corrente per cleanup su cancel/unmount.
  // Se non chiamiamo abort_upload_version la riga resta 'uploading' eterna,
  // tenant.storage_used_bytes "prenota" la quota e l'orfano puo' essere
  // ripreso erroneamente da un futuro upload con stesso fingerprint TUS.
  const currentVersionIdRef = useRef<string | null>(null);

  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token || token.length < 16) {
        if (!cancelled) {
          setValidation({ valid: false, reason: 'invalid_token' });
          setValidationLoading(false);
        }
        return;
      }
      try {
        const { data, error } = await supabase.rpc('validate_upload_token', { p_token: token });
        if (cancelled) return;
        if (error) {
          setValidation({ valid: false });
        } else {
          setValidation(data as unknown as ValidateResult);
        }
      } catch {
        if (!cancelled) setValidation({ valid: false });
      } finally {
        if (!cancelled) setValidationLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, token]);

  const handlePick = useCallback(
    (f: File | null) => {
      if (!f || !validation || !validation.valid) return;
      if (validation.max_file_size_bytes != null && f.size > validation.max_file_size_bytes) {
        setState({
          kind: 'error',
          messageKey: 'uploadPortal.errorTooLarge',
          params: { size: formatBytes(validation.max_file_size_bytes, locale) },
        });
        setFile(null);
        return;
      }
      if (
        validation.storage_remaining_bytes != null &&
        f.size > validation.storage_remaining_bytes
      ) {
        setState({ kind: 'error', messageKey: 'uploadPortal.errorQuotaExceeded' });
        setFile(null);
        return;
      }
      setFile(f);
      setState({ kind: 'idle' });
    },
    [validation, locale],
  );

  const cancelEverything = useCallback(() => {
    tusRef.current?.abort();
    tusRef.current = null;
    hashAbortRef.current?.abort();
    hashAbortRef.current = null;
    // Best-effort: chiama abort_upload_version per liberare la version
    // 'uploading' lato DB. Non blocca la UI, errore ignorato (nel worst
    // case rimane orfana e verra' marcata 'failed' dal cleanup periodico).
    const versionToAbort = currentVersionIdRef.current;
    const tokenToUse = token;
    if (versionToAbort && tokenToUse) {
      currentVersionIdRef.current = null;
      void supabase
        .rpc('abort_upload_version', {
          p_token: tokenToUse,
          p_version_id: versionToAbort,
        })
        .then(({ error }) => {
          if (error) {
            console.warn('[UploadPortal] abort_upload_version failed', error.message);
          }
        });
    }
  }, [supabase, token]);

  useEffect(() => () => cancelEverything(), [cancelEverything]);

  const startUpload = useCallback(async () => {
    if (!token || !file || !validation || !validation.valid) return;

    // 1) init draft version via RPC
    setState({ kind: 'uploading', uploaded: 0, total: file.size });
    let init: InitResult;
    try {
      const { data, error } = await supabase.rpc('init_upload_version', {
        p_token: token,
        p_filename: file.name,
        p_size: file.size,
        p_mime: file.type || 'application/octet-stream',
      });
      if (error || !data) throw error ?? new Error('init_failed');
      init = data as unknown as InitResult;
      currentVersionIdRef.current = init.version_id;
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? '';
      if (msg.includes('file_too_large')) {
        setState({
          kind: 'error',
          messageKey: 'uploadPortal.errorTooLarge',
          params: {
            size: formatBytes(validation.max_file_size_bytes ?? undefined, locale),
          },
        });
      } else if (msg.includes('storage_quota_exceeded')) {
        setState({ kind: 'error', messageKey: 'uploadPortal.errorQuotaExceeded' });
      } else {
        setState({ kind: 'error', messageKey: 'uploadPortal.errorInitFailed' });
      }
      return;
    }

    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

    // 2) compute SHA-256 in parallelo all'upload TUS
    const hashAbort = new AbortController();
    hashAbortRef.current = hashAbort;
    const sha256Promise = computeFileSha256(file, undefined, hashAbort.signal).catch((err) => {
      if ((err as DOMException).name === 'AbortError') return null;
      throw err;
    });

    // 3) upload TUS
    const uploadPromise = new Promise<void>((resolve, reject) => {
      tusRef.current = startTusUpload({
        supabaseUrl,
        anonKey,
        bucket: init.bucket,
        objectName: init.storage_key,
        file,
        onProgress: (uploaded, total) => {
          setState({ kind: 'uploading', uploaded, total });
        },
        onSuccess: () => resolve(),
        onError: (err) => reject(err),
      });
    });

    try {
      await uploadPromise;
    } catch {
      setState({ kind: 'error', messageKey: 'uploadPortal.errorNetwork' });
      currentVersionIdRef.current = null;
      // best-effort cleanup server-side
      await supabase.rpc('abort_upload_version', {
        p_token: token,
        p_version_id: init.version_id,
      });
      return;
    }

    // 4) attende hash se non ancora pronto
    setState({ kind: 'hashing', hashed: 0, total: file.size });
    const sha256 = await sha256Promise;
    if (!sha256) {
      setState({ kind: 'error', messageKey: 'uploadPortal.errorGeneric' });
      return;
    }

    // 5) finalize
    setState({ kind: 'finalizing' });
    try {
      const { error } = await supabase.rpc('finalize_upload_version', {
        p_token: token,
        p_version_id: init.version_id,
        p_sha256: sha256,
      });
      if (error) throw error;
      currentVersionIdRef.current = null;
    } catch {
      setState({ kind: 'error', messageKey: 'uploadPortal.errorFinalizeFailed' });
      return;
    }

    // Recupera il version_number effettivo per UX (best-effort: ignorabile)
    let versionNumber: number | null = null;
    try {
      const { data } = await supabase
        .from('presentation_versions')
        .select('version_number')
        .eq('id', init.version_id)
        .maybeSingle();
      versionNumber = (data?.version_number as number | undefined) ?? null;
    } catch {
      // ignore
    }

    setState({ kind: 'done', versionNumber });
  }, [file, locale, supabase, token, validation]);

  const resetForAnother = useCallback(() => {
    cancelEverything();
    setFile(null);
    setState({ kind: 'idle' });
  }, [cancelEverything]);

  // ── Rendering ────────────────────────────────────────────────────────

  if (validationLoading) {
    return (
      <Shell>
        <p className="text-sm text-sc-text-muted">{t('uploadPortal.validating')}</p>
      </Shell>
    );
  }

  if (!validation || !validation.valid) {
    const reason = validation && !validation.valid ? validation.reason : undefined;
    const reasonKey =
      reason === 'invalid_token'
        ? 'uploadPortal.invalidReasonInvalidToken'
        : reason === 'not_found'
          ? 'uploadPortal.invalidReasonNotFound'
          : reason === 'expired'
            ? 'uploadPortal.invalidReasonExpired'
            : 'uploadPortal.invalidGeneric';
    return (
      <Shell>
        <h1 className="text-xl font-semibold tracking-tight text-sc-danger">
          {t('uploadPortal.invalidTitle')}
        </h1>
        <p className="mt-3 text-sm text-sc-text-muted">{t(reasonKey)}</p>
        <p className="mt-6">
          <Link
            to="/login"
            className="text-sm font-medium text-sc-primary hover:text-sc-primary hover:underline"
          >
            {t('uploadPortal.goToLogin')} →
          </Link>
        </p>
      </Shell>
    );
  }

  const v = validation;

  if (state.kind === 'done') {
    return (
      <Shell>
        <p className="text-xs font-semibold uppercase tracking-wide text-sc-success">
          {t('uploadPortal.badge')}
        </p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">
          {t('uploadPortal.successTitle')}
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-sc-text-muted">
          {t('uploadPortal.successBody', { version: state.versionNumber ?? '?' })}
        </p>
        <button
          type="button"
          onClick={resetForAnother}
          className="mt-6 inline-flex items-center rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80"
        >
          {t('uploadPortal.uploadAnother')}
        </button>
      </Shell>
    );
  }

  const busy =
    state.kind === 'uploading' || state.kind === 'hashing' || state.kind === 'finalizing';

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-wide text-sc-primary/90">
        {t('uploadPortal.badge')}
      </p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight">{t('uploadPortal.pageTitle')}</h1>
      <p className="mt-3 text-sm leading-relaxed text-sc-text-muted">{t('uploadPortal.intro')}</p>

      <dl className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-4 text-sm">
        <Row label={t('uploadPortal.speakerLabel')} value={v.speaker_name} />
        <Row label={t('uploadPortal.eventLabel')} value={v.event_name} />
        <Row label={t('uploadPortal.sessionLabel')} value={v.session_title} />
        {v.scheduled_start ? (
          <Row
            label={t('uploadPortal.scheduledLabel')}
            value={new Intl.DateTimeFormat(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(v.scheduled_start))}
          />
        ) : null}
      </dl>

      <p className="mt-4 text-xs text-sc-text-dim">
        {t('uploadPortal.maxFileSize', {
          size: formatBytes(v.max_file_size_bytes ?? undefined, locale),
        })}
        {v.storage_remaining_bytes != null ? (
          <>
            {' '}
            ·{' '}
            {t('uploadPortal.storageRemaining', {
              size: formatBytes(v.storage_remaining_bytes, locale),
            })}
          </>
        ) : null}
      </p>

      <div className="mt-6">
        <DropZone
          file={file}
          disabled={busy}
          onPick={handlePick}
          labelTitle={t('uploadPortal.dropzoneTitle')}
          labelHint={t('uploadPortal.dropzoneHint')}
          labelSelect={file ? t('uploadPortal.replaceFile') : t('uploadPortal.selectFile')}
          locale={locale}
        />
      </div>

      {state.kind === 'error' ? (
        <p className="mt-4 rounded-xl border border-sc-danger/20 bg-sc-danger/10 px-3 py-2 text-sm text-sc-danger">
          {t(state.messageKey, state.params)}
        </p>
      ) : null}

      {state.kind === 'uploading' ? (
        <Progress
          label={t('uploadPortal.uploading')}
          uploaded={state.uploaded}
          total={state.total}
          locale={locale}
          t={t}
        />
      ) : null}
      {state.kind === 'hashing' ? (
        <p className="mt-4 text-sm text-sc-text-muted">{t('uploadPortal.hashing')}</p>
      ) : null}
      {state.kind === 'finalizing' ? (
        <p className="mt-4 text-sm text-sc-text-muted">{t('uploadPortal.finalizing')}</p>
      ) : null}

      <p className="mt-4 text-xs text-sc-text-dim">{t('uploadPortal.noticeResumable')}</p>

      <div className="mt-6 flex gap-3">
        <button
          type="button"
          disabled={!file || busy}
          onClick={startUpload}
          className="inline-flex items-center rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:cursor-not-allowed disabled:bg-sc-elevated disabled:text-sc-text-dim"
        >
          {t('uploadPortal.startUpload')}
        </button>
        {busy ? (
          <button
            type="button"
            onClick={() => {
              cancelEverything();
              setState({ kind: 'idle' });
            }}
            className="inline-flex items-center rounded-xl border border-sc-primary/20 px-4 py-2 text-sm font-medium text-sc-text hover:bg-sc-elevated"
          >
            {t('uploadPortal.cancelUpload')}
          </button>
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg px-4 py-12 text-sc-text">
      <div className="w-full max-w-xl rounded-xl border border-sc-primary/12 bg-sc-surface p-6 lg:p-8 shadow-xl">
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs uppercase tracking-wide text-sc-text-dim">{label}</dt>
      <dd className="truncate text-right text-sc-text">{value}</dd>
    </div>
  );
}

function DropZone({
  file,
  disabled,
  onPick,
  labelTitle,
  labelHint,
  labelSelect,
  locale,
}: {
  file: File | null;
  disabled: boolean;
  onPick: (f: File | null) => void;
  labelTitle: string;
  labelHint: string;
  labelSelect: string;
  locale: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (disabled) return;
        const dropped = e.dataTransfer.files?.[0] ?? null;
        onPick(dropped);
      }}
      className={`rounded-xl border-2 border-dashed p-6 text-center transition ${dragOver ? 'border-sc-primary bg-sc-primary/20' : 'border-sc-primary/20 bg-sc-bg/40'
        } ${disabled ? 'opacity-60' : ''}`}
    >
      {file ? (
        <div className="space-y-1 text-sm">
          <p className="truncate font-medium text-sc-text">{file.name}</p>
          <p className="text-xs text-sc-text-dim">
            {formatBytes(file.size, locale)} · {file.type || 'application/octet-stream'}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm font-medium text-sc-text">{labelTitle}</p>
          <p className="text-xs text-sc-text-dim">{labelHint}</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-4 inline-flex items-center rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs font-medium text-sc-text hover:bg-sc-elevated disabled:cursor-not-allowed disabled:opacity-50"
      >
        {labelSelect}
      </button>
    </div>
  );
}

function Progress({
  label,
  uploaded,
  total,
  locale,
  t,
}: {
  label: string;
  uploaded: number;
  total: number;
  locale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const pct = total > 0 ? Math.floor((uploaded / total) * 100) : 0;
  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-baseline justify-between text-xs text-sc-text-muted">
        <span>{label}</span>
        <span>
          {t('uploadPortal.progressLabel', {
            pct,
            uploaded: formatBytes(uploaded, locale),
            total: formatBytes(total, locale),
          })}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-sc-elevated">
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

export { UploadPortalView as Component };
