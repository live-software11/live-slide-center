import { useCallback, useEffect, useRef } from 'react';
import { isRunningInTauri } from '@/lib/backend-mode';
import type { DeviceMetricPingPayload } from '../repository';

/**
 * Sprint T-2 (G9) — Collector telemetria perf live PC sala.
 *
 * Misura ogni 5s un piccolo set di metriche disponibili nel browser/Tauri,
 * applica un EMA leggero (per smoothing) e ritorna un getter `collectMetrics()`
 * che produce il payload da iniettare in `invokeRoomPlayerBootstrap`.
 *
 * SOVRANO #2 — file partono SEMPRE da locale:
 *   le metriche raccolte sono SOLO numeriche aggregate (% CPU, MB heap, fps).
 *   Mai path, mai contenuto file, mai PII. La quota storage misurata e' quella
 *   del SANDBOX BROWSER (Cache API + IndexedDB + OPFS), non quella del disco
 *   reale del PC sala (che il browser non puo' vedere).
 *
 * Architettura:
 * - Le metriche "live" (FPS via rAF, CPU via desktop bridge) sono campionate
 *   in continuo da hook collaterali ed esposte tramite ref.
 * - Le metriche "snapshot" (heap, storage, network, battery) vengono lette
 *   "on-demand" quando il PC sala chiama `collectMetrics()` perche' sta per
 *   pingare il bootstrap.
 * - Tutto best-effort: se un'API non e' disponibile (Safari < 16, Firefox
 *   senza performance.memory, ecc.) il campo resta `null` e la RPC server
 *   side accetta nullable.
 */

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface NetworkInformation {
  effectiveType?: 'slow-2g' | '2g' | '3g' | '4g' | string;
  type?: 'wifi' | 'ethernet' | 'cellular' | 'bluetooth' | 'wimax' | 'none' | 'other' | 'unknown' | string;
  downlink?: number;
}

interface BatteryManager {
  level: number;
  charging: boolean;
  addEventListener?: (event: string, handler: () => void) => void;
  removeEventListener?: (event: string, handler: () => void) => void;
}

function getJsHeapMetrics(): { usedPct: number | null; usedMb: number | null } {
  if (typeof performance === 'undefined') return { usedPct: null, usedMb: null };
  const mem = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!mem || typeof mem.usedJSHeapSize !== 'number' || typeof mem.jsHeapSizeLimit !== 'number') {
    return { usedPct: null, usedMb: null };
  }
  const usedMb = +(mem.usedJSHeapSize / (1024 * 1024)).toFixed(2);
  const limit = mem.jsHeapSizeLimit;
  const usedPct = limit > 0 ? +Math.min(100, (mem.usedJSHeapSize / limit) * 100).toFixed(2) : null;
  return { usedPct, usedMb };
}

async function getStorageMetrics(): Promise<{ usedPct: number | null; usedMb: number | null }> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usedPct: null, usedMb: null };
  }
  try {
    const est = await navigator.storage.estimate();
    const quota = est.quota ?? 0;
    const usage = est.usage ?? 0;
    if (quota <= 0) return { usedPct: null, usedMb: usage > 0 ? +(usage / (1024 * 1024)).toFixed(2) : null };
    const usedPct = +Math.min(100, (usage / quota) * 100).toFixed(2);
    const usedMb = +(usage / (1024 * 1024)).toFixed(2);
    return { usedPct, usedMb };
  } catch {
    return { usedPct: null, usedMb: null };
  }
}

function getNetworkMetrics(): { type: string | null; downlinkMbps: number | null } {
  if (typeof navigator === 'undefined') return { type: null, downlinkMbps: null };
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!conn) return { type: null, downlinkMbps: null };
  const type = conn.type ?? conn.effectiveType ?? null;
  const downlink = typeof conn.downlink === 'number' ? +conn.downlink.toFixed(2) : null;
  return { type, downlinkMbps: downlink };
}

function getVisibility(): 'visible' | 'hidden' | null {
  if (typeof document === 'undefined') return null;
  return document.visibilityState === 'visible' ? 'visible' : 'hidden';
}

function getAppUptimeSec(): number | null {
  if (typeof performance === 'undefined' || typeof performance.timeOrigin !== 'number') return null;
  const elapsed = Date.now() - performance.timeOrigin;
  return elapsed > 0 ? Math.round(elapsed / 1000) : null;
}

/**
 * Hook FPS interno: calcola il frame rate medio degli ultimi 5 secondi
 * tramite requestAnimationFrame. Update interno ogni 1s.
 *
 * Performance budget: 1 callback rAF/frame = ~16ms a 60Hz, costo trascurabile.
 * Si auto-pausa quando document.visibilityState !== 'visible' per evitare
 * di accumulare drift quando il tab e' in background.
 */
function useFpsTracker(): React.MutableRefObject<number | null> {
  const fpsRef = useRef<number | null>(null);
  const framesRef = useRef<number[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    let raf = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      const cutoff = now - 5_000;
      framesRef.current.push(now);
      while (framesRef.current.length > 0 && framesRef.current[0] < cutoff) {
        framesRef.current.shift();
      }
      if (framesRef.current.length >= 2) {
        const span = framesRef.current[framesRef.current.length - 1] - framesRef.current[0];
        const frames = framesRef.current.length - 1;
        if (span > 0) {
          fpsRef.current = +Math.min(240, (frames / span) * 1000).toFixed(2);
        }
      }
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        framesRef.current.length = 0;
        if (raf === 0) raf = requestAnimationFrame(tick);
      } else if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, []);

  return fpsRef;
}

/**
 * Sprint T-2 — Hook collector pubblico.
 *
 * Uso tipico (in `RoomPlayerView`):
 * ```tsx
 * const { collectMetrics } = useDevicePerformanceCollector();
 * // poi nel polling loop:
 * const payload = await collectMetrics();
 * await invokeRoomPlayerBootstrap(token, true, mode, payload);
 * ```
 *
 * Il payload e' SEMPRE compatibile con `DeviceMetricPingPayload`. I campi
 * non disponibili (browser senza performance.memory, etc.) restano `null`.
 */
export function useDevicePerformanceCollector(): {
  collectMetrics: () => Promise<DeviceMetricPingPayload>;
} {
  const fpsRef = useFpsTracker();
  // Cache dei valori battery (la promise getBattery() puo' essere lenta su
  // alcuni browser; meglio averli pronti).
  const batteryCache = useRef<{ pct: number | null; charging: boolean | null }>({
    pct: null,
    charging: null,
  });

  // Pre-popola la battery una volta sola al mount + ascolta gli eventi di
  // levelchange/chargingchange per tenere il cache fresco senza polling.
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManager> };
    if (typeof nav.getBattery !== 'function') return;
    let battery: BatteryManager | null = null;
    let cancelled = false;

    const update = () => {
      if (!battery) return;
      batteryCache.current = {
        pct: +(battery.level * 100).toFixed(2),
        charging: battery.charging,
      };
    };

    void nav.getBattery().then((b) => {
      if (cancelled) return;
      battery = b;
      update();
      b.addEventListener?.('levelchange', update);
      b.addEventListener?.('chargingchange', update);
    });

    return () => {
      cancelled = true;
      if (battery) {
        battery.removeEventListener?.('levelchange', update);
        battery.removeEventListener?.('chargingchange', update);
      }
    };
  }, []);

  const collectMetrics = useCallback(async (): Promise<DeviceMetricPingPayload> => {
    const heap = getJsHeapMetrics();
    const storage = await getStorageMetrics();
    const network = getNetworkMetrics();
    const visibility = getVisibility();
    const uptime = getAppUptimeSec();

    // SE siamo dentro Tauri, la fonte e' "desktop" (anche se al momento le
    // metriche raccolte sono ancora quelle browser-side: l'integrazione con
    // Rust sysinfo e' deferred a Sprint T-2 fase 2). Marker utile lato server
    // per filtrare e per Sprint Q hybrid sync.
    const source: 'browser' | 'desktop' = isRunningInTauri() ? 'desktop' : 'browser';

    return {
      source,
      js_heap_used_pct: heap.usedPct,
      js_heap_used_mb: heap.usedMb,
      storage_quota_used_pct: storage.usedPct,
      storage_quota_used_mb: storage.usedMb,
      fps: fpsRef.current,
      network_type: network.type,
      network_downlink_mbps: network.downlinkMbps,
      battery_pct: batteryCache.current.pct,
      battery_charging: batteryCache.current.charging,
      visibility,
      // CPU/RAM/disk reali sono accessibili solo dal Rust backend Tauri
      // (sysinfo crate). Per ora null nei contesti browser; popolati in fase 2.
      cpu_pct: null,
      ram_used_pct: null,
      ram_used_mb: null,
      disk_free_pct: null,
      disk_free_gb: null,
      app_uptime_sec: uptime,
    };
  }, [fpsRef]);

  return { collectMetrics };
}
