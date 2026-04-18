/**
 * Sprint O2 (GUIDA_OPERATIVA_v3 §4.G — UX parity cloud/offline) — init sincrono backend desktop.
 *
 * Problema: il client Supabase JS (`createClient(url, key)`) richiede `url` e
 * `key` SINCRONI. In modalita cloud li leggiamo da `import.meta.env`. In
 * modalita desktop il backend Rust locale fornisce `base_url` + `admin_token`
 * via Tauri command `cmd_backend_info` — ma `cmd_backend_info` e' ASYNC
 * (passa per IPC Tauri).
 *
 * Soluzione: prima di renderizzare `<RouterProvider />` in `main.tsx`,
 * chiamiamo `ensureDesktopBackendReady()`. La funzione fa ONE-TIME `await
 * cmd_backend_info` e cache il risultato in modulo (variabile statica). Tutti
 * gli accessi successivi sono SINCRONI tramite `getCachedDesktopBackendInfo()`.
 *
 * Vantaggi:
 *   • Il client Supabase puo' essere creato sincronamente in `getSupabaseBrowserClient`.
 *   • Niente race condition: il primo render avviene SOLO dopo che il backend
 *     ha confermato `ready: true`.
 *   • In cloud questa funzione e' un no-op: ritorna immediatamente.
 *
 * Failure mode:
 *   • Se `cmd_backend_info` non risponde entro 5s o ritorna `ready: false`,
 *     `ensureDesktopBackendReady()` re-throw l'errore. `main.tsx` mostra una
 *     schermata "backend non disponibile, riavvia l'app". Mai silenziare:
 *     un desktop senza backend Rust non puo' fare nulla di utile.
 */

import { getDesktopBackendInfo, type DesktopBackendInfo } from './desktop-bridge';
import { getBackendMode } from './backend-mode';

let cachedInfo: DesktopBackendInfo | null = null;
let initPromise: Promise<DesktopBackendInfo> | null = null;

const INIT_TIMEOUT_MS = 5_000;

/**
 * Inizializza il backend desktop una sola volta. Va chiamato in `main.tsx`
 * PRIMA di `createRoot().render(...)`. In cloud ritorna immediatamente.
 *
 * Throw se: non in Tauri ma in modalita desktop, oppure il backend Rust non
 * risponde entro `INIT_TIMEOUT_MS`, oppure `ready: false` (backend non bootato).
 */
export async function ensureDesktopBackendReady(): Promise<DesktopBackendInfo | null> {
  if (getBackendMode() !== 'desktop') return null;
  if (cachedInfo !== null) return cachedInfo;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const timeoutPromise = new Promise<DesktopBackendInfo>((_, reject) => {
      window.setTimeout(
        () => reject(new Error(`desktop_backend_timeout: cmd_backend_info > ${INIT_TIMEOUT_MS}ms`)),
        INIT_TIMEOUT_MS,
      );
    });
    const info = await Promise.race([getDesktopBackendInfo(), timeoutPromise]);
    if (!info.ready || !info.base_url || !info.admin_token) {
      throw new Error(
        `desktop_backend_not_ready: ready=${info.ready} base_url=${Boolean(info.base_url)} admin_token=${Boolean(info.admin_token)}`,
      );
    }
    cachedInfo = info;
    return info;
  })();

  try {
    return await initPromise;
  } finally {
    if (cachedInfo === null) initPromise = null;
  }
}

/**
 * Accesso sincrono al backend info gia' inizializzato. Ritorna `null` in
 * cloud o se `ensureDesktopBackendReady()` non e' ancora stato chiamato (in
 * pratica, in desktop dopo `main.tsx` e' SEMPRE valorizzato).
 */
export function getCachedDesktopBackendInfo(): DesktopBackendInfo | null {
  return cachedInfo;
}

/**
 * Forza il refresh del cache (es. dopo cambio role + restart simulato in dev).
 * In produzione raramente serve perche' il backend Rust non cambia a runtime.
 */
export function invalidateDesktopBackendCache(): void {
  cachedInfo = null;
  initPromise = null;
}
