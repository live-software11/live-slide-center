import { useEffect, useRef } from 'react';
import {
  invokeSlideValidator,
  listUnvalidatedVersionsForSession,
} from '@/features/presentations/repository';

/**
 * Sprint T-3-A (G10) — File error checking automatico (warn-only).
 *
 * Hook trigger pull-based: ogni volta che il pannello file si apre con
 * versioni `status='ready' AND validation_warnings IS NULL`, kick l Edge
 * Function `slide-validator`. Best-effort: i fallimenti non bloccano la UX.
 *
 * Logica:
 * 1. All apertura della sessione (`enabled=true`) e dopo ogni cambio di
 *    `versionsTrigger` (es. nuovo upload), interroga RPC
 *    `list_unvalidated_versions_for_session` (max 10).
 * 2. Se ci sono versioni unvalidated, le passa a `slide-validator` (max 5
 *    per call lato server). La function torna asincrona quando ha finito.
 * 3. Chiama `onValidated()` per triggerare reload della lista lato UI
 *    (cosi i badge giallo `⚠ N issue` compaiono in <2 min).
 *
 * Throttling: fa al massimo UN tick ogni 60s per la stessa sessione, per
 * evitare di hammerare l Edge in caso di reload rapidi (panel collapse/expand).
 *
 * Idempotenza server-side: la RPC `record_validation_warnings` ha guard su
 * `validated_at IS NULL`, quindi 2 tab che triggherano in parallelo non
 * causano doppi-write.
 */
export function useValidationTrigger(input: {
  sessionId: string;
  enabled: boolean;
  /** Cambia ogni volta che la lista version cambia (es. dopo upload). */
  versionsTrigger: number;
  /** Callback chiamata quando la validation ha finito (refresh UI). */
  onValidated?: () => void;
}): void {
  const { sessionId, enabled, versionsTrigger, onValidated } = input;
  const lastTickAtRef = useRef<number>(0);
  const inFlightRef = useRef<boolean>(false);
  const onValidatedRef = useRef(onValidated);
  onValidatedRef.current = onValidated;

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const now = Date.now();
    const sinceLastTick = now - lastTickAtRef.current;
    if (sinceLastTick < 60_000 && lastTickAtRef.current > 0) {
      // Throttle: gia' triggherato di recente, skip.
      return;
    }
    if (inFlightRef.current) return;

    let cancelled = false;
    inFlightRef.current = true;
    lastTickAtRef.current = now;

    (async () => {
      try {
        const unvalidated = await listUnvalidatedVersionsForSession(sessionId, 10);
        if (cancelled) return;
        if (unvalidated.length === 0) return;

        // Process in batch da 5 (limite Edge function)
        const batches: string[][] = [];
        for (let i = 0; i < unvalidated.length; i += 5) {
          batches.push(unvalidated.slice(i, i + 5).map((u) => u.versionId));
        }

        for (const batch of batches) {
          if (cancelled) return;
          try {
            await invokeSlideValidator(batch);
          } catch {
            // best-effort: warn-only; il prossimo tick riprovera'
          }
        }

        if (!cancelled && onValidatedRef.current) {
          onValidatedRef.current();
        }
      } catch {
        // Cattura errori (RPC, JWT, ecc.) senza propagare alla UI: warn-only.
      } finally {
        inFlightRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled, versionsTrigger]);
}
