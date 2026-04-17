import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type RoomRow = Database['public']['Tables']['rooms']['Row'];
type SessionRow = Database['public']['Tables']['sessions']['Row'];
type SpeakerRow = Database['public']['Tables']['speakers']['Row'];
type PresentationRow = Database['public']['Tables']['presentations']['Row'];
type ActivityRow = Database['public']['Tables']['activity_log']['Row'];

export interface LiveRoomData {
  room: RoomRow;
  sessions: SessionRow[];
  speakers: SpeakerRow[];
  presentations: PresentationRow[];
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

  return {
    rooms: rooms.map((room) => {
      const roomSessions = sessions.filter((s) => s.room_id === room.id);
      const sessionIds = new Set(roomSessions.map((s) => s.id));
      const roomSpeakers = speakers.filter((sp) => sessionIds.has(sp.session_id));
      const speakerIds = new Set(roomSpeakers.map((sp) => sp.id));
      const roomPresentations = presentations.filter(
        (p) => p.speaker_id !== null && speakerIds.has(p.speaker_id),
      );
      return { room, sessions: roomSessions, speakers: roomSpeakers, presentations: roomPresentations };
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
