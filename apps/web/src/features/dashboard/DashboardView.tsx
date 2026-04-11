import { useTranslation } from 'react-i18next';

export default function DashboardView() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">{t('nav.dashboard')}</h1>
      <p className="mt-2 text-zinc-400">{t('app.tagline')}</p>
    </div>
  );
}

export { DashboardView as Component };
