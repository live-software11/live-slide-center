import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Download,
  FolderOpen,
  Lock,
  LockOpen,
  Monitor,
  Radio,
  RotateCcw,
  ShieldAlert,
  User,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileSyncItem, FileVerifyStatus } from '../hooks/useFileSync';
import { VersionBadge } from './VersionBadge';

interface FileSyncStatusProps {
  items: FileSyncItem[];
  onRetry: (versionId: string) => void;
  locale?: string;
  /**
   * Sprint I (§3.E E1) — apre il file LOCALE (preview blob URL) sul PC sala.
   * Solo per item `synced`. Se omesso, il bottone non viene mostrato (ad
   * esempio in admin dashboard se in futuro riusiamo questo componente lato
   * regia).
   */
  onOpen?: (item: FileSyncItem) => void;
  /** Sprint I (§3.E E4) — id presentation del file attualmente "in onda". */
  nowPlayingPresentationId?: string | null;
}

interface SessionGroup {
  sessionId: string;
  sessionTitle: string;
  sessionScheduledStart: string | null;
  files: FileSyncItem[];
}

function groupBySession(items: FileSyncItem[]): SessionGroup[] {
  const map = new Map<string, SessionGroup>();
  for (const item of items) {
    const existing = map.get(item.sessionId);
    if (existing) {
      existing.files.push(item);
    } else {
      map.set(item.sessionId, {
        sessionId: item.sessionId,
        sessionTitle: item.sessionTitle,
        sessionScheduledStart: item.sessionScheduledStart,
        files: [item],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    const at = a.sessionScheduledStart ? Date.parse(a.sessionScheduledStart) : Number.POSITIVE_INFINITY;
    const bt = b.sessionScheduledStart ? Date.parse(b.sessionScheduledStart) : Number.POSITIVE_INFINITY;
    if (at !== bt) return at - bt;
    return a.sessionTitle.localeCompare(b.sessionTitle);
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatDateTime(iso: string, locale = 'it'): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatSessionTime(iso: string | null, locale = 'it'): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

function StatusIcon({ status }: { status: FileSyncItem['status'] }) {
  switch (status) {
    case 'synced':
      return <CheckCircle2 className="h-4 w-4 text-sc-success shrink-0" />;
    case 'downloading':
      return <Download className="h-4 w-4 text-sc-primary shrink-0 animate-bounce" />;
    case 'error':
      return <AlertCircle className="h-4 w-4 text-sc-danger shrink-0" />;
    default:
      return <FolderOpen className="h-4 w-4 text-sc-text-dim shrink-0" />;
  }
}

/**
 * Sprint C3 (GUIDA_OPERATIVA_v3 §2.C3) — badge integrita' SHA256.
 *
 * - `verified`: lucchetto verde, file sicuramente integro byte-per-byte.
 * - `mismatch`: scudo rosso, hash diverso da quello dell'admin (file corrotto
 *   o pacchetto compromesso): NON usare per la proiezione.
 * - `skipped`: lucchetto aperto grigio, verifica non eseguita (file >512MB
 *   oppure upload legacy senza hash). Il file e' stato scaricato ma non
 *   confrontato — usalo se serve, ma valuta visivamente.
 * - `pending`: nessuna icona (durante il download).
 */
function VerifiedBadge({ verified }: { verified: FileVerifyStatus }) {
  const { t } = useTranslation();
  if (verified === 'pending') return null;
  if (verified === 'verified') {
    return (
      <span
        title={t('roomPlayer.verify.hint.verified')}
        aria-label={t('roomPlayer.verify.verified')}
        className="inline-flex items-center gap-0.5 text-sc-success"
      >
        <Lock className="h-3 w-3" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {t('roomPlayer.verify.verified')}
        </span>
      </span>
    );
  }
  if (verified === 'mismatch') {
    return (
      <span
        title={t('roomPlayer.verify.hint.mismatch')}
        aria-label={t('roomPlayer.verify.mismatch')}
        className="inline-flex items-center gap-0.5 text-sc-danger"
      >
        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
        <span className="text-[10px] font-medium uppercase tracking-wide">
          {t('roomPlayer.verify.mismatch')}
        </span>
      </span>
    );
  }
  return (
    <span
      title={t('roomPlayer.verify.hint.skipped')}
      aria-label={t('roomPlayer.verify.skipped')}
      className="inline-flex items-center gap-0.5 text-sc-text-dim"
    >
      <LockOpen className="h-3 w-3" aria-hidden="true" />
      <span className="text-[10px] font-medium uppercase tracking-wide">
        {t('roomPlayer.verify.skipped')}
      </span>
    </span>
  );
}

function FileRow({
  item,
  onRetry,
  onOpen,
  isNowPlaying,
  locale,
}: {
  item: FileSyncItem;
  onRetry: (id: string) => void;
  onOpen?: (item: FileSyncItem) => void;
  isNowPlaying: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const showProgress = item.status === 'downloading';
  // Sprint I (§3.E E1): il bottone "Apri sul PC" e' attivo SOLO se il file
  // e' completamente synced. Per i file in download mostriamo il %; per
  // quelli in errore il bottone "Riprova" (logica esistente).
  const canOpen = Boolean(onOpen) && item.status === 'synced';
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
        isNowPlaying
          ? 'border-sc-success/40 bg-sc-success/10 ring-1 ring-sc-success/20'
          : 'border-sc-primary/12 bg-sc-surface'
      }`}
    >
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 break-all text-sm font-medium text-sc-text" title={item.filename}>
            {item.filename}
          </p>
          {/* Sprint T-1 (G8): badge inline "vN/M" sempre visibile accanto al
              nome file. Verde se la corrente e' anche la latest, giallo se
              c'e' una versione piu' recente (admin ha rollbackato la
              corrente). Si vede a colpo d'occhio la versione "in onda". */}
          <VersionBadge
            versionNumber={item.versionNumber}
            versionTotal={item.versionTotal}
            variant="inline"
          />
          {isNowPlaying && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sc-success/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sc-success">
              <Radio className="h-3 w-3 animate-pulse" aria-hidden="true" />
              {t('roomPlayer.fileSync.nowPlaying')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-sc-text-dim">
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" aria-hidden="true" />
            {t('roomPlayer.files.lastModified', { date: formatDateTime(item.createdAt, locale) })}
          </span>
          <span>·</span>
          <span>{formatBytes(item.fileSizeBytes)}</span>
          {item.speakerName && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" aria-hidden="true" />
                {item.speakerName}
              </span>
            </>
          )}
          {item.status === 'synced' && item.verified !== 'pending' && (
            <>
              <span>·</span>
              <VerifiedBadge verified={item.verified} />
            </>
          )}
        </div>
        {showProgress && (
          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-sc-elevated">
            <div
              className="h-full rounded-full bg-sc-primary transition-all duration-300"
              style={{ width: `${item.progress}%` }}
            />
          </div>
        )}
        {item.status === 'error' && item.errorMessage && (
          <p className="text-xs text-sc-danger">
            {t(`roomPlayer.fileSync.errors.${item.errorMessage}`, { defaultValue: item.errorMessage })}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5 text-right">
        {/* Sprint I (§3.E E1): "Apri sul PC" SOLO per file synced. Triggera
            <FilePreviewDialog> con sorgente locale (FSA blob URL) e segnala a
            Supabase il "now playing" (best-effort). */}
        {canOpen && (
          <button
            type="button"
            onClick={() => onOpen?.(item)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/30 bg-sc-primary/10 px-2.5 py-1 text-xs font-medium text-sc-primary hover:bg-sc-primary/20"
            aria-label={t('roomPlayer.fileSync.openAria', { name: item.filename })}
          >
            <Monitor className="h-3.5 w-3.5" />
            {t('roomPlayer.fileSync.open')}
          </button>
        )}
        <span className="text-xs text-sc-text-dim">
          {showProgress ? (
            `${item.progress}%`
          ) : item.status === 'synced' ? (
            t('roomPlayer.fileSync.statusSynced')
          ) : item.status === 'error' ? (
            <button
              type="button"
              onClick={() => onRetry(item.versionId)}
              className="inline-flex items-center gap-1 text-sc-warning hover:text-sc-warning/80"
              aria-label={t('roomPlayer.fileSync.retry')}
            >
              <RotateCcw className="h-3 w-3" />
              {t('roomPlayer.fileSync.retry')}
            </button>
          ) : (
            t('roomPlayer.fileSync.statusPending')
          )}
        </span>
      </div>
    </li>
  );
}

export function FileSyncStatus({
  items,
  onRetry,
  onOpen,
  nowPlayingPresentationId,
  locale = 'it',
}: FileSyncStatusProps) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupBySession(items), [items]);

  if (items.length === 0) return null;

  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const when = formatSessionTime(group.sessionScheduledStart, locale);
        const title = group.sessionTitle?.trim()
          ? group.sessionTitle
          : t('roomPlayer.sessionUntitled');
        const synced = group.files.filter((f) => f.status === 'synced').length;
        return (
          <section key={group.sessionId} className="space-y-2">
            <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h2 className="text-sm font-semibold text-sc-text">{title}</h2>
              {when && <span className="text-xs text-sc-text-muted">· {when}</span>}
              <span className="ml-auto text-xs text-sc-text-dim">
                {synced}/{group.files.length}
              </span>
            </header>
            <ul className="space-y-1.5">
              {group.files.map((item) => (
                <FileRow
                  key={item.versionId}
                  item={item}
                  onRetry={onRetry}
                  onOpen={onOpen}
                  isNowPlaying={
                    Boolean(nowPlayingPresentationId) &&
                    item.presentationId === nowPlayingPresentationId
                  }
                  locale={locale}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
