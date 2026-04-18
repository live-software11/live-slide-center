import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type RoomRow = Database['public']['Tables']['rooms']['Row'];
type SessionRow = Database['public']['Tables']['sessions']['Row'];
type SpeakerRow = Database['public']['Tables']['speakers']['Row'];
type PresentationRow = Database['public']['Tables']['presentations']['Row'];
type ActivityRow = Database['public']['Tables']['activity_log']['Row'];
type RoomStateRow = Database['public']['Tables']['room_state']['Row'];
type PresentationVersionRow = Database['public']['Tables']['presentation_versions']['Row'];

export interface LiveRoomData {
  room: RoomRow;
  sessions: SessionRow[];
  speakers: SpeakerRow[];
  presentations: PresentationRow[];
  /**
   * Sprint U-3 (On Air): stato live della sala — quale file e' in onda,
   * indice slide, totale slide, started_at. NULL se la sala non ha mai
   * proiettato nulla (room_state non ancora inizializzato).
   */
  state: RoomStateRow | null;
  /** Sprint U-3: presentation in onda (denormalizzata da state.current_presentation_id). */
  nowPlayingPresentation: PresentationRow | null;
  /** Sprint U-3: version corrente (file_name, file_size_bytes) del file in onda. */
  nowPlayingVersion: Pick<PresentationVersionRow, 'id' | 'file_name' | 'file_size_bytes'> | null;
}

export interface LiveEventSnapshot {
  rooms: LiveRoomData[];
}

export async function fetchLiveEventSnapshot(eventId: string): Promise<LiveEventSnapshot> {
  const supabase = getSupabaseBrowserClient();

  const [roomsRes, sessionsRes, speakersRes, presentationsRes] = await Promise.all([
    supabase.from('rooms').select('*').eq('event_id', eventId).order('display_order'),
    supabase.from('sessions').select('*').eq('event_id', eventId).order('scheduled_start'),
    supabase.from('speakers').select('*').eq('event_id', eventId),
    supabase.from('presentations').select('*').eq('event_id', eventId),
  ]);

  if (roomsRes.error) throw roomsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (speakersRes.error) throw speakersRes.error;
  if (presentationsRes.error) throw presentationsRes.error;

  const rooms = (roomsRes.data ?? []) as RoomRow[];
  const sessions = (sessionsRes.data ?? []) as SessionRow[];
  const speakers = (speakersRes.data ?? []) as SpeakerRow[];
  const presentations = (presentationsRes.data ?? []) as PresentationRow[];

  // Sprint U-3: carico room_state per le sale di questo evento + le version
  // currentemente in onda. Due query separate, lasciate fuori dal Promise.all
  // sopra per evitare cascading change in caso di errore (lo state e' best-
  // effort: se manca, mostriamo "—" senza failare l'intera vista).
  const roomIds = rooms.map((r) => r.id);
  const states: Record<string, RoomStateRow> = {};
  if (roomIds.length > 0) {
    const stateRes = await supabase.from('room_state').select('*').in('room_id', roomIds);
    if (!stateRes.error) {
      (stateRes.data ?? []).forEach((s) => {
        const row = s as RoomStateRow;
        states[row.room_id] = row;
      });
    }
  }
  const nowPlayingPresIds = Object.values(states)
    .map((s) => s.current_presentation_id)
    .filter((v): v is string => Boolean(v));
  const versionsByPresId = new Map<
    string,
    Pick<PresentationVersionRow, 'id' | 'file_name' | 'file_size_bytes'>
  >();
  if (nowPlayingPresIds.length > 0) {
    const versionIds = presentations
      .filter((p) => nowPlayingPresIds.includes(p.id))
      .map((p) => p.current_version_id)
      .filter((v): v is string => Boolean(v));
    if (versionIds.length > 0) {
      const verRes = await supabase
        .from('presentation_versions')
        .select('id, file_name, file_size_bytes, presentation_id')
        .in('id', versionIds);
      if (!verRes.error) {
        (verRes.data ?? []).forEach((v) => {
          const row = v as Pick<
            PresentationVersionRow,
            'id' | 'file_name' | 'file_size_bytes'
          > & { presentation_id: string };
          versionsByPresId.set(row.presentation_id, {
            id: row.id,
            file_name: row.file_name,
            file_size_bytes: row.file_size_bytes,
          });
        });
      }
    }
  }

  return {
    rooms: rooms.map((room) => {
      const roomSessions = sessions.filter((s) => s.room_id === room.id);
      const sessionIds = new Set(roomSessions.map((s) => s.id));
      const roomSpeakers = speakers.filter((sp) => sessionIds.has(sp.session_id));
      const speakerIds = new Set(roomSpeakers.map((sp) => sp.id));
      const roomPresentations = presentations.filter(
        (p) => p.speaker_id !== null && speakerIds.has(p.speaker_id),
      );
      const state = states[room.id] ?? null;
      const nowPlayingPresentation = state?.current_presentation_id
        ? (presentations.find((p) => p.id === state.current_presentation_id) ?? null)
        : null;
      const nowPlayingVersion = nowPlayingPresentation
        ? (versionsByPresId.get(nowPlayingPresentation.id) ?? null)
        : null;
      return {
        room,
        sessions: roomSessions,
        speakers: roomSpeakers,
        presentations: roomPresentations,
        state,
        nowPlayingPresentation,
        nowPlayingVersion,
      };
    }),
  };
}

export async function fetchRecentActivity(eventId: string, limit = 30): Promise<ActivityRow[]> {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ActivityRow[];
}
