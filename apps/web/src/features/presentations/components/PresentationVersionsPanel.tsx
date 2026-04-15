import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/features/upload-portal/lib/format-bytes';
import {
  createVersionDownloadUrl,
  setCurrentVersion,
  updatePresentationStatus,
  type PresentationStatus,
  type PresentationVersion,
} from '@/features/presentations/repository';
import { usePresentationForSpeaker } from '@/features/presentations/hooks/usePresentationForSpeaker';

interface Props {
  speakerId: string;
  speakerName: string;
  enabled: boolean;
}

// Pannello storico versioni per una presentation. Carica in lazy (quando
// `enabled=true`). Realtime-aware via hook dedicato.
export function PresentationVersionsPanel({ speakerId, speakerName, enabled }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const { bundle, loading, error, reload } = usePresentationForSpeaker(speakerId, enabled);

  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string>('');
  const [noteOpen, setNoteOpen] = useState<PresentationStatus | null>(null);

  const onDownload = useCallback(async (v: PresentationVersion) => {
    setActionError(null);
    setActionBusy(`dl:${v.id}`);
    try {
      const url = await createVersionDownloadUrl(v.storage_key);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setActionError('download_failed');
    } finally {
      setActionBusy(null);
    }
  }, []);

  const onRollback = useCallback(
    async (v: PresentationVersion) => {
      if (!bundle.presentation) return;
      setActionError(null);
      setActionBusy(`rb:${v.id}`);
      try {
        await setCurrentVersion(bundle.presentation.id, v.id);
        await reload();
      } catch (e) {
        setActionError((e as { message?: string })?.message ?? 'rollback_failed');
      } finally {
        setActionBusy(null);
      }
    },
    [bundle.presentation, reload],
  );

  const onStatus = useCallback(
    async (status: PresentationStatus, note: string | null) => {
      if (!bundle.presentation) return;
      setActionError(null);
      setActionBusy(`st:${status}`);
      try {
        await updatePresentationStatus(bundle.presentation.id, status, note);
        setNoteOpen(null);
        setNoteDraft('');
        await reload();
      } catch (e) {
        setActionError((e as { message?: string })?.message ?? 'status_failed');
      } finally {
        setActionBusy(null);
      }
    },
    [bundle.presentation, reload],
  );

  if (!enabled) return null;

  if (loading && bundle.versions.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-sc-primary/12 bg-sc-bg/40 px-3 py-2 text-xs text-sc-text-dim">
        {t('presentation.versions.loading')}
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
        {t('presentation.versions.loadError')}
      </div>
    );
  }

  if (!bundle.presentation) {
    return (
      <div className="mt-3 rounded-xl border border-sc-primary/12 bg-sc-bg/40 px-3 py-2 text-xs text-sc-text-dim">
        {t('presentation.versions.none')}
      </div>
    );
  }

  const { presentation, versions } = bundle;
  const currentId = presentation.current_version_id;

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-sc-primary/12 bg-sc-bg/40 p-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="uppercase tracking-wide text-sc-text-dim">
            {t('presentation.versions.title')}
          </span>
          <StatusBadge status={presentation.status} />
          <span className="text-sc-text-dim">
            {t('presentation.versions.totalCount', { count: presentation.total_versions })}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          <StatusAction
            label={t('presentation.versions.markReviewed')}
            disabled={presentation.status === 'reviewed' || actionBusy !== null}
            onClick={() => {
              setNoteOpen('reviewed');
              setNoteDraft(presentation.reviewer_note ?? '');
            }}
          />
          <StatusAction
            label={t('presentation.versions.markApproved')}
            tone="success"
            disabled={presentation.status === 'approved' || actionBusy !== null}
            onClick={() => {
              setNoteOpen('approved');
              setNoteDraft(presentation.reviewer_note ?? '');
            }}
          />
          <StatusAction
            label={t('presentation.versions.markRejected')}
            tone="danger"
            disabled={presentation.status === 'rejected' || actionBusy !== null}
            onClick={() => {
              setNoteOpen('rejected');
              setNoteDraft(presentation.reviewer_note ?? '');
            }}
          />
        </div>
      </header>

      {noteOpen ? (
        <div className="rounded border border-sc-primary/20 bg-sc-surface/80 p-3">
          <label
            htmlFor={`note-${speakerId}`}
            className="mb-1 block text-xs text-sc-text-muted"
          >
            {t('presentation.versions.reviewerNoteLabel')}
          </label>
          <textarea
            id={`note-${speakerId}`}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
            placeholder={t('presentation.versions.reviewerNotePlaceholder', { name: speakerName })}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={actionBusy !== null}
              className="rounded-xl bg-sc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
              onClick={() => void onStatus(noteOpen, noteDraft.trim() || null)}
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              disabled={actionBusy !== null}
              className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
              onClick={() => {
                setNoteOpen(null);
                setNoteDraft('');
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : presentation.reviewer_note ? (
        <p className="rounded border border-sc-primary/12 bg-sc-surface/60 px-3 py-2 text-xs text-sc-text-muted">
          <span className="font-semibold text-sc-text-secondary">
            {t('presentation.versions.reviewerNoteLabel')}:
          </span>{' '}
          {presentation.reviewer_note}
          {presentation.reviewed_at ? (
            <span className="ml-2 text-sc-text-dim">
              ({dateTimeFmt.format(new Date(presentation.reviewed_at))})
            </span>
          ) : null}
        </p>
      ) : null}

      {actionError ? (
        <p className="rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
          {t('presentation.versions.actionError')}
        </p>
      ) : null}

      {versions.length === 0 ? (
        <p className="text-xs text-sc-text-dim">{t('presentation.versions.emptyList')}</p>
      ) : (
        <ul className="divide-y divide-sc-primary/12 rounded border border-sc-primary/12">
          {versions.map((v) => {
            const isCurrent = currentId === v.id;
            const canDownload = v.status === 'ready' || v.status === 'superseded';
            return (
              <li key={v.id} className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-sc-text-secondary">v{v.version_number}</span>
                    <VersionStatusBadge status={v.status} isCurrent={isCurrent} />
                    <span className="truncate text-sc-text-secondary" title={v.file_name}>
                      {v.file_name}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-sc-text-dim">
                    <span>{dateTimeFmt.format(new Date(v.created_at))}</span>
                    <span>{formatBytes(v.file_size_bytes, locale)}</span>
                    {v.file_hash_sha256 ? (
                      <span
                        title={v.file_hash_sha256}
                        className="font-mono text-[10px] text-zinc-600"
                      >
                        {t('presentation.versions.hashShort', {
                          hash: v.file_hash_sha256.slice(0, 12),
                        })}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={!canDownload || actionBusy === `dl:${v.id}`}
                    className="rounded-xl border border-sc-primary/20 px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={() => void onDownload(v)}
                  >
                    {actionBusy === `dl:${v.id}`
                      ? t('presentation.versions.downloading')
                      : t('presentation.versions.download')}
                  </button>
                  {!isCurrent && v.status !== 'failed' && v.status !== 'uploading' ? (
                    <button
                      type="button"
                      disabled={actionBusy === `rb:${v.id}`}
                      className="rounded-xl border border-amber-700/60 px-2.5 py-1 text-xs font-medium text-amber-200/90 hover:bg-amber-950/40 disabled:opacity-40"
                      onClick={() => void onRollback(v)}
                    >
                      {actionBusy === `rb:${v.id}`
                        ? t('presentation.versions.settingCurrent')
                        : t('presentation.versions.setCurrent')}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: PresentationStatus }) {
  const { t } = useTranslation();
  const tone: Record<PresentationStatus, string> = {
    pending: 'border-sc-primary/20 bg-sc-surface text-sc-text-muted',
    uploaded: 'border-blue-900/60 bg-blue-950/40 text-blue-300',
    reviewed: 'border-sc-primary/20 bg-sc-surface text-sc-text',
    approved: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
    rejected: 'border-red-900/60 bg-red-950/40 text-red-300',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone[status]}`}
    >
      {t(`presentation.status${capitalize(status)}`)}
    </span>
  );
}

function VersionStatusBadge({
  status,
  isCurrent,
}: {
  status: PresentationVersion['status'];
  isCurrent: boolean;
}) {
  const { t } = useTranslation();
  if (isCurrent) {
    return (
      <span className="inline-flex items-center rounded border border-emerald-700/70 bg-emerald-950/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
        {t('presentation.versions.currentBadge')}
      </span>
    );
  }
  const tone: Record<PresentationVersion['status'], string> = {
    uploading: 'border-blue-900/60 bg-blue-950/40 text-blue-300',
    processing: 'border-blue-900/60 bg-blue-950/40 text-blue-300',
    ready: 'border-emerald-900/60 bg-emerald-950/40 text-emerald-300',
    failed: 'border-red-900/60 bg-red-950/40 text-red-300',
    superseded: 'border-sc-primary/20 bg-sc-surface text-sc-text-dim',
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${tone[status]}`}
    >
      {t(`presentation.versions.vstatus.${status}`)}
    </span>
  );
}

function StatusAction({
  label,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  tone?: 'neutral' | 'success' | 'danger';
}) {
  const cls =
    tone === 'success'
      ? 'border-emerald-700/60 text-emerald-300 hover:bg-emerald-950/40'
      : tone === 'danger'
        ? 'border-red-700/60 text-red-300 hover:bg-red-950/40'
        : 'border-sc-primary/20 text-sc-text hover:bg-sc-elevated';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl border px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
