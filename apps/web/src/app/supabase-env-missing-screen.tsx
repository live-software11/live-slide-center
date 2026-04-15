import { useTranslation } from 'react-i18next';

export function SupabaseEnvMissingScreen() {
  const { t } = useTranslation();

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-6 text-zinc-100"
      role="alert"
      aria-labelledby="supabase-env-missing-title"
    >
      <div className="w-full max-w-lg rounded-lg border border-amber-500/40 bg-zinc-900/80 p-6 shadow-lg">
        <h1 id="supabase-env-missing-title" className="text-lg font-semibold text-amber-400">
          {t('config.supabaseMissingTitle')}
        </h1>
        <p className="mt-2 text-sm text-zinc-300">{t('config.supabaseMissingSubtitle')}</p>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-zinc-400">
          <li>{t('config.supabaseMissingStep1')}</li>
          <li>{t('config.supabaseMissingStep2')}</li>
          <li>{t('config.supabaseMissingStep3')}</li>
        </ol>
        <p className="mt-4 rounded bg-zinc-950/80 p-3 font-mono text-xs text-zinc-500">
          VITE_SUPABASE_URL=…
          <br />
          VITE_SUPABASE_ANON_KEY=…
        </p>
        <p className="mt-3 text-xs text-zinc-600">{t('config.supabaseMissingNote')}</p>
      </div>
    </div>
  );
}
