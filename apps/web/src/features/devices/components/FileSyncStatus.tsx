import { AlertCircle, CheckCircle2, Download, FolderOpen, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FileSyncItem } from '../hooks/useFileSync';

interface FileSyncStatusProps {
  items: FileSyncItem[];
  onRetry: (versionId: string) => void;
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

export function FileSyncStatus({ items, onRetry }: FileSyncStatusProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li
          key={item.versionId}
          className="flex items-center gap-2 rounded-xl border border-sc-primary/12 bg-sc-surface px-3 py-2.5"
        >
          <StatusIcon status={item.status} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-sc-text-secondary">{item.speakerName}</p>
            <p className="truncate text-xs text-sc-text-dim">{item.filename}</p>
            {item.status === 'downloading' && (
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-sc-elevated">
                <div
                  className="h-full rounded-full bg-sc-primary transition-all duration-300"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            )}
            {item.status === 'error' && item.errorMessage && (
              <p className="mt-0.5 text-xs text-sc-danger">{item.errorMessage}</p>
            )}
          </div>
          <span className="shrink-0 text-xs text-sc-text-dim">
            {item.status === 'downloading'
              ? `${item.progress}%`
              : item.status === 'synced'
                ? t('roomPlayer.fileSync.statusSynced')
                : item.status === 'error'
                  ? (
                    <button
                      type="button"
                      onClick={() => onRetry(item.versionId)}
                      className="flex items-center gap-1 text-xs text-sc-warning hover:text-sc-warning/80"
                      aria-label={t('roomPlayer.fileSync.retry')}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t('roomPlayer.fileSync.retry')}
                    </button>
                  )
                  : t('roomPlayer.fileSync.statusPending')}
          </span>
        </li>
      ))}
    </ul>
  );
}
