import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';

export type RoomRow = Database['public']['Tables']['rooms']['Row'];
export type RoomType = Database['public']['Enums']['room_type'];

export async function listRoomsByEvent(supabase: SupabaseClient<Database>, eventId: string) {
  return supabase.from('rooms').select('*').eq('event_id', eventId).order('display_order');
}

export async function createRoomForEvent(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  eventId: string,
  input: { name: string; room_type: RoomType },
) {
  return supabase
    .from('rooms')
    .insert({
      tenant_id: tenantId,
      event_id: eventId,
      name: input.name,
      room_type: input.room_type,
      settings: {},
    })
    .select()
    .single();
}
