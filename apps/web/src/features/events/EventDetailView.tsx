import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import type { RoomType } from '@/features/rooms/repository';
import { useEventDetail } from './hooks/useEventDetail';

const ROOM_TYPES: RoomType[] = ['main', 'breakout', 'preview', 'poster'];

const roomSchema = z.object({
  name: z.string().min(1).max(200),
  room_type: z.enum(['main', 'breakout', 'preview', 'poster']),
});

type RoomFormValues = z.infer<typeof roomSchema>;

function roomTypeLabel(t: TFunction, roomType: string): string {
  const map: Record<string, string> = {
    main: 'room.typeMain',
    breakout: 'room.typeBreakout',
    preview: 'room.typePreview',
    poster: 'room.typePoster',
  };
  const key = map[roomType];
  return key ? t(key) : roomType;
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

export default function EventDetailView() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { session, loading: authLoading } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tenantId = getTenantIdFromSession(session);
  const { state, reload, createRoom } = useEventDetail(supabase, eventId, tenantId);
  const [roomCreateError, setRoomCreateError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchema),
    defaultValues: { name: '', room_type: 'main' },
  });

  const onRoomSubmit = handleSubmit(async (values) => {
    setRoomCreateError(null);
    const result = await createRoom(values);
    if (result.errorMessage) {
      setRoomCreateError(
        result.errorMessage === 'missing_context' ? t('room.errors.missingContext') : result.errorMessage,
      );
      return;
    }
    reset({ name: '', room_type: 'main' });
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

  if (!eventId) {
    return (
      <div className="p-8">
        <p className="text-red-400" role="alert">
          {t('event.errors.invalidRoute')}
        </p>
        <Link to="/events" className="mt-4 inline-block text-blue-500 hover:underline">
          {t('event.detailBack')}
        </Link>
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
        <p className="mt-6">
          <Link to="/events" className="text-blue-500 hover:underline">
            {t('event.detailBack')}
          </Link>
        </p>
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="p-8">
        <p className="text-zinc-300" role="alert">
          {t('event.notFound')}
        </p>
        <Link to="/events" className="mt-6 inline-block text-blue-500 hover:underline">
          {t('event.detailBack')}
        </Link>
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

  const { event, rooms } = state;

  return (
    <div className="p-8">
      <nav className="mb-6 text-sm text-zinc-500" aria-label={t('event.detailBreadcrumb')}>
        <Link to="/events" className="hover:text-zinc-300">
          {t('event.titlePlural')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-zinc-300">{event.name}</span>
      </nav>

      <header className="border-b border-zinc-800 pb-6">
        <h1 className="text-2xl font-bold text-zinc-50">{event.name}</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {event.start_date} → {event.end_date} · {eventStatusLabel(t, event.status)}
        </p>
      </header>

      <section className="mt-8" aria-labelledby="rooms-section-title">
        <h2 id="rooms-section-title" className="text-lg font-semibold text-zinc-100">
          {t('room.titlePlural')}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t('room.eventDetailIntro')}</p>

        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
          <h3 className="text-sm font-medium text-zinc-200">{t('room.create')}</h3>
          <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onRoomSubmit} noValidate>
            <div>
              <label htmlFor="room-name" className="mb-1 block text-sm text-zinc-400">
                {t('room.name')}
              </label>
              <input
                id="room-name"
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
            <div>
              <label htmlFor="room-type" className="mb-1 block text-sm text-zinc-400">
                {t('room.type')}
              </label>
              <select
                id="room-type"
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                {...register('room_type')}
              >
                {ROOM_TYPES.map((rt) => (
                  <option key={rt} value={rt}>
                    {roomTypeLabel(t, rt)}
                  </option>
                ))}
              </select>
            </div>
            {roomCreateError ? (
              <p className="text-sm text-red-400" role="alert">
                {roomCreateError}
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
        </div>

        {rooms.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">{t('room.emptyEventList')}</p>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {rooms.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium text-zinc-100">{r.name}</p>
                  <p className="text-xs text-zinc-500">{roomTypeLabel(t, r.room_type)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { EventDetailView as Component };
