import { createVersionDownloadUrl } from '@/features/presentations/repository';

/**
 * Sprint G B4 (GUIDA_OPERATIVA_v3 §3.B4) — download bulk in ZIP lato browser.
 *
 * WHY browser-side e non server-side:
 *  - Supabase Edge Functions hanno timeout 150s e bandwidth costoso (esce
 *    dalla rete Supabase); con 50 file da 100 MB (= 5 GB) significherebbe
 *    bruciarsi un transfer al mese su un singolo download.
 *  - Lo storage Supabase emette signed URL → il browser scarica direttamente
 *    da S3-like, niente intermediario, niente costo extra. Lo zip si fa in
 *    RAM client.
 *
 * Limiti tecnici (in RAM):
 *  - JSZip carica TUTTI i blob in memoria prima di generare lo zip finale
 *    (no streaming nativo nel core; `zip.generateAsync({ streamFiles: true })`
 *    e' poco supportato cross-browser e non riduce davvero la RAM picco).
 *  - Limite pratico: ~2 GB totali per Chromium/Firefox 64-bit (oltre crashano
 *    con OOM tab); 1 GB per browser 32-bit (rari oggi).
 *  - Imponiamo `MAX_TOTAL_BYTES = 2 GB`: se la selezione supera, abort con
 *    messaggio "troppo grande, scarica meno file alla volta".
 *
 * Algoritmo:
 *  1) Pre-check: somma `fileSizeBytes`. Se > `MAX_TOTAL_BYTES` → throw.
 *  2) Per ogni file: signed URL → fetch → arrayBuffer → zip.file(name, buf).
 *     Concorrenza 3 (signed URL ha scadenza 5 min, evitiamo serial slow).
 *  3) `generateAsync({ type: 'blob', compression: 'STORE' })` perche' i file
 *     interni sono gia' compressi (pptx/pdf/jpg) → DEFLATE non riduce nulla
 *     ma costa CPU + tempo (10x piu' lento per >100MB).
 *  4) `URL.createObjectURL(blob)` + `<a download>` programmatico.
 *  5) Cleanup `URL.revokeObjectURL` dopo 30s (il download si avvia subito;
 *    revoke immediato a volte aborta in Safari).
 *
 * Errori:
 *  - `zip_too_large`: pre-check fallito.
 *  - `zip_no_files`: array vuoto.
 *  - `zip_download_failed`: una fetch fallisce (con il `versionId` nel
 *    messaggio per debugging).
 *  - Eredita errori da `createVersionDownloadUrl` (es. `signed_url_failed`).
 */

export interface ZipBulkDownloadItem {
  versionId: string;
  fileName: string;
  fileSizeBytes: number;
  storageKey: string;
}

export interface ZipBulkDownloadProgress {
  /** File completati (caricati nel zip). */
  completed: number;
  /** File totali. */
  total: number;
  /** Bytes processati cumulativi (somma sizeBytes dei completati). */
  bytesProcessed: number;
  /** Bytes totali. */
  bytesTotal: number;
  /** Phase corrente: 'fetching' | 'zipping' | 'done'. */
  phase: 'fetching' | 'zipping' | 'done';
}

export const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const FETCH_CONCURRENCY = 3;

export async function zipBulkDownload(
  items: ZipBulkDownloadItem[],
  archiveName: string,
  onProgress?: (p: ZipBulkDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (items.length === 0) throw new Error('zip_no_files');
  const bytesTotal = items.reduce((acc, it) => acc + (it.fileSizeBytes ?? 0), 0);
  if (bytesTotal > MAX_TOTAL_BYTES) throw new Error('zip_too_large');

  // Dynamic import: jszip pesa ~96KB gzipped; non lo vogliamo nel chunk
  // principale di EventDetailView (caricato anche se l'admin non scarica
  // mai un ZIP).
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  let completed = 0;
  let bytesProcessed = 0;
  const reportFetch = () => {
    onProgress?.({ completed, total: items.length, bytesProcessed, bytesTotal, phase: 'fetching' });
  };
  reportFetch();

  // Concorrenza con worker pool semplice. Niente Promise.all su tutti gli
  // items: con 50 file scatenerebbe 50 fetch in parallelo → throttle browser
  // + risk timeout signed URL.
  const queue = [...items];
  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw new Error('zip_aborted');
      const item = queue.shift();
      if (!item) return;
      let blob: Blob;
      try {
        const url = await createVersionDownloadUrl(item.storageKey);
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`zip_download_failed:${item.versionId}:${res.status}`);
        blob = await res.blob();
      } catch (err) {
        if (signal?.aborted) throw new Error('zip_aborted');
        if (err instanceof Error && err.message.startsWith('zip_')) throw err;
        throw new Error(`zip_download_failed:${item.versionId}`);
      }
      // Filename collision: due presentazioni potrebbero avere lo stesso
      // file_name (es. "slides.pptx"). Aggiungiamo prefisso versionId-short.
      const safeName = ensureUnique(zip, item.fileName, item.versionId);
      zip.file(safeName, blob);
      completed += 1;
      bytesProcessed += item.fileSizeBytes ?? 0;
      reportFetch();
    }
  });
  await Promise.all(workers);

  onProgress?.({ completed, total: items.length, bytesProcessed, bytesTotal, phase: 'zipping' });

  // STORE = no compression. PPTX/PDF/JPG sono gia' compressi; DEFLATE
  // sprecherebbe CPU per riduzioni <1%.
  const archive = await zip.generateAsync({ type: 'blob', compression: 'STORE' });

  // Trigger download programmatico. Niente librerie file-saver: il pattern
  // `<a download>` e' supportato da tutti i browser moderni.
  const url = URL.createObjectURL(archive);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeArchiveName(archiveName);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Safari cleanup tardivo: 30s di delay e' overkill ma sicuro.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);

  onProgress?.({ completed, total: items.length, bytesProcessed, bytesTotal, phase: 'done' });
}

/**
 * Se `zip` ha gia' un file con lo stesso nome, prefissalo con i primi 8
 * char dell'id versione per distinguerlo. Idempotente.
 */
function ensureUnique(
  zip: { files: Record<string, unknown> },
  fileName: string,
  versionId: string,
): string {
  if (!zip.files[fileName]) return fileName;
  const dot = fileName.lastIndexOf('.');
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : '';
  const short = versionId.replace(/-/g, '').slice(0, 8);
  return `${stem}__${short}${ext}`;
}

function sanitizeArchiveName(name: string): string {
  // Rimuove caratteri proibiti su Windows + spazi multipli.
  // I control char \x00-\x1F sono illegali nei filename NTFS/exFAT, quindi
  // l'eslint disable e' intenzionale qui.
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  const safe = cleaned.length > 0 ? cleaned : 'slide-center-bundle';
  return safe.endsWith('.zip') ? safe : `${safe}.zip`;
}
