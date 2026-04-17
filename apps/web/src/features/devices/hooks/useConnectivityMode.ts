import { useEffect, useState, useRef } from 'react';

/**
 * Sprint 2 — Stato di connettivita' visibile al Room Player.
 *
 * I 4 stati sono mutuamente esclusivi e derivati da:
 *  - `navigator.onLine` (browser API, evento online/offline)
 *  - presenza di `agentLan` configurato (Local Agent annunciato dall'evento)
 *  - health probe periodica `http://<lan>:<port>/api/v1/health` (timeout 2.5s)
 *
 * Tabella di verita':
 *
 * navigatorOnline | agentLan | LAN healthy | risultato
 * --------------- | -------- | ----------- | ----------------
 * true            | si       | si          | lan-via-agent  (verde-blu, primario)
 * true            | si       | no          | cloud-direct   (verde, fallback cloud)
 * true            | no       | n/a         | cloud-direct   (verde)
 * false           | si       | si          | intranet-only  (giallo, NO internet ma LAN serve i file)
 * false           | si       | no          | offline        (rosso)
 * false           | no       | n/a         | offline        (rosso)
 */
export type ConnectivityMode =
  | 'cloud-direct'
  | 'lan-via-agent'
  | 'intranet-only'
  | 'offline';

const HEALTH_TIMEOUT_MS = 2500;
const HEALTH_INTERVAL_MS = 15000;

interface UseConnectivityModeParams {
  agentLan: { lan_ip: string; lan_port: number } | null;
  navigatorOnline: boolean;
  enabled?: boolean;
}

interface UseConnectivityModeResult {
  mode: ConnectivityMode;
  lanHealthy: boolean | null;
  lastProbeAt: number | null;
}

/**
 * Esegue health probe verso il Local Agent.
 * Usa AbortController per timeout effettivo (fetch non lo supporta nativo).
 * Best-effort: errori silenti, ritorna `false`.
 */
async function probeLanHealth(agentLan: { lan_ip: string; lan_port: number }): Promise<boolean> {
  const url = `http://${agentLan.lan_ip}:${agentLan.lan_port}/api/v1/health`;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      method: 'GET',
      cache: 'no-store',
      mode: 'cors',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Hook che ritorna lo stato corrente di connettivita' (4 stati).
 * - Aggiornato su `online`/`offline` events del browser.
 * - Aggiornato ogni `HEALTH_INTERVAL_MS` quando `agentLan` e' configurato.
 * - Quando `agentLan` e' null la probe LAN viene saltata (lanHealthy = null).
 */
export function useConnectivityMode({
  agentLan,
  navigatorOnline,
  enabled = true,
}: UseConnectivityModeParams): UseConnectivityModeResult {
  const [lanHealthy, setLanHealthy] = useState<boolean | null>(null);
  const [lastProbeAt, setLastProbeAt] = useState<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !agentLan) {
      setLanHealthy(null);
      setLastProbeAt(null);
      return;
    }

    let inFlight = false;

    const runProbe = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const ok = await probeLanHealth(agentLan);
        if (cancelledRef.current) return;
        setLanHealthy(ok);
        setLastProbeAt(Date.now());
      } finally {
        inFlight = false;
      }
    };

    void runProbe();
    const intervalId = window.setInterval(() => {
      void runProbe();
    }, HEALTH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [agentLan, enabled]);

  let mode: ConnectivityMode;
  if (!navigatorOnline) {
    if (agentLan && lanHealthy === true) mode = 'intranet-only';
    else mode = 'offline';
  } else {
    if (agentLan && lanHealthy === true) mode = 'lan-via-agent';
    else mode = 'cloud-direct';
  }

  return { mode, lanHealthy, lastProbeAt };
}
