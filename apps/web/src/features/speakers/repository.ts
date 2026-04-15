import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { defaultUploadTokenExpiresAtIso, generateSpeakerUploadToken } from './lib/upload-token';

export type SpeakerRow = Database['public']['Tables']['speakers']['Row'];

export async function listSpeakersByEvent(supabase: SupabaseClient<Database>, eventId: string) {
  return supabase.from('speakers').select('*').eq('event_id', eventId).order('created_at', { ascending: true });
}

export async function createSpeakerForSession(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  eventId: string,
  input: { session_id: string; full_name: string; email: string | null },
) {
  const upload_token = generateSpeakerUploadToken();
  const upload_token_expires_at = defaultUploadTokenExpiresAtIso();
  return supabase
    .from('speakers')
    .insert({
      tenant_id: tenantId,
      event_id: eventId,
      session_id: input.session_id,
      full_name: input.full_name,
      email: input.email,
      upload_token,
      upload_token_expires_at,
    })
    .select()
    .single();
}

export async function regenerateSpeakerUploadToken(
  supabase: SupabaseClient<Database>,
  speakerId: string,
) {
  const upload_token = generateSpeakerUploadToken();
  const upload_token_expires_at = defaultUploadTokenExpiresAtIso();
  return supabase
    .from('speakers')
    .update({ upload_token, upload_token_expires_at })
    .eq('id', speakerId)
    .select()
    .single();
}

export async function deleteSpeakerById(supabase: SupabaseClient<Database>, id: string) {
  return supabase.from('speakers').delete().eq('id', id);
}
