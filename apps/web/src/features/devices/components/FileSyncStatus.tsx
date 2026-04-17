import { AlertCircle, Calendar, CheckCircle2, Download, FolderOpen, RotateCcw, User } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { FileSyncItem } from '../hooks/useFileSync';

interface FileSyncStatusProps {
  items: FileSyncItem[];
  onRetry: (versionId: string) => void;
  locale?: string;
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

function FileRow({
  item,
  onRetry,
  locale,
}: {
  item: FileSyncItem;
  onRetry: (id: string) => void;
  locale: string;
}) {
  const { t } = useTranslation();
  const showProgress = item.status === 'downloading';
  return (
    <li className="flex items-start gap-3 rounded-xl border border-sc-primary/12 bg-sc-surface px-3 py-2.5">
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-all text-sm font-medium text-sc-text" title={item.filename}>
          {item.filename}
        </p>
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
      <span className="shrink-0 text-right text-xs text-sc-text-dim">
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
    </li>
  );
}

export function FileSyncStatus({ items, onRetry, locale = 'it' }: FileSyncStatusProps) {
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
                <FileRow key={item.versionId} item={item} onRetry={onRetry} locale={locale} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
