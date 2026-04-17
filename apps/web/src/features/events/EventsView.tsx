import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
import { TenantQuotaPanel } from '@/features/tenant/components/TenantQuotaPanel';
import { useTenantQuotaRow } from '@/features/tenant/hooks/useTenantQuotaRow';
import {
  countEventsWithStartInYearMonth,
  currentYearMonthLocal,
  isUnlimitedEventsPerMonth,
} from '@/features/tenant/lib/quota-usage';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { useEvents } from './hooks/useEvents';

const schema = z
  .object({
    name: z.string().min(2).max(200),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  })
  .refine((d) => d.start_date <= d.end_date, { path: ['end_date'] });

type FormValues = z.infer<typeof schema>;

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function eventStatusLabel(t: TFunction, status: string): string {
  const map: Record<string, string> = {
    draft: 'event.statusDraft',
    setup: 'event.statusSetup',
    active: 'event.statusActive',
    closed: 'event.statusClosed',
    archived: 'event.statusArchived',
  };
  const key = map[status];
  return key ? t(key) : status;
}

export default function EventsView() {
  const { t } = useTranslation();
  const { session, loading: authLoading } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tenantId = getTenantIdFromSession(session);
  const { state, reload, create } = useEvents(supabase, tenantId);
  const quotaState = useTenantQuotaRow(supabase, tenantId);
  const [createError, setCreateError] = useState<string | null>(null);
  const yearMonthNow = useMemo(() => currentYearMonthLocal(), []);
  const eventsStartingThisMonth = useMemo(
    () => (state.status === 'ready' ? countEventsWithStartInYearMonth(state.events, yearMonthNow) : 0),
    [state, yearMonthNow],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      start_date: todayIsoDate(),
      end_date: todayIsoDate(),
    },
  });

  const startDateWatch = useWatch({ control, name: 'start_date' });
  const createDisabledByQuotaCap = useMemo(() => {
    if (quotaState.state.status !== 'ready' || state.status !== 'ready') return false;
    const row = quotaState.state.row;
    if (isUnlimitedEventsPerMonth(row.plan, row.max_events_per_month)) return false;
    const targetYm = (startDateWatch ?? '').slice(0, 7);
    if (targetYm.length !== 7) return false;
    return countEventsWithStartInYearMonth(state.events, targetYm) >= row.max_events_per_month;
  }, [quotaState.state, state, startDateWatch]);

  const onSubmit = handleSubmit(async (values) => {
    setCreateError(null);
    if (quotaState.state.status === 'ready') {
      const row = quotaState.state.row;
      if (!isUnlimitedEventsPerMonth(row.plan, row.max_events_per_month)) {
        const targetYm = values.start_date.slice(0, 7);
        const inTargetMonth = countEventsWithStartInYearMonth(
          state.status === 'ready' ? state.events : [],
          targetYm,
        );
        if (inTargetMonth >= row.max_events_per_month) {
          setCreateError(t('tenantQuota.errors.eventsPerMonthExceeded'));
          return;
        }
      }
    }
    const result = await create(values);
    if (result.errorMessage) {
      setCreateError(
        result.errorMessage === 'missing_tenant' ? t('event.errors.missingTenant') : result.errorMessage,
      );
      return;
    }
    void quotaState.reload();
    reset({
      name: '',
      start_date: todayIsoDate(),
      end_date: todayIsoDate(),
    });
  });

  if (authLoading) {
    return (
      <div className="p-6 lg:p-8 text-sc-text-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-danger" role="alert">
          {t('event.errors.missingTenant')}
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-danger" role="alert">
          {t('event.errors.load')}: {state.message}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-4 rounded-xl bg-sc-elevated px-4 py-2 text-sm hover:bg-sc-elevated"
        >
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  if (state.status !== 'ready') {
    return (
      <div className="p-6 lg:p-8 text-sc-text-muted">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <h1 className="text-2xl font-bold text-sc-text">{t('event.titlePlural')}</h1>
      <p className="mt-2 max-w-xl text-sm text-sc-text-muted">{t('event.listIntro')}</p>

      {quotaState.state.status === 'error' ? (
        <p className="mt-4 max-w-xl text-sm text-sc-warning" role="alert">
          {quotaState.state.message === 'no_tenant_row'
            ? t('tenantQuota.loadErrorNoRow')
            : `${t('tenantQuota.loadError')} (${quotaState.state.message})`}
        </p>
      ) : null}
      {quotaState.state.status === 'ready' ? (
        <div className="mt-6 max-w-2xl">
          <TenantQuotaPanel
            variant="eventsPage"
            row={quotaState.state.row}
            eventsInCurrentMonth={eventsStartingThisMonth}
          />
        </div>
      ) : quotaState.state.status === 'loading' ? (
        <p className="mt-4 text-xs text-sc-text-dim">{t('common.loading')}</p>
      ) : null}

      <section className="mt-8 rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6" aria-labelledby="new-event-title">
        <h2 id="new-event-title" className="text-lg font-semibold text-sc-text">
          {t('event.create')}
        </h2>
        <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="ev-name" className="mb-1 block text-sm text-sc-text-muted">
              {t('event.name')}
            </label>
            <input
              id="ev-name"
              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2 focus:border-sc-primary/40"
              aria-invalid={errors.name ? true : undefined}
              {...register('name')}
            />
            {errors.name ? (
              <p className="mt-1 text-xs text-sc-danger" role="alert">
                {errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="ev-start" className="mb-1 block text-sm text-sc-text-muted">
                {t('event.startDate')}
              </label>
              <input
                id="ev-start"
                type="date"
                className="rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2 focus:border-sc-primary/40"
                aria-invalid={errors.start_date ? true : undefined}
                {...register('start_date')}
              />
            </div>
            <div>
              <label htmlFor="ev-end" className="mb-1 block text-sm text-sc-text-muted">
                {t('event.endDate')}
              </label>
              <input
                id="ev-end"
                type="date"
                className="rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2 focus:border-sc-primary/40"
                aria-invalid={errors.end_date ? true : undefined}
                {...register('end_date')}
              />
            </div>
          </div>
          {errors.end_date ? (
            <p className="text-xs text-sc-danger" role="alert">
              {t('event.dateOrderError')}
            </p>
          ) : null}
          {createError ? (
            <p className="text-sm text-sc-danger" role="alert">
              {createError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting || createDisabledByQuotaCap}
            className="w-fit rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </form>
      </section>

      <section className="mt-10" aria-labelledby="event-list-title">
        <h2 id="event-list-title" className="text-lg font-semibold text-sc-text">
          {t('event.listTitle')}
        </h2>
        {state.events.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-sc-primary/25 bg-sc-surface/40 p-6 text-center">
            <h3 className="text-base font-semibold text-sc-text">{t('emptyState.eventsTitle')}</h3>
            <p className="mt-2 mx-auto max-w-md text-sm text-sc-text-muted">{t('emptyState.eventsBody')}</p>
            <Link
              to="/settings"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-sc-accent/30 bg-sc-accent/10 px-4 py-2 text-xs font-medium text-sc-accent transition-colors hover:bg-sc-accent/15"
            >
              {t('settings.demoSeedCta')}
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-sc-primary/12 rounded-xl border border-sc-primary/12">
            {state.events.map((ev) => (
              <li key={ev.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link
                    to={`/events/${ev.id}`}
                    className="font-medium text-sc-text hover:text-sc-primary hover:underline"
                  >
                    {ev.name}
                  </Link>
                  <p className="text-xs text-sc-text-dim">
                    {ev.start_date} → {ev.end_date} · {eventStatusLabel(t, ev.status)}
                  </p>
                </div>
                <span className="text-xs uppercase text-sc-text-dim">{ev.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { EventsView as Component };
