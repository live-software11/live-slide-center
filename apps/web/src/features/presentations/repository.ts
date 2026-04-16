import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';

export type Presentation = Database['public']['Tables']['presentations']['Row'];
export type PresentationVersion = Database['public']['Tables']['presentation_versions']['Row'];
export type PresentationStatus = Database['public']['Enums']['presentation_status'];

export interface PresentationBundle {
  presentation: Presentation | null;
  versions: PresentationVersion[];
}

export async function fetchPresentationForSpeaker(speakerId: string): Promise<PresentationBundle> {
  const supabase = getSupabaseBrowserClient();
  const { data: presentation, error: pErr } = await supabase
    .from('presentations')
    .select('*')
    .eq('speaker_id', speakerId)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!presentation) return { presentation: null, versions: [] };

  const { data: versions, error: vErr } = await supabase
    .from('presentation_versions')
    .select('*')
    .eq('presentation_id', presentation.id)
    .order('version_number', { ascending: false });
  if (vErr) throw vErr;
  return { presentation, versions: (versions ?? []) as PresentationVersion[] };
}

// Firma URL Storage per download versione (durata 5 min). RLS storage.objects
// limita SELECT al tenant proprietario: RPC-safe.
export async function createVersionDownloadUrlWithClient(
  supabase: SupabaseClient<Database>,
  storageKey: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from('presentations')
    .createSignedUrl(storageKey, 300, { download: true });
  if (error || !data?.signedUrl) {
    throw error ?? new Error('signed_url_failed');
  }
  return data.signedUrl;
}

export async function createVersionDownloadUrl(storageKey: string): Promise<string> {
  return createVersionDownloadUrlWithClient(getSupabaseBrowserClient(), storageKey);
}

export async function setCurrentVersion(presentationId: string, versionId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('rpc_set_current_version', {
    p_presentation_id: presentationId,
    p_version_id: versionId,
  });
  if (error) throw error;
}

export async function updatePresentationStatus(
  presentationId: string,
  status: PresentationStatus,
  note: string | null,
): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('rpc_update_presentation_status', {
    p_presentation_id: presentationId,
    p_status: status,
    p_note: note,
  });
  if (error) throw error;
}
