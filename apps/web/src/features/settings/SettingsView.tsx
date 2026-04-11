import { useTranslation } from 'react-i18next';

export default function SettingsView() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">{t('nav.settings')}</h1>
    </div>
  );
}

export { SettingsView as Component };
