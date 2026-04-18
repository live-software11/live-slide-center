import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Folder,
  FolderOpen,
  Gauge,
  Loader2,
  LogOut,
  Menu,
  Network,
  Pencil,
  Radio,
  RefreshCw,
  Tv2,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  invokeRoomPlayerBootstrap,
  invokeRoomPlayerRename,
  invokeRoomPlayerSetCurrent,
  type PlaybackMode,
  type RoomPlayerBootstrapSession,
  type RoomPlayerNetworkMode,
} from './repository';
import {
  clearDevicePairing,
  getDesktopBackendInfo,
  getDesktopRole,
  getPersistedDevice,
  type DesktopBackendInfo,
  type PersistedDevice,
} from '@/lib/desktop-bridge';
import { isRunningInTauri } from '@/lib/backend-mode';
import { useFileSync, type FileSyncItem, type RealtimeChannelStatus } from './hooks/useFileSync';
import { useConnectivityMode, type ConnectivityMode } from './hooks/useConnectivityMode';
import { FileSyncStatus } from './components/FileSyncStatus';
import { StorageUsagePanel } from './components/StorageUsagePanel';
import { FilePreviewDialog } from '@/features/presentations/components/FilePreviewDialog';
import { useFilePreviewSource } from '@/features/presentations/hooks/useFilePreviewSource';
import type { Database } from '@slidecenter/shared';

type SyncStatus = Database['public']['Enums']['sync_status'];

const STORED_TOKEN_KEY = 'device_token';
const STORED_DEVICE_ID_KEY = 'device_id';
/**
 * Sprint A1 (GUIDA_OPERATIVA_v3 §2.A1) — modalita di playback persistita
 * localmente. Cosi' un PC sala riavviato a meta' evento ricorda di essere in
 * `live` e non ricomincia a martellare il polling con frequenza `auto`.
 */
const STORED_PLAYBACK_MODE_KEY = 'sc:rp:playbackMode';

function loadStoredPlaybackMode(): PlaybackMode {
  try {
    const raw = localStorage.getItem(STORED_PLAYBACK_MODE_KEY);
    if (raw === 'auto' || raw === 'live' || raw === 'turbo') return raw;
  } catch {
    /* ignore */
  }
  return 'auto';
}

interface RoomData {
  id: string;
  name: string;
  syncStatus: SyncStatus;
  currentSession: RoomPlayerBootstrapSession | null;
  eventId: string;
  eventName: string | null;
  networkMode: RoomPlayerNetworkMode;
  agentLan: { lan_ip: string; lan_port: number } | null;
}

interface DeviceData {
  id: string;
  name: string;
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

/**
 * Sprint A2 (GUIDA_OPERATIVA_v3 §2.A2) — selettore modalita playback (radio
 * group orizzontale a 3 chip). Fonte di verita locale (UI) → propagata al hook
 * `useFileSync` e all'Edge Function `room-player-bootstrap` ad ogni polling.
 */
const PLAYBACK_MODE_STYLES: Record<PlaybackMode, { active: string; Icon: LucideIcon }> = {
  auto: {
    active: 'border-sc-primary/40 bg-sc-primary/15 text-sc-primary',
    Icon: Gauge,
  },
  live: {
    active: 'border-sc-success/40 bg-sc-success/15 text-sc-success',
    Icon: Tv2,
  },
  turbo: {
    active: 'border-sc-accent/40 bg-sc-accent/15 text-sc-accent',
    Icon: Zap,
  },
};

const PLAYBACK_MODE_ORDER: PlaybackMode[] = ['auto', 'live', 'turbo'];

function PlaybackModeChip({
  mode,
  onChange,
}: {
  mode: PlaybackMode;
  onChange: (next: PlaybackMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="radiogroup"
      aria-label={t('roomPlayer.playbackMode.label')}
      className="inline-flex items-center gap-0.5 rounded-full border border-sc-primary/12 bg-sc-surface p-0.5"
    >
      {PLAYBACK_MODE_ORDER.map((m) => {
        const cfg = PLAYBACK_MODE_STYLES[m];
        const Icon = cfg.Icon;
        const active = m === mode;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(m)}
            title={t(`roomPlayer.playbackMode.hint.${m}`)}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${active
              ? cfg.active
              : 'border-transparent text-sc-text-muted hover:bg-sc-elevated'
              }`}
          >
            <Icon className="h-3 w-3" />
            <span>{t(`roomPlayer.playbackMode.short.${m}`)}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Sprint B4 (GUIDA_OPERATIVA_v3 §2.B4) — chip stato Realtime.
 *
 * Indica al tecnico in sala se le notifiche push dal cloud stanno arrivando
 * (LIVE SYNC, verde, icona pulsante) oppure se siamo solo in polling
 * (POLLING, grigio). Quando subscribed, le modifiche dall'admin appaiono
 * in <1s senza aspettare il prossimo tick di polling.
 */
function RealtimeChip({ status }: { status: RealtimeChannelStatus }) {
  const { t } = useTranslation();
  const cfg = (() => {
    switch (status) {
      case 'subscribed':
        return {
          label: t('roomPlayer.realtime.subscribed'),
          className: 'border-sc-success/30 bg-sc-success/10 text-sc-success',
          pulse: true,
          hint: t('roomPlayer.realtime.hint.subscribed'),
        };
      case 'connecting':
        return {
          label: t('roomPlayer.realtime.connecting'),
          className: 'border-sc-warning/30 bg-sc-warning/10 text-sc-warning',
          pulse: false,
          hint: t('roomPlayer.realtime.hint.connecting'),
        };
      case 'error':
        return {
          label: t('roomPlayer.realtime.polling'),
          className: 'border-sc-text-muted/20 bg-sc-elevated text-sc-text-muted',
          pulse: false,
          hint: t('roomPlayer.realtime.hint.error'),
        };
      case 'idle':
      default:
        return {
          label: t('roomPlayer.realtime.polling'),
          className: 'border-sc-text-muted/20 bg-sc-elevated text-sc-text-muted',
          pulse: false,
          hint: t('roomPlayer.realtime.hint.idle'),
        };
    }
  })();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.className}`}
      title={cfg.hint}
      aria-label={`${t('roomPlayer.realtime.label')}: ${cfg.label}`}
    >
      <Radio className={`h-3 w-3 ${cfg.pulse ? 'animate-pulse' : ''}`} aria-hidden="true" />
      <span>{cfg.label}</span>
    </span>
  );
}

/** Modale di conferma "esci dall'evento" — overlay full-screen con backdrop. */
function ConfirmDisconnectModal({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-sc-surface p-6 shadow-2xl ring-1 ring-sc-primary/20">
        <h2 className="text-lg font-semibold text-sc-text">
          {t('roomPlayer.confirmDisconnect.title')}
        </h2>
        <p className="mt-2 text-sm text-sc-text-muted">
          {t('roomPlayer.confirmDisconnect.body')}
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-sc-primary/20 bg-sc-elevated px-4 py-2 text-sm font-medium text-sc-text hover:bg-sc-elevated/80"
          >
            {t('roomPlayer.confirmDisconnect.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-xl bg-sc-danger px-4 py-2 text-sm font-medium text-white hover:bg-sc-danger/80"
          >
            {t('roomPlayer.confirmDisconnect.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Editor inline del nome PC, salva via Edge Function autenticato col device_token. */
function DeviceNameEditor({
  deviceToken,
  device,
  onUpdated,
}: {
  deviceToken: string;
  device: DeviceData;
  onUpdated: (next: DeviceData) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(device.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraft(device.name);
  }, [device.name]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setError(null);
          setEditing(true);
        }}
        className="group flex max-w-full items-center gap-1.5 rounded-md px-1 -mx-1 text-left hover:bg-sc-elevated"
        title={t('roomPlayer.deviceName.edit')}
      >
        <span className="truncate text-sm font-medium text-sc-text">{device.name}</span>
        <Pencil className="h-3.5 w-3.5 shrink-0 text-sc-text-dim transition-opacity group-hover:opacity-100 sm:opacity-0" />
      </button>
    );
  }

  const submit = async () => {
    const trimmed = draft.trim();
    if (trimmed.length < 2) {
      setError(t('roomPlayer.deviceName.tooShort'));
      return;
    }
    if (trimmed === device.name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await invokeRoomPlayerRename(deviceToken, trimmed);
      onUpdated({ id: res.device_id, name: res.device_name });
      setEditing(false);
    } catch {
      setError(t('roomPlayer.deviceName.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') {
            setDraft(device.name);
            setEditing(false);
          }
        }}
        disabled={saving}
        maxLength={120}
        placeholder={t('roomPlayer.deviceName.placeholder')}
        aria-label={t('roomPlayer.deviceName.label')}
        className="min-w-0 flex-1 rounded-md border border-sc-primary/30 bg-sc-bg px-2 py-1 text-sm text-sc-text outline-none focus:border-sc-primary"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={saving}
        aria-label={t('roomPlayer.deviceName.save')}
        className="rounded-md p-1 text-sc-success hover:bg-sc-elevated disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(device.name);
          setEditing(false);
          setError(null);
        }}
        disabled={saving}
        aria-label={t('roomPlayer.deviceName.cancel')}
        className="rounded-md p-1 text-sc-text-muted hover:bg-sc-elevated disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
      {error && (
        <span className="absolute mt-12 max-w-xs rounded bg-sc-danger/90 px-2 py-1 text-[11px] text-white shadow">
          {error}
        </span>
      )}
    </div>
  );
}

export default function RoomPlayerView() {
  const { t, i18n } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [device, setDevice] = useState<DeviceData | null>(null);
  const [waitingRoom, setWaitingRoom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [navigatorOnline, setNavigatorOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  // Sprint A1: stato playback mode persistito in localStorage. Lazy init per
  // evitare race condition al primo render.
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode>(() => loadStoredPlaybackMode());
  // Sprint N2-N3: in modalita desktop (Tauri) leggiamo `device.json` per
  // ottenere l'URL del PC admin (download via lan-sign-url) e backend info
  // per il base URL del proprio Axum locale (long-poll eventi LAN).
  // In modalita cloud restano `null` e useFileSync funziona come oggi.
  const [persistedDevice, setPersistedDevice] = useState<PersistedDevice | null>(null);
  const [desktopInfo, setDesktopInfo] = useState<DesktopBackendInfo | null>(null);
  useEffect(() => {
    if (!isRunningInTauri()) return;
    let cancelled = false;
    void Promise.all([getPersistedDevice(), getDesktopBackendInfo()]).then(([dev, info]) => {
      if (cancelled) return;
      setPersistedDevice(dev);
      setDesktopInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const lanAdminBaseUrl = useMemo(
    () => persistedDevice?.admin_server?.base_url ?? null,
    [persistedDevice],
  );
  const localBackendBaseUrl = useMemo(
    () => (desktopInfo?.ready ? desktopInfo.base_url ?? null : null),
    [desktopInfo],
  );
  // Sprint I (§3.D + §3.E): file aperto in anteprima sul PC sala. Quando
  // settato, render `<FilePreviewDialog>` con sorgente locale (FSA blob URL).
  const [previewItem, setPreviewItem] = useState<FileSyncItem | null>(null);
  // Sprint I (§3.E E4): id presentation segnalata come "ora in onda". Snapshot
  // ottimistico locale (l'admin lo riceve via room_state.current_presentation_id).
  const [nowPlayingPresentationId, setNowPlayingPresentationId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORED_PLAYBACK_MODE_KEY, playbackMode);
    } catch {
      /* ignore */
    }
  }, [playbackMode]);

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

  const {
    supported,
    dirHandle,
    items,
    pickFolder,
    clearFolder,
    retryItem,
    refreshNow,
    realtimeStatus,
    storage,
    cleanupOrphanFiles,
  } = useFileSync({
    roomId: roomData?.id ?? '',
    roomName: roomData?.name ?? 'sala',
    eventId: roomData?.eventId ?? '',
    deviceToken: token ?? '',
    networkMode: roomData?.networkMode ?? 'cloud',
    agentLan: roomData?.agentLan ?? null,
    navigatorOnline,
    enabled: Boolean(roomData && token),
    playbackMode,
    lanAdminBaseUrl,
    localBackendBaseUrl,
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
        setDevice({ id: data.device.id, name: data.device.name });
        if (!data.room) {
          setRoomData(null);
          setWaitingRoom(true);
        } else {
          setRoomData({
            id: data.room.id,
            name: data.room.name,
            syncStatus: data.room_state.sync_status,
            currentSession: data.room_state.current_session,
            eventId: data.event_id,
            eventName: data.event_name ?? null,
            networkMode: data.network_mode ?? 'cloud',
            agentLan: data.agent,
          });
          setWaitingRoom(false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'invalid_token') setAuthError('invalid_token');
        else if (msg === 'tenant_suspended') setAuthError('tenant_suspended');
        else setAuthError('generic');
      } finally {
        setLoading(false);
      }
    }

    void loadRoom();
  }, [token]);

  const roomId = roomData?.id;

  // Polling continuo ogni 12s anche quando in attesa di sala: appena admin
  // assegna la sala, l'UI del PC sala si aggiorna automaticamente.
  // Sprint A6: ad ogni tick dichiariamo la modalita di playback al server cosi'
  // la dashboard admin (sezione Sala dell'evento) la veda sempre fresca.
  useEffect(() => {
    if (!token) return;
    const pollToken = token;
    const id = window.setInterval(() => {
      void invokeRoomPlayerBootstrap(pollToken, false, playbackMode)
        .then((d) => {
          setDevice((prev) => (prev?.name === d.device.name && prev?.id === d.device.id ? prev : { id: d.device.id, name: d.device.name }));
          if (!d.room) {
            setWaitingRoom(true);
            setRoomData(null);
            return;
          }
          setWaitingRoom(false);
          setRoomData((prev) =>
            prev
              ? {
                ...prev,
                id: d.room!.id,
                name: d.room!.name,
                syncStatus: d.room_state.sync_status,
                currentSession: d.room_state.current_session,
                networkMode: d.network_mode ?? 'cloud',
                agentLan: d.agent,
                eventName: d.event_name ?? prev.eventName,
              }
              : {
                id: d.room!.id,
                name: d.room!.name,
                syncStatus: d.room_state.sync_status,
                currentSession: d.room_state.current_session,
                eventId: d.event_id,
                eventName: d.event_name ?? null,
                networkMode: d.network_mode ?? 'cloud',
                agentLan: d.agent,
              },
          );
        })
        .catch(() => { });
    }, 12_000);
    return () => window.clearInterval(id);
  }, [token, roomId, playbackMode]);

  const handleDisconnect = () => {
    try {
      localStorage.removeItem(STORED_TOKEN_KEY);
      localStorage.removeItem(STORED_DEVICE_ID_KEY);
    } catch {
      /* ignore */
    }
    // Sprint M3 (GUIDA_OPERATIVA_v3 §4.E M3): in modalita desktop role=sala
    // l'utente che fa "Esci dall'evento" deve smontare il pairing in modo
    // coordinato: cancella `device.json` + riga `paired_devices` SQLite +
    // reset TXT mDNS event_id. Senza questo, `DesktopRoleGate` ripopolerebbe
    // localStorage al prossimo refresh e re-redirecterebbe a /sala/:token
    // (loop infinito perche' il token in localStorage e' stato pulito ma
    // device.json ce l'ha ancora).
    //
    // Fire-and-forget: non blocchiamo la nav. Se Tauri non e' disponibile
    // (cloud) il bridge ritorna noop in 0 ms.
    if (isRunningInTauri()) {
      void (async () => {
        try {
          const role = await getDesktopRole();
          if (role === 'sala') {
            await clearDevicePairing();
          }
        } catch {
          /* best-effort */
        }
      })();
    }
    navigate('/pair', { replace: true });
  };

  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const aTime = a.sessionScheduledStart ? Date.parse(a.sessionScheduledStart) : Number.POSITIVE_INFINITY;
      const bTime = b.sessionScheduledStart ? Date.parse(b.sessionScheduledStart) : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.filename.localeCompare(b.filename);
    });
  }, [items]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg">
        <p className="text-sc-text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg gap-4 p-6">
        <p className="text-sc-danger text-center max-w-sm">
          {authError === 'invalid_token'
            ? t('roomPlayer.error.invalidToken')
            : authError === 'missing_token'
              ? t('roomPlayer.error.missingToken')
              : authError === 'tenant_suspended'
                ? t('auth.errorTenantSuspendedLogin')
                : t('roomPlayer.error.generic')}
        </p>
        <button
          type="button"
          onClick={handleDisconnect}
          className="rounded-xl bg-sc-primary px-4 py-2 text-sm text-white hover:bg-sc-primary/80"
        >
          {t('roomPlayer.error.reconnect')}
        </button>
      </div>
    );
  }

  if (waitingRoom && device) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-sc-bg gap-5 p-6 text-center">
        <Building2 className="h-12 w-12 text-sc-text-muted" aria-hidden="true" />
        <div className="max-w-md space-y-2">
          <h1 className="text-xl font-semibold text-sc-text">
            {t('roomPlayer.noRoomAssigned.title')}
          </h1>
          <p className="text-sm text-sc-text-muted">
            {t('roomPlayer.noRoomAssigned.body')}
          </p>
          <p className="pt-2 text-xs text-sc-text-dim">
            {t('roomPlayer.noRoomAssigned.deviceNameHint', { name: device.name })}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-sc-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('roomPlayer.noRoomAssigned.wait')}</span>
        </div>
        <button
          type="button"
          onClick={() => setConfirmDisconnect(true)}
          className="mt-2 inline-flex items-center gap-2 rounded-xl border border-sc-primary/20 bg-sc-surface px-4 py-2 text-sm text-sc-text-secondary hover:bg-sc-elevated"
        >
          <LogOut className="h-4 w-4" />
          {t('roomPlayer.menu.disconnect')}
        </button>
        <ConfirmDisconnectModal
          open={confirmDisconnect}
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={handleDisconnect}
        />
      </div>
    );
  }

  if (!roomData || !device) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-sc-bg">
        <p className="text-sc-text-muted">{t('common.loading')}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-sc-bg text-sc-text">
      <header className="border-b border-sc-primary/12 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Folder className="h-5 w-5 shrink-0 text-sc-text-muted" />
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold text-sc-text truncate">
                {roomData.name}
              </h1>
              {roomData.eventName && (
                <p className="truncate text-xs text-sc-text-muted">{roomData.eventName}</p>
              )}
              {roomData.currentSession && (
                <p className="mt-0.5 truncate text-xs text-sc-primary">
                  ▶ {roomData.currentSession.title}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              aria-label={t('common.menu')}
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-xl p-1.5 text-sc-text-muted hover:text-sc-text"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
          <DeviceNameEditor
            deviceToken={token!}
            device={device}
            onUpdated={(next) => setDevice(next)}
          />
          <span className="hidden text-sc-text-dim sm:inline">·</span>
          <ConnectivityChip
            mode={connectivityMode}
            networkMode={roomData.networkMode}
            agentLan={roomData.agentLan}
            lanHealthy={lanHealthy}
          />
          <NetworkModeChip networkMode={roomData.networkMode} />
          <SyncBadge status={roomData.syncStatus} />
          <PlaybackModeChip mode={playbackMode} onChange={setPlaybackMode} />
          <RealtimeChip status={realtimeStatus} />
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
                onClick={() => {
                  void refreshNow();
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-sc-text-secondary hover:bg-sc-elevated"
              >
                <RefreshCw className="h-4 w-4" />
                {t('roomPlayer.actions.refresh')}
              </button>
            </li>
            <li>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setConfirmDisconnect(true);
                }}
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

        {dirHandle && storage && (
          <StorageUsagePanel storage={storage} onCleanup={cleanupOrphanFiles} />
        )}

        {sortedItems.length > 0 ? (
          <FileSyncStatus
            items={sortedItems}
            onRetry={retryItem}
            onOpen={(item) => {
              // Sprint I (§3.E E1+E3): apre l'anteprima locale e segnala
              // "now playing" all'admin (best-effort, no blocco UI).
              setPreviewItem(item);
              setNowPlayingPresentationId(item.presentationId);
              if (token) {
                void invokeRoomPlayerSetCurrent(token, item.presentationId).catch((err) => {
                  // Logghiamo solo: l'esperienza sala vince sull'audit. Se la
                  // Edge Function e' giu', il file si apre lo stesso.
                  console.warn('[room-player] set_current failed', err);
                });
              }
            }}
            nowPlayingPresentationId={nowPlayingPresentationId}
            locale={i18n.language}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-sc-primary/15 bg-sc-surface/40 px-4 py-8 text-center">
            <p className="text-sm text-sc-text-dim">{t('roomPlayer.noFilesYet')}</p>
          </div>
        )}
      </main>

      <ConfirmDisconnectModal
        open={confirmDisconnect}
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={handleDisconnect}
      />

      {/* Sprint I (§3.D + §3.E): anteprima inline file LOCALE (PDF/img/video).
          Per file non-anteprimabili (pptx/keynote/...) il dialog mostra
          fallback con bottone "Scarica" (apre il blob in nuova tab). Il vero
          launcher con app esterna arriva con SLIDE CENTER Desktop (Sprint J). */}
      {previewItem && dirHandle && (
        <RoomPreviewDialogContainer
          item={previewItem}
          dirHandle={dirHandle}
          roomName={roomData?.name ?? 'sala'}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
}

/**
 * Sprint I — wrapper PC sala per `<FilePreviewDialog>`. Sorgente sempre
 * `local` (regola sovrana §1: la sala usa SOLO i file in cartella).
 *
 * Path FSA: `[roomName, sessionTitle, filename]` — combaciante con quello
 * scritto dal downloader in `useFileSync` (sanitizeFsSegment applicato in
 * `readLocalFile` per la lettura, quindi e' OK passare i nomi originali).
 */
function RoomPreviewDialogContainer({
  item,
  dirHandle,
  roomName,
  onClose,
}: {
  item: FileSyncItem;
  dirHandle: FileSystemDirectoryHandle;
  roomName: string;
  onClose: () => void;
}) {
  const { url, loading, error } = useFilePreviewSource({
    enabled: true,
    mode: 'local',
    dirHandle,
    segments: [roomName || 'sala', item.sessionTitle || 'sessione'],
    filename: item.filename,
    enforceLocalOnly: true,
  });

  // Sul PC sala "scarica" significa: apri il blob URL in una nuova tab. Il
  // browser:
  // - per video/audio/img/pdf: lo riproduce/visualizza (anteprima nativa);
  // - per pptx/keynote/altri: lo SCARICA nella cartella Download di sistema,
  //   e l'utente puo' aprirlo manualmente con PowerPoint/Keynote.
  //
  // Limitazione spiegata in §3.E E2 della guida: il vero "Apri con app
  // esterna" richiede SLIDE CENTER Desktop (Tauri shell.open) — Sprint J.
  const onDownload = url ? () => window.open(url, '_blank', 'noopener,noreferrer') : undefined;

  return (
    <FilePreviewDialog
      open
      onClose={onClose}
      fileName={item.filename}
      mime={item.mimeType}
      sourceUrl={url}
      sourceLoading={loading}
      sourceError={error}
      onDownload={onDownload}
    />
  );
}

export { RoomPlayerView as Component };
