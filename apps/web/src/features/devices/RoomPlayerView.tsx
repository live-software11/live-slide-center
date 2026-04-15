import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Folder,
  FolderOpen,
  LogOut,
  Menu,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import type { Database } from '@slidecenter/shared';
import { getDeviceByToken } from './repository';
import { useFileSync } from './hooks/useFileSync';
import { FileSyncStatus } from './components/FileSyncStatus';

type SyncStatus = Database['public']['Enums']['sync_status'];

interface SessionRow {
  id: string;
  title: string;
  scheduled_start: string;
  scheduled_end: string;
}

interface RoomData {
  id: string;
  name: string;
  syncStatus: SyncStatus;
  currentSession: SessionRow | null;
  eventId: string;
}

function syncStatusColor(status: SyncStatus): string {
  switch (status) {
    case 'synced':
      return 'text-green-400 bg-green-900/30 border-green-700/40';
    case 'syncing':
      return 'text-yellow-400 bg-yellow-900/30 border-yellow-700/40';
    case 'outdated':
      return 'text-orange-400 bg-orange-900/30 border-orange-700/40';
    case 'offline':
      return 'text-red-400 bg-red-900/30 border-red-700/40';
  }
}

function SyncBadge({ status }: { status: SyncStatus }) {
  const { t } = useTranslation();
  const icons: Record<SyncStatus, React.ReactNode> = {
    synced: <CheckCircle2 className="h-3.5 w-3.5" />,
    syncing: <RefreshCw className="h-3.5 w-3.5 animate-spin" />,
    outdated: <Clock className="h-3.5 w-3.5" />,
    offline: <WifiOff className="h-3.5 w-3.5" />,
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${syncStatusColor(status)}`}
    >
      {icons[status]}
      {t(`roomPlayer.sync.${status}`)}
    </span>
  );
}

export default function RoomPlayerView() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const { supported, dirHandle, items, pickFolder, clearFolder, retryItem } = useFileSync({
    roomId: roomData?.id ?? '',
    roomName: roomData?.name ?? 'sala',
    eventId: roomData?.eventId ?? '',
    enabled: !!roomData,
  });

  useEffect(() => {
    if (!token) {
      setAuthError('missing_token');
      setLoading(false);
      return;
    }

    async function loadRoom() {
      try {
        const device = await getDeviceByToken(token!);
        if (!device) {
          setAuthError('invalid_token');
          setLoading(false);
          return;
        }

        const supabase = getSupabaseBrowserClient();

        const { data: room } = await supabase
          .from('rooms')
          .select('id, name')
          .eq('id', device.room_id ?? '')
          .maybeSingle();

        if (!room) {
          setAuthError('no_room_assigned');
          setLoading(false);
          return;
        }

        const { data: roomState } = await supabase
          .from('room_state')
          .select('sync_status, current_session_id')
          .eq('room_id', room.id)
          .maybeSingle();

        let currentSession: SessionRow | null = null;
        if (roomState?.current_session_id) {
          const { data: session } = await supabase
            .from('sessions')
            .select('id, title, scheduled_start, scheduled_end')
            .eq('id', roomState.current_session_id)
            .maybeSingle();
          currentSession = session ?? null;
        }

        setRoomData({
          id: room.id,
          name: room.name,
          syncStatus: roomState?.sync_status ?? 'offline',
          currentSession,
          eventId: device.event_id,
        });
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'load_error');
      } finally {
        setLoading(false);
      }
    }

    void loadRoom();
  }, [token]);

  const roomId = roomData?.id;

  useEffect(() => {
    if (!roomId) return;

    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel(`room-player:${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'room_state',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const rs = payload.new as { sync_status: SyncStatus; current_session_id: string | null };
          setRoomData((prev) =>
            prev ? { ...prev, syncStatus: rs.sync_status } : prev,
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [roomId]);

  const handleDisconnect = () => {
    localStorage.removeItem('device_token');
    localStorage.removeItem('device_id');
    navigate('/pair');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <p className="text-zinc-400">{t('common.loading')}</p>
      </div>
    );
  }

  if (authError || !roomData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 gap-4 p-6">
        <p className="text-red-400">
          {authError === 'invalid_token'
            ? t('roomPlayer.error.invalidToken')
            : authError === 'no_room_assigned'
              ? t('roomPlayer.error.noRoom')
              : authError === 'missing_token'
                ? t('roomPlayer.error.missingToken')
                : t('roomPlayer.error.generic')}
        </p>
        <button
          type="button"
          onClick={() => navigate('/pair')}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500"
        >
          {t('roomPlayer.error.reconnect')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <Folder className="h-5 w-5 text-zinc-400" />
          <div>
            <h1 className="text-sm font-semibold">{roomData.name}</h1>
            {roomData.currentSession && (
              <p className="text-xs text-zinc-400 truncate max-w-56">
                {roomData.currentSession.title}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <SyncBadge status={roomData.syncStatus} />
          <button
            type="button"
            aria-label={t('common.menu')}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-1.5 text-zinc-400 hover:text-zinc-200"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <div className="border-b border-zinc-800 bg-zinc-900 px-4 py-2">
          <ul className="space-y-1">
            {supported && (
              <li>
                <button
                  type="button"
                  onClick={async () => {
                    if (dirHandle) {
                      await clearFolder();
                    } else {
                      await pickFolder();
                    }
                    setMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                >
                  <FolderOpen className="h-4 w-4" />
                  {dirHandle
                    ? t('roomPlayer.menu.changeFolder')
                    : t('roomPlayer.menu.openFolder')}
                </button>
              </li>
            )}
            <li>
              <button
                type="button"
                onClick={() => navigate('/pair')}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                <RefreshCw className="h-4 w-4" />
                {t('roomPlayer.menu.changeRoom')}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-red-400 hover:bg-zinc-800"
              >
                <LogOut className="h-4 w-4" />
                {t('roomPlayer.menu.disconnect')}
              </button>
            </li>
          </ul>
        </div>
      )}

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {/* Banner selezione cartella */}
        {supported && !dirHandle && (
          <div className="rounded-lg border border-blue-800/60 bg-blue-950/40 p-4">
            <p className="text-sm font-medium text-blue-300">{t('roomPlayer.fileSync.pickFolderTitle')}</p>
            <p className="mt-1 text-xs text-blue-400/80">{t('roomPlayer.fileSync.pickFolderHint')}</p>
            <button
              type="button"
              onClick={pickFolder}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              <FolderOpen className="h-4 w-4" />
              {t('roomPlayer.fileSync.pickFolderCta')}
            </button>
          </div>
        )}

        {/* Cartella selezionata — info */}
        {supported && dirHandle && (
          <div className="flex items-center gap-2 rounded-lg border border-green-800/40 bg-green-950/20 px-3 py-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-green-400" />
            <span className="min-w-0 flex-1 truncate text-xs text-green-300">
              {t('roomPlayer.fileSync.folderActive', { name: dirHandle.name })}
            </span>
          </div>
        )}

        {/* Avviso browser non supportato */}
        {!supported && (
          <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-3 py-2">
            <p className="text-xs text-amber-400">{t('roomPlayer.fileSync.notSupported')}</p>
          </div>
        )}

        {/* Lista file con stato sync */}
        {dirHandle && items.length > 0 ? (
          <FileSyncStatus items={items} onRetry={retryItem} />
        ) : dirHandle && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-500">{t('roomPlayer.noFiles')}</p>
        ) : !dirHandle && items.length === 0 && supported ? null : (
          <p className="py-8 text-center text-sm text-zinc-500">{t('roomPlayer.noFiles')}</p>
        )}
      </main>
    </div>
  );
}

export { RoomPlayerView as Component };
