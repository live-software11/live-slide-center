import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import type { RoomType } from '@/features/rooms/repository';
import type { SessionType } from '@/features/sessions/repository';
import { useEventDetail } from './hooks/useEventDetail';

const ROOM_TYPES: RoomType[] = ['main', 'breakout', 'preview', 'poster'];
const SESSION_TYPES: SessionType[] = ['talk', 'panel', 'workshop', 'break', 'ceremony'];

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

function sessionTypeLabel(t: TFunction, sessionType: string): string {
  const map: Record<string, string> = {
    talk: 'session.typeTalk',
    panel: 'session.typePanel',
    workshop: 'session.typeWorkshop',
    break: 'session.typeBreak',
    ceremony: 'session.typeCeremony',
  };
  const key = map[sessionType];
  return key ? t(key) : sessionType;
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

const sessionFormSchema = (t: TFunction) =>
  z
    .object({
      title: z.string().min(1).max(300),
      room_id: z.string().uuid(),
      session_type: z.enum(['talk', 'panel', 'workshop', 'break', 'ceremony']),
      scheduled_start: z.string().min(1),
      scheduled_end: z.string().min(1),
    })
    .refine(
      (data) => new Date(data.scheduled_end).getTime() >= new Date(data.scheduled_start).getTime(),
      { path: ['scheduled_end'], message: t('session.errors.scheduleOrder') },
    );

type SessionFormValues = z.infer<ReturnType<typeof sessionFormSchema>>;

const speakerFormSchema = (t: TFunction) =>
  z.object({
    session_id: z.string().uuid(),
    full_name: z.string().min(1).max(200),
    email: z
      .string()
      .max(320)
      .transform((s) => s.trim())
      .refine((s) => s === '' || z.string().email().safeParse(s).success, {
        message: t('speaker.errors.invalidEmail'),
      }),
  });

type SpeakerFormValues = z.infer<ReturnType<typeof speakerFormSchema>>;

export default function EventDetailView() {
  const { t, i18n } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const { session, loading: authLoading } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const dateTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'it-IT', {
        dateStyle: 'short',
        timeStyle: 'short',
      }),
    [i18n.language],
  );
  const tenantId = getTenantIdFromSession(session);
  const { state, reload, createRoom, createSession, createSpeaker } = useEventDetail(supabase, eventId, tenantId);
  const [roomCreateError, setRoomCreateError] = useState<string | null>(null);
  const [sessionCreateError, setSessionCreateError] = useState<string | null>(null);
  const [speakerCreateError, setSpeakerCreateError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchema),
    defaultValues: { name: '', room_type: 'main' },
  });

  const sessionSchemaResolved = useMemo(() => sessionFormSchema(t), [t]);
  const {
    register: registerSession,
    handleSubmit: handleSessionSubmit,
    reset: resetSessionForm,
    formState: { errors: sessionErrors, isSubmitting: sessionSubmitting },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchemaResolved),
    defaultValues: {
      title: '',
      room_id: '',
      session_type: 'talk',
      scheduled_start: '',
      scheduled_end: '',
    },
  });

  const readyEventId = state.status === 'ready' ? state.event.id : null;
  const eventStartDate = state.status === 'ready' ? state.event.start_date : null;
  const roomIdsKey = state.status === 'ready' ? state.rooms.map((r) => r.id).join(',') : null;

  useEffect(() => {
    if (!readyEventId || !eventStartDate || !roomIdsKey) return;
    const firstRoomId = roomIdsKey.split(',')[0];
    if (!firstRoomId) return;
    resetSessionForm({
      title: '',
      room_id: firstRoomId,
      session_type: 'talk',
      scheduled_start: `${eventStartDate}T09:00`,
      scheduled_end: `${eventStartDate}T10:00`,
    });
  }, [readyEventId, roomIdsKey, eventStartDate, resetSessionForm]);

  const speakerSchemaResolved = useMemo(() => speakerFormSchema(t), [t]);
  const {
    register: registerSpeaker,
    handleSubmit: handleSpeakerSubmit,
    reset: resetSpeakerForm,
    formState: { errors: speakerErrors, isSubmitting: speakerSubmitting },
  } = useForm<SpeakerFormValues>({
    resolver: zodResolver(speakerSchemaResolved),
    defaultValues: { session_id: '', full_name: '', email: '' },
  });

  const sessionIdsKey =
    state.status === 'ready' && state.sessions.length > 0
      ? state.sessions.map((s) => s.id).join(',')
      : null;

  useEffect(() => {
    if (!readyEventId || !sessionIdsKey) return;
    const firstSessionId = sessionIdsKey.split(',')[0];
    if (!firstSessionId) return;
    resetSpeakerForm({ session_id: firstSessionId, full_name: '', email: '' });
  }, [readyEventId, sessionIdsKey, resetSpeakerForm]);

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

  const onSessionSubmit = handleSessionSubmit(async (values) => {
    setSessionCreateError(null);
    const result = await createSession(values);
    if (result.errorMessage) {
      setSessionCreateError(
        result.errorMessage === 'missing_context' ? t('session.errors.missingContext') : result.errorMessage,
      );
      return;
    }
    if (eventStartDate) {
      resetSessionForm({
        title: '',
        room_id: values.room_id,
        session_type: 'talk',
        scheduled_start: `${eventStartDate}T09:00`,
        scheduled_end: `${eventStartDate}T10:00`,
      });
    }
  });

  const onSpeakerSubmit = handleSpeakerSubmit(async (values) => {
    setSpeakerCreateError(null);
    const emailTrimmed = typeof values.email === 'string' ? values.email.trim() : '';
    const emailForDb = emailTrimmed === '' ? null : emailTrimmed;
    const result = await createSpeaker({
      session_id: values.session_id,
      full_name: values.full_name,
      email: emailForDb,
    });
    if (result.errorMessage) {
      setSpeakerCreateError(
        result.errorMessage === 'missing_context' ? t('speaker.errors.missingContext') : result.errorMessage,
      );
      return;
    }
    resetSpeakerForm({
      session_id: values.session_id,
      full_name: '',
      email: '',
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

  const { event, rooms, sessions, speakers } = state;

  const speakersSorted = [...speakers].sort((a, b) => {
    const sa = sessions.find((s) => s.id === a.session_id)?.scheduled_start ?? '';
    const sb = sessions.find((s) => s.id === b.session_id)?.scheduled_start ?? '';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.display_order - b.display_order;
  });

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

      <section className="mt-12" aria-labelledby="sessions-section-title">
        <h2 id="sessions-section-title" className="text-lg font-semibold text-zinc-100">
          {t('session.titlePlural')}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t('session.eventDetailIntro')}</p>

        {rooms.length === 0 ? (
          <p className="mt-6 text-sm text-amber-400/90" role="status">
            {t('session.needRoomFirst')}
          </p>
        ) : (
          <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="text-sm font-medium text-zinc-200">{t('session.create')}</h3>
            <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onSessionSubmit} noValidate>
              <div>
                <label htmlFor="session-title" className="mb-1 block text-sm text-zinc-400">
                  {t('session.sessionTitle')}
                </label>
                <input
                  id="session-title"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  aria-invalid={sessionErrors.title ? true : undefined}
                  {...registerSession('title')}
                />
                {sessionErrors.title ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {sessionErrors.title.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="session-room" className="mb-1 block text-sm text-zinc-400">
                  {t('session.room')}
                </label>
                <select
                  id="session-room"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  {...registerSession('room_id')}
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {sessionErrors.room_id ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {sessionErrors.room_id.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="session-type" className="mb-1 block text-sm text-zinc-400">
                  {t('session.type')}
                </label>
                <select
                  id="session-type"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  {...registerSession('session_type')}
                >
                  {SESSION_TYPES.map((st) => (
                    <option key={st} value={st}>
                      {sessionTypeLabel(t, st)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="session-start" className="mb-1 block text-sm text-zinc-400">
                  {t('session.scheduledStart')}
                </label>
                <input
                  id="session-start"
                  type="datetime-local"
                  step={60}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  aria-invalid={sessionErrors.scheduled_start ? true : undefined}
                  {...registerSession('scheduled_start')}
                />
                {sessionErrors.scheduled_start ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {sessionErrors.scheduled_start.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="session-end" className="mb-1 block text-sm text-zinc-400">
                  {t('session.scheduledEnd')}
                </label>
                <input
                  id="session-end"
                  type="datetime-local"
                  step={60}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  aria-invalid={sessionErrors.scheduled_end ? true : undefined}
                  {...registerSession('scheduled_end')}
                />
                {sessionErrors.scheduled_end ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {sessionErrors.scheduled_end.message}
                  </p>
                ) : null}
              </div>
              {sessionCreateError ? (
                <p className="text-sm text-red-400" role="alert">
                  {sessionCreateError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={sessionSubmitting}
                className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {t('common.create')}
              </button>
            </form>
          </div>
        )}

        {sessions.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">{t('session.emptyEventList')}</p>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {sessions.map((s) => {
              const roomName = rooms.find((r) => r.id === s.room_id)?.name ?? t('session.roomUnknown');
              return (
                <li key={s.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-zinc-100">{s.title}</p>
                    <p className="text-xs text-zinc-500">
                      {roomName} · {sessionTypeLabel(t, s.session_type)}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {dateTimeFmt.format(new Date(s.scheduled_start))} → {dateTimeFmt.format(new Date(s.scheduled_end))}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="speakers-section-title">
        <h2 id="speakers-section-title" className="text-lg font-semibold text-zinc-100">
          {t('speaker.titlePlural')}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t('speaker.eventDetailIntro')}</p>

        {sessions.length === 0 ? (
          <p className="mt-6 text-sm text-amber-400/90" role="status">
            {t('speaker.needSessionFirst')}
          </p>
        ) : (
          <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
            <h3 className="text-sm font-medium text-zinc-200">{t('speaker.create')}</h3>
            <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onSpeakerSubmit} noValidate>
              <div>
                <label htmlFor="speaker-session" className="mb-1 block text-sm text-zinc-400">
                  {t('speaker.linkedSession')}
                </label>
                <select
                  id="speaker-session"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  {...registerSpeaker('session_id')}
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
                {speakerErrors.session_id ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {speakerErrors.session_id.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="speaker-name" className="mb-1 block text-sm text-zinc-400">
                  {t('speaker.fullName')}
                </label>
                <input
                  id="speaker-name"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  autoComplete="name"
                  aria-invalid={speakerErrors.full_name ? true : undefined}
                  {...registerSpeaker('full_name')}
                />
                {speakerErrors.full_name ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {speakerErrors.full_name.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="speaker-email" className="mb-1 block text-sm text-zinc-400">
                  {t('speaker.emailOptional')}
                </label>
                <input
                  id="speaker-email"
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none ring-blue-600 focus:ring-2"
                  aria-invalid={speakerErrors.email ? true : undefined}
                  {...registerSpeaker('email')}
                />
                {speakerErrors.email ? (
                  <p className="mt-1 text-xs text-red-400" role="alert">
                    {speakerErrors.email.message}
                  </p>
                ) : null}
              </div>
              {speakerCreateError ? (
                <p className="text-sm text-red-400" role="alert">
                  {speakerCreateError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={speakerSubmitting}
                className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {t('common.create')}
              </button>
            </form>
          </div>
        )}

        {speakersSorted.length === 0 ? (
          <p className="mt-6 text-sm text-zinc-500">{t('speaker.emptyEventList')}</p>
        ) : (
          <ul className="mt-6 divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {speakersSorted.map((sp) => {
              const sessionTitle =
                sessions.find((s) => s.id === sp.session_id)?.title ?? t('speaker.sessionUnknown');
              return (
                <li key={sp.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-zinc-100">{sp.full_name}</p>
                    <p className="text-xs text-zinc-500">{sessionTitle}</p>
                    {sp.email ? <p className="text-xs text-zinc-400">{sp.email}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export { EventDetailView as Component };
