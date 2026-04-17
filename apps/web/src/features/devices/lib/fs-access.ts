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
 * Scarica un file da un URL (signed URL Supabase) e lo scrive seguendo una
 * struttura di sub-directory arbitraria. Il path effettivo locale sara':
 *   `{dirHandle}/{segments[0]}/{segments[1]}/.../{filename}`
 *
 * Esempio con `segments = ['Sala 1', 'Mattina']`, `filename = 'slide.pptx'`:
 *   `<cartella scelta>/Sala 1/Mattina/slide.pptx`
 *
 * @param dirHandle      Handle radice scelto dall'utente
 * @param segments       Lista sub-cartelle (vengono create se non esistono)
 * @param filename       Nome file da creare/sovrascrivere
 * @param url            Signed URL per il download
 * @param onProgress     Callback con percentuale 0-100 (richiede content-length)
 */
export async function downloadFileToPath(
  dirHandle: FileSystemDirectoryHandle,
  segments: string[],
  filename: string,
  url: string,
  onProgress?: (pct: number) => void,
): Promise<void> {
  let dir = dirHandle;
  for (const raw of segments) {
    const seg = sanitizeFsSegment(raw);
    dir = await dir.getDirectoryHandle(seg, { create: true });
  }
  const fileHandle = await dir.getFileHandle(sanitizeFsSegment(filename, 'file'), {
    create: true,
  });
  const writable = await fileHandle.createWritable();

  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} — ${response.statusText}`);
  if (!response.body) throw new Error('Response body is null — cannot stream download');

  const contentLength = response.headers.get('content-length');
  const total = contentLength ? parseInt(contentLength, 10) : null;
  let loaded = 0;

  const reader = response.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value);
      loaded += value.byteLength;
      if (total && onProgress) {
        onProgress(Math.round((loaded / total) * 100));
      }
    }
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch { /* best-effort cleanup */ }
    throw err;
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
): Promise<void> {
  return downloadFileToPath(dirHandle, [subFolder], filename, url, onProgress);
}
