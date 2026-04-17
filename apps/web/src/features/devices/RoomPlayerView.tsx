import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Folder,
  FolderOpen,
  LogOut,
  Menu,
  Network,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import { invokeRoomPlayerBootstrap, type RoomPlayerBootstrapSession, type RoomPlayerNetworkMode } from './repository';
import { useFileSync } from './hooks/useFileSync';
import { useConnectivityMode, type ConnectivityMode } from './hooks/useConnectivityMode';
import { FileSyncStatus } from './components/FileSyncStatus';
import type { Database } from '@slidecenter/shared';

type SyncStatus = Database['public']['Enums']['sync_status'];

interface RoomData {
  id: string;
  name: string;
  syncStatus: SyncStatus;
  currentSession: RoomPlayerBootstrapSession | null;
  eventId: string;
  networkMode: RoomPlayerNetworkMode;
  agentLan: { lan_ip: string; lan_port: number } | null;
}

function syncStatusColor(status: SyncStatus): string {
  switch (status) {
    case 'synced':
      return 'text-sc-success bg-sc-success/10 border-sc-success/30';
    case 'syncing':
      return 'text-sc-warning bg-sc-warning/10 border-sc-warning/30';
    case 'outdated':
      return 'text-sc-accent bg-sc-accent/10 border-sc-accent/30';
    case 'offline':
      return 'text-sc-danger bg-sc-danger/10 border-sc-danger/30';
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

/**
 * Sprint 2 — Chip di connettivita' a 4 stati (intranet offline aware).
 * Sostituisce il vecchio RouteModeChip basato solo su `networkMode`.
 *
 * Stati visibili:
 *  - cloud-direct  (verde)     — Internet + nessun agent o probe negativa
 *  - lan-via-agent (verde-blu) — Internet + Local Agent in LAN (preferito)
 *  - intranet-only (giallo)    — Internet KO ma Local Agent serve i file
 *  - offline       (rosso)     — Tutto irraggiungibile, cache locale
 */
const CONNECTIVITY_STYLES: Record<ConnectivityMode, string> = {
  'cloud-direct': 'border-sc-success/30 bg-sc-success/10 text-sc-success',
  'lan-via-agent': 'border-sc-primary/30 bg-sc-primary/10 text-sc-primary',
  'intranet-only': 'border-sc-warning/30 bg-sc-warning/10 text-sc-warning',
  offline: 'border-sc-danger/30 bg-sc-danger/10 text-sc-danger',
};

function ConnectivityChip({
  mode,
  networkMode,
  agentLan,
  lanHealthy,
}: {
  mode: ConnectivityMode;
  networkMode: RoomPlayerNetworkMode;
  agentLan: { lan_ip: string; lan_port: number } | null;
  lanHealthy: boolean | null;
}) {
  const { t } = useTranslation();

  const Icon =
    mode === 'offline'
      ? WifiOff
      : mode === 'intranet-only'
        ? Network
        : mode === 'lan-via-agent'
          ? Network
          : Cloud;

  const label = t(`intranet.status.${mode}`);

  let hint: string;
  if (mode === 'offline') {
    hint = agentLan
      ? t('intranet.hint.offlineWithAgentDown', {
        ip: agentLan.lan_ip,
        port: agentLan.lan_port,
      })
      : t('intranet.hint.offlineNoAgent');
  } else if (mode === 'intranet-only') {
    hint = t('intranet.hint.intranetOnly', {
      ip: agentLan?.lan_ip ?? '-',
      port: agentLan?.lan_port ?? '-',
    });
  } else if (mode === 'lan-via-agent') {
    hint = t('intranet.hint.lanViaAgent', {
      ip: agentLan?.lan_ip ?? '-',
      port: agentLan?.lan_port ?? '-',
    });
  } else if (agentLan && lanHealthy === false) {
    hint = t('intranet.hint.cloudFallback', {
      ip: agentLan.lan_ip,
      port: agentLan.lan_port,
    });
  } else if (networkMode === 'intranet') {
    hint = t('intranet.hint.cloudDirectIntranetMode');
  } else {
    hint = t('intranet.hint.cloudDirectDefault');
  }

  return (
    <span
      className={`inline-flex max-w-44 items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-medium ${CONNECTIVITY_STYLES[mode]}`}
      title={hint}
      aria-label={`${label}: ${hint}`}
      role="status"
    >
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

function NetworkModeChip({
  networkMode,
}: {
  networkMode: RoomPlayerNetworkMode;
}) {
  const { t } = useTranslation();
  const Icon = networkMode === 'cloud' ? Cloud : networkMode === 'intranet' ? Network : CloudOff;
  return (
    <span
      className="inline-flex items-center gap-1 truncate rounded-full border border-sc-primary/12 bg-sc-surface px-2 py-0.5 text-[10px] font-medium text-sc-text-muted"
      title={t('intranet.networkMode.hint', { mode: t(`roomPlayer.route.mode.${networkMode}`) })}
    >
      <Icon className="h-3 w-3 shrink-0 text-sc-primary" />
      <span className="truncate">{t(`roomPlayer.route.mode.${networkMode}`)}</span>
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
  const [navigatorOnline, setNavigatorOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const on = () => setNavigatorOnline(true);
    const off = () => setNavigatorOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const { supported, dirHandle, items, pickFolder, clearFolder, retryItem } = useFileSync({
    roomId: roomData?.id ?? '',
    roomName: roomData?.name ?? 'sala',
    eventId: roomData?.eventId ?? '',
    deviceToken: token ?? '',
    networkMode: roomData?.networkMode ?? 'cloud',
    agentLan: roomData?.agentLan ?? null,
    navigatorOnline,
    enabled: Boolean(roomData && token),
  });

  const { mode: connectivityMode, lanHealthy } = useConnectivityMode({
    agentLan: roomData?.agentLan ?? null,
    navigatorOnline,
    enabled: Boolean(roomData && token),
  });

  useEffect(() => {
    if (!token) {
      setAuthError('missing_token');
      setLoading(false);
      return;
    }

    const deviceToken = token;

    async function loadRoom() {
      try {
        const data = await invokeRoomPlayerBootstrap(deviceToken);
        setRoomData({
          id: data.room.id,
          name: data.room.name,
          syncStatus: data.room_state.sync_status,
          currentSession: data.room_state.current_session,
          eventId: data.event_id,
          networkMode: data.network_mode,
          agentLan: data.agent,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'invalid_token') setAuthError('invalid_token');
        else if (msg === 'no_room_assigned') setAuthError('no_room_assigned');
        else if (msg === 'tenant_suspended') setAuthError('tenant_suspended');
        else setAuthError('generic');
      } finally {
        setLoading(false);
      }
    }

    void loadRoom();
  }, [token]);

  const roomId = roomData?.id;

  useEffect(() => {
    if (!token || !roomId) return;
    const pollToken = token;
    const id = window.setInterval(() => {
      void invokeRoomPlayerBootstrap(pollToken, false)
        .then((d) => {
          setRoomData((prev) =>
            prev
              ? {
                ...prev,
                syncStatus: d.room_state.sync_status,
                currentSession: d.room_state.current_session,
                networkMode: d.network_mode,
                agentLan: d.agent,
              }
              : prev,
          );
        })
        .catch(() => { });
    }, 12_000);
    return () => window.clearInterval(id);
  }, [token, roomId]);

  const handleDisconnect = () => {
    localStorage.removeItem('device_token');
    localStorage.removeItem('device_id');
    navigate('/pair');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg">
        <p className="text-sc-text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (authError || !roomData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg gap-4 p-6">
        <p className="text-sc-danger text-center max-w-sm">
          {authError === 'invalid_token'
            ? t('roomPlayer.error.invalidToken')
            : authError === 'no_room_assigned'
              ? t('roomPlayer.error.noRoom')
              : authError === 'missing_token'
                ? t('roomPlayer.error.missingToken')
                : authError === 'tenant_suspended'
                  ? t('auth.errorTenantSuspendedLogin')
                  : t('roomPlayer.error.generic')}
        </p>
        <button
          type="button"
          onClick={() => navigate('/pair')}
          className="rounded-xl bg-sc-primary px-4 py-2 text-sm text-white hover:bg-sc-primary/80"
        >
          {t('roomPlayer.error.reconnect')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-sc-bg text-sc-text">
      <header className="flex items-center justify-between border-b border-sc-primary/12 px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Folder className="h-5 w-5 shrink-0 text-sc-text-muted" />
          <div className="min-w-0">
            <h1 className="text-sm font-semibold truncate">{roomData.name}</h1>
            {roomData.currentSession && (
              <p className="text-xs text-sc-text-muted truncate max-w-56">
                {roomData.currentSession.title}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
          <ConnectivityChip
            mode={connectivityMode}
            networkMode={roomData.networkMode}
            agentLan={roomData.agentLan}
            lanHealthy={lanHealthy}
          />
          <NetworkModeChip networkMode={roomData.networkMode} />
          <SyncBadge status={roomData.syncStatus} />
          <button
            type="button"
            aria-label={t('common.menu')}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-xl p-1.5 text-sc-text-muted hover:text-sc-text shrink-0"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {connectivityMode === 'offline' && (
        <div className="border-b border-sc-danger/25 bg-sc-danger/10 px-4 py-2">
          <p className="text-center text-xs text-sc-danger">{t('intranet.banner.offline')}</p>
        </div>
      )}
      {connectivityMode === 'intranet-only' && (
        <div className="border-b border-sc-warning/25 bg-sc-warning/10 px-4 py-2">
          <p className="text-center text-xs text-sc-warning">{t('intranet.banner.intranetOnly')}</p>
        </div>
      )}

      {menuOpen && (
        <div className="border-b border-sc-primary/12 bg-sc-surface px-4 py-2">
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
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-sc-text-secondary hover:bg-sc-elevated"
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
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-sc-text-secondary hover:bg-sc-elevated"
              >
                <RefreshCw className="h-4 w-4" />
                {t('roomPlayer.menu.changeRoom')}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-sc-danger hover:bg-sc-elevated"
              >
                <LogOut className="h-4 w-4" />
                {t('roomPlayer.menu.disconnect')}
              </button>
            </li>
          </ul>
        </div>
      )}

      <main className="flex-1 overflow-auto p-4 space-y-4">
        {supported && !dirHandle && (
          <div className="rounded-xl border border-sc-primary/20 bg-sc-primary/10 p-4">
            <p className="text-sm font-medium text-sc-primary">{t('roomPlayer.fileSync.pickFolderTitle')}</p>
            <p className="mt-1 text-xs text-sc-primary/80">{t('roomPlayer.fileSync.pickFolderHint')}</p>
            <button
              type="button"
              onClick={pickFolder}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sc-primary/80"
            >
              <FolderOpen className="h-4 w-4" />
              {t('roomPlayer.fileSync.pickFolderCta')}
            </button>
          </div>
        )}

        {supported && dirHandle && (
          <div className="flex items-center gap-2 rounded-xl border border-sc-success/20 bg-sc-success/10 px-3 py-2">
            <FolderOpen className="h-4 w-4 shrink-0 text-sc-success" />
            <span className="min-w-0 flex-1 truncate text-xs text-sc-success">
              {t('roomPlayer.fileSync.folderActive', { name: dirHandle.name })}
            </span>
          </div>
        )}

        {!supported && (
          <div className="rounded-xl border border-sc-warning/20 bg-sc-warning/10 px-3 py-2">
            <p className="text-xs text-sc-warning">{t('roomPlayer.fileSync.notSupported')}</p>
          </div>
        )}

        {dirHandle && items.length > 0 ? (
          <FileSyncStatus items={items} onRetry={retryItem} />
        ) : dirHandle && items.length === 0 ? (
          <p className="py-8 text-center text-sm text-sc-text-dim">{t('roomPlayer.noFiles')}</p>
        ) : !dirHandle && items.length === 0 && supported ? null : (
          <p className="py-8 text-center text-sm text-sc-text-dim">{t('roomPlayer.noFiles')}</p>
        )}
      </main>
    </div>
  );
}

export { RoomPlayerView as Component };
