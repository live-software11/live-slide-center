import { useTranslation } from 'react-i18next';

export function SupabaseEnvMissingScreen() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-sc-bg px-6 text-sc-text"
      role="alert"
      aria-labelledby="supabase-env-missing-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-sc-warning/30 bg-sc-surface p-6 shadow-lg">
        <h1 id="supabase-env-missing-title" className="text-lg font-semibold text-sc-warning">
          {t('config.supabaseMissingTitle')}
        </h1>
        <p className="mt-2 text-sm text-sc-text-secondary">{t('config.supabaseMissingSubtitle')}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-sc-text-muted">
          <li>{t('config.supabaseMissingStep1')}</li>
          <li>{t('config.supabaseMissingStep2')}</li>
          <li>{t('config.supabaseMissingStep3')}</li>
        </ol>
        <p className="mt-4 rounded-xl bg-sc-bg/80 p-3 font-mono text-xs text-sc-text-dim">
          VITE_SUPABASE_URL=…
          <br />
          VITE_SUPABASE_ANON_KEY=…
        </p>
        <p className="mt-3 text-xs text-sc-text-dim">{t('config.supabaseMissingNote')}</p>
      </div>
    </div>
  );
}
