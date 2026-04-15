import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import {
  createRoomForEvent,
  deleteRoomById,
  listRoomsByEvent,
  updateRoomById,
  type RoomRow,
  type RoomType,
} from '../../rooms/repository';
import {
  createSessionForEvent,
  deleteSessionById,
  listSessionsByEvent,
  reorderSessionsDisplayOrder,
  updateSessionById,
  type SessionRow,
  type SessionType,
} from '../../sessions/repository';
import {
  createSpeakerForSession,
  deleteSpeakerById,
  listSpeakersByEvent,
  regenerateSpeakerUploadToken,
  updateSpeakerById,
  type SpeakerRow,
} from '../../speakers/repository';
import { deleteEventById, getEventById, updateEventById, type EventRow, type EventStatus, type NetworkMode } from '../repository';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'ready'; event: EventRow; rooms: RoomRow[]; sessions: SessionRow[]; speakers: SpeakerRow[] };

export function useEventDetail(
  supabase: SupabaseClient<Database>,
  eventId: string | undefined,
  tenantId: string | null,
) {
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!eventId || !tenantId) return;
    const [evRes, roomsRes, sessionsRes, speakersRes] = await Promise.all([
      getEventById(supabase, eventId),
      listRoomsByEvent(supabase, eventId),
      listSessionsByEvent(supabase, eventId),
      listSpeakersByEvent(supabase, eventId),
    ]);
    if (evRes.error) {
      setState({ status: 'error', message: evRes.error.message });
      return;
    }
    if (!evRes.data) {
      setState({ status: 'not_found' });
      return;
    }
    if (roomsRes.error) {
      setState({ status: 'error', message: roomsRes.error.message });
      return;
    }
    if (sessionsRes.error) {
      setState({ status: 'error', message: sessionsRes.error.message });
      return;
    }
    if (speakersRes.error) {
      setState({ status: 'error', message: speakersRes.error.message });
      return;
    }
    setState({
      status: 'ready',
      event: evRes.data,
      rooms: roomsRes.data ?? [],
      sessions: sessionsRes.data ?? [],
      speakers: speakersRes.data ?? [],
    });
  }, [supabase, eventId, tenantId]);

  useEffect(() => {
    if (!eventId || !tenantId) return;
    startTransition(() => {
      void load();
    });
  }, [load, eventId, tenantId]);

  const createRoom = useCallback(
    async (input: { name: string; room_type: RoomType }) => {
      if (!eventId || !tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await createRoomForEvent(supabase, tenantId, eventId, input);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, eventId, load],
  );

  const updateRoom = useCallback(
    async (roomId: string, input: { name: string; room_type: RoomType }) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await updateRoomById(supabase, roomId, input);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const createSession = useCallback(
    async (input: {
      room_id: string;
      title: string;
      session_type: SessionType;
      scheduled_start: string;
      scheduled_end: string;
      display_order?: number;
    }) => {
      if (!eventId || !tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await createSessionForEvent(supabase, tenantId, eventId, {
        room_id: input.room_id,
        title: input.title,
        session_type: input.session_type,
        scheduled_start: new Date(input.scheduled_start).toISOString(),
        scheduled_end: new Date(input.scheduled_end).toISOString(),
        display_order: input.display_order,
      });
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, eventId, load],
  );

  const reorderSessions = useCallback(
    async (orderedSessionIds: string[]) => {
      if (!eventId || !tenantId) return { errorMessage: 'missing_context' as const };
      const res = await reorderSessionsDisplayOrder(supabase, orderedSessionIds, eventId);
      if (res.errorMessage) return { errorMessage: res.errorMessage };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, eventId, load],
  );

  const updateSession = useCallback(
    async (
      sessionId: string,
      input: {
        room_id: string;
        title: string;
        session_type: SessionType;
        scheduled_start: string;
        scheduled_end: string;
      },
    ) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await updateSessionById(supabase, sessionId, {
        room_id: input.room_id,
        title: input.title,
        session_type: input.session_type,
        scheduled_start: new Date(input.scheduled_start).toISOString(),
        scheduled_end: new Date(input.scheduled_end).toISOString(),
      });
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const createSpeaker = useCallback(
    async (input: { session_id: string; full_name: string; email: string | null }) => {
      if (!eventId || !tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await createSpeakerForSession(supabase, tenantId, eventId, input);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, eventId, load],
  );

  const updateSpeaker = useCallback(
    async (speakerId: string, input: { session_id: string; full_name: string; email: string | null }) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await updateSpeakerById(supabase, speakerId, input);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const deleteRoom = useCallback(
    async (roomId: string) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await deleteRoomById(supabase, roomId);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await deleteSessionById(supabase, sessionId);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const deleteSpeaker = useCallback(
    async (speakerId: string) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await deleteSpeakerById(supabase, speakerId);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const regenerateSpeakerUpload = useCallback(
    async (speakerId: string) => {
      if (!tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await regenerateSpeakerUploadToken(supabase, speakerId);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, load],
  );

  const importSpeakersBulk = useCallback(
    async (rows: { session_id: string; full_name: string; email: string | null }[]) => {
      if (!eventId || !tenantId) return { imported: 0, errorMessage: 'missing_context' as const };
      let imported = 0;
      for (const row of rows) {
        const { error } = await createSpeakerForSession(supabase, tenantId, eventId, row);
        if (error) {
          return { imported, errorMessage: error.message };
        }
        imported += 1;
      }
      await load();
      return { imported, errorMessage: null as string | null };
    },
    [supabase, tenantId, eventId, load],
  );

  const updateEvent = useCallback(
    async (input: { name: string; start_date: string; end_date: string; status: EventStatus; network_mode?: NetworkMode }) => {
      if (!eventId || !tenantId) return { errorMessage: 'missing_context' as const };
      const { error } = await updateEventById(supabase, eventId, input);
      if (error) return { errorMessage: error.message };
      await load();
      return { errorMessage: null as string | null };
    },
    [supabase, tenantId, eventId, load],
  );

  const deleteEvent = useCallback(async () => {
    if (!eventId || !tenantId) return { errorMessage: 'missing_context' as const };
    const { error } = await deleteEventById(supabase, eventId);
    if (error) return { errorMessage: error.message };
    return { errorMessage: null as string | null };
  }, [supabase, tenantId, eventId]);

  return {
    state,
    reload: load,
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
  };
}
