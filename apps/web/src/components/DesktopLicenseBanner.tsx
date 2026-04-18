import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  AlertTriangle,
  CalendarClock,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  ShieldX,
} from 'lucide-react';
import { getBackendMode } from '@/lib/backend-mode';
import {
  getDesktopLicenseStatus,
  renewDesktopLicenseNow,
  verifyDesktopLicenseNow,
  type DesktopLicenseStatus,
} from '@/lib/desktop-bridge';

/**
 * Sprint D1 — Banner sticky stato licenza desktop.
 *
 * Renderizzato SOLO in modalita desktop. In cloud ritorna null.
 * Logica:
 *   • check al mount + ogni 60s in background
 *   • se status = `active` → null (no banner)
 *   • altrimenti mostra warning con CTA: "Collega" / "Verifica ora" / "Ricollega"
 *
 * Posizionato sotto `<DesktopUpdateBanner />` nell'AppShell. Il dismiss e' per-stato:
 * dopo "Verifica ora" il banner scompare se torna `active`. Per `notBound` /
 * `revoked` / `tenantSuspended` non c'e' dismiss: l'utente DEVE risolvere.
 */
const POLL_INTERVAL_MS = 60_000;

export function DesktopLicenseBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<DesktopLicenseStatus | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [renewing, setRenewing] = useState(false);

  const isDesktop = getBackendMode() === 'desktop';

  const refresh = useCallback(async () => {
    const s = await getDesktopLicenseStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void (async () => {
      const s = await getDesktopLicenseStatus();
      if (!cancelled) setStatus(s);
    })();
    const id = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isDesktop, refresh]);

  if (!isDesktop || !status) return null;
  if (status.kind === 'active') return null;
  if (status.kind === 'error') return null;

  async function handleVerify() {
    if (verifying) return;
    setVerifying(true);
    try {
      await verifyDesktopLicenseNow();
      await refresh();
    } finally {
      setVerifying(false);
    }
  }

  async function handleRenew() {
    if (renewing) return;
    setRenewing(true);
    try {
      await renewDesktopLicenseNow();
      await refresh();
    } finally {
      setRenewing(false);
    }
  }

  let title = '';
  let hint: string | null = null;
  let cta:
    | { kind: 'link'; label: string }
    | { kind: 'verify'; label: string }
    | { kind: 'renew'; label: string }
    | null = null;
  let tone: 'warn' | 'danger' = 'warn';
  let Icon = AlertTriangle;

  switch (status.kind) {
    case 'notBound':
      title = t('desktopLicense.banner.notBoundTitle');
      cta = { kind: 'link', label: t('desktopLicense.banner.notBoundCta') };
      Icon = KeyRound;
      tone = 'warn';
      break;
    case 'pairTokenExpiring': {
      const days = Math.max(0, status.pairTokenDaysRemaining);
      title = t('desktopLicense.banner.pairTokenExpiringTitle', { days });
      hint = t('desktopLicense.banner.pairTokenExpiringHint');
      cta = { kind: 'renew', label: t('desktopLicense.banner.pairTokenExpiringCta') };
      Icon = CalendarClock;
      tone = 'warn';
      break;
    }
    case 'pairTokenExpired':
      title = t('desktopLicense.banner.pairTokenExpiredTitle');
      hint = t('desktopLicense.banner.pairTokenExpiredHint');
      cta = { kind: 'link', label: t('desktopLicense.banner.pairTokenExpiredCta') };
      Icon = ShieldAlert;
      tone = 'danger';
      break;
    case 'gracePeriod': {
      const days = Math.max(0, status.daysRemaining);
      title = t('desktopLicense.banner.graceTitle', { days });
      cta = { kind: 'verify', label: t('desktopLicense.banner.graceCta') };
      Icon = AlertTriangle;
      tone = 'warn';
      break;
    }
    case 'graceExpired':
      title = t('desktopLicense.banner.graceExpiredTitle');
      hint = t('desktopLicense.banner.graceExpiredHint');
      cta = { kind: 'verify', label: t('desktopLicense.banner.graceCta') };
      Icon = ShieldAlert;
      tone = 'danger';
      break;
    case 'revoked':
      title = t('desktopLicense.banner.revokedTitle');
      cta = { kind: 'link', label: t('desktopLicense.banner.revokedCta') };
      Icon = ShieldX;
      tone = 'danger';
      break;
    case 'tenantSuspended':
      title = t('desktopLicense.banner.tenantSuspendedTitle');
      hint = t('desktopLicense.banner.tenantSuspendedHint');
      Icon = ShieldX;
      tone = 'danger';
      break;
  }

  const bg = tone === 'danger' ? 'bg-sc-danger/10 border-sc-danger/30' : 'bg-amber-500/10 border-amber-500/30';
  const fg = tone === 'danger' ? 'text-sc-danger' : 'text-amber-700 dark:text-amber-300';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex w-full items-center justify-between gap-3 border-b px-4 py-2 text-xs ${bg}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <Icon className={`h-4 w-4 shrink-0 ${fg}`} aria-hidden />
        <span className="truncate text-sc-text">
          <strong className="font-semibold">{title}</strong>
          {hint ? <span className="ml-2 opacity-80">{hint}</span> : null}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {cta?.kind === 'verify' ? (
          <button
            type="button"
            onClick={() => void handleVerify()}
            disabled={verifying}
            className="inline-flex items-center gap-1.5 rounded-md bg-sc-primary px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white transition-colors hover:bg-sc-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {verifying ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            <span>{cta.label}</span>
          </button>
        ) : null}
        {cta?.kind === 'renew' ? (
          <button
            type="button"
            onClick={() => void handleRenew()}
            disabled={renewing}
            className="inline-flex items-center gap-1.5 rounded-md bg-sc-primary px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white transition-colors hover:bg-sc-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {renewing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            <span>{cta.label}</span>
          </button>
        ) : null}
        {cta?.kind === 'link' ? (
          <Link
            to="/centro-slide/licenza"
            className="inline-flex items-center gap-1.5 rounded-md bg-sc-primary px-2.5 py-1 text-[11px] font-medium uppercase tracking-wide text-white transition-colors hover:bg-sc-primary/90"
          >
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            <span>{cta.label}</span>
          </Link>
        ) : null}
      </div>
    </div>
  );
}
