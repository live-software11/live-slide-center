import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Languages, Link2 } from 'lucide-react';
import { getIntegrationsEnvUrls } from '@/features/settings/lib/integrations-env';

function normalizeLang(code: string | undefined): 'it' | 'en' {
  const base = (code ?? 'it').split('-')[0]?.toLowerCase() ?? 'it';
  return base === 'en' ? 'en' : 'it';
}

export default function SettingsView() {
  const { t, i18n } = useTranslation();
  const active = useMemo(() => normalizeLang(i18n.language), [i18n.language]);
  const integrationUrls = useMemo(() => getIntegrationsEnvUrls(), []);

  const setLanguage = useCallback(
    (lng: 'it' | 'en') => {
      void i18n.changeLanguage(lng);
    },
    [i18n],
  );

  const activeLabel = active === 'en' ? t('settings.languageEn') : t('settings.languageIt');

  const btnClass = (lng: 'it' | 'en') =>
    `rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sc-ring/40 ${active === lng
      ? 'border-sc-primary/50 bg-sc-primary/12 text-sc-primary ring-1 ring-sc-primary/25'
      : 'border-sc-primary/15 bg-sc-surface/50 text-sc-text-secondary hover:border-sc-primary/30 hover:bg-sc-primary/8'
    }`;

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sc-primary/20 bg-sc-primary/10 text-sc-primary">
          <Languages className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-sc-text">{t('nav.settings')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sc-text-muted">{t('settings.pageIntro')}</p>
        </div>
      </div>

      <section
        className="mt-10 max-w-2xl rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6"
        aria-labelledby="settings-language-heading"
      >
        <h2 id="settings-language-heading" className="text-lg font-semibold text-sc-text">
          {t('settings.languageTitle')}
        </h2>
        <p className="mt-2 text-sm text-sc-text-dim">{t('settings.languageHint')}</p>
        <p className="mt-2 text-xs text-sc-text-muted">{t('settings.languageAutoNote')}</p>

        <div className="mt-6 flex flex-wrap gap-3" role="group" aria-label={t('settings.languageTitle')}>
          <button type="button" className={btnClass('it')} onClick={() => setLanguage('it')}>
            {t('settings.languageIt')}
          </button>
          <button type="button" className={btnClass('en')} onClick={() => setLanguage('en')}>
            {t('settings.languageEn')}
          </button>
        </div>

        <p className="mt-5 text-sm text-sc-text-secondary" role="status">
          {t('settings.languageCurrent', { label: activeLabel })}
        </p>
      </section>

      <section
        className="mt-10 max-w-2xl rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6"
        aria-labelledby="settings-integrations-heading"
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sc-accent/20 bg-sc-accent/10 text-sc-accent">
            <Link2 className="h-4 w-4" aria-hidden />
          </div>
          <h2 id="settings-integrations-heading" className="text-lg font-semibold text-sc-text">
            {t('settings.integrationsTitle')}
          </h2>
        </div>
        <p className="mt-2 text-sm text-sc-text-dim">{t('settings.integrationsIntro')}</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-sc-primary/12 bg-sc-bg/40 p-4">
            <h3 className="text-sm font-semibold text-sc-text">{t('settings.integrationsTimerTitle')}</h3>
            <p className="mt-2 text-xs leading-relaxed text-sc-text-muted">{t('settings.integrationsTimerBody')}</p>
            {integrationUrls.liveSpeakerTimer ? (
              <a
                href={integrationUrls.liveSpeakerTimer}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-sc-primary hover:underline"
              >
                {t('settings.integrationsOpenApp')}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <p className="mt-3 text-xs text-sc-text-dim">{t('settings.integrationsTimerEnvHint')}</p>
            )}
          </div>

          <div className="rounded-xl border border-sc-primary/12 bg-sc-bg/40 p-4">
            <h3 className="text-sm font-semibold text-sc-text">{t('settings.integrationsCrewTitle')}</h3>
            <p className="mt-2 text-xs leading-relaxed text-sc-text-muted">{t('settings.integrationsCrewBody')}</p>
            {integrationUrls.liveCrew ? (
              <a
                href={integrationUrls.liveCrew}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-sc-primary hover:underline"
              >
                {t('settings.integrationsOpenApp')}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
              </a>
            ) : (
              <p className="mt-3">
                <span className="inline-flex rounded-full border border-sc-primary/20 bg-sc-primary/10 px-2.5 py-0.5 text-xs font-medium text-sc-text-secondary">
                  {t('settings.integrationsBadgeSoon')}
                </span>
              </p>
            )}
          </div>

          <div className="rounded-xl border border-sc-primary/12 bg-sc-bg/40 p-4 sm:col-span-2">
            <h3 className="text-sm font-semibold text-sc-text">{t('settings.integrationsApiTitle')}</h3>
            <p className="mt-2 text-xs leading-relaxed text-sc-text-muted">{t('settings.integrationsApiBody')}</p>
            <p className="mt-3">
              <span className="inline-flex rounded-full border border-sc-primary/20 bg-sc-primary/10 px-2.5 py-0.5 text-xs font-medium text-sc-text-secondary">
                {t('settings.integrationsBadgeSoon')}
              </span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

export { SettingsView as Component };
