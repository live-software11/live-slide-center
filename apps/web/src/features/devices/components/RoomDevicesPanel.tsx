import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowRightLeft,
  Check,
  Loader2,
  MoreVertical,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import {
  broadcastForceRefresh,
  renameDevice,
  revokeDevice,
  updateDeviceRoom,
} from '../repository';
import type { RoomDevice } from '../hooks/useRoomDevices';

/**
 * Sprint D1+D2+D3 (GUIDA_OPERATIVA_v3 §2.D) — pannello salute PC paired
 * sotto ogni card sala in `EventDetailView`.
 *
 * Mostra per ogni device:
 *  - Pallino stato online (verde <30s / arancione 30-180s / rosso >180s o
 *    `null`). Calcolato da `last_seen_at` lato client per non dipendere
 *    dall'enum `status` che non si "spegne" da solo.
 *  - Nome device (modificabile inline) + browser
 *  - Tempo dall'ultimo `last_seen_at` ("12s fa", "3min fa", "—")
 *  - Menu actions: Forza refresh / Rinomina / Sposta in altra sala / Rimuovi
 *
 * Le actions chiamano direttamente Supabase (le RLS `tenant_isolation` su
 * `paired_devices` permettono l'admin del tenant). "Forza refresh" usa un
 * broadcast Realtime sul topic `room:<roomId>` (vedi `broadcastForceRefresh`
 * nel repository).
 *
 * Tutti i testi sono i18n IT+EN (`roomDevices.*`).
 */
const ONLINE_THRESHOLD_MS = 30 * 1000;
const WARNING_THRESHOLD_MS = 180 * 1000;

type ConnectivityState = 'online' | 'warning' | 'offline';

function computeConnectivity(lastSeenAt: string | null, fallbackStatus?: string | null): ConnectivityState {
  if (!lastSeenAt) {
    return fallbackStatus === 'online' ? 'warning' : 'offline';
  }
  const last = Date.parse(lastSeenAt);
  if (!Number.isFinite(last)) return 'offline';
  const delta = Date.now() - last;
  if (delta < ONLINE_THRESHOLD_MS) return 'online';
  if (delta < WARNING_THRESHOLD_MS) return 'warning';
  return 'offline';
}

function formatRelative(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const last = Date.parse(iso);
  if (!Number.isFinite(last)) return '—';
  const deltaSec = Math.max(0, Math.round((Date.now() - last) / 1000));
  if (deltaSec < 60) return `${deltaSec}s`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}min`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

interface RoomOption {
  id: string;
  name: string;
}

interface RoomDevicesPanelProps {
  devices: RoomDevice[];
  /** Tutte le sale dell'evento, per il dropdown "Sposta in...". */
  rooms: RoomOption[];
  /** Sala corrente (per nascondersi dal dropdown). */
  currentRoomId: string;
  /** Locale formato data/ora ("it" / "en"). */
  locale: string;
  /** Callback dopo ogni mutation per re-fetch dei device. */
  onMutated?: () => Promise<void> | void;
}

export function RoomDevicesPanel({
  devices,
  rooms,
  currentRoomId,
  locale,
  onMutated,
}: RoomDevicesPanelProps) {
  const { t } = useTranslation();

  if (devices.length === 0) {
    return (
      <p className="mt-3 text-xs italic text-sc-text-dim">
        {t('roomDevices.empty')}
      </p>
    );
  }

  return (
    <ul className="mt-3 space-y-1.5 border-l-2 border-sc-primary/15 pl-3">
      {devices.map((device) => (
        <DeviceRow
          key={device.id}
          device={device}
          rooms={rooms}
          currentRoomId={currentRoomId}
          locale={locale}
          onMutated={onMutated}
        />
      ))}
    </ul>
  );
}

function DeviceRow({
  device,
  rooms,
  currentRoomId,
  locale,
  onMutated,
}: {
  device: RoomDevice;
  rooms: RoomOption[];
  currentRoomId: string;
  locale: string;
  onMutated?: () => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(device.device_name);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState<null | 'force' | 'rename' | 'move' | 'remove'>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const connectivity = computeConnectivity(device.last_seen_at, device.status);
  const dotClass =
    connectivity === 'online'
      ? 'bg-sc-success'
      : connectivity === 'warning'
        ? 'bg-sc-warning'
        : 'bg-sc-danger';
  const lastSeenText = formatRelative(device.last_seen_at, locale);

  const closeAll = () => {
    setMenuOpen(false);
    setMoveOpen(false);
    setConfirmRemove(false);
    setRenaming(false);
    setErrorKey(null);
  };

  const handleForceRefresh = async () => {
    setBusy('force');
    setErrorKey(null);
    try {
      await broadcastForceRefresh(currentRoomId);
      closeAll();
    } catch {
      setErrorKey('roomDevices.errors.force_failed');
    } finally {
      setBusy(null);
    }
  };

  const handleRenameSubmit = async () => {
    const next = renameValue.trim();
    if (!next || next === device.device_name) {
      setRenaming(false);
      return;
    }
    setBusy('rename');
    setErrorKey(null);
    try {
      await renameDevice(device.id, next);
      await onMutated?.();
      closeAll();
    } catch {
      setErrorKey('roomDevices.errors.rename_failed');
    } finally {
      setBusy(null);
    }
  };

  const handleMove = async (targetRoomId: string) => {
    if (targetRoomId === currentRoomId) {
      setMoveOpen(false);
      return;
    }
    setBusy('move');
    setErrorKey(null);
    try {
      await updateDeviceRoom(device.id, targetRoomId);
      await onMutated?.();
      closeAll();
    } catch {
      setErrorKey('roomDevices.errors.move_failed');
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async () => {
    setBusy('remove');
    setErrorKey(null);
    try {
      await revokeDevice(device.id);
      await onMutated?.();
      closeAll();
    } catch {
      setErrorKey('roomDevices.errors.remove_failed');
    } finally {
      setBusy(null);
    }
  };

  const otherRooms = rooms.filter((r) => r.id !== currentRoomId);

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg bg-sc-surface px-2 py-1.5 text-xs">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`}
        title={t(`roomDevices.status.${connectivity}`)}
      />

      <div className="min-w-0 flex-1">
        {renaming ? (
          <form
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              void handleRenameSubmit();
            }}
          >
            <input
              autoFocus
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="min-w-0 flex-1 rounded border border-sc-primary/30 bg-sc-bg px-1.5 py-0.5 text-xs text-sc-text outline-none ring-sc-ring/25 focus:ring-2"
              maxLength={80}
            />
            <button
              type="submit"
              disabled={busy === 'rename'}
              className="rounded p-1 text-sc-success hover:bg-sc-success/10 disabled:opacity-50"
              aria-label={t('common.save')}
            >
              {busy === 'rename' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setRenameValue(device.device_name);
                setRenaming(false);
              }}
              className="rounded p-1 text-sc-text-dim hover:bg-sc-elevated"
              aria-label={t('common.cancel')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </form>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium text-sc-text">{device.device_name}</span>
            {device.browser ? (
              <span className="text-[10px] text-sc-text-dim">· {device.browser}</span>
            ) : null}
            <span className="text-[10px] text-sc-text-dim" title={device.last_seen_at ?? ''}>
              · {t('roomDevices.lastSeen', { value: lastSeenText })}
            </span>
          </div>
        )}
        {errorKey ? (
          <p className="mt-0.5 text-[10px] text-sc-danger" role="alert">
            {t(errorKey)}
          </p>
        ) : null}
      </div>

      {confirmRemove ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] text-sc-warning">{t('roomDevices.confirmRemove')}</span>
          <button
            type="button"
            disabled={busy === 'remove'}
            onClick={() => void handleRemove()}
            className="rounded bg-sc-danger/15 px-2 py-0.5 text-[10px] font-medium text-sc-danger hover:bg-sc-danger/25 disabled:opacity-50"
          >
            {busy === 'remove' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              t('common.confirmDelete')
            )}
          </button>
          <button
            type="button"
            onClick={() => setConfirmRemove(false)}
            className="rounded border border-sc-primary/20 px-2 py-0.5 text-[10px] text-sc-text-secondary hover:bg-sc-elevated"
          >
            {t('common.cancel')}
          </button>
        </div>
      ) : moveOpen ? (
        <div className="flex shrink-0 items-center gap-1">
          {otherRooms.length === 0 ? (
            <span className="text-[10px] italic text-sc-text-dim">
              {t('roomDevices.move.noOtherRooms')}
            </span>
          ) : (
            <select
              className="rounded border border-sc-primary/20 bg-sc-bg px-1.5 py-0.5 text-[10px] text-sc-text outline-none"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value;
                if (v) void handleMove(v);
              }}
              disabled={busy === 'move'}
            >
              <option value="" disabled>
                {t('roomDevices.move.placeholder')}
              </option>
              {otherRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => setMoveOpen(false)}
            className="rounded p-0.5 text-sc-text-dim hover:bg-sc-elevated"
            aria-label={t('common.cancel')}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : !renaming ? (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded p-1 text-sc-text-dim hover:bg-sc-elevated"
            aria-label={t('roomDevices.actionsMenuLabel', { name: device.device_name })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 top-full z-10 mt-1 w-44 rounded-lg border border-sc-primary/15 bg-sc-elevated p-1 shadow-lg"
            >
              <MenuItem
                icon={busy === 'force' ? Loader2 : RefreshCw}
                disabled={busy === 'force'}
                spinning={busy === 'force'}
                onClick={() => void handleForceRefresh()}
                label={t('roomDevices.actions.forceRefresh')}
              />
              <MenuItem
                icon={Pencil}
                onClick={() => {
                  setRenameValue(device.device_name);
                  setRenaming(true);
                  setMenuOpen(false);
                }}
                label={t('roomDevices.actions.rename')}
              />
              <MenuItem
                icon={ArrowRightLeft}
                onClick={() => {
                  setMoveOpen(true);
                  setMenuOpen(false);
                }}
                label={t('roomDevices.actions.move')}
              />
              <MenuItem
                icon={Trash2}
                danger
                onClick={() => {
                  setConfirmRemove(true);
                  setMenuOpen(false);
                }}
                label={t('roomDevices.actions.remove')}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  spinning,
}: {
  icon: typeof RefreshCw;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  spinning?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-sc-bg disabled:opacity-50 ${danger ? 'text-sc-danger' : 'text-sc-text'}`}
    >
      <Icon className={`h-3 w-3 shrink-0 ${spinning ? 'animate-spin' : ''}`} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
