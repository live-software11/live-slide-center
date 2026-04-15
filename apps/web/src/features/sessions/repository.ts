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

/** Aggiorna `display_order` in sequenza (0..n-1) per l’ordine elenco tenant; RLS per riga. */
export async function reorderSessionsDisplayOrder(supabase: SupabaseClient<Database>, orderedSessionIds: string[]) {
  for (let i = 0; i < orderedSessionIds.length; i += 1) {
    const { error } = await supabase
      .from('sessions')
      .update({ display_order: i })
      .eq('id', orderedSessionIds[i]!);
    if (error) return { errorMessage: error.message };
  }
  return { errorMessage: null as string | null };
}
