import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HardDrive, Loader2, Trash2 } from 'lucide-react';
import type { StorageEstimate, OrphanCleanupResult } from '../lib/fs-access';

/**
 * Sprint E3 (GUIDA_OPERATIVA_v3 §2.E3) — pannello salute disco lato Room
 * Player. Mostra:
 *  - Barra usage con label "X.X GB usati / Y.Y GB" + percentuale.
 *  - Bottone "Pulisci file orfani" che rimuove file su disco non piu' nella
 *    lista corrente (es. presentazioni di sessioni concluse).
 *
 * Quando la quota residua scende sotto 1GB la barra diventa arancione (warning).
 * Sotto 100MB diventa rossa (critical).
 *
 * Note: la quota mostrata e' quella dell'ORIGIN del browser (IndexedDB / OPFS),
 * NON dello spazio reale del disco fisico scelto. E' un'approssimazione utile
 * per pre-allarme ma non una garanzia. Il caso reale di "disco pieno" arriva
 * comunque a runtime con un errore `download_failed`/`storage_full`.
 */
const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < MB) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < GB) return `${(bytes / MB).toFixed(0)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

interface StorageUsagePanelProps {
  storage: StorageEstimate | null;
  onCleanup: () => Promise<OrphanCleanupResult | null>;
}

export function StorageUsagePanel({ storage, onCleanup }: StorageUsagePanelProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<OrphanCleanupResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (!storage) return null;

  const { quotaBytes, usageBytes, availableBytes, usagePct } = storage;
  if (quotaBytes === 0) return null;

  const status: 'ok' | 'warn' | 'crit' =
    availableBytes < 100 * MB ? 'crit' : availableBytes < GB ? 'warn' : 'ok';

  const barColor =
    status === 'crit' ? 'bg-sc-danger' : status === 'warn' ? 'bg-sc-warning' : 'bg-sc-success';
  const borderColor =
    status === 'crit'
      ? 'border-sc-danger/30 bg-sc-danger/5'
      : status === 'warn'
        ? 'border-sc-warning/30 bg-sc-warning/5'
        : 'border-sc-primary/15 bg-sc-surface/40';

  const handleCleanup = async () => {
    setBusy(true);
    setLastResult(null);
    try {
      const r = await onCleanup();
      setLastResult(r);
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  return (
    <div className={`rounded-xl border px-4 py-3 ${borderColor}`}>
      <div className="flex flex-wrap items-center gap-2">
        <HardDrive className="h-4 w-4 shrink-0 text-sc-text-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="text-sm font-medium text-sc-text">
              {t('roomPlayer.storage.title')}
            </p>
            <p className="text-xs text-sc-text-dim">
              {t('roomPlayer.storage.usage', {
                used: formatBytes(usageBytes),
                quota: formatBytes(quotaBytes),
                pct: usagePct,
              })}
            </p>
          </div>
          <div
            className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sc-elevated"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={usagePct}
            aria-label={t('roomPlayer.storage.title')}
          >
            <div
              className={`h-full transition-all ${barColor}`}
              style={{ width: `${Math.max(2, usagePct)}%` }}
            />
          </div>
          {status !== 'ok' && (
            <p
              className={`mt-1.5 text-[11px] ${status === 'crit' ? 'text-sc-danger' : 'text-sc-warning'}`}
            >
              {t(`roomPlayer.storage.warn.${status}`, {
                available: formatBytes(availableBytes),
              })}
            </p>
          )}
        </div>
      </div>

      {confirmOpen ? (
        <div className="mt-3 rounded-lg border border-sc-warning/30 bg-sc-warning/5 px-3 py-2 text-xs">
          <p className="text-sc-text">{t('roomPlayer.storage.confirmCleanup')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCleanup()}
              className="rounded-lg bg-sc-warning px-3 py-1 text-xs font-medium text-white hover:bg-sc-warning/85 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('roomPlayer.storage.confirmCleanupAction')
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmOpen(false)}
              className="rounded-lg border border-sc-primary/20 px-3 py-1 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/15 px-2.5 py-1 text-xs text-sc-text-muted hover:bg-sc-elevated disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            {t('roomPlayer.storage.cleanupButton')}
          </button>
          {lastResult && (
            <p className="text-[11px] text-sc-text-dim">
              {t('roomPlayer.storage.cleanupResult', {
                files: lastResult.removedFiles,
                size: formatBytes(lastResult.removedBytes),
              })}
              {lastResult.errors > 0 && (
                <>
                  {' '}
                  ·{' '}
                  <span className="text-sc-warning">
                    {t('roomPlayer.storage.cleanupErrors', { count: lastResult.errors })}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
