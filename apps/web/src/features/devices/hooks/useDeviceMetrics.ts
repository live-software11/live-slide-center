import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDeviceMetricsForEvent,
  type DeviceMetricsRow,
} from '../repository';

/**
 * Sprint T-2 (G9) — Hook admin LivePerfTelemetryPanel.
 *
 * Polla ogni `refreshMs` (default 8s) la RPC `fetch_device_metrics_for_event`
 * e ritorna l'array di {device, latest, pings[]} per ogni PC sala dell'evento.
 *
 * Comportamento:
 * - Primo fetch immediato; poi polling timer.
 * - Se la finestra del browser e' nascosta (`document.hidden`) sospendiamo
 *   il polling per non sprecare quota Supabase (l'admin non sta guardando).
 * - On error: mantiene l'ultimo dato valido + espone `error`. Il caller
 *   decide se mostrare un placeholder.
 *
 * NB: NON usiamo Realtime postgres_changes su `device_metric_pings` perche':
 *   - Volume INSERT alto (1 ping/12s × N device): saturerebbe il channel.
 *   - L'admin non deve vedere "tick a tick" ma trend ultimi 30 min.
 *   - Polling 8s e' sufficiente per UX live (la UI sentry dei PC sala in
 *     evento medio aggiorna comunque ogni 12-60s).
 */
export interface UseDeviceMetricsOptions {
  /** Finestra temporale dei ping ritornati. Default 30 minuti (max 60). */
  windowMin?: number;
  /** Numero massimo di ping per device. Default 60 (max 200). */
  maxPingsPerDevice?: number;
  /** Intervallo di polling in millisecondi. Default 8000 (8s). */
  refreshMs?: number;
  /** Se false, nessun fetch (utile durante mount/teardown). */
  enabled?: boolean;
}

export interface UseDeviceMetricsResult {
  rows: DeviceMetricsRow[];
  loading: boolean;
  error: string | null;
  /** Ultimo refresh riuscito. Null se non e' mai andato a buon fine. */
  lastRefreshAt: Date | null;
  /** Forza un refresh immediato (es. dopo che admin promuove un device). */
  refresh: () => Promise<void>;
}

export function useDeviceMetrics(
  eventId: string | null,
  options: UseDeviceMetricsOptions = {},
): UseDeviceMetricsResult {
  const {
    windowMin = 30,
    maxPingsPerDevice = 60,
    refreshMs = 8_000,
    enabled = true,
  } = options;

  const [rows, setRows] = useState<DeviceMetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);

  // Anti-race: se il fetch parte e nel frattempo eventId cambia, scartiamo
  // la risposta vecchia (cosi' non sovrascriviamo i dati del nuovo evento).
  const reqIdRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!eventId || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    const reqId = ++reqIdRef.current;
    try {
      const data = await fetchDeviceMetricsForEvent(eventId, {
        windowMin,
        maxPingsPerDevice,
      });
      if (reqId !== reqIdRef.current) return; // race: scartato
      setRows(data);
      setError(null);
      setLastRefreshAt(new Date());
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      setError(err instanceof Error ? err.message : 'fetch_metrics_failed');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [eventId, enabled, windowMin, maxPingsPerDevice]);

  useEffect(() => {
    if (!eventId || !enabled) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void refresh();
    };
    const timer = window.setInterval(tick, refreshMs);

    // Quando il tab admin torna visibile dopo essere stato in background,
    // rifacciamo subito un refresh (potrebbero essere passati minuti).
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [eventId, enabled, refreshMs, refresh]);

  return { rows, loading, error, lastRefreshAt, refresh };
}
