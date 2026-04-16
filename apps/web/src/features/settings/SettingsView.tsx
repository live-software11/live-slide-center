import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';

function normalizeLang(code: string | undefined): 'it' | 'en' {
  const base = (code ?? 'it').split('-')[0]?.toLowerCase() ?? 'it';
  return base === 'en' ? 'en' : 'it';
}

export default function SettingsView() {
  const { t, i18n } = useTranslation();
  const active = useMemo(() => normalizeLang(i18n.language), [i18n.language]);

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
    </div>
  );
}

export { SettingsView as Component };
