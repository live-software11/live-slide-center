import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, List, Monitor, Plus, Wifi } from 'lucide-react';
import { usePairedDevices } from './hooks/usePairedDevices';
import { PairingModal } from './components/PairingModal';
import { DeviceList } from './components/DeviceList';
import { RoomAssignBoard } from './components/RoomAssignBoard';
import { AddLanPcDialog } from './components/AddLanPcDialog';
import type { RoomRow } from '@/features/rooms/repository';
import { getDesktopBackendInfo } from '@/lib/desktop-bridge';
import { isRunningInTauri } from '@/lib/backend-mode';

type DevicesViewMode = 'list' | 'board';
const VIEW_MODE_KEY = 'sc:devices:viewMode';

function loadViewMode(): DevicesViewMode {
  try {
    const raw = localStorage.getItem(VIEW_MODE_KEY);
    return raw === 'board' ? 'board' : 'list';
  } catch {
    return 'list';
  }
}

function saveViewMode(mode: DevicesViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    /* storage bloccato: non blocchiamo la UI */
  }
}

interface DevicesPanelProps {
  eventId: string;
  rooms: RoomRow[];
  /**
   * Sprint L3/L5: necessario per il pair-direct LAN — il PC sala salva
   * `event_name` nel device.json e nella tabella `events` mirror locale.
   * Se non viene passato, il bottone "Aggiungi PC LAN" usa stringa vuota
   * (fallback safe: il sala mostrera' l'event_id).
   */
  eventName?: string;
}

/**
 * Sprint L3 (GUIDA_OPERATIVA_v3 §4.D L3): in modalita desktop+admin con backend
 * pronto e mDNS attivo, il pannello aggiunge il bottone "Aggiungi PC LAN" che
 * apre `AddLanPcDialog` per il pair-direct senza codice 6 cifre.
 *
 * Pre-condizioni per mostrare il bottone LAN:
 *   • SPA dentro Tauri (`window.__TAURI__` esposto via `withGlobalTauri`),
 *   • backend Rust avviato (`cmd_backend_info().ready === true`),
 *   • ruolo nodo = `admin` (il PC sala non puo' "aggiungere altri PC sala").
 *
 * In tutti gli altri scenari (browser/cloud, primo render prima del boot,
 * ruolo sala) mostriamo solo il bottone classico "+ Aggiungi PC" che apre il
 * `PairingModal` con codice 6 cifre tramite Edge Function Supabase.
 */
export function DevicesPanel({ eventId, rooms, eventName }: DevicesPanelProps) {
  const { t } = useTranslation();
  const { devices, loading, error, refresh } = usePairedDevices(eventId);
  const [showModal, setShowModal] = useState(false);
  const [showLanDialog, setShowLanDialog] = useState(false);
  const [showLanButton, setShowLanButton] = useState(false);
  const [viewMode, setViewMode] = useState<DevicesViewMode>(() => loadViewMode());

  const applyViewMode = (mode: DevicesViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  };

  useEffect(() => {
    if (!isRunningInTauri()) return;
    let cancelled = false;
    void (async () => {
      const info = await getDesktopBackendInfo();
      if (cancelled) return;
      setShowLanButton(info.ready === true && info.role === 'admin');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePaired = async (_deviceId: string) => {
    await refresh();
    setTimeout(() => setShowModal(false), 1500);
  };

  const handleLanPaired = async (_deviceId: string) => {
    await refresh();
  };

  return (
    <section
      className="rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-4"
      aria-labelledby="devices-panel-title"
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5 text-sc-text-muted" />
          <h3 id="devices-panel-title" className="text-sm font-semibold text-sc-text">
            {t('devices.panel.title')}
          </h3>
          {devices.length > 0 && (
            <span className="rounded-full bg-sc-elevated px-2 py-0.5 text-xs text-sc-text-secondary">
              {devices.length}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex overflow-hidden rounded-xl border border-sc-primary/20"
            role="tablist"
            aria-label={t('devices.panel.viewModeLabel')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'list'}
              onClick={() => applyViewMode('list')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-sc-primary text-white'
                  : 'bg-sc-surface text-sc-text-secondary hover:bg-sc-elevated'
              }`}
              title={t('devices.panel.viewList')}
            >
              <List className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('devices.panel.viewList')}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'board'}
              onClick={() => applyViewMode('board')}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                viewMode === 'board'
                  ? 'bg-sc-primary text-white'
                  : 'bg-sc-surface text-sc-text-secondary hover:bg-sc-elevated'
              }`}
              title={t('devices.panel.viewBoard')}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('devices.panel.viewBoard')}</span>
            </button>
          </div>
          {showLanButton ? (
            <button
              type="button"
              onClick={() => setShowLanDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sc-success/30 bg-sc-success/10 px-3 py-1.5 text-sm font-medium text-sc-success hover:bg-sc-success/15"
            >
              <Wifi className="h-4 w-4" />
              {t('devices.addLanPc.buttonLabel')}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sc-primary/80"
          >
            <Plus className="h-4 w-4" />
            {t('devices.panel.addDevice')}
          </button>
        </div>
      </div>

      {loading && (
        <p className="py-2 text-center text-sm text-sc-text-dim">{t('common.loading')}</p>
      )}
      {error && (
        <p className="py-2 text-center text-sm text-sc-danger">{error}</p>
      )}
      {!loading && !error && viewMode === 'list' && (
        <DeviceList devices={devices} rooms={rooms} onRefresh={refresh} />
      )}
      {!loading && !error && viewMode === 'board' && (
        <RoomAssignBoard devices={devices} rooms={rooms} onRefresh={refresh} />
      )}

      {showModal && (
        <PairingModal
          eventId={eventId}
          onClose={() => setShowModal(false)}
          onPaired={(id) => void handlePaired(id)}
        />
      )}

      {showLanDialog && (
        <AddLanPcDialog
          eventId={eventId}
          eventName={eventName ?? ''}
          rooms={rooms}
          onClose={() => setShowLanDialog(false)}
          onPaired={(id) => void handleLanPaired(id)}
        />
      )}
    </section>
  );
}
