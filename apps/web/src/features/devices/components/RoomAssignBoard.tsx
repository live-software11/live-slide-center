import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Building2,
  GripVertical,
  Inbox,
  LayoutGrid,
  Loader2,
  Monitor,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { PairedDevice } from '../repository';
import { updateDeviceRoom } from '../repository';
import type { RoomRow } from '@/features/rooms/repository';

/**
 * Sprint S-2 (G5) — Lavagna drag&drop visiva PC <-> sale.
 *
 * Sostituisce/affianca il dropdown "Assegna sala" del menu kebab in
 * `DeviceList`. L'admin trascina le card device tra colonne sala (+ una
 * colonna speciale "Non assegnati"). HTML5 drag&drop nativo: zero
 * dipendenze nuove, coerente con la pipeline di drag&drop file di Sprint
 * S-1 (`SessionFilesPanel.onDrop`).
 *
 * UX:
 *   - Card device drag-and-droppabili (`draggable=true`).
 *   - Colonne hover-target con ring + colore feedback.
 *   - Aggiornamento ottimistico locale → mutation `updateDeviceRoom` →
 *     refresh esplicito (il realtime listener su `paired_devices`
 *     allineera' eventuali altre admin-sessions in <1s, vedi
 *     `usePairedDevices.useEffect`).
 *   - Rollback automatico in caso di errore Supabase + banner di errore
 *     transient (5s).
 *
 * Sicurezza:
 *   - Mutazione via `updateDeviceRoom` esistente (RLS `tenant_isolation`
 *     su `paired_devices` permette UPDATE solo all'admin del tenant).
 *   - Sovereign rule #2 N/A: nessun file viaggia, solo metadati di
 *     allocazione.
 *
 * Accessibilita:
 *   - Tutti gli eventi DnD hanno fallback select-based dentro `DeviceList`
 *     (kebab menu) per chi naviga da tastiera o non puo' usare il mouse.
 *   - Colonne hanno `aria-label` con nome sala + count.
 */

interface RoomAssignBoardProps {
  devices: PairedDevice[];
  rooms: RoomRow[];
  onRefresh: () => Promise<void> | void;
}

const DRAG_MIME = 'application/x-sc-device-id';

const ONLINE_THRESHOLD_MS = 30 * 1000;
const WARNING_THRESHOLD_MS = 180 * 1000;

type ConnectivityState = 'online' | 'warning' | 'offline';

function computeConnectivity(
  lastSeenAt: string | null,
  fallbackStatus?: string | null,
): ConnectivityState {
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

interface ColumnDef {
  id: string | null;
  name: string;
  devices: PairedDevice[];
}

export function RoomAssignBoard({ devices, rooms, onRefresh }: RoomAssignBoardProps) {
  const { t } = useTranslation();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverColumnId, setHoverColumnId] = useState<string | null | undefined>(undefined);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Optimistic state: l'utente vede subito il PC nella nuova colonna prima
  // che la mutation si concluda. Se la mutation fallisce, ripristiniamo lo
  // stato remoto via onRefresh (il listener realtime arrivera' subito dopo).
  const [optimisticRoom, setOptimisticRoom] = useState<Record<string, string | null>>({});

  const effectiveRoomId = useCallback(
    (device: PairedDevice): string | null => {
      if (device.id in optimisticRoom) {
        return optimisticRoom[device.id]!;
      }
      return device.room_id;
    },
    [optimisticRoom],
  );

  // Sprint S-4 (G7): i device 'control_center' NON entrano nella Kanban
  // sale (sono assegnati a "tutte" le sale dell'evento, non a una specifica)
  // e vengono mostrati in una fascia separata in alto, NON drag&droppabili.
  // Per riportare un CC a 'room' usare il kebab → "Riporta a sala normale".
  const regularDevices = useMemo(() => devices.filter((d) => d.role !== 'control_center'), [devices]);
  const centerDevices = useMemo(() => devices.filter((d) => d.role === 'control_center'), [devices]);

  const columns = useMemo<ColumnDef[]>(() => {
    const unassigned: ColumnDef = {
      id: null,
      name: t('devices.board.unassigned'),
      devices: [],
    };
    const byRoom = new Map<string, ColumnDef>();
    for (const room of rooms) {
      byRoom.set(room.id, { id: room.id, name: room.name, devices: [] });
    }
    for (const device of regularDevices) {
      const target = effectiveRoomId(device);
      if (target && byRoom.has(target)) {
        byRoom.get(target)!.devices.push(device);
      } else {
        unassigned.devices.push(device);
      }
    }
    return [unassigned, ...rooms.map((r) => byRoom.get(r.id)!)];
  }, [regularDevices, rooms, effectiveRoomId, t]);

  const showError = useCallback((key: string) => {
    setErrorMessage(t(key));
    window.setTimeout(() => setErrorMessage(null), 5000);
  }, [t]);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLLIElement>, deviceId: string) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(DRAG_MIME, deviceId);
      setDraggingId(deviceId);
    },
    [],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setHoverColumnId(undefined);
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, columnId: string | null) => {
      if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (hoverColumnId !== columnId) {
        setHoverColumnId(columnId);
      }
    },
    [hoverColumnId],
  );

  const handleDragLeave = useCallback(
    (columnId: string | null) => {
      if (hoverColumnId === columnId) {
        setHoverColumnId(undefined);
      }
    },
    [hoverColumnId],
  );

  const performMove = useCallback(
    async (deviceId: string, targetRoomId: string | null) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return;
      const currentRoomId = effectiveRoomId(device);
      if (currentRoomId === targetRoomId) return;

      setOptimisticRoom((prev) => ({ ...prev, [deviceId]: targetRoomId }));
      setBusyDeviceId(deviceId);
      try {
        await updateDeviceRoom(deviceId, targetRoomId);
        await onRefresh();
        setOptimisticRoom((prev) => {
          const next = { ...prev };
          delete next[deviceId];
          return next;
        });
      } catch {
        setOptimisticRoom((prev) => {
          const next = { ...prev };
          delete next[deviceId];
          return next;
        });
        showError('devices.board.errors.move_failed');
      } finally {
        setBusyDeviceId(null);
      }
    },
    [devices, effectiveRoomId, onRefresh, showError],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, columnId: string | null) => {
      e.preventDefault();
      const deviceId = e.dataTransfer.getData(DRAG_MIME);
      setDraggingId(null);
      setHoverColumnId(undefined);
      if (!deviceId) return;
      void performMove(deviceId, columnId);
    },
    [performMove],
  );

  return (
    <div
      className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-3"
      aria-label={t('devices.board.label')}
    >
      <p className="mb-3 text-xs text-sc-text-dim">{t('devices.board.hint')}</p>

      {errorMessage && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger"
        >
          {errorMessage}
        </div>
      )}

      {/* Sprint S-4 (G7): fascia "Centri Slide" — device promossi a Centro
          Slide. Read-only nella lavagna (non hanno una sala specifica): per
          riportarli a 'room' usare il kebab → "Riporta a sala normale". */}
      {centerDevices.length > 0 && (
        <div
          className="mb-3 rounded-xl border border-sc-primary/25 bg-sc-primary/5 p-2"
          role="region"
          aria-label={t('devices.board.centersLabel', { count: centerDevices.length })}
        >
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Building2
                className="h-3.5 w-3.5 shrink-0 text-sc-primary"
                aria-hidden="true"
              />
              <h4 className="truncate text-xs font-semibold uppercase tracking-wide text-sc-primary">
                {t('devices.board.centersTitle')}
              </h4>
            </div>
            <span className="rounded-full bg-sc-surface px-1.5 py-0.5 text-[10px] text-sc-text-dim">
              {centerDevices.length}
            </span>
          </div>
          <p className="mb-2 px-1 text-[11px] text-sc-text-dim">
            {t('devices.board.centersHint')}
          </p>
          <ul className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {centerDevices.map((device) => {
              const connectivity = computeConnectivity(device.last_seen_at, device.status);
              const dot =
                connectivity === 'online'
                  ? 'bg-sc-success'
                  : connectivity === 'warning'
                    ? 'bg-sc-warning'
                    : 'bg-sc-danger';
              return (
                <li
                  key={device.id}
                  className="flex items-center gap-2 rounded-lg border border-sc-primary/20 bg-sc-elevated/50 px-2 py-1.5 text-xs"
                  title={t('devices.board.centerCardTitle')}
                >
                  <Building2
                    className="h-3.5 w-3.5 shrink-0 text-sc-primary"
                    aria-hidden="true"
                  />
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
                    title={t(`devices.board.status.${connectivity}`)}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-sc-text">
                    {device.device_name}
                  </span>
                  {connectivity === 'online' ? (
                    <Wifi
                      className="h-3 w-3 shrink-0 text-sc-success"
                      aria-label={t('devices.list.online')}
                    />
                  ) : (
                    <WifiOff
                      className="h-3 w-3 shrink-0 text-sc-text-dim"
                      aria-label={t('devices.list.offline')}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((col) => {
          const isHover = hoverColumnId === col.id;
          const isUnassigned = col.id === null;
          const baseRing = isHover
            ? 'ring-2 ring-sc-primary bg-sc-primary/5'
            : 'ring-1 ring-sc-primary/12 bg-sc-elevated/40';
          return (
            <div
              key={col.id ?? '__unassigned__'}
              role="region"
              aria-label={t('devices.board.columnLabel', {
                name: col.name,
                count: col.devices.length,
              })}
              className={`rounded-xl p-2 transition-shadow ${baseRing}`}
              onDragOver={(e) => handleDragOver(e, col.id)}
              onDragLeave={() => handleDragLeave(col.id)}
              onDrop={(e) => handleDrop(e, col.id)}
            >
              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  {isUnassigned ? (
                    <Inbox className="h-3.5 w-3.5 shrink-0 text-sc-text-muted" aria-hidden="true" />
                  ) : (
                    <LayoutGrid
                      className="h-3.5 w-3.5 shrink-0 text-sc-text-muted"
                      aria-hidden="true"
                    />
                  )}
                  <h4 className="truncate text-xs font-semibold uppercase tracking-wide text-sc-text-secondary">
                    {col.name}
                  </h4>
                </div>
                <span className="rounded-full bg-sc-surface px-1.5 py-0.5 text-[10px] text-sc-text-dim">
                  {col.devices.length}
                </span>
              </div>

              {col.devices.length === 0 ? (
                <p className="rounded-lg border border-dashed border-sc-primary/15 px-2 py-3 text-center text-[11px] italic text-sc-text-dim">
                  {t('devices.board.dropHere')}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {col.devices.map((device) => {
                    const connectivity = computeConnectivity(device.last_seen_at, device.status);
                    const dot =
                      connectivity === 'online'
                        ? 'bg-sc-success'
                        : connectivity === 'warning'
                          ? 'bg-sc-warning'
                          : 'bg-sc-danger';
                    const isDragging = draggingId === device.id;
                    const isBusy = busyDeviceId === device.id;
                    return (
                      <li
                        key={device.id}
                        draggable={!isBusy}
                        onDragStart={(e) => handleDragStart(e, device.id)}
                        onDragEnd={handleDragEnd}
                        className={`group flex cursor-grab items-center gap-2 rounded-lg border border-sc-primary/15 bg-sc-surface px-2 py-1.5 text-xs shadow-sm transition-opacity active:cursor-grabbing ${
                          isDragging ? 'opacity-50' : ''
                        } ${isBusy ? 'pointer-events-none opacity-60' : ''}`}
                        aria-grabbed={isDragging}
                      >
                        <GripVertical
                          className="h-3 w-3 shrink-0 text-sc-text-dim opacity-60 group-hover:opacity-100"
                          aria-hidden="true"
                        />
                        <Monitor
                          className="h-3.5 w-3.5 shrink-0 text-sc-text-muted"
                          aria-hidden="true"
                        />
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
                          title={t(`devices.board.status.${connectivity}`)}
                        />
                        <span className="min-w-0 flex-1 truncate font-medium text-sc-text">
                          {device.device_name}
                        </span>
                        {isBusy ? (
                          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-sc-text-dim" />
                        ) : connectivity === 'online' ? (
                          <Wifi
                            className="h-3 w-3 shrink-0 text-sc-success"
                            aria-label={t('devices.list.online')}
                          />
                        ) : (
                          <WifiOff
                            className="h-3 w-3 shrink-0 text-sc-text-dim"
                            aria-label={t('devices.list.offline')}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {devices.length === 0 ? (
        <p className="mt-3 text-center text-xs text-sc-text-dim">
          {t('devices.list.empty')}
        </p>
      ) : null}
      {/* Sprint S-4 (G7): se l'evento ha SOLO Centri Slide e nessun PC sala
          ancora pairato, evidenziamo che la Kanban e' vuota by design (non
          serve assegnare nulla, i CC ricevono tutto). */}
      {regularDevices.length === 0 && centerDevices.length > 0 && (
        <p className="mt-3 text-center text-xs italic text-sc-text-dim">
          {t('devices.board.allCentersHint')}
        </p>
      )}
    </div>
  );
}
