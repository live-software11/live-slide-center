import { useTranslation } from 'react-i18next';

/** Fallback mostrato durante l'hydration iniziale del router (React Router 7). */
export function HydrateFallback() {
  const { t } = useTranslation();
  return <p className="p-8 text-sc-text-muted">{t('common.loading')}</p>;
}
