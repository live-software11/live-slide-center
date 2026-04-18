import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ValidationWarning } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { invokeEdgeFunction } from '@/lib/edge-functions';

export type Presentation = Database['public']['Tables']['presentations']['Row'];
export type PresentationVersion = Database['public']['Tables']['presentation_versions']['Row'];
export type PresentationStatus = Database['public']['Enums']['presentation_status'];

export type { ValidationWarning };

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

/**
 * Sprint I (GUIDA_OPERATIVA_v3 §3.D D2-D3) — signed URL per ANTEPRIMA inline
 * (PDF in <iframe>, image in <img>, video in <video>).
 *
 * Differenza vs `createVersionDownloadUrl`: NON setta `download: true`, quindi
 * il browser NON forza `Content-Disposition: attachment` e mostra il file nel
 * tag invece di scaricarlo.
 *
 * Stessa durata 5 minuti (storage RLS valida solo al primo HIT, l'URL e' un
 * JWT firmato dal lato server). Sufficiente per aprire il dialog, leggere il
 * PDF/video e tornare alla lista — nessun rischio di link "leakato" persistente.
 */
export async function createVersionPreviewUrl(storageKey: string): Promise<string> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.storage
    .from('presentations')
    .createSignedUrl(storageKey, 300);
  if (error || !data?.signedUrl) {
    throw error ?? new Error('signed_url_failed');
  }
  return data.signedUrl;
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
  // `p_note` accetta NULL runtime (motivazione opzionale per status changes),
  // ma il type generator lo riflette come `string` non-nullable. Cast.
  const { error } = await supabase.rpc('rpc_update_presentation_status', {
    p_presentation_id: presentationId,
    p_status: status,
    p_note: note as unknown as string,
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

// Init upload diretto su una sessione (senza speaker). Crea sempre una nuova
// presentation con `speaker_id NULL`: cosi' una sessione puo' avere n file
// caricati direttamente dal regista. Restituisce gli stessi campi del flusso
// admin classico (per riusare lo stack TUS senza modifiche).
export async function initSessionUpload(input: {
  sessionId: string;
  filename: string;
  size: number;
  mime: string;
}): Promise<AdminInitUploadResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('init_upload_version_for_session', {
    p_session_id: input.sessionId,
    p_filename: input.filename,
    p_size: input.size,
    p_mime: input.mime,
  });
  if (error || !data) throw error ?? new Error('init_session_upload_failed');
  return data as unknown as AdminInitUploadResult;
}

// Cancella una presentation (e le sue versioni in cascade). Restituisce le
// storage_key da pulire dal bucket: lo facciamo lato client con un best-effort
// `storage.remove`. La cancellazione DB e' atomica.
export async function deletePresentationAdmin(presentationId: string): Promise<void> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('delete_presentation_admin', {
    p_presentation_id: presentationId,
  });
  if (error || !data) throw error ?? new Error('delete_presentation_failed');
  const result = data as { ok?: boolean; storage_keys?: string[] };
  const keys = Array.isArray(result.storage_keys) ? result.storage_keys.filter((k): k is string => typeof k === 'string') : [];
  if (keys.length > 0) {
    try {
      await supabase.storage.from('presentations').remove(keys);
    } catch {
      /* best-effort: la riga DB e' gia' rimossa, lo storage si pulisce con cron */
    }
  }
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

// ────────────────────────────────────────────────────────────────────
// Sprint G B3: spostamento presentation tra sessioni (stesso evento)
// ────────────────────────────────────────────────────────────────────

export interface MovePresentationToSessionResult {
  ok: boolean;
  /** True se la presentation era gia' nella sessione target (no-op). */
  skipped: boolean;
  reason?: string;
  presentation_id: string;
  session_id: string;
}

/**
 * Sposta una presentation in altra sessione dello stesso evento.
 * Lato DB: `rpc_move_presentation_to_session` resetta `speaker_id = NULL`
 * (lo speaker e' legato alla vecchia sessione e non puo' seguire).
 */
export async function movePresentationToSession(
  presentationId: string,
  targetSessionId: string,
): Promise<MovePresentationToSessionResult> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('rpc_move_presentation_to_session', {
    p_presentation_id: presentationId,
    p_target_session_id: targetSessionId,
  });
  if (error || !data) throw error ?? new Error('move_presentation_to_session_failed');
  return data as unknown as MovePresentationToSessionResult;
}

// ────────────────────────────────────────────────────────────────────
// Sprint T-3-A (G10): file validator warn-only
// ────────────────────────────────────────────────────────────────────

export interface UnvalidatedVersion {
  versionId: string;
  presentationId: string;
  fileName: string;
  storageKey: string;
}

export interface SlideValidatorResult {
  ok: boolean;
  processed: number;
  results: Array<{
    version_id: string;
    ok: boolean;
    warnings_count?: number;
    skipped?: boolean;
    reason?: string;
  }>;
}

/**
 * Sprint T-3-A: ritorna fino a `limit` versions ready non ancora validate
 * per la sessione. Usa RPC `list_unvalidated_versions_for_session` (RLS-isolata).
 *
 * Il chiamante (hook `useValidationTrigger`) invoca poi `invokeSlideValidator`
 * con le `versionId` ricevute.
 */
export async function listUnvalidatedVersionsForSession(
  sessionId: string,
  limit = 10,
): Promise<UnvalidatedVersion[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.rpc('list_unvalidated_versions_for_session', {
    p_session_id: sessionId,
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    version_id: string;
    presentation_id: string;
    file_name: string;
    storage_key: string;
  }>;
  return rows.map((r) => ({
    versionId: r.version_id,
    presentationId: r.presentation_id,
    fileName: r.file_name,
    storageKey: r.storage_key,
  }));
}

/**
 * Sprint T-3-A: invoca l Edge Function `slide-validator` con i version_id da
 * processare (max 5 lato server). Best-effort: i fallimenti per singola
 * version non bloccano la response complessiva.
 *
 * NB: l Edge function ha rate-limit naturale (gira solo se `validated_at IS NULL`),
 * quindi piu' tab che la triggherano per gli stessi id non duplicano lavoro.
 */
export async function invokeSlideValidator(versionIds: string[]): Promise<SlideValidatorResult> {
  if (versionIds.length === 0) {
    return { ok: true, processed: 0, results: [] };
  }
  return invokeEdgeFunction<SlideValidatorResult>('slide-validator', {
    version_ids: versionIds,
  });
}

// ────────────────────────────────────────────────────────────────────
// Sprint T-3-E (G10): Next-Up preview per PC tecnico
// ────────────────────────────────────────────────────────────────────

/**
 * Sprint T-3-E: descrittore minimo di un file in scaletta utilizzato dal
 * pannello Next-Up. Tutti i campi servono al thumbnail loader (`storageKey`,
 * `mimeType`, `fileName`) e al rendering della card (`fileName`, `speakerName`,
 * `versionNumber`, `presentationId`).
 */
export interface NextUpFile {
  presentationId: string;
  versionId: string;
  versionNumber: number;
  fileName: string;
  mimeType: string | null;
  storageKey: string;
  speakerName: string | null;
  /** Indice (1-based) nella scaletta della sessione, utile per la UI. */
  positionInSession: number;
  /** Numero totale di file nella scaletta. */
  totalInSession: number;
}

export interface NextUpInfo {
  /** Sessione attualmente attiva sulla room (da `room_state.current_session_id`). */
  sessionId: string | null;
  sessionTitle: string | null;
  /** File in onda (corrispondente a `room_state.current_presentation_id`). */
  current: NextUpFile | null;
  /**
   * File successivo nella scaletta. NULL se:
   *  - non c'e' un file in onda (non sappiamo da dove ripartire), o
   *  - il file in onda e' l'ultimo della scaletta.
   */
  next: NextUpFile | null;
}

interface NextUpPresentationRaw {
  id: string;
  current_version_id: string | null;
  created_at: string;
  speaker: { full_name: string; display_order: number } | null;
  current_version: {
    id: string;
    version_number: number;
    file_name: string;
    mime_type: string | null;
    storage_key: string;
    status: PresentationVersion['status'];
  } | null;
}

/**
 * Sprint T-3-E: dato un `room_id`, restituisce sessione attiva + file "in
 * onda" + file "prossimo" nella scaletta. Logica di ordinamento:
 *
 *  1. Per le presentation con uno speaker → `speakers.display_order` ASC.
 *  2. Tie-break (e per le presentation senza speaker) → `created_at` ASC.
 *
 * Filtro: scartiamo presentation senza `current_version_id` (file mai
 * caricato) o con version `status != 'ready'` (upload in corso, file
 * rifiutato, ecc.) — non possiamo mostrare un thumbnail per qualcosa che
 * non e' ancora pronto.
 *
 * Una sola round-trip via PostgREST embed.
 */
export async function getNextUpForRoom(roomId: string): Promise<NextUpInfo | null> {
  const supabase = getSupabaseBrowserClient();

  // 1. Stato della room: sessione attiva + file in onda.
  const { data: stateRow, error: stateErr } = await supabase
    .from('room_state')
    .select('current_session_id, current_presentation_id')
    .eq('room_id', roomId)
    .maybeSingle();
  if (stateErr) throw stateErr;
  if (!stateRow || !stateRow.current_session_id) {
    return { sessionId: null, sessionTitle: null, current: null, next: null };
  }

  const sessionId = stateRow.current_session_id;
  const currentPresentationId = stateRow.current_presentation_id;

  // 2. In parallelo: titolo sessione + presentations della sessione con embed
  //    speaker + current_version.
  const [{ data: sessionRow, error: sessErr }, { data: presRows, error: presErr }] = await Promise.all([
    supabase.from('sessions').select('title').eq('id', sessionId).maybeSingle(),
    supabase
      .from('presentations')
      .select(
        `id, current_version_id, created_at,
         speaker:speaker_id ( full_name, display_order ),
         current_version:current_version_id (
           id, version_number, file_name, mime_type, storage_key, status
         )`,
      )
      .eq('session_id', sessionId),
  ]);
  if (sessErr) throw sessErr;
  if (presErr) throw presErr;

  const sessionTitle = (sessionRow?.title as string | undefined) ?? null;

  const presentationsRaw = (presRows ?? []) as unknown as NextUpPresentationRaw[];

  // 3. Filtro per file pronto + ordinamento canonico.
  const ready = presentationsRaw.filter(
    (p) => p.current_version_id && p.current_version && p.current_version.status === 'ready',
  );

  ready.sort((a, b) => {
    const orderA = a.speaker?.display_order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.speaker?.display_order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return Date.parse(a.created_at) - Date.parse(b.created_at);
  });

  if (ready.length === 0) {
    return { sessionId, sessionTitle, current: null, next: null };
  }

  const total = ready.length;
  const toFile = (p: NextUpPresentationRaw, idx: number): NextUpFile | null => {
    if (!p.current_version) return null;
    return {
      presentationId: p.id,
      versionId: p.current_version.id,
      versionNumber: p.current_version.version_number,
      fileName: p.current_version.file_name,
      mimeType: p.current_version.mime_type,
      storageKey: p.current_version.storage_key,
      speakerName: p.speaker?.full_name ?? null,
      positionInSession: idx + 1,
      totalInSession: total,
    };
  };

  // 4. Risolvi current + next.
  let current: NextUpFile | null = null;
  let next: NextUpFile | null = null;

  if (currentPresentationId) {
    const idx = ready.findIndex((p) => p.id === currentPresentationId);
    if (idx >= 0) {
      current = toFile(ready[idx], idx);
      if (idx + 1 < ready.length) {
        next = toFile(ready[idx + 1], idx + 1);
      }
    }
  }

  // Fallback: se non c'e' un current_presentation_id (sala con sessione attiva
  // ma nessun file ancora aperto), il "next" diventa il primo della scaletta.
  if (!current && !currentPresentationId) {
    next = toFile(ready[0], 0);
  }

  return { sessionId, sessionTitle, current, next };
}
