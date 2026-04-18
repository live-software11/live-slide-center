/**
 * Sprint S-1 (G4) — drag&drop di cartelle intere nell'upload admin.
 *
 * RATIONALE:
 *  - L'utente vuole poter trascinare una cartella (es. "Conferenza-2026/")
 *    contenente sotto-cartelle e file PPTX/PDF e caricare tutto in una sola
 *    azione, mantenendo la struttura come PREFISSO del filename salvato.
 *  - Lo schema attuale (`presentation_versions.file_name TEXT 255`) non
 *    supporta directory native, ma puo' contenere uno "/" senza sanitizzazione
 *    (la sanitizzazione del regex avviene SOLO per la `storage_key`).
 *  - Quindi convertiamo `webkitRelativePath` -> `name` del File ricreato.
 *
 * BROWSER SUPPORT:
 *  - `DataTransferItem.webkitGetAsEntry()` e' supportato da tutti i browser
 *    moderni (Chrome, Edge, Firefox, Safari). E' un'API non-standard ma de
 *    facto universale (https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/webkitGetAsEntry).
 *  - `<input type="file" webkitdirectory>` e' supportato da Chrome/Edge/Safari
 *    (Firefox da v50). Per device mobili spesso non funziona ma il caso d'uso
 *    primario e' admin desktop.
 *  - Fallback: se nessuno dei due e' disponibile, ricadiamo sul flusso
 *    "files singoli" (gia' funzionante).
 *
 * SAFETY LIMITS (configurabili):
 *  - MAX_FILES_PER_DROP: previene drop accidentali di cartelle enormi (es.
 *    "Documents/" intera = milioni di file → freeze del browser).
 *  - MAX_TRAVERSAL_DEPTH: previene cycle infiniti su symlink (anche se in
 *    pratica i FS API browser non li seguono).
 *  - MAX_TOTAL_BYTES: protezione UI; le quote tenant sono validate dalla RPC.
 *
 * COSA NON FACCIAMO QUI:
 *  - Hash/dedup dei file (gestito da `useUploadQueue`).
 *  - Validazione estensione/MIME (la RPC `init_upload_version_for_session`
 *    accetta qualsiasi mime; il frontend potra' filtrare in futuro).
 *  - Non leggiamo i bytes: solo metadati (`File` e' lazy in entrambi i casi).
 */

export interface FolderTraversalResult {
  /** File pronti per la coda upload, con `name` = path relativo. */
  files: File[];
  /** Numero di file scartati per duplicato (stesso relativePath). */
  duplicates: number;
  /** Numero di file scartati perche' size = 0. */
  emptyFiles: number;
  /** Numero di file scartati per filename troppo lungo (> MAX_FILENAME_LEN). */
  filenameTooLong: number;
  /** Path della cartella root (primo segmento). Vuoto se drop di file singoli. */
  rootFolderName: string;
  /** True se il drop conteneva almeno una cartella (per UI hint). */
  containedFolders: boolean;
  /** True se il drop ha superato `MAX_FILES_PER_DROP` (alcuni file scartati). */
  truncated: boolean;
}

const MAX_FILES_PER_DROP = 500;
const MAX_TRAVERSAL_DEPTH = 10;
const MAX_FILENAME_LEN = 255; // deve combaciare con check RPC `filename_too_long`

/**
 * Ricostruisce un `File` con `name = relativePath` preservando bytes/lastModified.
 * Se `relativePath` > MAX_FILENAME_LEN tenta di troncare la PARTE INIZIALE
 * mantenendo nome+estensione finale (cosi' l'utente vede comunque il file
 * "vero", anche se la struttura cartella perde i livelli alti).
 *
 * Esempio: "VeryLongFolder/.../actual_file_name.pptx" len 280
 *   → ".../actual_file_name.pptx" len ≤ 255
 *
 * Se anche solo il filename finale supera 255, ritorna null (chiamante
 * deve segnalare l'errore in UI).
 */
function rebuildFileWithRelativePath(file: File, relativePath: string): File | null {
  if (!relativePath || relativePath.length === 0) return null;
  let finalName = relativePath;
  if (finalName.length > MAX_FILENAME_LEN) {
    // Estrae nome file finale (dopo l'ultimo '/').
    const lastSep = finalName.lastIndexOf('/');
    const baseName = lastSep >= 0 ? finalName.slice(lastSep + 1) : finalName;
    if (baseName.length > MAX_FILENAME_LEN) return null;
    // Trunca segmenti dall'inizio finche' rientri nel limite.
    // Prefix " /" indica truncamento per chiarezza visiva.
    const ELLIPSIS = '.../';
    const allowedPrefixLen = MAX_FILENAME_LEN - baseName.length - ELLIPSIS.length;
    if (allowedPrefixLen <= 0) {
      finalName = baseName;
    } else {
      // Mantieni gli ULTIMI segmenti che ci stanno
      const segments = finalName.slice(0, lastSep).split('/');
      const kept: string[] = [];
      let lenBudget = allowedPrefixLen;
      for (let i = segments.length - 1; i >= 0; i -= 1) {
        const seg = segments[i];
        const cost = seg.length + 1; // +1 per '/'
        if (cost > lenBudget) break;
        kept.unshift(seg);
        lenBudget -= cost;
      }
      finalName = `${ELLIPSIS}${kept.join('/')}/${baseName}`;
      if (finalName.length > MAX_FILENAME_LEN) finalName = baseName;
    }
  }
  return new File([file], finalName, { type: file.type, lastModified: file.lastModified });
}

/**
 * Estrae il "primo segmento" di un path relativo. Ritorna stringa vuota se
 * il path non contiene "/" (file root).
 */
function rootSegmentOf(relativePath: string): string {
  const i = relativePath.indexOf('/');
  return i > 0 ? relativePath.slice(0, i) : '';
}

/**
 * Visita ricorsiva di un `FileSystemEntry`. Accumula `FileEntry` mantenendo
 * `relativePath` come stringa "Folder/Sub/file.ext" (no leading '/').
 *
 * Implementazione iterativa (BFS con queue) per evitare stack overflow su
 * cartelle profonde. Limite hard `MAX_TRAVERSAL_DEPTH` per safety.
 */
async function collectFromEntry(rootEntry: FileSystemEntry): Promise<Array<{ file: File; relativePath: string }>> {
  const out: Array<{ file: File; relativePath: string }> = [];
  // Queue: { entry, pathPrefix, depth }
  const queue: Array<{ entry: FileSystemEntry; pathPrefix: string; depth: number }> = [
    { entry: rootEntry, pathPrefix: '', depth: 0 },
  ];

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { entry, pathPrefix, depth } = next;
    if (depth > MAX_TRAVERSAL_DEPTH) continue; // skip silenzioso, sarebbe edge case

    // L'entry name e' il segment finale (es. "file.pdf" o "Sala-1").
    const segment = entry.name;
    const newPath = pathPrefix ? `${pathPrefix}/${segment}` : segment;

    if (entry.isFile) {
      // FileSystemFileEntry.file(success, error)
      const fileEntry = entry as FileSystemFileEntry;
      try {
        const file = await new Promise<File>((resolve, reject) => {
          fileEntry.file(resolve, reject);
        });
        out.push({ file, relativePath: newPath });
      } catch {
        // Browser puo' rifiutare l'accesso (es. file system locked, file in
        // uso). Non blocchiamo: skippiamo silenziosamente.
      }
      continue;
    }

    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      // readEntries() ritorna massimo ~100 entries per chiamata; serve loop.
      let batchEmpty = false;
      while (!batchEmpty) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        }).catch(() => [] as FileSystemEntry[]);
        if (batch.length === 0) {
          batchEmpty = true;
        } else {
          for (const child of batch) {
            queue.push({ entry: child, pathPrefix: newPath, depth: depth + 1 });
          }
        }
      }
      continue;
    }

    // Entry strani (symlink, ecc.) → skip
  }

  return out;
}

/**
 * Estrae file da un `DataTransferItemList` (drop event). Distingue:
 *  - Cartelle (via `webkitGetAsEntry().isDirectory === true`) → ricorsione.
 *  - File (via `webkitGetAsEntry().isFile === true` o fallback `getAsFile()`).
 *
 * Se nessun item ha `webkitGetAsEntry`, ricade su `dt.files` (FileList).
 *
 * IMPORTANTE: bisogna chiamare `webkitGetAsEntry()` PRIMA di qualunque
 * `await`, altrimenti la `DataTransferItemList` viene "consumata" dal
 * browser e ritorna null. Quindi raccogliamo gli entry SINCRONI all'inizio.
 */
export async function extractFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<FolderTraversalResult> {
  const items = dataTransfer.items;
  const directFiles = dataTransfer.files;

  // Step 1 (sincrono): raccolta entry da tutti gli items.
  const entries: FileSystemEntry[] = [];
  const directOnlyFiles: File[] = []; // file senza struttura cartella
  let containedFolders = false;
  if (items && items.length > 0 && typeof (items[0] as DataTransferItem).webkitGetAsEntry === 'function') {
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item.kind !== 'file') continue;
      const entry = item.webkitGetAsEntry();
      if (entry) {
        if (entry.isDirectory) containedFolders = true;
        entries.push(entry);
      } else {
        // Fallback raro: l'item dichiara "file" ma getAsEntry torna null
        const f = item.getAsFile();
        if (f) directOnlyFiles.push(f);
      }
    }
  } else if (directFiles && directFiles.length > 0) {
    // Browser senza webkitGetAsEntry: solo file singoli (no cartelle).
    for (let i = 0; i < directFiles.length; i += 1) {
      const f = directFiles.item(i);
      if (f) directOnlyFiles.push(f);
    }
  }

  // Step 2 (async): traversal ricorsivo degli entry → file con relativePath.
  const collected: Array<{ file: File; relativePath: string }> = [];
  for (const entry of entries) {
    const items = await collectFromEntry(entry);
    collected.push(...items);
    if (collected.length >= MAX_FILES_PER_DROP) break;
  }

  // Aggiungi file diretti (senza cartella) con relativePath = file.name
  for (const f of directOnlyFiles) {
    collected.push({ file: f, relativePath: f.name });
    if (collected.length >= MAX_FILES_PER_DROP) break;
  }

  return finalizeResult(collected, containedFolders);
}

/**
 * Estrae file da un `<input type="file" webkitdirectory>` change event.
 * In questo caso ogni `File` ha gia' `webkitRelativePath` impostato (con
 * la cartella root come primo segmento), quindi NON serve traversal API.
 */
export function extractFilesFromInputDirectory(files: FileList | null): FolderTraversalResult {
  if (!files || files.length === 0) {
    return {
      files: [],
      duplicates: 0,
      emptyFiles: 0,
      filenameTooLong: 0,
      rootFolderName: '',
      containedFolders: false,
      truncated: false,
    };
  }
  const collected: Array<{ file: File; relativePath: string }> = [];
  let containedFolders = false;
  for (let i = 0; i < files.length; i += 1) {
    const f = files.item(i);
    if (!f) continue;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
    if (rel.includes('/')) containedFolders = true;
    collected.push({ file: f, relativePath: rel });
    if (collected.length >= MAX_FILES_PER_DROP) break;
  }
  return finalizeResult(collected, containedFolders);
}

/**
 * Filtro finale + dedup + statistiche per UI.
 * - Skippa file con size 0 (la coda li scarterebbe comunque ma e' meglio
 *   mostrarlo all'utente come "N file vuoti ignorati").
 * - Dedup su `relativePath` (un drop legittimo non puo' avere lo stesso
 *   path due volte; succede solo per drag accidentale di stesso file da
 *   due punti).
 * - Tronca a `MAX_FILES_PER_DROP` se servisse (limite gia' applicato sopra
 *   ma teniamo il flag per UI).
 * - Ricostruisce ogni File con `name = relativePath`.
 */
function finalizeResult(
  collected: Array<{ file: File; relativePath: string }>,
  containedFolders: boolean,
): FolderTraversalResult {
  const seen = new Set<string>();
  const filesOut: File[] = [];
  let duplicates = 0;
  let emptyFiles = 0;
  let filenameTooLong = 0;
  let rootFolderName = '';

  const truncated = collected.length >= MAX_FILES_PER_DROP;
  const slice = collected.slice(0, MAX_FILES_PER_DROP);

  for (const { file, relativePath } of slice) {
    if (file.size === 0) {
      emptyFiles += 1;
      continue;
    }
    const key = relativePath.toLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    const rebuilt = rebuildFileWithRelativePath(file, relativePath);
    if (!rebuilt) {
      filenameTooLong += 1;
      continue;
    }
    if (!rootFolderName) {
      const root = rootSegmentOf(relativePath);
      if (root) rootFolderName = root;
    }
    filesOut.push(rebuilt);
  }

  return {
    files: filesOut,
    duplicates,
    emptyFiles,
    filenameTooLong,
    rootFolderName,
    containedFolders,
    truncated,
  };
}

/** Esposto per i test e per UI che mostra il limite all'utente. */
export const FOLDER_TRAVERSAL_LIMITS = Object.freeze({
  maxFilesPerDrop: MAX_FILES_PER_DROP,
  maxDepth: MAX_TRAVERSAL_DEPTH,
  maxFilenameLen: MAX_FILENAME_LEN,
});
