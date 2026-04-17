import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Languages, Link2, Sparkles, Trash2, RotateCcw, PlayCircle } from 'lucide-react';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getIntegrationsEnvUrls } from '@/features/settings/lib/integrations-env';
import { clearDemoData, resetTenantOnboarding, seedDemoData } from '@/features/onboarding/repository';

function normalizeLang(code: string | undefined): 'it' | 'en' {
  const base = (code ?? 'it').split('-')[0]?.toLowerCase() ?? 'it';
  return base === 'en' ? 'en' : 'it';
}

type DemoActionState =
  | { status: 'idle' }
  | { status: 'busy' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export default function SettingsView() {
  const { t, i18n } = useTranslation();
  const active = useMemo(() => normalizeLang(i18n.language), [i18n.language]);
  const integrationUrls = useMemo(() => getIntegrationsEnvUrls(), []);
  const { session } = useAuth();
  const role = session?.user?.app_metadata?.role;
  const isAdmin = role === 'admin';
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [seedState, setSeedState] = useState<DemoActionState>({ status: 'idle' });
  const [clearState, setClearState] = useState<DemoActionState>({ status: 'idle' });
  const [resetState, setResetState] = useState<DemoActionState>({ status: 'idle' });

  const setLanguage = useCallback(
    (lng: 'it' | 'en') => {
      void i18n.changeLanguage(lng);
    },
    [i18n],
  );

  const handleSeedDemo = useCallback(async () => {
    setSeedState({ status: 'busy' });
    try {
      const res = await seedDemoData(supabase);
      setSeedState({
        status: 'success',
        message: res.created
          ? t('settings.demoSeedSuccessNew')
          : t('settings.demoSeedSuccessExisting'),
      });
    } catch (err) {
      setSeedState({ status: 'error', message: err instanceof Error ? err.message : 'unknown' });
    }
  }, [supabase, t]);

  const handleClearDemo = useCallback(async () => {
    if (!window.confirm(t('settings.demoClearConfirm'))) return;
    setClearState({ status: 'busy' });
    try {
      const res = await clearDemoData(supabase);
      const count = res.deleted_events ?? 0;
      setClearState({
        status: 'success',
        message: count > 0
          ? t('settings.demoClearSuccess', { count })
          : t('settings.demoClearNothing'),
      });
    } catch (err) {
      setClearState({ status: 'error', message: err instanceof Error ? err.message : 'unknown' });
    }
  }, [supabase, t]);

  const handleResetOnboarding = useCallback(async () => {
    setResetState({ status: 'busy' });
    try {
      await resetTenantOnboarding(supabase);
      setResetState({ status: 'success', message: t('settings.onboardingResetSuccess') });
    } catch (err) {
      setResetState({ status: 'error', message: err instanceof Error ? err.message : 'unknown' });
    }
  }, [supabase, t]);

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

      {isAdmin ? (
        <section
          className="mt-10 max-w-2xl rounded-xl border border-sc-accent/20 bg-sc-accent/5 p-6"
          aria-labelledby="settings-demo-heading"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-sc-accent/25 bg-sc-accent/10 text-sc-accent">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <h2 id="settings-demo-heading" className="text-lg font-semibold text-sc-text">
              {t('settings.demoTitle')}
            </h2>
          </div>
          <p className="mt-2 text-sm text-sc-text-dim">{t('settings.demoIntro')}</p>

          <div className="mt-5 grid gap-3">
            <DemoActionRow
              icon={<PlayCircle className="h-4 w-4" aria-hidden />}
              title={t('settings.demoSeedTitle')}
              body={t('settings.demoSeedBody')}
              ctaLabel={t('settings.demoSeedCta')}
              busy={seedState.status === 'busy'}
              onClick={() => void handleSeedDemo()}
              tone="primary"
              feedback={seedState}
            />
            <DemoActionRow
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              title={t('settings.demoClearTitle')}
              body={t('settings.demoClearBody')}
              ctaLabel={t('settings.demoClearCta')}
              busy={clearState.status === 'busy'}
              onClick={() => void handleClearDemo()}
              tone="danger"
              feedback={clearState}
            />
            <DemoActionRow
              icon={<RotateCcw className="h-4 w-4" aria-hidden />}
              title={t('settings.onboardingResetTitle')}
              body={t('settings.onboardingResetBody')}
              ctaLabel={t('settings.onboardingResetCta')}
              busy={resetState.status === 'busy'}
              onClick={() => void handleResetOnboarding()}
              tone="muted"
              feedback={resetState}
            />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function DemoActionRow({
  icon,
  title,
  body,
  ctaLabel,
  busy,
  onClick,
  tone,
  feedback,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaLabel: string;
  busy: boolean;
  onClick: () => void;
  tone: 'primary' | 'danger' | 'muted';
  feedback: DemoActionState;
}) {
  const { t } = useTranslation();
  const buttonClass = (() => {
    if (tone === 'primary') {
      return 'inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sc-primary/85 disabled:opacity-50';
    }
    if (tone === 'danger') {
      return 'inline-flex items-center gap-1.5 rounded-xl border border-sc-danger/40 bg-sc-danger/10 px-4 py-2 text-sm font-medium text-sc-danger transition-colors hover:bg-sc-danger/15 disabled:opacity-50';
    }
    return 'inline-flex items-center gap-1.5 rounded-xl border border-sc-primary/20 px-4 py-2 text-sm font-medium text-sc-text-secondary transition-colors hover:bg-sc-primary/8 disabled:opacity-50';
  })();
  return (
    <div className="rounded-xl border border-sc-primary/12 bg-sc-bg/50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-sc-text">
            <span className="text-sc-text-muted">{icon}</span>
            {title}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-sc-text-muted">{body}</p>
        </div>
        <button type="button" disabled={busy} onClick={onClick} className={buttonClass}>
          {busy ? t('common.loading') : ctaLabel}
        </button>
      </div>
      {feedback.status === 'success' ? (
        <p className="mt-3 text-xs text-sc-success" role="status">
          {feedback.message}
        </p>
      ) : null}
      {feedback.status === 'error' ? (
        <p className="mt-3 text-xs text-sc-danger" role="alert">
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}

export { SettingsView as Component };
