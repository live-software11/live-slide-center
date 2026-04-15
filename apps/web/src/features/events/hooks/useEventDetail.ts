import { startTransition, useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { createRoomForEvent, listRoomsByEvent, type RoomRow, type RoomType } from '../../rooms/repository';
import { getEventById, type EventRow } from '../repository';

type DetailState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'not_found' }
  | { status: 'ready'; event: EventRow; rooms: RoomRow[] };

export function useEventDetail(
  supabase: SupabaseClient<Database>,
  eventId: string | undefined,
  tenantId: string | null,
) {
  const [state, setState] = useState<DetailState>({ status: 'loading' });

  const load = useCallback(async () => {
    if (!eventId || !tenantId) return;
    const [evRes, roomsRes] = await Promise.all([
      getEventById(supabase, eventId),
      listRoomsByEvent(supabase, eventId),
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
    setState({ status: 'ready', event: evRes.data, rooms: roomsRes.data ?? [] });
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

  return { state, reload: load, createRoom };
}
