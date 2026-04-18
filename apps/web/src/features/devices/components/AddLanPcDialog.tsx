import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Monitor, RefreshCw, Tv2, Wifi, WifiOff, X } from 'lucide-react';
import {
  discoverLanNodes,
  getAdminLanBaseUrl,
  getDesktopBackendInfo,
  pairDirectLan,
  registerPairedDeviceOnAdminLocal,
  type DesktopBackendInfo,
  type DiscoveredLanNode,
  type PairDirectInput,
} from '@/lib/desktop-bridge';
import type { RoomRow } from '@/features/rooms/repository';
import { isRunningInTauri } from '@/lib/backend-mode';
import { rememberPairedDeviceLanUrl } from '../repository';

interface AddLanPcDialogProps {
  eventId: string;
  eventName: string;
  rooms: RoomRow[];
  onClose: () => void;
  /** Callback dopo pair-direct OK. Riceve device_id (per refresh). */
  onPaired: (deviceId: string) => void;
}

type DiscoveryState =
  | { status: 'idle' }
  | { status: 'scanning' }
  | { status: 'ready'; nodes: DiscoveredLanNode[] }
  | { status: 'error'; message: string };

type PairState =
  | { status: 'idle' }
  | { status: 'pairing'; nodeKey: string }
  | { status: 'success'; deviceName: string; roomName: string | null }
  | { status: 'error'; message: string; code?: string };

/**
 * Sprint L3/L5 (GUIDA_OPERATIVA_v3 §4.D L3+L5) — dialog "Aggiungi PC LAN".
 *
 * **Flusso operativo per l'admin in field-test:**
 *
 *   1. Click "+ Aggiungi PC LAN" su EventDetailView (visibile solo se desktop+admin).
 *   2. Discovery automatica via mDNS (`_slidecenter._tcp.local`, role=sala).
 *   3. Per ogni PC sala trovato, l'admin sceglie:
 *      • la sala di destinazione (oppure "nessuna sala" → assegna piu' tardi),
 *      • un nome opzionale per il PC sala (default = hostname).
 *   4. Click "Abbina" → POST `http://<sala_ip>:<port>/functions/v1/pair-direct`
 *      con `event_id`, `room_id?`, `admin_server: { base_url, name }`,
 *      `device_name?`, `user_agent`, `browser`.
 *   5. Sul PC sala l'Axum locale crea/upserta `events`+`rooms` (mirror minimo
 *      perche' il PC sala fara' bootstrap dei file in pull dall'admin), inserisce
 *      `paired_devices`, salva `device.json` per auto-rejoin e aggiorna mDNS TXT
 *      con `event_id` (cosi' altri admin LAN vedono "gia' assegnato").
 *   6. La SPA admin riceve `device_token`+`device_id`+`paired_at` e chiama
 *      `onPaired(device_id)` → `usePairedDevices.refresh()` per aggiornare la
 *      lista dispositivi del DevicesPanel.
 *
 * **Limiti deliberati Sprint L:**
 *   • Nessun retry automatico (l'utente schiaccia "Cerca di nuovo" se serve).
 *   • Discovery one-shot (1.5s default): no streaming/realtime — basta per LAN.
 *   • `admin_server.base_url` calcolato lato SPA da `lan_addresses[0]`: in
 *     ambienti multi-NIC (es. PC con Wi-Fi + Ethernet attivi) potrebbe servire
 *     una scelta esplicita; rimandato a Sprint Q.
 *   • Nessun controllo certificate/fingerprint: tutto avviene in plaintext HTTP
 *     LAN, accettabile per intranet protetta da firewall di sala.
 */
export function AddLanPcDialog({
  eventId,
  eventName,
  rooms,
  onClose,
  onPaired,
}: AddLanPcDialogProps) {
  const { t } = useTranslation();
  // Lazy init: in modalita cloud restiamo con `{ ready: false }` SENZA mai
  // chiamare setInfo dentro un effect (rispetta `react-hooks/set-state-in-effect`).
  const [info, setInfo] = useState<DesktopBackendInfo | null>(() =>
    isRunningInTauri() ? null : { ready: false },
  );
  const [discovery, setDiscovery] = useState<DiscoveryState>({ status: 'idle' });
  const [selectedRoomByKey, setSelectedRoomByKey] = useState<Record<string, string>>({});
  const [deviceNameByKey, setDeviceNameByKey] = useState<Record<string, string>>({});
  const [pair, setPair] = useState<PairState>({ status: 'idle' });
  const inTauri = isRunningInTauri();

  // Helper: chiave univoca per nodo (fullname e' garantito unico in mDNS).
  const nodeKey = (n: DiscoveredLanNode) => n.fullname || `${n.name}@${n.addresses[0] ?? '?'}`;

  // Helper: prima IP usabile + URL (preferiamo IPv4 da local network).
  const nodeBaseUrl = (n: DiscoveredLanNode): string | null => {
    const ip = n.addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? n.addresses[0];
    if (!ip) return null;
    return `http://${ip}:${n.port}`;
  };

  // Stabile (no deps): legge sempre l'ultimo `info` dal closure tramite
  // useState getter. Questo evita ricreazioni continue di `runDiscovery` e
  // permette di non triggerare l'effect a ogni `info` change.
  const runDiscovery = useCallback(async () => {
    setDiscovery({ status: 'scanning' });
    try {
      const res = await discoverLanNodes({ roleFilter: 'sala', timeoutMs: 1500 });
      setDiscovery({ status: 'ready', nodes: res.nodes });
    } catch (e) {
      setDiscovery({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  // Sprint L3: backend info (lan_addresses + role) e' la pre-condizione per il
  // pair-direct. Recuperiamo l'info E lanciamo la discovery iniziale dentro
  // la `.then()` callback (asincrona): React 19 non considera questi setState
  // "in effect body" → no warning `set-state-in-effect`.
  useEffect(() => {
    if (!inTauri) return;
    let cancelled = false;
    void getDesktopBackendInfo().then((res) => {
      if (cancelled) return;
      setInfo(res);
      const lanBase = getAdminLanBaseUrl(res);
      if (res.ready && res.role === 'admin' && lanBase) {
        void runDiscovery();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [inTauri, runDiscovery]);

  const adminLanBaseUrl = useMemo(() => (info ? getAdminLanBaseUrl(info) : null), [info]);
  const isAdmin = info?.role === 'admin';
  const canScan = inTauri && info?.ready === true && isAdmin && !!adminLanBaseUrl;

  const onPairClick = async (n: DiscoveredLanNode) => {
    if (pair.status === 'pairing' || !adminLanBaseUrl) return;
    const key = nodeKey(n);
    const roomId = selectedRoomByKey[key] || '';
    const room = rooms.find((r) => r.id === roomId) ?? null;
    const customName = deviceNameByKey[key]?.trim();
    const baseUrl = nodeBaseUrl(n);
    if (!baseUrl) {
      setPair({ status: 'error', message: t('devices.addLanPc.discoveryError', { message: 'no_base_url' }) });
      return;
    }
    setPair({ status: 'pairing', nodeKey: key });
    try {
      const input: PairDirectInput = {
        targetBaseUrl: baseUrl,
        event_id: eventId,
        event_name: eventName,
        room_id: roomId || undefined,
        room_name: room?.name,
        device_name: customName && customName.length > 0 ? customName : n.name || n.hostname,
        admin_server: {
          base_url: adminLanBaseUrl,
          name: info?.data_root, // Identificatore "best-effort" del nodo admin.
        },
      };
      const out = await pairDirectLan(input);
      // Sprint M3: registra `lanBaseUrl` per il futuro pair-revoke. La mappa
      // vive in localStorage (`sc:devices:lanBaseUrlByDeviceId`). Se l'utente
      // cancella i dati del browser perde la mappa: in quel caso "Rimuovi PC"
      // cancella solo il record locale e l'utente puo' usare "Esci dall'evento"
      // dal menu del sala per smontare definitivamente.
      rememberPairedDeviceLanUrl(out.device_id, baseUrl);

      // Sprint N1: registra il device anche nel SQLite locale del backend
      // admin (necessario per il fan-out HTTP `notify_paired_devices`).
      // Best-effort: se fallisce loghiamo ma non rompiamo il flusso utente
      // (il pair sul sala e' gia' avvenuto, quindi visualmente ha senso
      // mostrare success — il fan-out potra' essere riparato con un re-pair).
      if (info?.base_url && info?.admin_token) {
        const reg = await registerPairedDeviceOnAdminLocal({
          admin: { base_url: info.base_url, admin_token: info.admin_token },
          device_id: out.device_id,
          device_token: out.device_token,
          event_id: eventId,
          room_id: out.room_id,
          device_name: out.device_name,
          lan_base_url: baseUrl,
        });
        if (!reg.ok) {
          console.warn('[AddLanPcDialog] register on admin local failed', reg);
        }
      }
      setPair({
        status: 'success',
        deviceName: out.device_name,
        roomName: room?.name ?? null,
      });
      onPaired(out.device_id);
      // Re-discovery automatica per riflettere il nuovo `event_id` su quel PC sala.
      window.setTimeout(() => {
        void runDiscovery();
      }, 800);
    } catch (e) {
      const err = e as Error & { code?: string; status?: number };
      const isConflict = err.status === 409 || err.code === 'already_paired';
      setPair({
        status: 'error',
        code: err.code,
        message: isConflict
          ? t('devices.addLanPc.pairConflict')
          : t('devices.addLanPc.pairError', { message: err.message ?? 'error' }),
      });
    }
  };

  const renderBody = () => {
    if (!inTauri) {
      return (
        <p className="rounded-xl border border-sc-warning/30 bg-sc-warning/10 px-3 py-2 text-sm text-sc-warning">
          {t('devices.addLanPc.notDesktop')}
        </p>
      );
    }
    if (info && info.ready && !isAdmin) {
      return (
        <p className="rounded-xl border border-sc-warning/30 bg-sc-warning/10 px-3 py-2 text-sm text-sc-warning">
          {t('devices.addLanPc.notAdmin')}
        </p>
      );
    }
    if (info && info.ready && !adminLanBaseUrl) {
      return (
        <p className="rounded-xl border border-sc-warning/30 bg-sc-warning/10 px-3 py-2 text-sm text-sc-warning">
          {t('devices.addLanPc.noLanIp')}
        </p>
      );
    }
    if (!info || !info.ready) {
      return (
        <p className="text-sm text-sc-text-muted" role="status">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {t('common.loading')}
        </p>
      );
    }

    if (discovery.status === 'scanning') {
      return (
        <p className="text-sm text-sc-text-muted" role="status">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          {t('devices.addLanPc.scanning')}
        </p>
      );
    }
    if (discovery.status === 'error') {
      return (
        <p className="rounded-xl border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-sm text-sc-danger" role="alert">
          {t('devices.addLanPc.discoveryError', { message: discovery.message })}
        </p>
      );
    }
    const nodes = discovery.status === 'ready' ? discovery.nodes : [];
    if (nodes.length === 0) {
      return (
        <p className="rounded-xl border border-sc-primary/12 bg-sc-bg/60 px-3 py-2 text-sm text-sc-text-muted">
          {t('devices.addLanPc.noResults')}
        </p>
      );
    }

    return (
      <ul className="divide-y divide-sc-primary/12 rounded-xl border border-sc-primary/12">
        {nodes.map((n) => {
          const key = nodeKey(n);
          const isPairing = pair.status === 'pairing' && pair.nodeKey === key;
          const alreadyPaired = !!n.event_id && n.event_id !== eventId;
          const baseUrl = nodeBaseUrl(n);
          const selectedRoomId = selectedRoomByKey[key] ?? '';
          return (
            <li key={key} className="flex flex-col gap-3 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-sc-text">
                    <Tv2 className="h-4 w-4 text-sc-success" aria-hidden />
                    {n.name || n.hostname}
                  </p>
                  <p className="mt-0.5 text-xs text-sc-text-dim">
                    {baseUrl ?? '—'}
                  </p>
                  <p className="mt-0.5 text-xs text-sc-text-dim">
                    v{n.app_version ?? '?'} · {n.hostname}
                  </p>
                  {alreadyPaired ? (
                    <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-sc-warning/30 bg-sc-warning/10 px-2 py-0.5 text-xs font-medium text-sc-warning">
                      {t('devices.addLanPc.alreadyPaired', { eventId: n.event_id })}
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex-1 text-xs text-sc-text-muted">
                  {t('devices.addLanPc.selectRoom')}
                  <select
                    className="mt-1 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                    value={selectedRoomId}
                    onChange={(e) =>
                      setSelectedRoomByKey((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    disabled={isPairing}
                  >
                    <option value="">{t('devices.addLanPc.noRoomOption')}</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex-1 text-xs text-sc-text-muted">
                  {t('devices.addLanPc.deviceNameLabel')}
                  <input
                    type="text"
                    placeholder={t('devices.addLanPc.deviceNamePlaceholder')}
                    className="mt-1 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm outline-none ring-sc-ring/25 focus:ring-2"
                    value={deviceNameByKey[key] ?? ''}
                    onChange={(e) =>
                      setDeviceNameByKey((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                    disabled={isPairing}
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void onPairClick(n)}
                  disabled={isPairing || pair.status === 'pairing'}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-sc-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:opacity-50"
                >
                  {isPairing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      {t('devices.addLanPc.pairing')}
                    </>
                  ) : (
                    <>
                      <Monitor className="h-4 w-4" aria-hidden />
                      {t('devices.addLanPc.pair')}
                    </>
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-lan-pc-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-sc-primary/20 bg-sc-surface shadow-2xl">
        <header className="flex items-start justify-between border-b border-sc-primary/12 px-5 py-4">
          <div className="min-w-0">
            <h2 id="add-lan-pc-title" className="flex items-center gap-2 text-base font-semibold text-sc-text">
              {info?.mdns_active ? (
                <Wifi className="h-4 w-4 text-sc-success" aria-hidden />
              ) : (
                <WifiOff className="h-4 w-4 text-sc-warning" aria-hidden />
              )}
              {t('devices.addLanPc.title')}
            </h2>
            <p className="mt-1 text-xs text-sc-text-dim">{t('devices.addLanPc.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 rounded-lg p-1.5 text-sc-text-muted hover:bg-sc-elevated hover:text-sc-text"
            aria-label={t('devices.addLanPc.close')}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {discovery.status === 'ready' && discovery.nodes.length > 0 ? (
            <p className="text-xs text-sc-text-muted">
              {t('devices.addLanPc.discoveredCount', { count: discovery.nodes.length })}
            </p>
          ) : null}

          {pair.status === 'success' ? (
            <p
              role="status"
              className="rounded-xl border border-sc-success/30 bg-sc-success/10 px-3 py-2 text-sm text-sc-success"
            >
              {pair.roomName
                ? t('devices.addLanPc.pairedSuccess', { name: pair.deviceName, room: pair.roomName })
                : t('devices.addLanPc.pairedSuccessNoRoom', { name: pair.deviceName })}
            </p>
          ) : null}
          {pair.status === 'error' ? (
            <p
              role="alert"
              className="rounded-xl border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-sm text-sc-danger"
            >
              {pair.message}
            </p>
          ) : null}

          {renderBody()}
        </div>

        <footer className="flex items-center justify-between border-t border-sc-primary/12 bg-sc-bg/40 px-5 py-3">
          <button
            type="button"
            onClick={() => void runDiscovery()}
            disabled={!canScan || discovery.status === 'scanning'}
            className="inline-flex items-center gap-1.5 rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-1.5 text-xs font-medium text-sc-text hover:bg-sc-elevated disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('devices.addLanPc.rescan')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-sc-elevated px-3 py-1.5 text-xs font-medium text-sc-text-secondary hover:bg-sc-elevated"
          >
            {t('devices.addLanPc.close')}
          </button>
        </footer>
      </div>
    </div>
  );
}
