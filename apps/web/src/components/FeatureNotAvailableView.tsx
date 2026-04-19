import { useTranslation } from 'react-i18next';
import { Cloud, ExternalLink, Monitor } from 'lucide-react';
import { Button } from '@slidecenter/ui';
import type { CloudOnlyFeature } from '@/lib/backend-mode';

/**
 * Sprint W D3 — vista mostrata quando l'utente desktop apre un URL che
 * corrisponde a una feature cloud-only (es. /billing aperto da deeplink
 * salvato in cloud poi importato in desktop).
 *
 * NON e' un errore: e' uno stato informativo che spiega perche' la feature
 * non puo' funzionare in modalita desktop e indirizza alla versione cloud.
 *
 * Le 8 chiavi i18n usate (`featureNotAvailable.*`) sono definite in
 * `packages/shared/src/i18n/locales/{it,en}.json` (Sprint W D4).
 */
export function FeatureNotAvailableView({ feature }: { feature: CloudOnlyFeature }) {
  const { t } = useTranslation();

  // Le feature elencate hanno una chiave i18n dedicata; quelle non mappate
  // ricadono su `feature.generic` per non rompere la UI.
  const featureKey: string = (() => {
    switch (feature) {
      case 'billing':
      case 'tenant-admin':
      case 'audit-log-export':
        return `featureNotAvailable.feature.${feature}`;
      default:
        return 'featureNotAvailable.feature.generic';
    }
  })();

  const featureLabel = t(featureKey, t('featureNotAvailable.feature.generic'));

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl rounded-2xl border border-sc-border bg-sc-card p-8 text-center shadow-lg">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-sc-primary/10 text-sc-primary">
          <Monitor className="h-7 w-7" aria-hidden />
        </div>
        <span
          className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-sc-accent/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-sc-accent"
          role="status"
        >
          {t('featureNotAvailable.modeBadge')}
        </span>
        <h1 className="mb-2 text-2xl font-bold tracking-tight text-sc-text">
          {t('featureNotAvailable.title', { feature: featureLabel })}
        </h1>
        <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed text-sc-text-muted">
          {t('featureNotAvailable.description', { feature: featureLabel })}
        </p>
        <Button
          asChild
          className="bg-sc-primary text-sc-primary-foreground hover:bg-sc-primary/90"
        >
          <a
            href="https://app.liveworksapp.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2"
          >
            <Cloud className="h-4 w-4" aria-hidden />
            {t('featureNotAvailable.cta')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </Button>
      </div>
    </div>
  );
}
