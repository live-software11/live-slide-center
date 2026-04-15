import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type EventRow = Database['public']['Tables']['events']['Row'];
export type EventStatus = Database['public']['Enums']['event_status'];

export async function listTenantEvents(supabase: SupabaseClient<Database>) {
  return supabase.from('events').select('*').order('start_date', { ascending: false });
}

export async function createTenantEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  input: { name: string; start_date: string; end_date: string },
) {
  return supabase
    .from('events')
    .insert({
      tenant_id: tenantId,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
    })
    .select()
    .single();
}

export async function getEventById(supabase: SupabaseClient<Database>, eventId: string) {
  return supabase.from('events').select('*').eq('id', eventId).maybeSingle();
}

export async function updateEventById(
  supabase: SupabaseClient<Database>,
  eventId: string,
  input: { name: string; start_date: string; end_date: string; status: EventStatus },
) {
  return supabase
    .from('events')
    .update({
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      status: input.status,
    })
    .eq('id', eventId)
    .select()
    .single();
}

export async function deleteEventById(supabase: SupabaseClient<Database>, eventId: string) {
  return supabase.from('events').delete().eq('id', eventId);
}
