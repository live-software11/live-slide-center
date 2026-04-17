import { useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useTenantWarnings } from '../hooks/useTenantWarnings';
import type { LicenseSummary, StorageSummary } from '../repository';

/**
 * Banner stack mostrati in cima a ogni view per ricordare scadenza licenza
 * o storage in esaurimento. Dismissable in sessione (sessionStorage). Re-mostra
 * a refresh / nuova sessione.
 */
export function TenantWarningBanners() {
  const { license, storage } = useTenantWarnings();
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  const banners = useMemo(() => {
    const out: { key: string; node: ReactElement }[] = [];

    if (license && shouldShowLicenseBanner(license)) {
      const key = `license_${license.threshold}_${license.expires_at ?? 'na'}`;
      if (!dismissed.has(key)) {
        out.push({ key, node: <LicenseBanner license={license} onDismiss={() => dismissBanner(key, setDismissed)} /> });
      }
    }
    if (storage && shouldShowStorageBanner(storage)) {
      const key = `storage_${storage.threshold}_${Math.floor(storage.percent ?? 0)}`;
      if (!dismissed.has(key)) {
        out.push({ key, node: <StorageBanner storage={storage} onDismiss={() => dismissBanner(key, setDismissed)} /> });
      }
    }
    return out;
    // i18n re-render hook (anche se non usato in deps di calcolo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [license, storage, dismissed, t]);

  if (banners.length === 0) return null;
  return (
    <div className="space-y-2 px-4 pt-4 sm:px-6 lg:px-8">
      {banners.map((b) => (
        <div key={b.key}>{b.node}</div>
      ))}
    </div>
  );
}

function LicenseBanner({ license, onDismiss }: { license: LicenseSummary; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const tone = license.threshold;
  const palette = (() => {
    if (tone === 'expired') return { ring: 'border-sc-danger/40 bg-sc-danger/10 text-sc-danger', icon: <AlertCircle className="h-5 w-5 text-sc-danger" /> };
    if (tone === 'critical') return { ring: 'border-sc-danger/40 bg-sc-danger/10 text-sc-danger', icon: <AlertCircle className="h-5 w-5 text-sc-danger" /> };
    if (tone === 'warning') return { ring: 'border-amber-500/40 bg-amber-500/10 text-amber-500', icon: <AlertTriangle className="h-5 w-5 text-amber-500" /> };
    return { ring: 'border-sc-primary/30 bg-sc-primary/10 text-sc-primary', icon: <Info className="h-5 w-5 text-sc-primary" /> };
  })();
  const days = license.days_remaining ?? 0;
  const expiresLabel = license.expires_at
    ? new Date(license.expires_at).toLocaleDateString(i18n.language === 'en' ? 'en-GB' : 'it-IT')
    : '';
  const titleKey = tone === 'expired'
    ? 'notifications.license.expiredTitle'
    : tone === 'critical' || days <= 1
      ? 'notifications.license.criticalTitle'
      : tone === 'warning'
        ? 'notifications.license.warningTitle'
        : 'notifications.license.infoTitle';
  const title = t(titleKey, { count: Math.max(days, 0), date: expiresLabel });

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${palette.ring}`} role="alert">
      <span className="mt-0.5 shrink-0">{palette.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-sc-text">{title}</p>
        <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">
          {t('notifications.license.description', { plan: license.plan ?? '—' })}
        </p>
        <div className="mt-2">
          <Link
            to="/billing"
            className="inline-flex items-center gap-1 rounded-md bg-sc-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sc-primary-strong"
          >
            {t('notifications.license.cta')}
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('notifications.dismiss')}
        className="shrink-0 rounded-md p-1 text-sc-text-dim transition-colors hover:bg-sc-text/10 hover:text-sc-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function StorageBanner({ storage, onDismiss }: { storage: StorageSummary; onDismiss: () => void }) {
  const { t } = useTranslation();
  const tone = storage.threshold;
  const palette = (() => {
    if (tone === 'critical') return { ring: 'border-sc-danger/40 bg-sc-danger/10 text-sc-danger', icon: <AlertCircle className="h-5 w-5 text-sc-danger" /> };
    return { ring: 'border-amber-500/40 bg-amber-500/10 text-amber-500', icon: <AlertTriangle className="h-5 w-5 text-amber-500" /> };
  })();
  const usedMb = Math.round(storage.used_bytes / 1024 / 1024);
  const limitMb = Math.round(storage.limit_bytes / 1024 / 1024);
  const percent = storage.percent ?? 0;
  const titleKey = tone === 'critical' ? 'notifications.storage.criticalTitle' : 'notifications.storage.warningTitle';

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${palette.ring}`} role="alert">
      <span className="mt-0.5 shrink-0">{palette.icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-sc-text">
          {t(titleKey, { percent: percent.toFixed(0) })}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">
          {t('notifications.storage.description', { used: usedMb, limit: limitMb })}
        </p>
        <div className="mt-2">
          <Link
            to="/billing"
            className="inline-flex items-center gap-1 rounded-md bg-sc-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sc-primary-strong"
          >
            {t('notifications.storage.cta')}
          </Link>
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t('notifications.dismiss')}
        className="shrink-0 rounded-md p-1 text-sc-text-dim transition-colors hover:bg-sc-text/10 hover:text-sc-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function shouldShowLicenseBanner(s: LicenseSummary): boolean {
  return s.threshold === 'info' || s.threshold === 'warning' || s.threshold === 'critical' || s.threshold === 'expired';
}
function shouldShowStorageBanner(s: StorageSummary): boolean {
  return s.threshold === 'warning' || s.threshold === 'critical';
}

const DISMISS_STORAGE_KEY = 'sc.warningBannersDismissed';

function readDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function dismissBanner(key: string, setDismissed: React.Dispatch<React.SetStateAction<Set<string>>>) {
  setDismissed((prev) => {
    const next = new Set(prev);
    next.add(key);
    try {
      sessionStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // sessionStorage indisponibile (incognito strict): degrade silenzioso
    }
    return next;
  });
}
