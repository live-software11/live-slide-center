import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RefreshCw, X } from 'lucide-react';
import { getBackendMode } from '@/lib/backend-mode';
import {
  checkForUpdate,
  installUpdateAndRestart,
  type UpdateCheckResult,
} from '@/lib/desktop-bridge';

/**
 * Sprint P3 (GUIDA_OPERATIVA_v3 §4.H) — Banner update Tauri.
 *
 * Renderizzato SOLO in modalita desktop. In cloud ritorna null immediato.
 *
 * Comportamento:
 *   • Check al mount + ogni 30 minuti in background.
 *   • Banner top sticky (non invasivo) quando disponibile update.
 *   • Click "Installa e riavvia" → scarica + install + restart (la app muore).
 *   • Click "Piu' tardi" → dismiss locale (sessionStorage), riapparira' al
 *     prossimo avvio o dopo 30 minuti se pubblicata altra versione.
 *   • Errori graceful: console.warn (no toast — l'updater e' best-effort).
 *
 * Discrezione: il banner e' una stripe da 40px in cima, sopra `<main>`.
 * Quando manca update, zero footprint visivo. Il dismiss e' per-versione cosi'
 * non spamma se l'utente clicca "Piu' tardi" su 1.0.5 ma rilasciamo 1.0.6.
 */

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const DISMISS_KEY_PREFIX = 'sc:desktop-updater:dismissed:';

export function DesktopUpdateBanner() {
  const { t } = useTranslation();
  const [available, setAvailable] = useState<UpdateCheckResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  const isDesktop = getBackendMode() === 'desktop';

  // Sprint P3: il check parte SEMPRE dopo un'await, mai sincrono nel body
  // dell'effect (regola react-hooks/set-state-in-effect React 19+).
  // Usiamo `cancelled` flag per scartare risultati post-unmount.
  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;

    async function runCheck() {
      const res = await checkForUpdate();
      if (cancelled) return;
      if (!res.available || !res.version) {
        setAvailable(null);
        return;
      }
      const dismissed = sessionStorage.getItem(`${DISMISS_KEY_PREFIX}${res.version}`);
      if (cancelled) return;
      if (dismissed) {
        setAvailable(null);
        return;
      }
      setAvailable(res);
    }

    void runCheck();
    const id = window.setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isDesktop]);

  if (!isDesktop || !available || !available.version) return null;

  function dismiss() {
    if (available?.version) {
      try {
        sessionStorage.setItem(`${DISMISS_KEY_PREFIX}${available.version}`, '1');
      } catch {
        /* ignore */
      }
    }
    setAvailable(null);
  }

  async function install() {
    if (installing) return;
    setInstalling(true);
    setInstallError(null);
    const res = await installUpdateAndRestart();
    if (!res.ok) {
      setInstallError(res.error ?? 'install_failed');
      setInstalling(false);
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full items-center justify-between gap-3 border-b border-sc-primary/15 bg-sc-primary/8 px-4 py-2 text-xs text-sc-text"
    >
      <div className="flex min-w-0 items-center gap-2">
        <Download className="h-4 w-4 shrink-0 text-sc-primary" aria-hidden />
        <span className="truncate">
          <strong className="font-semibold">{t('desktopUpdater.available')}</strong>
          <span className="mx-2 opacity-50">·</span>
          <span>{t('desktopUpdater.newVersion', { version: available.version })}</span>
          {available.current_version ? (
            <>
              <span className="mx-2 opacity-50">·</span>
              <span className="opacity-70">
                {t('desktopUpdater.currentVersion', { version: available.current_version })}
              </span>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {installError ? (
          <span
            className="hidden truncate text-sc-danger sm:inline-block"
            title={t('desktopUpdater.installFailed', { error: installError })}
          >
            {t('desktopUpdater.installFailed', { error: installError })}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void install()}
          disabled={installing}
          className="inline-flex items-center gap-1.5 rounded-md bg-sc-primary px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white transition-colors hover:bg-sc-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {installing ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>
            {installing ? t('desktopUpdater.installing') : t('desktopUpdater.installNow')}
          </span>
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={installing}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] uppercase tracking-wide text-sc-text-muted transition-colors hover:bg-sc-primary/10 hover:text-sc-text disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('desktopUpdater.later')}
        >
          <X className="h-3 w-3" aria-hidden />
          <span className="hidden sm:inline">{t('desktopUpdater.later')}</span>
        </button>
      </div>
    </div>
  );
}
