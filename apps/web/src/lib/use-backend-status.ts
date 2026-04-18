/**
 * Sprint O4 (GUIDA_OPERATIVA_v3 §4.G — UX parity cloud/offline) — hook stato backend.
 *
 * Determina lo stato del backend per l'indicator visivo in header:
 *
 *   • `cloud-online`: cloud + `navigator.onLine === true`. Dati live via Supabase.
 *   • `cloud-offline`: cloud + `navigator.onLine === false`. SPA degradata (cache PWA).
 *   • `lan-connected`: desktop + admin server raggiungibile (GET /health < 2s).
 *   • `standalone`: desktop + admin server NON raggiungibile (sala usa solo file
 *     gia' scaricati; admin in standalone non ha senso per il user finale ma
 *     puo' capitare se il server Rust crasha).
 *   • `loading`: stato iniziale prima del primo check (evita flicker).
 *
 * Polling: 15s in cloud (basta `navigator.onLine` event-based + check sporadico),
 * 10s in desktop (l'admin server LAN puo' cadere e il sala deve accorgersene
 * entro la durata massima dello stale slide ~15s).
 *
 * Il check `/health` desktop e' lightweight (no DB, no auth, ~5ms), quindi
 * 10s di polling = 6 req/min = trascurabile su rete locale.
 */

import { useEffect, useState } from 'react';
import { getBackendBaseUrl, getBackendMode } from './backend-mode';

export type BackendStatus =
  | 'loading'
  | 'cloud-online'
  | 'cloud-offline'
  | 'lan-connected'
  | 'standalone';

export interface BackendStatusInfo {
  status: BackendStatus;
  /** Ultimo check riuscito (timestamp ms epoch) — utile per "ultimo aggiornamento Xs fa". */
  lastCheckedAt: number | null;
  /** Latenza dell'ultimo health check in ms (solo desktop). */
  latencyMs: number | null;
}

const POLL_MS_CLOUD = 15_000;
const POLL_MS_DESKTOP = 10_000;
const HEALTH_TIMEOUT_MS = 2_000;

export function useBackendStatus(): BackendStatusInfo {
  const [info, setInfo] = useState<BackendStatusInfo>({
    status: 'loading',
    lastCheckedAt: null,
    latencyMs: null,
  });

  useEffect(() => {
    const mode = getBackendMode();
    let cancelled = false;
    let timer: number | null = null;

    async function checkOnce() {
      if (cancelled) return;
      if (mode === 'cloud') {
        const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
        setInfo({
          status: online ? 'cloud-online' : 'cloud-offline',
          lastCheckedAt: Date.now(),
          latencyMs: null,
        });
        return;
      }
      // desktop: probe `/health`
      const baseUrl = getBackendBaseUrl();
      if (!baseUrl) {
        setInfo({ status: 'standalone', lastCheckedAt: Date.now(), latencyMs: null });
        return;
      }
      const ctrl = new AbortController();
      const timeoutId = window.setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
      const t0 = performance.now();
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
          method: 'GET',
          signal: ctrl.signal,
          cache: 'no-store',
        });
        const dt = Math.round(performance.now() - t0);
        if (cancelled) return;
        if (res.ok) {
          setInfo({ status: 'lan-connected', lastCheckedAt: Date.now(), latencyMs: dt });
        } else {
          setInfo({ status: 'standalone', lastCheckedAt: Date.now(), latencyMs: dt });
        }
      } catch {
        if (cancelled) return;
        setInfo((prev) => ({ status: 'standalone', lastCheckedAt: Date.now(), latencyMs: prev.latencyMs }));
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void checkOnce();

    const pollMs = mode === 'cloud' ? POLL_MS_CLOUD : POLL_MS_DESKTOP;
    timer = window.setInterval(() => {
      void checkOnce();
    }, pollMs);

    const onOnline = () => void checkOnce();
    const onOffline = () => void checkOnce();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', onOffline);
    }

    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', onOffline);
      }
    };
  }, []);

  return info;
}
