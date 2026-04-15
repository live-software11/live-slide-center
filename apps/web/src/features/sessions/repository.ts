import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type SessionRow = Database['public']['Tables']['sessions']['Row'];
export type SessionType = Database['public']['Enums']['session_type'];

export async function listSessionsByEvent(supabase: SupabaseClient<Database>, eventId: string) {
  return supabase
    .from('sessions')
    .select('*')
    .eq('event_id', eventId)
    .order('display_order', { ascending: true })
    .order('scheduled_start', { ascending: true });
}

export async function createSessionForEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  eventId: string,
  input: {
    room_id: string;
    title: string;
    session_type: SessionType;
    scheduled_start: string;
    scheduled_end: string;
    display_order?: number;
  },
) {
  return supabase
    .from('sessions')
    .insert({
      tenant_id: tenantId,
      event_id: eventId,
      room_id: input.room_id,
      title: input.title,
      session_type: input.session_type,
      scheduled_start: input.scheduled_start,
      scheduled_end: input.scheduled_end,
      display_order: input.display_order ?? 0,
    })
    .select()
    .single();
}

export async function updateSessionById(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  input: {
    room_id: string;
    title: string;
    session_type: SessionType;
    scheduled_start: string;
    scheduled_end: string;
  },
) {
  return supabase
    .from('sessions')
    .update({
      room_id: input.room_id,
      title: input.title,
      session_type: input.session_type,
      scheduled_start: input.scheduled_start,
      scheduled_end: input.scheduled_end,
    })
    .eq('id', sessionId)
    .select()
    .single();
}

export async function deleteSessionById(supabase: SupabaseClient<Database>, id: string) {
  return supabase.from('sessions').delete().eq('id', id);
}

/** Aggiorna `display_order` atomicamente via RPC PostgreSQL (singola transazione, RLS rispettata). */
export async function reorderSessionsDisplayOrder(
  supabase: SupabaseClient<Database>,
  orderedSessionIds: string[],
  eventId: string,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC non in types generati fino a `supabase gen types`
  const { error } = await (supabase.rpc as any)('rpc_reorder_sessions', {
    p_ids: orderedSessionIds,
    p_event_id: eventId,
  });
  if (error) return { errorMessage: (error as { message: string }).message };
  return { errorMessage: null as string | null };
}
