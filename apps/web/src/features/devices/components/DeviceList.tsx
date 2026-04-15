import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, MoreVertical, Pencil, LayoutGrid, Trash2, Wifi, WifiOff } from 'lucide-react';
import type { PairedDevice } from '../repository';
import { renameDevice, revokeDevice, updateDeviceRoom } from '../repository';
import type { RoomRow } from '@/features/rooms/repository';

interface DeviceListProps {
  devices: PairedDevice[];
  rooms: RoomRow[];
  onRefresh: () => void;
}

interface DeviceMenuProps {
  device: PairedDevice;
  rooms: RoomRow[];
  onDone: () => void;
}

function DeviceMenu({ device, rooms, onDone }: DeviceMenuProps) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(device.device_name);

  const handleRename = async () => {
    if (newName.trim() && newName.trim() !== device.device_name) {
      await renameDevice(device.id, newName.trim());
    }
    setRenaming(false);
    onDone();
  };

  const handleRoomChange = async (roomId: string | null) => {
    await updateDeviceRoom(device.id, roomId);
    onDone();
  };

  const handleRevoke = async () => {
    if (confirm(t('devices.list.revokeConfirm', { name: device.device_name }))) {
      await revokeDevice(device.id);
      onDone();
    }
  };

  return (
    <div className="absolute right-0 top-6 z-10 min-w-48 rounded-xl border border-sc-primary/20 bg-sc-elevated shadow-xl">
      <div className="p-2">
        {renaming ? (
          <div className="flex gap-2 px-2 py-1">
            <input
              autoFocus
              className="flex-1 rounded bg-sc-surface px-2 py-1 text-sm text-white outline-none ring-1 ring-blue-500"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
            <button
              type="button"
              className="rounded bg-sc-primary px-2 py-1 text-xs text-white"
              onClick={() => void handleRename()}
            >
              {t('common.save')}
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-sc-text-secondary hover:bg-sc-elevated"
              onClick={() => setRenaming(true)}
            >
              <Pencil className="h-4 w-4" />
              {t('devices.list.rename')}
            </button>

            <div className="mt-1">
              <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-sc-text-dim">
                {t('devices.list.assignRoom')}
              </p>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-sc-text-secondary hover:bg-sc-elevated"
                onClick={() => void handleRoomChange(null)}
              >
                <LayoutGrid className="h-4 w-4" />
                {t('devices.list.noRoom')}
              </button>
              {rooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-sc-text-secondary hover:bg-sc-elevated"
                  onClick={() => void handleRoomChange(room.id)}
                >
                  <LayoutGrid className="h-4 w-4" />
                  {room.name}
                </button>
              ))}
            </div>

            <div className="my-1 border-t border-sc-primary/20" />
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-sc-danger hover:bg-sc-elevated"
              onClick={() => void handleRevoke()}
            >
              <Trash2 className="h-4 w-4" />
              {t('devices.list.revoke')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function DeviceList({ devices, rooms, onRefresh }: DeviceListProps) {
  const { t } = useTranslation();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  if (devices.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-sc-text-dim">{t('devices.list.empty')}</p>
    );
  }

  return (
    <ul className="divide-y divide-sc-primary/12">
      {devices.map((device) => {
        const assignedRoom = rooms.find((r) => r.id === device.room_id);
        const isOnline = device.status === 'online';

        return (
          <li key={device.id} className="flex items-center gap-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sc-elevated">
              <Monitor className="h-5 w-5 text-sc-text-muted" />
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-sc-text">{device.device_name}</p>
              <p className="truncate text-xs text-sc-text-dim">
                {assignedRoom?.name ?? t('devices.list.noRoomAssigned')}
              </p>
            </div>

            <div className="flex items-center gap-1">
              {isOnline ? (
                <Wifi className="h-4 w-4 text-green-400" aria-label={t('devices.list.online')} />
              ) : (
                <WifiOff
                  className="h-4 w-4 text-sc-text-dim"
                  aria-label={t('devices.list.offline')}
                />
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                aria-label={t('devices.list.actions')}
                className="rounded p-1 text-sc-text-muted hover:text-sc-text"
                onClick={() => setOpenMenuId(openMenuId === device.id ? null : device.id)}
              >
                <MoreVertical className="h-5 w-5" />
              </button>

              {openMenuId === device.id && (
                <DeviceMenu
                  device={device}
                  rooms={rooms}
                  onDone={() => {
                    setOpenMenuId(null);
                    onRefresh();
                  }}
                />
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
