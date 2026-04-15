import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Plus } from 'lucide-react';
import { usePairedDevices } from './hooks/usePairedDevices';
import { PairingModal } from './components/PairingModal';
import { DeviceList } from './components/DeviceList';
import type { RoomRow } from '@/features/rooms/repository';

interface DevicesPanelProps {
  eventId: string;
  rooms: RoomRow[];
}

export function DevicesPanel({ eventId, rooms }: DevicesPanelProps) {
  const { t } = useTranslation();
  const { devices, loading, error, refresh } = usePairedDevices(eventId);
  const [showModal, setShowModal] = useState(false);

  const handlePaired = async (_deviceId: string) => {
    await refresh();
    setTimeout(() => setShowModal(false), 1500);
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
            <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
              {devices.length}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sc-primary/80"
        >
          <Plus className="h-4 w-4" />
          {t('devices.panel.addDevice')}
        </button>
      </div>

      {loading && (
        <p className="py-2 text-center text-sm text-sc-text-dim">{t('common.loading')}</p>
      )}
      {error && (
        <p className="py-2 text-center text-sm text-sc-danger">{error}</p>
      )}
      {!loading && !error && (
        <DeviceList devices={devices} rooms={rooms} onRefresh={refresh} />
      )}

      {showModal && (
        <PairingModal
          eventId={eventId}
          onClose={() => setShowModal(false)}
          onPaired={(id) => void handlePaired(id)}
        />
      )}
    </section>
  );
}
