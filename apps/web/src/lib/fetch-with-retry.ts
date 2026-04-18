/**
 * Sprint E1 (GUIDA_OPERATIVA_v3 §2.E1) — wrapper di `fetch` con retry
 * automatico e backoff esponenziale.
 *
 * Pensato per chiamate "control plane" piccole (Edge Function bootstrap,
 * rename, status) — NON per download di payload grossi (quelli hanno gia'
 * la loro logica di resume HTTP `Range` in `fs-access.ts::downloadFileToPath`,
 * e ri-scaricarli ad ogni 5xx vanificherebbe la resilienza Sprint C).
 *
 * Politica di retry:
 *  - Transient network errors (`TypeError: Failed to fetch`, etc.) → retry.
 *  - HTTP 408, 429, 502, 503, 504 → retry (problema momentaneo del lato server).
 *  - Tutti gli altri status (incluso 401/403/404/4xx) → NON retry, throw subito
 *    cosi' il chiamante puo' gestire (es. token revocato).
 *  - `AbortSignal.aborted` → mai retry.
 *
 * Backoff di default: [500ms, 2000ms, 8000ms]. Quindi al massimo 3 retry =
 * 4 tentativi totali, attesa totale ≤ 10.5s.
 *
 * Usato in `apps/web/src/features/devices/repository.ts` per
 * `invokeRoomPlayerBootstrap` e `invokeRoomPlayerRename`.
 */

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_BACKOFF_MS = [500, 2000, 8000] as const;

export interface FetchWithRetryOptions extends RequestInit {
  /** Backoff array. Lunghezza determina i retry massimi. Default: [500, 2000, 8000]. */
  backoffMs?: readonly number[];
  /** Callback per logging (es. Sentry breadcrumb). */
  onRetry?: (info: { attempt: number; reason: 'network' | 'status'; status?: number; error?: unknown }) => void;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const { backoffMs = DEFAULT_BACKOFF_MS, onRetry, signal, ...init } = options;
  const maxAttempts = backoffMs.length + 1;

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      const e = new DOMException('aborted', 'AbortError');
      throw e;
    }
    try {
      const res = await fetch(url, { ...init, signal });
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) return res;
      // Status retryable → trattiamo come errore.
      lastError = new Error(`HTTP ${res.status}`);
      if (attempt < maxAttempts - 1) {
        onRetry?.({ attempt, reason: 'status', status: res.status });
        await sleepWithAbort(backoffMs[attempt] ?? 0, signal);
        continue;
      }
      return res; // Esauriti i retry: ritorno l'ultima risposta non-ok cosi' il chiamante puo' leggerne il body.
    } catch (err) {
      lastError = err;
      if (signal?.aborted || err instanceof DOMException) throw err;
      if (attempt < maxAttempts - 1) {
        onRetry?.({ attempt, reason: 'network', error: err });
        await sleepWithAbort(backoffMs[attempt] ?? 0, signal);
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error('fetch_with_retry_unknown');
}

function sleepWithAbort(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
