import { useTranslation } from 'react-i18next';

export default function EventsView() {
  const { t } = useTranslation();
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">{t('event.titlePlural')}</h1>
    </div>
  );
}

export { EventsView as Component };
