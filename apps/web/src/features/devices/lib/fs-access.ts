/**
 * Wrapper File System Access API (Chrome/Edge 86+) + IndexedDB per persistenza handle.
 *
 * Il tecnico seleziona la cartella una sola volta; l'handle viene salvato in IndexedDB
 * e ripristinato alla sessione successiva senza richiedere una nuova selezione manuale,
 * a patto che l'origine rimanga la stessa (stessa URL).
 */

const DB_NAME = 'slide-center-fs';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const HANDLE_KEY = 'root-dir';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

/** True se il browser supporta la File System Access API */
export function isFsAccessSupported(): boolean {
  return 'showDirectoryPicker' in window;
}

/**
 * Verifica che l'handle salvato sia ancora accessibile e abbia permesso di scrittura.
 * Restituisce il permesso corrente: 'granted' | 'denied' | 'prompt'.
 */
async function queryPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode,
): Promise<PermissionState> {
  if ('queryPermission' in handle) {
    return handle.queryPermission({ mode });
  }
  return 'granted';
}

async function requestPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode,
): Promise<PermissionState> {
  if ('requestPermission' in handle) {
    return handle.requestPermission({ mode });
  }
  return 'granted';
}

/**
 * Restituisce l'handle salvato se ancora valido (permesso read+write), altrimenti null.
 * Non mostra nessun dialog all'utente.
 */
export async function getSavedDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
    if (!handle) return null;
    const perm = await queryPermission(handle, 'readwrite');
    if (perm === 'granted') return handle;
    return handle; // restituito anche se 'prompt'; requestPermission dovrà essere chiamato in un click handler
  } catch {
    return null;
  }
}

/**
 * Chiede all'utente di selezionare una cartella e la persiste in IndexedDB.
 * Da chiamare solo in risposta a un evento utente (click), altrimenti il browser blocca.
 */
export async function pickAndSaveDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFsAccessSupported()) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet(HANDLE_KEY, handle);
    return handle;
  } catch (err) {
    if ((err as Error).name === 'AbortError') return null;
    throw err;
  }
}

/** Richiede il permesso di scrittura se è nello stato 'prompt'. */
export async function ensureWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const perm = await queryPermission(handle, 'readwrite');
  if (perm === 'granted') return true;
  const result = await requestPermission(handle, 'readwrite');
  return result === 'granted';
}

/** Elimina l'handle salvato (usato quando il tecnico vuole cambiare cartella). */
export async function clearSavedDirHandle(): Promise<void> {
  await idbDelete(HANDLE_KEY);
}

/** Sanifica un segmento di path locale rimuovendo caratteri non sicuri per FS. */
export function sanitizeFsSegment(name: string, fallback = 'cartella'): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length === 0 ? fallback : cleaned.slice(0, 120);
}

/**
 * Sprint A4 + C1 (GUIDA_OPERATIVA_v3 §2.A4 + §2.C1) — opzioni di download.
 *
 * - `priority`: passato a `fetch(url, { priority })` (Chromium 102+; no-op altrove).
 *   Permette al browser di abbassare la priorita' della richiesta sotto rete
 *   condivisa (es. `low` durante una proiezione 4K live).
 * - `throttleMs` + `throttleEveryBytes`: introducono una pausa artificiale ogni
 *   N byte scritti per liberare CPU/rete e non disturbare la proiezione.
 *   Default: nessun throttle.
 * - `expectedSizeBytes`: Sprint C1. Se passato e il file locale esiste con
 *   dimensione `0 < N < expected`, viene tentato un download `Range: bytes=N-`
 *   e in caso di 206 il file viene appeso (resume). Se il file e' gia'
 *   completo (`N === expected`), il download viene saltato.
 * - `forceFullDownload`: Sprint C1. Se `true`, ignora il file esistente e
 *   riscrive da zero. Usato quando la verifica SHA256 fallisce (mismatch).
 */
export interface DownloadOptions {
  priority?: 'high' | 'low' | 'auto';
  throttleMs?: number;
  throttleEveryBytes?: number;
  signal?: AbortSignal;
  expectedSizeBytes?: number;
  forceFullDownload?: boolean;
}

const DEFAULT_THROTTLE_EVERY_BYTES = 4 * 1024 * 1024;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * Sprint I (GUIDA_OPERATIVA_v3 §3.D D2) — restituisce il blob LOCALE gia'
 * scaricato di un file, navigando le sub-cartelle (`segments`).
 *
 * Usato dal PC sala per:
 * - Anteprima inline (PDF/img/video/audio) nel `<FilePreviewDialog>`.
 * - Apertura nuova tab del blob URL per file non-anteprimabili (pptx,
 *   keynote, ...) in attesa del launcher Tauri (Sprint J).
 *
 * Tutte le sub-cartelle e il filename sono passati per `sanitizeFsSegment`,
 * cosi' il path corrisponde esattamente a quello creato da
 * `downloadVersionToFolder` durante lo Sprint A.
 *
 * Permission policy: presuppone che la directory abbia gia' permessi
 * `granted` (il PC sala li ottiene una volta in `pickAndSaveDirHandle` e
 * il browser li mantiene per la sessione). Se il browser ha revocato il
 * permesso, `getDirectoryHandle({ create: false })` lancia `NotAllowedError`
 * e ritorniamo `null` (il chiamante mostrera' il fallback "scarica" /
 * "ri-scegli cartella").
 *
 * @returns blob File se trovato, `null` altrimenti.
 */
export async function readLocalFile(
  dirHandle: FileSystemDirectoryHandle,
  segments: string[],
  filename: string,
): Promise<File | null> {
  try {
    let dir = dirHandle;
    for (const raw of segments) {
      const seg = sanitizeFsSegment(raw);
      dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    const handle = await dir.getFileHandle(sanitizeFsSegment(filename, 'file'), {
      create: false,
    });
    return await handle.getFile();
  } catch {
    return null;
  }
}

/**
 * Sprint C1 (GUIDA_OPERATIVA_v3 §2.C1) — restituisce la dimensione del file
 * locale gia' scaricato, o `null` se non esiste / non leggibile.
 */
async function getExistingFileSize(
  dirHandle: FileSystemDirectoryHandle,
  segments: string[],
  filename: string,
): Promise<number | null> {
  try {
    let dir = dirHandle;
    for (const raw of segments) {
      const seg = sanitizeFsSegment(raw);
      // create:false: se la sub-cartella non esiste, NotFoundError.
      dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    const handle = await dir.getFileHandle(sanitizeFsSegment(filename, 'file'), {
      create: false,
    });
    const file = await handle.getFile();
    return file.size;
  } catch {
    return null;
  }
}

/**
 * Sprint C2 (GUIDA_OPERATIVA_v3 §2.C2) — soglia massima per il calcolo del
 * digest SHA-256 lato browser. Web Crypto non ha API streaming, e per file
 * grandi caricheremmo l'intero contenuto in `Uint8Array` (RAM). 512 MiB e'
 * il punto di equilibrio: copre il 99% delle slide PowerPoint/PDF; per file
 * piu' grandi (es. video 5 GB) restituiamo `'skipped'` esplicito invece di
 * crashare il browser. Vedi `verifyFileSha256` sotto.
 */
const MAX_VERIFY_BYTES = 512 * 1024 * 1024;

/**
 * Sprint C2 — verifica integrita' file locale calcolando SHA-256 e
 * confrontandolo con l'hash atteso (calcolato dall'admin lato upload).
 *
 * @returns
 *   - `true` se l'hash combacia,
 *   - `false` se NON combacia (mismatch → ridownload completo dal chiamante),
 *   - `'skipped'` se il file e' troppo grande (>512MB) o l'hash atteso e' null
 *     (upload legacy senza hash) o si e' verificato un errore di lettura.
 */
export async function verifyFileSha256(
  dirHandle: FileSystemDirectoryHandle,
  segments: string[],
  filename: string,
  expectedHash: string | null,
): Promise<true | false | 'skipped'> {
  if (!expectedHash) return 'skipped';
  try {
    let dir = dirHandle;
    for (const raw of segments) {
      const seg = sanitizeFsSegment(raw);
      dir = await dir.getDirectoryHandle(seg, { create: false });
    }
    const handle = await dir.getFileHandle(sanitizeFsSegment(filename, 'file'), {
      create: false,
    });
    const file = await handle.getFile();
    if (file.size > MAX_VERIFY_BYTES) return 'skipped';
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.toLowerCase() === expectedHash.toLowerCase();
  } catch {
    return 'skipped';
  }
}

/**
 * Scarica un file da un URL (signed URL Supabase) e lo scrive seguendo una
 * struttura di sub-directory arbitraria. Il path effettivo locale sara':
 *   `{dirHandle}/{segments[0]}/{segments[1]}/.../{filename}`
 *
 * Esempio con `segments = ['Sala 1', 'Mattina']`, `filename = 'slide.pptx'`:
 *   `<cartella scelta>/Sala 1/Mattina/slide.pptx`
 *
 * Sprint C1: se `options.expectedSizeBytes` e' fornito e il file esiste gia'
 * parzialmente, prova un download `Range: bytes=N-` (resume). Se il server
 * risponde 200 (Range non supportato) ricomincia da zero. Se il file e' gia'
 * completo, ritorna immediatamente senza ri-scaricare.
 *
 * @param dirHandle      Handle radice scelto dall'utente
 * @param segments       Lista sub-cartelle (vengono create se non esistono)
 * @param filename       Nome file da creare/sovrascrivere
 * @param url            Signed URL per il download
 * @param onProgress     Callback con percentuale 0-100 (richiede content-length)
 * @param options        Opzioni Sprint A4 + C1 (priority, throttle, abort, resume)
 */
export async function downloadFileToPath(
  dirHandle: FileSystemDirectoryHandle,
  segments: string[],
  filename: string,
  url: string,
  onProgress?: (pct: number) => void,
  options?: DownloadOptions,
): Promise<void> {
  let dir = dirHandle;
  for (const raw of segments) {
    const seg = sanitizeFsSegment(raw);
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const safeName = sanitizeFsSegment(filename, 'file');
  const fileHandle = await dir.getFileHandle(safeName, { create: true });

  // Sprint C1: pre-check per il resume.
  // Calcoliamo l'offset di partenza e lo stato del file locale PRIMA di
  // aprire il writable, cosi' decidiamo se appendere o riscrivere da zero.
  const expected = options?.expectedSizeBytes ?? 0;
  let resumeFrom = 0;
  let keepExistingData = false;
  if (!options?.forceFullDownload && expected > 0) {
    const existing = await getExistingFileSize(dirHandle, segments, safeName);
    if (existing !== null) {
      if (existing === expected) {
        // File gia' completo sul disco: niente download, progresso al 100%.
        onProgress?.(100);
        return;
      }
      if (existing > 0 && existing < expected) {
        resumeFrom = existing;
        keepExistingData = true;
      }
      // existing > expected (file corrotto/sovrascritto): trattiamo come full reset.
    }
  }

  const writable = await fileHandle.createWritable({ keepExistingData });
  if (resumeFrom > 0) {
    try {
      await writable.seek(resumeFrom);
    } catch {
      // Se il seek fallisce, ricominciamo da zero per sicurezza.
      resumeFrom = 0;
      keepExistingData = false;
      try { await writable.abort(); } catch { /* ignore */ }
      const fresh = await fileHandle.createWritable({ keepExistingData: false });
      // Usa il writable nuovo da qui in avanti: assegnazione tramite let var
      // sarebbe piu' pulita ma rompe la chiusura. Riscriviamo la funzione:
      return downloadFromOffset(fresh, 0, false);
    }
  }

  return downloadFromOffset(writable, resumeFrom, keepExistingData);

  async function downloadFromOffset(
    w: FileSystemWritableFileStream,
    offset: number,
    appending: boolean,
  ): Promise<void> {
    const fetchInit: RequestInit & { priority?: 'high' | 'low' | 'auto' } = {};
    if (options?.priority) fetchInit.priority = options.priority;
    if (options?.signal) fetchInit.signal = options.signal;
    if (offset > 0) {
      fetchInit.headers = { Range: `bytes=${offset}-` };
    }

    let response: Response;
    try {
      response = await fetch(url, fetchInit);
    } catch (err) {
      try { await w.abort(); } catch { /* ignore */ }
      throw err;
    }

    // 416 Range Not Satisfiable: di solito significa che il file lato server
    // e' piu' piccolo del nostro offset → file gia' completo o cambiato.
    // Trattiamo come "tutto ok, niente da scaricare".
    if (response.status === 416) {
      try { await w.close(); } catch { /* ignore */ }
      onProgress?.(100);
      return;
    }

    // 200 invece di 206 quando avevamo chiesto Range: il server NON supporta
    // resume (es. signed URL con CDN troppo aggressivo). Riscriviamo da zero.
    if (offset > 0 && response.status === 200) {
      try { await w.abort(); } catch { /* ignore */ }
      const fresh = await fileHandle.createWritable({ keepExistingData: false });
      return downloadFromOffset(fresh, 0, false);
    }

    if (!response.ok) {
      try { await w.abort(); } catch { /* ignore */ }
      throw new Error(`HTTP ${response.status} — ${response.statusText}`);
    }
    if (!response.body) {
      try { await w.abort(); } catch { /* ignore */ }
      throw new Error('Response body is null — cannot stream download');
    }

    const contentLength = response.headers.get('content-length');
    const remaining = contentLength ? parseInt(contentLength, 10) : null;
    const total = remaining !== null ? offset + remaining : null;
    let loaded = offset;
    let bytesSinceLastThrottle = 0;
    const throttleMs = Math.max(0, options?.throttleMs ?? 0);
    const throttleEveryBytes = Math.max(
      1024,
      options?.throttleEveryBytes ?? DEFAULT_THROTTLE_EVERY_BYTES,
    );

    if (offset > 0 && total && onProgress) {
      onProgress(Math.round((loaded / total) * 100));
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await w.write(value);
        loaded += value.byteLength;
        bytesSinceLastThrottle += value.byteLength;

        if (total && onProgress) {
          onProgress(Math.round((loaded / total) * 100));
        }

        if (throttleMs > 0 && bytesSinceLastThrottle >= throttleEveryBytes) {
          bytesSinceLastThrottle = 0;
          await sleep(throttleMs, options?.signal);
        }
      }
      await w.close();
      // Marker: appending non utilizzato direttamente, e' diagnostico.
      void appending;
    } catch (err) {
      try { await w.abort(); } catch { /* best-effort cleanup */ }
      throw err;
    }
  }
}

/**
 * Wrapper compatibile retro con la firma legacy `(handle, subFolder, filename, url, onProgress)`.
 * Internamente delega a `downloadFileToPath([subFolder], filename, ...)`.
 */
export async function downloadFileToDir(
  dirHandle: FileSystemDirectoryHandle,
  subFolder: string,
  filename: string,
  url: string,
  onProgress?: (pct: number) => void,
  options?: DownloadOptions,
): Promise<void> {
  return downloadFileToPath(dirHandle, [subFolder], filename, url, onProgress, options);
}

/**
 * Sprint E3 (GUIDA_OPERATIVA_v3 §2.E3) — stima dello spazio disco disponibile
 * per l'origin tramite `navigator.storage.estimate()`.
 *
 * Note importanti:
 *  - Su Chrome desktop la quota e' tipicamente ~60% del disco disponibile,
 *    Firefox ~50%, Edge come Chrome. Limiti per origin/eTLD+1.
 *  - I file scaricati via File System Access API (cartella scelta dall'utente)
 *    NON contano nella quota dell'origin. Quindi `usage` e' una stima della
 *    sola IndexedDB / Cache API / OPFS — utile come segnale, ma il vincolo
 *    reale e' lo spazio libero del DISCO della cartella scelta, che non e'
 *    interrogabile da JS (security restriction).
 *  - Conclusione: usiamo `availableBytes` come "soglia di pre-allarme" per
 *    rifiutare download palesemente troppo grossi (>5GB su quota residua di
 *    1GB), ma NON come garanzia. L'utente vede il warning e puo' liberare
 *    spazio o spostare la cartella.
 *
 * Ritorna `null` se l'API non e' supportata (Safari < 16 o vecchi browser).
 */
export interface StorageEstimate {
  quotaBytes: number;
  usageBytes: number;
  availableBytes: number;
  /** Quota in % (0-100). */
  usagePct: number;
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const est = await navigator.storage.estimate();
    const quota = est.quota ?? 0;
    const usage = est.usage ?? 0;
    const available = Math.max(0, quota - usage);
    const pct = quota > 0 ? Math.min(100, Math.round((usage / quota) * 100)) : 0;
    return { quotaBytes: quota, usageBytes: usage, availableBytes: available, usagePct: pct };
  } catch {
    return null;
  }
}

/**
 * Sprint E3 — pulizia file orfani: scansiona ricorsivamente la cartella
 * radice, calcola la chiave relativa di ogni file (`segments.join('/')+'/'+filename`)
 * e rimuove quelli che NON sono nella `expectedKeys`.
 *
 * `expectedKeys` deve essere costruita lato chiamante usando lo stesso
 * pattern di `downloadFileToPath`: `[roomName, sessionTitle].join('/') + '/' + filename`,
 * con `sanitizeFsSegment` applicato ad ogni componente. Se la chiave non
 * matcha 1:1 il file viene cancellato — assicurarsi della consistenza prima
 * di chiamare!
 *
 * Ritorna i conteggi di file/byte rimossi. Best-effort: errori per singolo
 * file vengono loggati e ignorati (es. file aperto da PowerPoint, lock OS).
 *
 * Profondita' max scansione: 3 livelli (room/session/file). Oltre, ignora.
 */
export interface OrphanCleanupResult {
  removedFiles: number;
  removedBytes: number;
  errors: number;
}

export async function purgeOrphanFiles(
  dirHandle: FileSystemDirectoryHandle,
  expectedKeys: ReadonlySet<string>,
  options: { maxDepth?: number } = {},
): Promise<OrphanCleanupResult> {
  const maxDepth = options.maxDepth ?? 3;
  const result: OrphanCleanupResult = { removedFiles: 0, removedBytes: 0, errors: 0 };

  async function walk(handle: FileSystemDirectoryHandle, segments: string[], depth: number): Promise<void> {
    if (depth > maxDepth) return;
    // entries() is a JS-async-iterator; we can iterate with `for await`.
    const dir = handle as FileSystemDirectoryHandle & {
      entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [name, child] of dir.entries()) {
      if (child.kind === 'directory') {
        await walk(child as FileSystemDirectoryHandle, [...segments, name], depth + 1);
      } else if (child.kind === 'file') {
        const key = [...segments, name].join('/');
        if (expectedKeys.has(key)) continue;
        try {
          const fileHandle = child as FileSystemFileHandle;
          let sizeBytes = 0;
          try {
            const f = await fileHandle.getFile();
            sizeBytes = f.size;
          } catch {
            sizeBytes = 0;
          }
          await handle.removeEntry(name);
          result.removedFiles += 1;
          result.removedBytes += sizeBytes;
        } catch {
          result.errors += 1;
        }
      }
    }
  }

  try {
    await walk(dirHandle, [], 0);
  } catch {
    result.errors += 1;
  }
  return result;
}
