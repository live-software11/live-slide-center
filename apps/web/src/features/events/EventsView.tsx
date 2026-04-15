import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
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
  const [createError, setCreateError] = useState<string | null>(null);

  const {
    register,
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

  const onSubmit = handleSubmit(async (values) => {
    setCreateError(null);
    const result = await create(values);
    if (result.errorMessage) {
      setCreateError(
        result.errorMessage === 'missing_tenant' ? t('event.errors.missingTenant') : result.errorMessage,
      );
      return;
    }
    reset({
      name: '',
      start_date: todayIsoDate(),
      end_date: todayIsoDate(),
    });
  });

  if (authLoading) {
    return (
      <div className="p-8 text-zinc-400">
        {t('common.loading')}
      </div>
    );
  }

  if (!tenantId) {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">
          {t('event.errors.missingTenant')}
        </p>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">
          {t('event.errors.load')}: {state.message}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-4 rounded-md bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
        >
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  if (state.status !== 'ready') {
    return (
      <div className="p-8 text-zinc-400">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-zinc-50">{t('event.titlePlural')}</h1>
      <p className="mt-2 max-w-xl text-sm text-zinc-400">{t('event.listIntro')}</p>

      <section className="mt-8 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6" aria-labelledby="new-event-title">
        <h2 id="new-event-title" className="text-lg font-semibold text-zinc-100">
          {t('event.create')}
        </h2>
        <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onSubmit} noValidate>
          <div>
            <label htmlFor="ev-name" className="mb-1 block text-sm text-zinc-400">
              {t('event.name')}
            </label>
            <input
              id="ev-name"
              className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
              aria-invalid={errors.name ? true : undefined}
              {...register('name')}
            />
            {errors.name ? (
              <p className="mt-1 text-xs text-red-400" role="alert">
                {errors.name.message}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-4">
            <div>
              <label htmlFor="ev-start" className="mb-1 block text-sm text-zinc-400">
                {t('event.startDate')}
              </label>
              <input
                id="ev-start"
                type="date"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                aria-invalid={errors.start_date ? true : undefined}
                {...register('start_date')}
              />
            </div>
            <div>
              <label htmlFor="ev-end" className="mb-1 block text-sm text-zinc-400">
                {t('event.endDate')}
              </label>
              <input
                id="ev-end"
                type="date"
                className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                aria-invalid={errors.end_date ? true : undefined}
                {...register('end_date')}
              />
            </div>
          </div>
          {errors.end_date ? (
            <p className="text-xs text-red-400" role="alert">
              {t('event.dateOrderError')}
            </p>
          ) : null}
          {createError ? (
            <p className="text-sm text-red-400" role="alert">
              {createError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {t('common.create')}
          </button>
        </form>
      </section>

      <section className="mt-10" aria-labelledby="event-list-title">
        <h2 id="event-list-title" className="text-lg font-semibold text-zinc-100">
          {t('event.listTitle')}
        </h2>
        {state.events.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">{t('event.emptyList')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {state.events.map((ev) => (
              <li key={ev.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link
                    to={`/events/${ev.id}`}
                    className="font-medium text-zinc-100 hover:text-blue-400 hover:underline"
                  >
                    {ev.name}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {ev.start_date} → {ev.end_date} · {eventStatusLabel(t, ev.status)}
                  </p>
                </div>
                <span className="text-xs uppercase text-zinc-500">{ev.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { EventsView as Component };
