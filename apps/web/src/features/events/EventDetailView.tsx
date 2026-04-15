import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import QRCode from 'react-qr-code';
import { z } from 'zod';
import { useAuth } from '@/app/use-auth';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getUploadPortalAbsoluteUrl } from '@/lib/upload-portal-url';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import type { EventStatus, NetworkMode } from '@/features/events/repository';
import type { RoomType } from '@/features/rooms/repository';
import type { SessionRow, SessionType } from '@/features/sessions/repository';

const NETWORK_MODES: NetworkMode[] = ['cloud', 'intranet', 'hybrid'];

const EVENT_STATUSES: EventStatus[] = ['draft', 'setup', 'active', 'closed', 'archived'];
import { TenantQuotaPanel } from '@/features/tenant/components/TenantQuotaPanel';
import { useTenantQuotaRow } from '@/features/tenant/hooks/useTenantQuotaRow';
import { isUnlimitedRoomsPerEvent } from '@/features/tenant/lib/quota-usage';
import {
  formatSpeakerCsvIssue,
  parseAndResolveSpeakerCsv,
  speakerCsvTemplateContent,
} from '@/features/speakers/lib/speaker-csv-import';
import { useEventDetail } from './hooks/useEventDetail';
import { PresentationVersionsPanel } from '@/features/presentations/components/PresentationVersionsPanel';
import { DevicesPanel } from '@/features/devices/DevicesPanel';

const ROOM_TYPES: RoomType[] = ['main', 'breakout', 'preview', 'poster'];
const SESSION_TYPES: SessionType[] = ['talk', 'panel', 'workshop', 'break', 'ceremony'];

const roomSchema = (t: TFunction) =>
  z.object({
    name: z.string().min(1, t('room.errors.nameRequired')).max(200),
    room_type: z.enum(['main', 'breakout', 'preview', 'poster']),
  });

type RoomFormValues = z.infer<ReturnType<typeof roomSchema>>;

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

type PendingDelete = { kind: 'room' | 'session' | 'speaker'; id: string };

function reorderSessionIdList(ids: readonly string[], fromId: string, toId: string): string[] {
  const arr = [...ids];
  const fromIdx = arr.indexOf(fromId);
  const toIdx = arr.indexOf(toId);
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return [...ids];
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
  return arr;
}

type RoomEditDraft = { id: string; name: string; room_type: RoomType };

type SessionEditDraft = {
  id: string;
  title: string;
  room_id: string;
  session_type: SessionType;
  scheduled_start: string;
  scheduled_end: string;
};

type SpeakerEditDraft = { id: string; session_id: string; full_name: string; email: string };

/** Valore `datetime-local` nel fuso del browser da stringa ISO salvata in DB. */
function toDatetimeLocalValue(isoUtc: string): string {
  const d = new Date(isoUtc);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

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
  const navigate = useNavigate();
  const {
    state,
    reload,
    updateEvent,
    deleteEvent,
    createRoom,
    updateRoom,
    createSession,
    reorderSessions,
    updateSession,
    createSpeaker,
    updateSpeaker,
    deleteRoom,
    deleteSession,
    deleteSpeaker,
    regenerateSpeakerUpload,
    importSpeakersBulk,
  } = useEventDetail(supabase, eventId, tenantId);
  const quotaState = useTenantQuotaRow(supabase, tenantId);
  const [roomCreateError, setRoomCreateError] = useState<string | null>(null);
  const [sessionCreateError, setSessionCreateError] = useState<string | null>(null);
  const [sessionReorderBusy, setSessionReorderBusy] = useState(false);
  const [sessionReorderError, setSessionReorderError] = useState<string | null>(null);
  const [sessionScheduleView, setSessionScheduleView] = useState<'list' | 'byRoom'>('list');
  const [speakerCreateError, setSpeakerCreateError] = useState<string | null>(null);
  const [speakerAuxError, setSpeakerAuxError] = useState<string | null>(null);
  const [copiedSpeakerId, setCopiedSpeakerId] = useState<string | null>(null);
  const [regenerateBusyId, setRegenerateBusyId] = useState<string | null>(null);
  const [roomEditDraft, setRoomEditDraft] = useState<RoomEditDraft | null>(null);
  const [roomEditBusy, setRoomEditBusy] = useState(false);
  const [roomEditError, setRoomEditError] = useState<string | null>(null);
  const [sessionEditDraft, setSessionEditDraft] = useState<SessionEditDraft | null>(null);
  const [sessionEditBusy, setSessionEditBusy] = useState(false);
  const [sessionEditError, setSessionEditError] = useState<string | null>(null);
  const [speakerEditDraft, setSpeakerEditDraft] = useState<SpeakerEditDraft | null>(null);
  const [versionsExpandedSpeakerId, setVersionsExpandedSpeakerId] = useState<string | null>(null);
  const [speakerEditBusy, setSpeakerEditBusy] = useState(false);
  const [speakerEditError, setSpeakerEditError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const speakerCsvInputRef = useRef<HTMLInputElement>(null);
  const [csvImportBusy, setCsvImportBusy] = useState(false);
  const [csvFeedback, setCsvFeedback] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [eventEditMode, setEventEditMode] = useState(false);
  const [eventEditBusy, setEventEditBusy] = useState(false);
  const [eventEditError, setEventEditError] = useState<string | null>(null);
  const [pendingEventDelete, setPendingEventDelete] = useState(false);
  const [eventDeleteBusy, setEventDeleteBusy] = useState(false);

  const roomSchemaResolved = useMemo(() => roomSchema(t), [t]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RoomFormValues>({
    resolver: zodResolver(roomSchemaResolved),
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

  const roomsQuotaBlocked = useMemo(() => {
    if (state.status !== 'ready' || quotaState.state.status !== 'ready') return false;
    const row = quotaState.state.row;
    if (isUnlimitedRoomsPerEvent(row.plan, row.max_rooms_per_event)) return false;
    return state.rooms.length >= row.max_rooms_per_event;
  }, [state, quotaState.state]);

  const sessionsOrdered = useMemo(() => {
    if (state.status !== 'ready') return [];
    return [...state.sessions].sort(
      (a, b) => a.display_order - b.display_order || a.scheduled_start.localeCompare(b.scheduled_start),
    );
  }, [state]);

  const sessionsByRoom = useMemo(() => {
    if (state.status !== 'ready') return new Map<string, SessionRow[]>();
    const map = new Map<string, SessionRow[]>();
    for (const r of state.rooms) {
      map.set(r.id, []);
    }
    for (const s of state.sessions) {
      const list = map.get(s.room_id) ?? [];
      list.push(s);
      map.set(s.room_id, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
    }
    return map;
  }, [state]);

  const downloadSpeakerCsvTemplate = useCallback(() => {
    const blob = new Blob([speakerCsvTemplateContent()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'speakers_import_template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, []);

  const onSpeakerCsvSelected = useCallback(
    async (files: FileList | null) => {
      setCsvFeedback(null);
      const file = files?.[0];
      if (!file || state.status !== 'ready') return;
      const text = await file.text();
      const parsed = parseAndResolveSpeakerCsv(text, state.sessions);
      if ('issues' in parsed) {
        setCsvFeedback({
          variant: 'error',
          message: parsed.issues.map((issue) => formatSpeakerCsvIssue(t, issue)).join('\n'),
        });
        return;
      }
      setCsvImportBusy(true);
      const out = await importSpeakersBulk(parsed.rows);
      setCsvImportBusy(false);
      if (out.errorMessage === 'missing_context') {
        setCsvFeedback({ variant: 'error', message: t('speaker.errors.missingContext') });
      } else if (out.errorMessage) {
        setCsvFeedback({
          variant: 'error',
          message: t('speaker.csvImport.partialFailure', {
            imported: out.imported,
            total: parsed.rows.length,
            reason: out.errorMessage,
          }),
        });
      } else {
        setCsvFeedback({
          variant: 'success',
          message: t('speaker.csvImport.success', { count: out.imported }),
        });
      }
    },
    [state, importSpeakersBulk, t],
  );

  const onRoomSubmit = handleSubmit(async (values) => {
    setRoomCreateError(null);
    if (state.status === 'ready' && quotaState.state.status === 'ready') {
      const row = quotaState.state.row;
      if (
        !isUnlimitedRoomsPerEvent(row.plan, row.max_rooms_per_event) &&
        state.rooms.length >= row.max_rooms_per_event
      ) {
        setRoomCreateError(t('tenantQuota.errors.roomsPerEventExceeded'));
        return;
      }
    }
    const result = await createRoom(values);
    if (result.errorMessage) {
      setRoomCreateError(
        result.errorMessage === 'missing_context' ? t('room.errors.missingContext') : result.errorMessage,
      );
      return;
    }
    void quotaState.reload();
    reset({ name: '', room_type: 'main' });
  });

  const submitRoomEdit = useCallback(async () => {
    if (!roomEditDraft) return;
    const name = roomEditDraft.name.trim();
    if (name.length < 1) {
      setRoomEditError(t('room.errors.nameRequired'));
      return;
    }
    setRoomEditBusy(true);
    setRoomEditError(null);
    const res = await updateRoom(roomEditDraft.id, { name, room_type: roomEditDraft.room_type });
    setRoomEditBusy(false);
    if (res.errorMessage) {
      setRoomEditError(
        res.errorMessage === 'missing_context' ? t('room.errors.missingContext') : res.errorMessage,
      );
      return;
    }
    setRoomEditDraft(null);
  }, [roomEditDraft, updateRoom, t]);

  const submitSessionEdit = useCallback(async () => {
    if (!sessionEditDraft) return;
    const title = sessionEditDraft.title.trim();
    if (title.length < 1) {
      setSessionEditError(t('session.errors.titleRequired'));
      return;
    }
    if (new Date(sessionEditDraft.scheduled_end).getTime() < new Date(sessionEditDraft.scheduled_start).getTime()) {
      setSessionEditError(t('session.errors.scheduleOrder'));
      return;
    }
    setSessionEditBusy(true);
    setSessionEditError(null);
    const res = await updateSession(sessionEditDraft.id, {
      title,
      room_id: sessionEditDraft.room_id,
      session_type: sessionEditDraft.session_type,
      scheduled_start: sessionEditDraft.scheduled_start,
      scheduled_end: sessionEditDraft.scheduled_end,
    });
    setSessionEditBusy(false);
    if (res.errorMessage) {
      setSessionEditError(
        res.errorMessage === 'missing_context' ? t('session.errors.missingContext') : res.errorMessage,
      );
      return;
    }
    setSessionEditDraft(null);
  }, [sessionEditDraft, updateSession, t]);

  const submitSpeakerEdit = useCallback(async () => {
    if (!speakerEditDraft) return;
    const name = speakerEditDraft.full_name.trim();
    if (name.length < 1) {
      setSpeakerEditError(t('speaker.errors.nameRequired'));
      return;
    }
    const emailTrim = speakerEditDraft.email.trim();
    if (emailTrim !== '' && !z.string().email().safeParse(emailTrim).success) {
      setSpeakerEditError(t('speaker.errors.invalidEmail'));
      return;
    }
    const emailForDb = emailTrim === '' ? null : emailTrim;
    setSpeakerEditBusy(true);
    setSpeakerEditError(null);
    const res = await updateSpeaker(speakerEditDraft.id, {
      session_id: speakerEditDraft.session_id,
      full_name: name,
      email: emailForDb,
    });
    setSpeakerEditBusy(false);
    if (res.errorMessage) {
      setSpeakerEditError(
        res.errorMessage === 'missing_context' ? t('speaker.errors.missingContext') : res.errorMessage,
      );
      return;
    }
    setSpeakerEditDraft(null);
  }, [speakerEditDraft, updateSpeaker, t]);

  const onSessionSubmit = handleSessionSubmit(async (values) => {
    setSessionCreateError(null);
    const maxOrder =
      state.status === 'ready' ? state.sessions.reduce((m, s) => Math.max(m, s.display_order), -1) : -1;
    const result = await createSession({
      ...values,
      display_order: maxOrder + 1,
    });
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
    setSpeakerAuxError(null);
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
    setSpeakerEditDraft(null);
    setSpeakerEditError(null);
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

  if (!eventId) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-danger" role="alert">
          {t('event.errors.invalidRoute')}
        </p>
        <Link to="/events" className="mt-4 inline-block text-sc-primary hover:underline">
          {t('event.detailBack')}
        </Link>
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
        <p className="mt-6">
          <Link to="/events" className="text-sc-primary hover:underline">
            {t('event.detailBack')}
          </Link>
        </p>
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-text-secondary" role="alert">
          {t('event.notFound')}
        </p>
        <Link to="/events" className="mt-6 inline-block text-sc-primary hover:underline">
          {t('event.detailBack')}
        </Link>
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

  const { event, rooms, sessions, speakers } = state;

  const speakersSorted = [...speakers].sort((a, b) => {
    const sa = sessions.find((s) => s.id === a.session_id)?.scheduled_start ?? '';
    const sb = sessions.find((s) => s.id === b.session_id)?.scheduled_start ?? '';
    if (sa !== sb) return sa.localeCompare(sb);
    return a.display_order - b.display_order;
  });

  return (
    <div className="p-6 lg:p-8">
      <nav className="mb-6 text-sm text-sc-text-dim" aria-label={t('event.detailBreadcrumb')}>
        <Link to="/events" className="hover:text-sc-text-secondary">
          {t('event.titlePlural')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-sc-text-secondary">{event.name}</span>
      </nav>

      <header className="border-b border-sc-primary/12 pb-6">
        {eventEditMode ? (
          <form
            className="flex max-w-xl flex-col gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const name = (fd.get('ev_name') as string).trim();
              const start = fd.get('ev_start') as string;
              const end = fd.get('ev_end') as string;
              const status = fd.get('ev_status') as EventStatus;
              const networkMode = fd.get('ev_network_mode') as NetworkMode;
              if (!name || !start || !end) return;
              if (new Date(end) < new Date(start)) {
                setEventEditError(t('validation.dateEndBeforeStart'));
                return;
              }
              setEventEditBusy(true);
              setEventEditError(null);
              const res = await updateEvent({ name, start_date: start, end_date: end, status, network_mode: networkMode });
              setEventEditBusy(false);
              if (res.errorMessage) {
                setEventEditError(res.errorMessage);
              } else {
                setEventEditMode(false);
              }
            }}
          >
            <div>
              <label htmlFor="ev-name" className="mb-1 block text-sm text-sc-text-muted">{t('event.name')}</label>
              <input id="ev-name" name="ev_name" defaultValue={event.name} required
                className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="ev-start" className="mb-1 block text-sm text-sc-text-muted">{t('event.startDate')}</label>
                <input id="ev-start" name="ev_start" type="date" defaultValue={event.start_date} required
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2" />
              </div>
              <div className="flex-1">
                <label htmlFor="ev-end" className="mb-1 block text-sm text-sc-text-muted">{t('event.endDate')}</label>
                <input id="ev-end" name="ev_end" type="date" defaultValue={event.end_date} required
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2" />
              </div>
            </div>
            <div>
              <label htmlFor="ev-status" className="mb-1 block text-sm text-sc-text-muted">{t('event.status')}</label>
              <select id="ev-status" name="ev_status" defaultValue={event.status}
                className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2">
                {EVENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{eventStatusLabel(t, s)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ev-network-mode" className="mb-1 block text-sm text-sc-text-muted">{t('event.networkMode')}</label>
              <select id="ev-network-mode" name="ev_network_mode" defaultValue={event.network_mode ?? 'cloud'}
                className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2">
                {NETWORK_MODES.map((m) => (
                  <option key={m} value={m}>{t(`event.networkMode_${m}`)}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-sc-text-dim">{t(`event.networkModeHint_${event.network_mode ?? 'cloud'}`)}</p>
            </div>
            {eventEditError ? <p className="text-xs text-sc-danger" role="alert">{eventEditError}</p> : null}
            <div className="flex gap-2">
              <button type="submit" disabled={eventEditBusy}
                className="rounded-xl bg-sc-primary px-4 py-1.5 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50">
                {t('common.save')}
              </button>
              <button type="button" disabled={eventEditBusy}
                className="rounded-xl bg-sc-elevated px-4 py-1.5 text-sm font-medium text-sc-text-secondary hover:bg-sc-elevated"
                onClick={() => { setEventEditMode(false); setEventEditError(null); }}>
                {t('common.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-sc-text">{event.name}</h1>
              <p className="mt-2 text-sm text-sc-text-muted">
                {event.start_date} → {event.end_date} · {eventStatusLabel(t, event.status)}
                {' · '}
                <span className="inline-flex items-center gap-1 rounded-full border border-sc-primary/20 bg-sc-surface px-2 py-0.5 text-xs font-medium text-sc-text-secondary">
                  {t(`event.networkMode_${event.network_mode ?? 'cloud'}`)}
                </span>
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Link
                to={`/events/${event.id}/live`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-sc-primary/30 bg-sc-primary/10 px-3 py-1.5 text-sm font-medium text-sc-primary hover:bg-sc-primary/15"
              >
                <span className="h-2 w-2 rounded-full bg-sc-primary animate-pulse" aria-hidden />
                {t('liveView.badge')}
              </Link>
              <button type="button"
                className="rounded-xl bg-sc-elevated px-3 py-1.5 text-sm font-medium text-sc-text-secondary hover:bg-sc-elevated"
                onClick={() => setEventEditMode(true)}>
                {t('event.edit')}
              </button>
              {pendingEventDelete ? (
                <div className="flex flex-col items-end gap-1">
                  <p className="max-w-xs text-right text-xs text-sc-warning">{t('event.deleteCascadeHint')}</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={eventDeleteBusy}
                      className="rounded-xl bg-sc-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-sc-danger/80 disabled:opacity-50"
                      onClick={async () => {
                        setEventDeleteBusy(true);
                        setDeleteError(null);
                        const res = await deleteEvent();
                        setEventDeleteBusy(false);
                        if (res.errorMessage) {
                          setDeleteError(res.errorMessage);
                          setPendingEventDelete(false);
                        } else {
                          navigate('/events', { replace: true });
                        }
                      }}>
                      {t('common.confirmDelete')}
                    </button>
                    <button type="button" disabled={eventDeleteBusy}
                      className="rounded-xl bg-sc-elevated px-3 py-1.5 text-sm text-sc-text-secondary hover:bg-sc-elevated"
                      onClick={() => setPendingEventDelete(false)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button"
                  className="rounded-xl bg-sc-danger/15 px-3 py-1.5 text-sm font-medium text-sc-danger hover:bg-sc-danger/25"
                  aria-label={t('event.deleteAriaLabel', { name: event.name })}
                  onClick={() => setPendingEventDelete(true)}>
                  {t('event.delete')}
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      {deleteError ? (
        <div
          className="mt-4 rounded-xl border border-sc-danger/20 bg-sc-danger/10 px-4 py-3 text-sm text-sc-danger"
          role="alert"
        >
          <p>
            {t('event.errors.deleteFailed')}: {deleteError}
          </p>
          <button
            type="button"
            className="mt-2 text-xs text-sc-danger underline hover:text-sc-danger"
            onClick={() => setDeleteError(null)}
          >
            {t('common.close')}
          </button>
        </div>
      ) : null}

      {quotaState.state.status === 'error' ? (
        <p className="mt-4 max-w-xl text-sm text-sc-warning" role="alert">
          {quotaState.state.message === 'no_tenant_row'
            ? t('tenantQuota.loadErrorNoRow')
            : `${t('tenantQuota.loadError')} (${quotaState.state.message})`}
        </p>
      ) : null}
      {quotaState.state.status === 'ready' ? (
        <div className="mt-6 max-w-2xl">
          <TenantQuotaPanel variant="eventDetail" row={quotaState.state.row} roomsInThisEvent={rooms.length} />
        </div>
      ) : quotaState.state.status === 'loading' && state.status === 'ready' ? (
        <p className="mt-4 text-xs text-sc-text-dim">{t('common.loading')}</p>
      ) : null}

      <section className="mt-8" aria-labelledby="rooms-section-title">
        <h2 id="rooms-section-title" className="text-lg font-semibold text-sc-text">
          {t('room.titlePlural')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-dim">{t('room.eventDetailIntro')}</p>

        <div className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6">
          <h3 className="text-sm font-medium text-sc-text">{t('room.create')}</h3>
          <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onRoomSubmit} noValidate>
            <div>
              <label htmlFor="room-name" className="mb-1 block text-sm text-sc-text-muted">
                {t('room.name')}
              </label>
              <input
                id="room-name"
                className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                aria-invalid={errors.name ? true : undefined}
                {...register('name')}
              />
              {errors.name ? (
                <p className="mt-1 text-xs text-sc-danger" role="alert">
                  {errors.name.message}
                </p>
              ) : null}
            </div>
            <div>
              <label htmlFor="room-type" className="mb-1 block text-sm text-sc-text-muted">
                {t('room.type')}
              </label>
              <select
                id="room-type"
                className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
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
              <p className="text-sm text-sc-danger" role="alert">
                {roomCreateError}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={isSubmitting || roomsQuotaBlocked}
              className="w-fit rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
            >
              {t('common.create')}
            </button>
          </form>
        </div>

        {rooms.length === 0 ? (
          <p className="mt-6 text-sm text-sc-text-dim">{t('room.emptyEventList')}</p>
        ) : (
          <ul className="mt-6 divide-y divide-sc-primary/12 rounded-xl border border-sc-primary/12">
            {rooms.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  {roomEditDraft?.id === r.id ? (
                    <form
                      className="flex max-w-lg flex-col gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void submitRoomEdit();
                      }}
                    >
                      <div>
                        <label htmlFor={`room-edit-name-${r.id}`} className="mb-1 block text-sm text-sc-text-muted">
                          {t('room.name')}
                        </label>
                        <input
                          id={`room-edit-name-${r.id}`}
                          value={roomEditDraft.name}
                          onChange={(e) =>
                            setRoomEditDraft((d) => (d?.id === r.id ? { ...d, name: e.target.value } : d))
                          }
                          className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label htmlFor={`room-edit-type-${r.id}`} className="mb-1 block text-sm text-sc-text-muted">
                          {t('room.type')}
                        </label>
                        <select
                          id={`room-edit-type-${r.id}`}
                          value={roomEditDraft.room_type}
                          onChange={(e) =>
                            setRoomEditDraft((d) =>
                              d?.id === r.id ? { ...d, room_type: e.target.value as RoomType } : d,
                            )
                          }
                          className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                        >
                          {ROOM_TYPES.map((rt) => (
                            <option key={rt} value={rt}>
                              {roomTypeLabel(t, rt)}
                            </option>
                          ))}
                        </select>
                      </div>
                      {roomEditError ? (
                        <p className="text-xs text-sc-danger" role="alert">
                          {roomEditError}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          disabled={roomEditBusy}
                          className="rounded-xl bg-sc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
                        >
                          {t('common.save')}
                        </button>
                        <button
                          type="button"
                          disabled={roomEditBusy}
                          className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
                          onClick={() => {
                            setRoomEditDraft(null);
                            setRoomEditError(null);
                          }}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="font-medium text-sc-text">{r.name}</p>
                      <p className="text-xs text-sc-text-dim">{roomTypeLabel(t, r.room_type)}</p>
                    </>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                  {pendingDelete?.kind === 'room' && pendingDelete.id === r.id ? (
                    <>
                      <p className="max-w-xs text-xs text-sc-warning">{t('room.deleteCascadeHint')}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={deleteBusy}
                          className="rounded-xl bg-sc-danger/15 px-3 py-1.5 text-xs font-medium text-sc-danger hover:bg-sc-danger/25 disabled:opacity-50"
                          onClick={async () => {
                            setDeleteBusy(true);
                            setDeleteError(null);
                            const res = await deleteRoom(r.id);
                            setDeleteBusy(false);
                            if (res.errorMessage) {
                              setDeleteError(res.errorMessage);
                              return;
                            }
                            setPendingDelete(null);
                            setRoomEditDraft((d) => (d?.id === r.id ? null : d));
                          }}
                        >
                          {t('common.confirmDelete')}
                        </button>
                        <button
                          type="button"
                          disabled={deleteBusy}
                          className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
                          onClick={() => {
                            setPendingDelete(null);
                            setDeleteError(null);
                          }}
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    </>
                  ) : roomEditDraft?.id === r.id ? null : (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        className="text-sm text-sc-text-muted hover:text-sc-text"
                        aria-label={t('room.editAriaLabel', { name: r.name })}
                        onClick={() => {
                          setSessionEditDraft(null);
                          setSessionEditError(null);
                          setSpeakerEditDraft(null);
                          setSpeakerEditError(null);
                          setRoomEditError(null);
                          setDeleteError(null);
                          setPendingDelete(null);
                          setRoomEditDraft({ id: r.id, name: r.name, room_type: r.room_type });
                        }}
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        type="button"
                        className="text-sm text-sc-danger hover:text-sc-danger"
                        aria-label={t('room.deleteAriaLabel', { name: r.name })}
                        onClick={() => {
                          setSessionEditDraft(null);
                          setSessionEditError(null);
                          setSpeakerEditDraft(null);
                          setSpeakerEditError(null);
                          setRoomEditDraft((d) => (d?.id === r.id ? null : d));
                          setRoomEditError(null);
                          setPendingDelete({ kind: 'room', id: r.id });
                          setDeleteError(null);
                        }}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="sessions-section-title">
        <h2 id="sessions-section-title" className="text-lg font-semibold text-sc-text">
          {t('session.titlePlural')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-dim">{t('session.eventDetailIntro')}</p>
        {sessions.length > 1 ? (
          <p className="mt-2 text-xs text-sc-text-dim">{t('session.dragListHint')}</p>
        ) : null}
        {sessionReorderError ? (
          <p className="mt-2 text-sm text-sc-warning" role="alert">
            {t('session.reorderFailed')}: {sessionReorderError}
          </p>
        ) : null}

        {sessions.length > 0 && rooms.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2" role="tablist" aria-label={t('session.viewModeAria')}>
            <span className="text-xs text-sc-text-dim">{t('session.viewModeLabel')}</span>
            <div className="inline-flex rounded-xl border border-sc-primary/20 bg-sc-bg p-0.5">
              <button
                type="button"
                role="tab"
                aria-selected={sessionScheduleView === 'list'}
                className={`rounded px-3 py-1.5 text-xs font-medium ${sessionScheduleView === 'list' ? 'bg-sc-elevated text-sc-text' : 'text-sc-text-muted hover:text-sc-text'
                  }`}
                onClick={() => setSessionScheduleView('list')}
              >
                {t('session.viewList')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sessionScheduleView === 'byRoom'}
                className={`rounded px-3 py-1.5 text-xs font-medium ${sessionScheduleView === 'byRoom' ? 'bg-sc-elevated text-sc-text' : 'text-sc-text-muted hover:text-sc-text'
                  }`}
                onClick={() => setSessionScheduleView('byRoom')}
              >
                {t('session.viewByRoom')}
              </button>
            </div>
          </div>
        ) : null}

        {rooms.length === 0 ? (
          <p className="mt-6 text-sm text-sc-warning" role="status">
            {t('session.needRoomFirst')}
          </p>
        ) : (
          <div className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6">
            <h3 className="text-sm font-medium text-sc-text">{t('session.create')}</h3>
            <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onSessionSubmit} noValidate>
              <div>
                <label htmlFor="session-title" className="mb-1 block text-sm text-sc-text-muted">
                  {t('session.sessionTitle')}
                </label>
                <input
                  id="session-title"
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  aria-invalid={sessionErrors.title ? true : undefined}
                  {...registerSession('title')}
                />
                {sessionErrors.title ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {sessionErrors.title.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="session-room" className="mb-1 block text-sm text-sc-text-muted">
                  {t('session.room')}
                </label>
                <select
                  id="session-room"
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  {...registerSession('room_id')}
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                {sessionErrors.room_id ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {sessionErrors.room_id.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="session-type" className="mb-1 block text-sm text-sc-text-muted">
                  {t('session.type')}
                </label>
                <select
                  id="session-type"
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
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
                <label htmlFor="session-start" className="mb-1 block text-sm text-sc-text-muted">
                  {t('session.scheduledStart')}
                </label>
                <input
                  id="session-start"
                  type="datetime-local"
                  step={60}
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  aria-invalid={sessionErrors.scheduled_start ? true : undefined}
                  {...registerSession('scheduled_start')}
                />
                {sessionErrors.scheduled_start ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {sessionErrors.scheduled_start.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="session-end" className="mb-1 block text-sm text-sc-text-muted">
                  {t('session.scheduledEnd')}
                </label>
                <input
                  id="session-end"
                  type="datetime-local"
                  step={60}
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  aria-invalid={sessionErrors.scheduled_end ? true : undefined}
                  {...registerSession('scheduled_end')}
                />
                {sessionErrors.scheduled_end ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {sessionErrors.scheduled_end.message}
                  </p>
                ) : null}
              </div>
              {sessionCreateError ? (
                <p className="text-sm text-sc-danger" role="alert">
                  {sessionCreateError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={sessionSubmitting}
                className="w-fit rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
              >
                {t('common.create')}
              </button>
            </form>
          </div>
        )}

        {sessions.length === 0 ? (
          <p className="mt-6 text-sm text-sc-text-dim">{t('session.emptyEventList')}</p>
        ) : sessionScheduleView === 'list' ? (
          <ul className="mt-6 divide-y divide-sc-primary/12 rounded-xl border border-sc-primary/12">
            {sessionsOrdered.map((s) => {
              const roomName = rooms.find((r) => r.id === s.room_id)?.name ?? t('session.roomUnknown');
              const canDragReorder = !sessionEditDraft && !sessionReorderBusy;
              return (
                <li
                  key={s.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
                  onDragOver={(e) => {
                    if (!canDragReorder) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!canDragReorder) return;
                    const fromId = e.dataTransfer.getData('text/plain');
                    if (!fromId || fromId === s.id) return;
                    const currentIds = sessionsOrdered.map((x) => x.id);
                    const newOrder = reorderSessionIdList(currentIds, fromId, s.id);
                    void (async () => {
                      setSessionReorderError(null);
                      setSessionReorderBusy(true);
                      const res = await reorderSessions(newOrder);
                      setSessionReorderBusy(false);
                      if (res.errorMessage) {
                        setSessionReorderError(res.errorMessage);
                      }
                    })();
                  }}
                >
                  <div className="flex min-w-0 flex-1 gap-2">
                    {sessionEditDraft?.id !== s.id ? (
                      <div
                        draggable
                        className="mt-0.5 flex h-8 w-7 shrink-0 cursor-grab select-none items-center justify-center rounded border border-sc-primary/20 bg-sc-surface text-sm text-sc-text-dim hover:bg-sc-elevated active:cursor-grabbing"
                        aria-label={t('session.dragHandleAriaLabel', { title: s.title })}
                        title={t('session.dragHint')}
                        onDragStart={(e) => {
                          if (!canDragReorder) {
                            e.preventDefault();
                            return;
                          }
                          e.dataTransfer.setData('text/plain', s.id);
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                      >
                        <span aria-hidden>⋮⋮</span>
                      </div>
                    ) : (
                      <span className="w-7 shrink-0" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      {sessionEditDraft?.id === s.id ? (
                        <form
                          className="flex max-w-lg flex-col gap-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void submitSessionEdit();
                          }}
                        >
                          <div>
                            <label htmlFor={`session-edit-title-${s.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('session.sessionTitle')}
                            </label>
                            <input
                              id={`session-edit-title-${s.id}`}
                              value={sessionEditDraft.title}
                              onChange={(e) =>
                                setSessionEditDraft((d) => (d?.id === s.id ? { ...d, title: e.target.value } : d))
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                            />
                          </div>
                          <div>
                            <label htmlFor={`session-edit-room-${s.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('session.room')}
                            </label>
                            <select
                              id={`session-edit-room-${s.id}`}
                              value={sessionEditDraft.room_id}
                              onChange={(e) =>
                                setSessionEditDraft((d) => (d?.id === s.id ? { ...d, room_id: e.target.value } : d))
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                            >
                              {rooms.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`session-edit-type-${s.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('session.type')}
                            </label>
                            <select
                              id={`session-edit-type-${s.id}`}
                              value={sessionEditDraft.session_type}
                              onChange={(e) =>
                                setSessionEditDraft((d) =>
                                  d?.id === s.id ? { ...d, session_type: e.target.value as SessionType } : d,
                                )
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                            >
                              {SESSION_TYPES.map((st) => (
                                <option key={st} value={st}>
                                  {sessionTypeLabel(t, st)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`session-edit-start-${s.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('session.scheduledStart')}
                            </label>
                            <input
                              id={`session-edit-start-${s.id}`}
                              type="datetime-local"
                              step={60}
                              value={sessionEditDraft.scheduled_start}
                              onChange={(e) =>
                                setSessionEditDraft((d) =>
                                  d?.id === s.id ? { ...d, scheduled_start: e.target.value } : d,
                                )
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                            />
                          </div>
                          <div>
                            <label htmlFor={`session-edit-end-${s.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('session.scheduledEnd')}
                            </label>
                            <input
                              id={`session-edit-end-${s.id}`}
                              type="datetime-local"
                              step={60}
                              value={sessionEditDraft.scheduled_end}
                              onChange={(e) =>
                                setSessionEditDraft((d) => (d?.id === s.id ? { ...d, scheduled_end: e.target.value } : d))
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                            />
                          </div>
                          {sessionEditError ? (
                            <p className="text-xs text-sc-danger" role="alert">
                              {sessionEditError}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={sessionEditBusy}
                              className="rounded-xl bg-sc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
                            >
                              {t('common.save')}
                            </button>
                            <button
                              type="button"
                              disabled={sessionEditBusy}
                              className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
                              onClick={() => {
                                setSessionEditDraft(null);
                                setSessionEditError(null);
                              }}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <p className="font-medium text-sc-text">{s.title}</p>
                          <p className="text-xs text-sc-text-dim">
                            {roomName} · {sessionTypeLabel(t, s.session_type)}
                          </p>
                          <p className="text-xs text-sc-text-muted">
                            {dateTimeFmt.format(new Date(s.scheduled_start))} →{' '}
                            {dateTimeFmt.format(new Date(s.scheduled_end))}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                    {pendingDelete?.kind === 'session' && pendingDelete.id === s.id ? (
                      <>
                        <p className="max-w-xs text-xs text-sc-warning">{t('session.deleteCascadeHint')}</p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={deleteBusy}
                            className="rounded-xl bg-sc-danger/15 px-3 py-1.5 text-xs font-medium text-sc-danger hover:bg-sc-danger/25 disabled:opacity-50"
                            onClick={async () => {
                              setDeleteBusy(true);
                              setDeleteError(null);
                              const res = await deleteSession(s.id);
                              setDeleteBusy(false);
                              if (res.errorMessage) {
                                setDeleteError(res.errorMessage);
                                return;
                              }
                              setPendingDelete(null);
                              setSessionEditDraft((d) => (d?.id === s.id ? null : d));
                            }}
                          >
                            {t('common.confirmDelete')}
                          </button>
                          <button
                            type="button"
                            disabled={deleteBusy}
                            className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
                            onClick={() => {
                              setPendingDelete(null);
                              setDeleteError(null);
                            }}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </>
                    ) : sessionEditDraft?.id === s.id ? null : (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          className="text-sm text-sc-text-muted hover:text-sc-text"
                          aria-label={t('session.editAriaLabel', { title: s.title })}
                          onClick={() => {
                            setRoomEditDraft(null);
                            setRoomEditError(null);
                            setSpeakerEditDraft(null);
                            setSpeakerEditError(null);
                            setSessionEditError(null);
                            setDeleteError(null);
                            setPendingDelete(null);
                            setSessionEditDraft({
                              id: s.id,
                              title: s.title,
                              room_id: s.room_id,
                              session_type: s.session_type,
                              scheduled_start: toDatetimeLocalValue(s.scheduled_start),
                              scheduled_end: toDatetimeLocalValue(s.scheduled_end),
                            });
                          }}
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          className="text-sm text-sc-danger hover:text-sc-danger"
                          aria-label={t('session.deleteAriaLabel', { title: s.title })}
                          onClick={() => {
                            setSessionEditDraft((d) => (d?.id === s.id ? null : d));
                            setSessionEditError(null);
                            setPendingDelete({ kind: 'session', id: s.id });
                            setDeleteError(null);
                          }}
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-6 space-y-6" aria-label={t('session.byRoomSectionAria')}>
            <p className="text-xs text-sc-text-dim">{t('session.byRoomIntro')}</p>
            {rooms.map((room) => {
              const roomSessions = sessionsByRoom.get(room.id) ?? [];
              return (
                <div key={room.id} className="rounded-xl border border-sc-primary/12 bg-sc-bg/50 p-4">
                  <h3 className="text-sm font-semibold text-sc-text">{room.name}</h3>
                  <p className="text-xs text-sc-text-dim">{roomTypeLabel(t, room.room_type)}</p>
                  {roomSessions.length === 0 ? (
                    <p className="mt-3 text-xs text-sc-text-dim">{t('session.byRoomEmpty')}</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {roomSessions.map((s) => (
                        <li
                          key={s.id}
                          className="flex gap-3 rounded-xl border border-sc-primary/12 bg-sc-surface/60 px-3 py-2.5"
                        >
                          <div className="w-1 shrink-0 rounded-full bg-sc-primary" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-sc-text">{s.title}</p>
                            <p className="text-xs text-sc-text-dim">{sessionTypeLabel(t, s.session_type)}</p>
                            <p className="text-xs text-sc-text-muted">
                              {dateTimeFmt.format(new Date(s.scheduled_start))}
                              {' → '}
                              {dateTimeFmt.format(new Date(s.scheduled_end))}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-12" aria-labelledby="speakers-section-title">
        <h2 id="speakers-section-title" className="text-lg font-semibold text-sc-text">
          {t('speaker.titlePlural')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-dim">{t('speaker.eventDetailIntro')}</p>

        {sessions.length > 0 ? (
          <div className="mt-4 max-w-2xl rounded-xl border border-sc-primary/12 bg-sc-bg/60 p-4">
            <h3 className="text-sm font-medium text-sc-text">{t('speaker.csvImport.title')}</h3>
            <p className="mt-1 text-xs text-sc-text-dim">{t('speaker.csvImport.hint')}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={downloadSpeakerCsvTemplate}
                className="rounded-xl border border-sc-primary/20 bg-sc-surface px-3 py-2 text-xs font-medium text-sc-text hover:bg-sc-elevated"
              >
                {t('speaker.csvImport.downloadTemplate')}
              </button>
              <input
                ref={speakerCsvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label={t('speaker.csvImport.fileAriaLabel')}
                onChange={(e) => {
                  const list = e.target.files;
                  void onSpeakerCsvSelected(list);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                disabled={csvImportBusy}
                onClick={() => speakerCsvInputRef.current?.click()}
                className="rounded-xl bg-sc-primary px-3 py-2 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
              >
                {csvImportBusy ? t('speaker.csvImport.importing') : t('speaker.csvImport.selectFile')}
              </button>
            </div>
            {csvFeedback ? (
              <pre
                className={`mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-xs ${csvFeedback.variant === 'error' ? 'text-sc-warning' : 'text-sc-success'
                  }`}
                role="status"
              >
                {csvFeedback.message}
              </pre>
            ) : null}
          </div>
        ) : null}

        {speakerAuxError ? (
          <p className="mt-3 text-sm text-sc-danger" role="alert">
            {speakerAuxError}
          </p>
        ) : null}

        {sessions.length === 0 ? (
          <p className="mt-6 text-sm text-sc-warning" role="status">
            {t('speaker.needSessionFirst')}
          </p>
        ) : (
          <div className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6">
            <h3 className="text-sm font-medium text-sc-text">{t('speaker.create')}</h3>
            <form className="mt-4 flex max-w-lg flex-col gap-4" onSubmit={onSpeakerSubmit} noValidate>
              <div>
                <label htmlFor="speaker-session" className="mb-1 block text-sm text-sc-text-muted">
                  {t('speaker.linkedSession')}
                </label>
                <select
                  id="speaker-session"
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  {...registerSpeaker('session_id')}
                >
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
                {speakerErrors.session_id ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {speakerErrors.session_id.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="speaker-name" className="mb-1 block text-sm text-sc-text-muted">
                  {t('speaker.fullName')}
                </label>
                <input
                  id="speaker-name"
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  autoComplete="name"
                  aria-invalid={speakerErrors.full_name ? true : undefined}
                  {...registerSpeaker('full_name')}
                />
                {speakerErrors.full_name ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {speakerErrors.full_name.message}
                  </p>
                ) : null}
              </div>
              <div>
                <label htmlFor="speaker-email" className="mb-1 block text-sm text-sc-text-muted">
                  {t('speaker.emailOptional')}
                </label>
                <input
                  id="speaker-email"
                  type="email"
                  autoComplete="email"
                  className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                  aria-invalid={speakerErrors.email ? true : undefined}
                  {...registerSpeaker('email')}
                />
                {speakerErrors.email ? (
                  <p className="mt-1 text-xs text-sc-danger" role="alert">
                    {speakerErrors.email.message}
                  </p>
                ) : null}
              </div>
              {speakerCreateError ? (
                <p className="text-sm text-sc-danger" role="alert">
                  {speakerCreateError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={speakerSubmitting}
                className="w-fit rounded-xl bg-sc-primary px-4 py-2 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
              >
                {t('common.create')}
              </button>
            </form>
          </div>
        )}

        {speakersSorted.length === 0 ? (
          <p className="mt-6 text-sm text-sc-text-dim">{t('speaker.emptyEventList')}</p>
        ) : (
          <ul className="mt-6 divide-y divide-sc-primary/12 rounded-xl border border-sc-primary/12">
            {speakersSorted.map((sp) => {
              const sessionTitle =
                sessions.find((s) => s.id === sp.session_id)?.title ?? t('speaker.sessionUnknown');
              const portalUrl =
                sp.upload_token && sp.upload_token.length > 0
                  ? getUploadPortalAbsoluteUrl(sp.upload_token)
                  : null;
              const expiresLabel =
                sp.upload_token_expires_at && portalUrl
                  ? dateTimeFmt.format(new Date(sp.upload_token_expires_at))
                  : null;
              const versionsOpen = versionsExpandedSpeakerId === sp.id;
              return (
                <li key={sp.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      {speakerEditDraft?.id === sp.id ? (
                        <form
                          className="mb-3 flex max-w-lg flex-col gap-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void submitSpeakerEdit();
                          }}
                        >
                          <div>
                            <label htmlFor={`speaker-edit-session-${sp.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('speaker.linkedSession')}
                            </label>
                            <select
                              id={`speaker-edit-session-${sp.id}`}
                              value={speakerEditDraft.session_id}
                              onChange={(e) =>
                                setSpeakerEditDraft((d) =>
                                  d?.id === sp.id ? { ...d, session_id: e.target.value } : d,
                                )
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                            >
                              {sessions.map((sess) => (
                                <option key={sess.id} value={sess.id}>
                                  {sess.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`speaker-edit-name-${sp.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('speaker.fullName')}
                            </label>
                            <input
                              id={`speaker-edit-name-${sp.id}`}
                              value={speakerEditDraft.full_name}
                              onChange={(e) =>
                                setSpeakerEditDraft((d) =>
                                  d?.id === sp.id ? { ...d, full_name: e.target.value } : d,
                                )
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                              autoComplete="name"
                            />
                          </div>
                          <div>
                            <label htmlFor={`speaker-edit-email-${sp.id}`} className="mb-1 block text-sm text-sc-text-muted">
                              {t('speaker.emailOptional')}
                            </label>
                            <input
                              id={`speaker-edit-email-${sp.id}`}
                              type="email"
                              value={speakerEditDraft.email}
                              onChange={(e) =>
                                setSpeakerEditDraft((d) => (d?.id === sp.id ? { ...d, email: e.target.value } : d))
                              }
                              className="w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                              autoComplete="email"
                            />
                          </div>
                          {speakerEditError ? (
                            <p className="text-xs text-sc-danger" role="alert">
                              {speakerEditError}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={speakerEditBusy}
                              className="rounded-xl bg-sc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
                            >
                              {t('common.save')}
                            </button>
                            <button
                              type="button"
                              disabled={speakerEditBusy}
                              className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
                              onClick={() => {
                                setSpeakerEditDraft(null);
                                setSpeakerEditError(null);
                              }}
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        </form>
                      ) : (
                        <>
                          <p className="font-medium text-sc-text">{sp.full_name}</p>
                          <p className="text-xs text-sc-text-dim">{sessionTitle}</p>
                          {sp.email ? <p className="text-xs text-sc-text-muted">{sp.email}</p> : null}
                        </>
                      )}
                      {portalUrl ? (
                        <div className="mt-3 flex flex-col gap-2 border-t border-sc-primary/10 pt-3 sm:flex-row sm:items-start sm:gap-4">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-sc-text-muted">{t('speaker.uploadLinkLabel')}</p>
                            <p className="mt-1 break-all font-mono text-xs text-sc-text-secondary">{portalUrl}</p>
                            {expiresLabel ? (
                              <p className="mt-1 text-xs text-sc-text-dim">
                                {t('speaker.uploadExpires', { date: expiresLabel })}
                              </p>
                            ) : null}
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs font-medium text-sc-text hover:bg-sc-elevated"
                                onClick={async () => {
                                  setSpeakerAuxError(null);
                                  try {
                                    await navigator.clipboard.writeText(portalUrl);
                                    setCopiedSpeakerId(sp.id);
                                    window.setTimeout(() => setCopiedSpeakerId((cur) => (cur === sp.id ? null : cur)), 2200);
                                  } catch {
                                    setSpeakerAuxError(t('speaker.copyUploadLinkFailed'));
                                  }
                                }}
                              >
                                {copiedSpeakerId === sp.id ? t('speaker.linkCopied') : t('speaker.copyUploadLink')}
                              </button>
                            </div>
                          </div>
                          <div
                            className="shrink-0 rounded-xl bg-white p-2"
                            role="img"
                            aria-label={t('speaker.uploadQrAria', { name: sp.full_name })}
                          >
                            <QRCode value={portalUrl} size={104} level="M" />
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 border-t border-sc-primary/10 pt-3">
                          <p className="text-xs text-sc-text-dim">{t('speaker.uploadLinkMissing')}</p>
                          <button
                            type="button"
                            disabled={regenerateBusyId === sp.id}
                            className="mt-2 rounded-xl border border-sc-warning/30 px-3 py-1.5 text-xs font-medium text-sc-warning hover:bg-sc-warning/10 disabled:opacity-50"
                            onClick={async () => {
                              setSpeakerAuxError(null);
                              setRegenerateBusyId(sp.id);
                              const res = await regenerateSpeakerUpload(sp.id);
                              setRegenerateBusyId(null);
                              if (res.errorMessage) {
                                setSpeakerAuxError(
                                  res.errorMessage === 'missing_context'
                                    ? t('speaker.errors.missingContext')
                                    : res.errorMessage,
                                );
                              }
                            }}
                          >
                            {regenerateBusyId === sp.id ? t('speaker.generatingUploadLink') : t('speaker.generateUploadLink')}
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                      {pendingDelete?.kind === 'speaker' && pendingDelete.id === sp.id ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={deleteBusy}
                            className="rounded-xl bg-sc-danger/15 px-3 py-1.5 text-xs font-medium text-sc-danger hover:bg-sc-danger/25 disabled:opacity-50"
                            onClick={async () => {
                              setDeleteBusy(true);
                              setDeleteError(null);
                              const res = await deleteSpeaker(sp.id);
                              setDeleteBusy(false);
                              if (res.errorMessage) {
                                setDeleteError(res.errorMessage);
                                return;
                              }
                              setPendingDelete(null);
                              setSpeakerEditDraft((d) => (d?.id === sp.id ? null : d));
                            }}
                          >
                            {t('common.confirmDelete')}
                          </button>
                          <button
                            type="button"
                            disabled={deleteBusy}
                            className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-xs text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50"
                            onClick={() => {
                              setPendingDelete(null);
                              setDeleteError(null);
                            }}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      ) : speakerEditDraft?.id === sp.id ? null : (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            className="text-sm text-sc-text-muted hover:text-sc-text"
                            aria-label={t('speaker.editAriaLabel', { name: sp.full_name })}
                            onClick={() => {
                              setRoomEditDraft(null);
                              setRoomEditError(null);
                              setSessionEditDraft(null);
                              setSessionEditError(null);
                              setSpeakerAuxError(null);
                              setSpeakerEditError(null);
                              setDeleteError(null);
                              setPendingDelete(null);
                              setSpeakerEditDraft({
                                id: sp.id,
                                session_id: sp.session_id,
                                full_name: sp.full_name,
                                email: sp.email ?? '',
                              });
                            }}
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            className="text-sm text-sc-danger hover:text-sc-danger"
                            aria-label={t('speaker.deleteAriaLabel', { name: sp.full_name })}
                            onClick={() => {
                              setSpeakerEditDraft((d) => (d?.id === sp.id ? null : d));
                              setSpeakerEditError(null);
                              setSpeakerAuxError(null);
                              setPendingDelete({ kind: 'speaker', id: sp.id });
                              setDeleteError(null);
                            }}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-sc-primary/10 pt-2">
                    <button
                      type="button"
                      aria-expanded={versionsOpen}
                      className="inline-flex items-center gap-2 text-xs font-medium text-sc-primary hover:text-sc-primary"
                      onClick={() =>
                        setVersionsExpandedSpeakerId((cur) => (cur === sp.id ? null : sp.id))
                      }
                    >
                      <span aria-hidden="true">{versionsOpen ? '▾' : '▸'}</span>
                      {versionsOpen
                        ? t('presentation.versions.hide')
                        : t('presentation.versions.show')}
                    </button>
                    <PresentationVersionsPanel
                      speakerId={sp.id}
                      speakerName={sp.full_name}
                      enabled={versionsOpen}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-12" aria-labelledby="devices-section-title">
        <h2 id="devices-section-title" className="text-lg font-semibold text-sc-text">
          {t('devices.panel.sectionTitle')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-dim">{t('devices.panel.sectionIntro')}</p>
        <div className="mt-6 max-w-2xl">
          <DevicesPanel eventId={event.id} rooms={rooms} />
        </div>
      </section>
    </div>
  );
}

export { EventDetailView as Component };
