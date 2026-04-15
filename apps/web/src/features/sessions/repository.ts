import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type SessionRow = Database['public']['Tables']['sessions']['Row'];
export type SessionType = Database['public']['Enums']['session_type'];

export async function listSessionsByEvent(supabase: SupabaseClient<Database>, eventId: string) {
  return supabase.from('sessions').select('*').eq('event_id', eventId).order('scheduled_start', { ascending: true });
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
    })
    .select()
    .single();
}
