import { useMemo } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { formatBytes } from '@/features/admin/lib/format-bytes';
import type { TenantQuotaRow } from '../repository';
import { currentYearMonthLocal, isUnlimitedEventsPerMonth, isUnlimitedRoomsPerEvent, isUnlimitedStorage, storageUsageRatio } from '../lib/quota-usage';

type Variant = 'eventsPage' | 'eventDetail';

function planLabel(t: TFunction, plan: TenantQuotaRow['plan']): string {
  const key = `tenantQuota.planLabels.${plan}` as const;
  return t(key);
}

type Props = {
  variant: Variant;
  row: TenantQuotaRow;
  /** Solo `eventsPage`: eventi con `start_date` nel mese corrente (calendario locale). */
  eventsInCurrentMonth?: number;
  /** Solo `eventDetail`: numero sale nell'evento aperto. */
  roomsInThisEvent?: number;
};

export function TenantQuotaPanel({ variant, row, eventsInCurrentMonth = 0, roomsInThisEvent }: Props) {
  const { t, i18n } = useTranslation();
  const ym = useMemo(() => currentYearMonthLocal(), []);
  const monthTitle = useMemo(() => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, (m ?? 1) - 1, 1);
    return new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'it-IT', {
      month: 'long',
      year: 'numeric',
    }).format(d);
  }, [ym, i18n.language]);

  const unlimitedEvents = isUnlimitedEventsPerMonth(row.plan, row.max_events_per_month);
  const unlimitedRooms = isUnlimitedRoomsPerEvent(row.plan, row.max_rooms_per_event);
  const unlimitedStorage = isUnlimitedStorage(row.plan, row.storage_limit_bytes);

  const eventsAtOrOverCap =
    variant === 'eventsPage' &&
    !unlimitedEvents &&
    eventsInCurrentMonth >= row.max_events_per_month;
  const roomsAtOrOverCap =
    variant === 'eventDetail' &&
    typeof roomsInThisEvent === 'number' &&
    !unlimitedRooms &&
    roomsInThisEvent >= row.max_rooms_per_event;

  const storagePct = unlimitedStorage ? 0 : storageUsageRatio(row.storage_used_bytes, row.storage_limit_bytes);

  return (
    <section
      className="rounded-xl border border-sc-primary/12 bg-sc-surface/50 p-4"
      aria-label={t('tenantQuota.sectionAria')}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-sc-text">{t('tenantQuota.sectionTitle')}</h2>
        <span className="text-xs text-sc-text-dim">
          {t('tenantQuota.planLine', { plan: planLabel(t, row.plan) })}
        </span>
      </div>
      {variant === 'eventsPage' ? (
        <p className="mt-2 text-xs text-sc-text-dim">{t('tenantQuota.eventsMonthHint', { month: monthTitle })}</p>
      ) : (
        <p className="mt-2 text-xs text-sc-text-dim">{t('tenantQuota.eventDetailIntro')}</p>
      )}

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs uppercase tracking-wide text-sc-text-dim">{t('tenantQuota.storageLabel')}</dt>
          <dd className="mt-1 text-sc-text">
            {unlimitedStorage ? (
              t('tenantQuota.storageUnlimited', { used: formatBytes(row.storage_used_bytes) })
            ) : (
              <>
                {formatBytes(row.storage_used_bytes)} / {formatBytes(row.storage_limit_bytes)}
                <div
                  className="mt-2 h-2 overflow-hidden rounded-full bg-sc-elevated"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(storagePct)}
                  aria-label={t('tenantQuota.storageMeterAria')}
                >
                  <div
                    className={`h-full rounded-full ${storagePct >= 90 ? 'bg-sc-warning' : 'bg-sc-primary'}`}
                    style={{ width: `${storagePct}%` }}
                  />
                </div>
              </>
            )}
          </dd>
        </div>
        {variant === 'eventsPage' ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-sc-text-dim">{t('tenantQuota.eventsThisMonthLabel')}</dt>
            <dd className="mt-1 text-sc-text">
              {unlimitedEvents
                ? t('tenantQuota.unlimited')
                : t('tenantQuota.usedOf', {
                    used: eventsInCurrentMonth,
                    total: row.max_events_per_month,
                  })}
              {eventsAtOrOverCap ? (
                <p className="mt-1 text-xs text-sc-warning" role="status">
                  {t('tenantQuota.eventsAtCap')}
                </p>
              ) : null}
            </dd>
          </div>
        ) : typeof roomsInThisEvent === 'number' ? (
          <div>
            <dt className="text-xs uppercase tracking-wide text-sc-text-dim">{t('tenantQuota.roomsThisEventLabel')}</dt>
            <dd className="mt-1 text-sc-text">
              {unlimitedRooms
                ? t('tenantQuota.unlimited')
                : t('tenantQuota.usedOf', {
                    used: roomsInThisEvent,
                    total: row.max_rooms_per_event,
                  })}
              {roomsAtOrOverCap ? (
                <p className="mt-1 text-xs text-sc-warning" role="status">
                  {t('tenantQuota.roomsAtCap')}
                </p>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
