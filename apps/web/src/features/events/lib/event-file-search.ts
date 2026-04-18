import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * Sprint F (GUIDA_OPERATIVA_v3 §3.A) — search file globale a livello evento.
 *
 * Cerca per `file_name` su `presentation_versions` filtrando per
 * `presentations.event_id = eventId` e tenendo solo le versioni in stato
 * `ready` (le altre — `uploading`, `failed`, `deleted` — non sono visibili
 * all'admin nella UI normale, quindi non hanno senso in search).
 *
 * Sicurezza:
 *  - RLS `tenant_isolation` su `presentations`/`presentation_versions` blocca
 *    tutto cio' che non e' del tenant corrente: la query qui sotto e' inerte
 *    per tenant esterni.
 *  - Wildcard injection: i caratteri `%`, `_`, `\` hanno semantica speciale
 *    in `ILIKE`. Li escapamo via `\` per trattarli come letterali (es. una
 *    ricerca per `100%` deve trovare il file `Slides 100%.pptx` letterale,
 *    non "qualsiasi cosa che contenga 100").
 *  - Lunghezza minima: 2 caratteri. Sotto, ritorniamo array vuoto senza
 *    chiamare il DB (1 char => quasi-full-scan inutile su un evento da
 *    centinaia di file).
 *
 * Limiti:
 *  - `LIMIT 50` (vedi `MAX_RESULTS`): se l'admin cerca "pdf" e ha 200 file,
 *    mostriamo i primi 50 con un avviso "altri X risultati, affina la ricerca".
 *  - Sort: `version_number` desc → la versione piu' recente per ogni
 *    presentazione viene prima. NON deduplichiamo per `presentation_id`:
 *    se due versioni dello stesso speaker matchano, le mostriamo entrambe
 *    (l'admin vede la storia, utile in revisione).
 */

export interface EventFileSearchResult {
  versionId: string;
  presentationId: string;
  fileName: string;
  versionNumber: number;
  sessionId: string;
  sessionTitle: string;
  roomId: string | null;
  roomName: string | null;
  speakerId: string | null;
  speakerName: string | null;
  /** Se true, e' la `current_version_id` della presentazione (versione attiva). */
  isCurrent: boolean;
}

export const MAX_RESULTS = 50;
export const MIN_QUERY_LENGTH = 2;

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function searchEventFiles(
  eventId: string,
  query: string,
  signal?: AbortSignal,
): Promise<EventFileSearchResult[]> {
  const trimmed = query.trim();
  if (!eventId || trimmed.length < MIN_QUERY_LENGTH) return [];
  const supabase = getSupabaseBrowserClient();
  const pattern = `%${escapeIlike(trimmed)}%`;

  // Selezione embedded: sfruttiamo la FK `presentations -> sessions -> rooms`
  // gia' modellata in DB. `!inner` su `presentations` perche' filtriamo per
  // `presentations.event_id`, quindi PostgREST richiede inner join.
  // `speakers` e' nullable (la presentazione puo' essere aggiunta dall'admin
  // senza speaker), quindi NON inner.
  const { data, error } = await supabase
    .from('presentation_versions')
    .select(
      `
      id,
      file_name,
      version_number,
      presentation_id,
      presentations!inner (
        id,
        session_id,
        speaker_id,
        event_id,
        current_version_id,
        sessions ( id, title, room_id, rooms ( id, name ) ),
        speakers ( id, full_name )
      )
    `,
    )
    .eq('status', 'ready')
    .eq('presentations.event_id', eventId)
    .ilike('file_name', pattern)
    .order('version_number', { ascending: false })
    .limit(MAX_RESULTS)
    .abortSignal(signal ?? new AbortController().signal);

  if (error) {
    // Se l'utente e' uscito dalla pagina (`signal.aborted`), Supabase butta
    // un errore con `name === 'AbortError'`. Lo silenziamo: non e' un bug.
    if (signal?.aborted || (error as { name?: string }).name === 'AbortError') return [];
    throw error;
  }

  if (!data) return [];

  // PostgREST ritorna i nested come array (anche per relazioni 1:1) quando
  // non puo' garantire l'unicita' a livello di select. Normalizziamo.
  return data.map((row) => {
    const pres = Array.isArray(row.presentations) ? row.presentations[0] : row.presentations;
    if (!pres) {
      // Caso teoricamente impossibile con `!inner`, ma TypeScript chiede check.
      return {
        versionId: row.id as string,
        presentationId: row.presentation_id as string,
        fileName: (row.file_name as string) ?? '',
        versionNumber: (row.version_number as number) ?? 0,
        sessionId: '',
        sessionTitle: '',
        roomId: null,
        roomName: null,
        speakerId: null,
        speakerName: null,
        isCurrent: false,
      };
    }
    const session = Array.isArray(pres.sessions) ? pres.sessions[0] : pres.sessions;
    const room = session
      ? Array.isArray(session.rooms)
        ? session.rooms[0]
        : session.rooms
      : null;
    const speaker = Array.isArray(pres.speakers) ? pres.speakers[0] : pres.speakers;
    return {
      versionId: row.id as string,
      presentationId: row.presentation_id as string,
      fileName: (row.file_name as string) ?? '',
      versionNumber: (row.version_number as number) ?? 0,
      sessionId: (session?.id as string | undefined) ?? '',
      sessionTitle: (session?.title as string | undefined) ?? '',
      roomId: (room?.id as string | undefined) ?? null,
      roomName: (room?.name as string | undefined) ?? null,
      speakerId: (speaker?.id as string | undefined) ?? null,
      speakerName: (speaker?.full_name as string | undefined) ?? null,
      isCurrent: pres.current_version_id === row.id,
    };
  });
}
