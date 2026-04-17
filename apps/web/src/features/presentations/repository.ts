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

// ────────────────────────────────────────────────────────────────────
// Upload diretto da admin tenant (no upload_token speaker)
// ────────────────────────────────────────────────────────────────────

export interface AdminInitUploadResult {
  version_id: string;
  presentation_id: string;
  storage_key: string;
  bucket: string;
}

export async function initAdminUpload(input: {
  speakerId: string;
  filename: string;
  size: number;
  mime: string;
}): Promise<AdminInitUploadResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('init_upload_version_admin', {
    p_speaker_id: input.speakerId,
    p_filename: input.filename,
    p_size: input.size,
    p_mime: input.mime,
  });
  if (error || !data) throw error ?? new Error('init_admin_upload_failed');
  return data as unknown as AdminInitUploadResult;
}

export async function finalizeAdminUpload(versionId: string, sha256: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('finalize_upload_version_admin', {
    p_version_id: versionId,
    p_sha256: sha256,
  });
  if (error) throw error;
}

export async function abortAdminUpload(versionId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { error } = await supabase.rpc('abort_upload_version_admin', {
    p_version_id: versionId,
  });
  if (error) throw error;
}

// ────────────────────────────────────────────────────────────────────
// Spostamento presentation tra speaker (stesso evento/tenant)
// ────────────────────────────────────────────────────────────────────

export interface MovePresentationResult {
  ok: boolean;
  presentation_id: string;
  speaker_id: string;
  session_id: string;
}

export async function movePresentation(
  presentationId: string,
  targetSpeakerId: string,
): Promise<MovePresentationResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_move_presentation', {
    p_presentation_id: presentationId,
    p_target_speaker_id: targetSpeakerId,
  });
  if (error || !data) throw error ?? new Error('move_presentation_failed');
  return data as unknown as MovePresentationResult;
}
