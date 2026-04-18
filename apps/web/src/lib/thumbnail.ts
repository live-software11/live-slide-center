/**
 * Sprint T-3-E (G10) — Wrapper di alto livello per thumbnail di file
 * presentazione. Orchestra:
 *
 *  - signed URL Storage (300s, riusato finche' non scade)
 *  - download del file (range parziale per pptx, completo per pdf)
 *  - dispatch su PDF (`pdf.js`) o PPTX (`thumbnail.jpeg` embedded)
 *  - cache LRU dei blob URL per `versionId`
 *
 * Decisione cache: chiavata su `versionId`, non su `presentationId`. Cosi'
 * upload di una nuova versione invalida automaticamente il vecchio thumb
 * (il nuovo versionId e' diverso).
 *
 * I blob URL vengono revocati quando un'entry viene espulsa dalla cache LRU
 * o quando l'utente chiama `clearThumbnailCache()` (utile per logout).
 */

import { LRUCache } from './lru-cache';
import { renderFirstPagePngBlob } from './thumbnail-pdf';
import { extractPptxThumbnailBlob } from './thumbnail-pptx';
import { createVersionPreviewUrl } from '@/features/presentations/repository';

const CACHE_CAPACITY = 32;
const FETCH_TIMEOUT_MS = 20_000;

interface CacheEntry {
  versionId: string;
  blobUrl: string;
  /** Per i futuri controlli di invalidazione: salviamo il timestamp. */
  createdAt: number;
}

class ThumbnailCache extends LRUCache<string, CacheEntry> {
  override set(key: string, value: CacheEntry): void {
    // Se sostituiamo un'entry esistente, prima revochiamo il vecchio URL
    // per non leakare RAM (ogni blob URL trattiene il blob in memoria).
    const existing = this.get(key);
    if (existing && existing.blobUrl !== value.blobUrl) {
      try { URL.revokeObjectURL(existing.blobUrl); } catch { /* ignore */ }
    }
    super.set(key, value);
  }

  override delete(key: string): boolean {
    const existing = this.get(key);
    if (existing) {
      try { URL.revokeObjectURL(existing.blobUrl); } catch { /* ignore */ }
    }
    return super.delete(key);
  }

  override clear(): void {
    // Revoca tutti i blob URL prima di svuotare la mappa, altrimenti i
    // blob restano in RAM finche' il GC non li raccoglie (puo' richiedere
    // minuti su Chrome).
    for (const entry of this.values()) {
      try { URL.revokeObjectURL(entry.blobUrl); } catch { /* ignore */ }
    }
    super.clear();
  }
}

// Singleton lato modulo: vive per tutta la sessione browser.
const cache = new ThumbnailCache(CACHE_CAPACITY);

// Inflight: dedup chiamate concorrenti per lo stesso versionId.
const inFlight = new Map<string, Promise<string | null>>();

interface RequestParams {
  versionId: string;
  storageKey: string;
  mimeType: string | null;
  fileName: string;
  signal?: AbortSignal;
}

export interface ThumbnailResult {
  /** URL blob: pronto da usare in `<img src>`. */
  url: string | null;
  /** Se il thumbnail non e' stato generato, motivo per la UI. */
  reason?: 'unsupported' | 'fetch_failed' | 'render_failed' | 'aborted';
}

/**
 * Restituisce un blob URL del thumbnail per la version richiesta.
 * Cache hit → ritorno immediato.
 * Cache miss → fetch + decode + cache + ritorno.
 */
export async function getThumbnailFor(params: RequestParams): Promise<ThumbnailResult> {
  const { versionId, storageKey, mimeType, fileName, signal } = params;

  if (signal?.aborted) return { url: null, reason: 'aborted' };

  const cached = cache.get(versionId);
  if (cached) return { url: cached.blobUrl };

  // Pattern: tipo file supportato?
  const kind = detectKind(mimeType, fileName);
  if (kind === 'unsupported') return { url: null, reason: 'unsupported' };

  // Dedup concorrenti: se un'altra chiamata sta gia' generando lo stesso
  // thumbnail, attacchiamoci alla sua promise.
  const existing = inFlight.get(versionId);
  if (existing) {
    const url = await existing;
    if (signal?.aborted) return { url: null, reason: 'aborted' };
    return url ? { url } : { url: null, reason: 'render_failed' };
  }

  const promise = (async (): Promise<string | null> => {
    try {
      // 1) Signed URL.
      const signedUrl = await createVersionPreviewUrl(storageKey).catch(() => null);
      if (!signedUrl) return null;

      // 2) Fetch con timeout.
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);
      let buffer: ArrayBuffer | null = null;
      try {
        const res = await fetch(signedUrl, { signal: controller.signal });
        if (!res.ok) return null;
        buffer = await res.arrayBuffer();
      } finally {
        window.clearTimeout(timer);
      }

      if (signal?.aborted) return null;
      if (!buffer || buffer.byteLength === 0) return null;

      // 3) Dispatch generatore.
      let blob: Blob | null = null;
      if (kind === 'pdf') {
        blob = await renderFirstPagePngBlob(buffer, { signal, targetWidth: 320 });
      } else if (kind === 'pptx') {
        blob = await extractPptxThumbnailBlob(buffer, { signal });
      }

      if (!blob) return null;
      if (signal?.aborted) return null;

      const blobUrl = URL.createObjectURL(blob);
      cache.set(versionId, { versionId, blobUrl, createdAt: Date.now() });
      return blobUrl;
    } catch {
      return null;
    }
  })();

  inFlight.set(versionId, promise);
  try {
    const url = await promise;
    if (signal?.aborted) return { url: null, reason: 'aborted' };
    if (!url) return { url: null, reason: 'render_failed' };
    return { url };
  } finally {
    inFlight.delete(versionId);
  }
}

/**
 * Cancella tutti i thumbnail in cache. Da chiamare a logout o cambio tenant.
 */
export function clearThumbnailCache(): void {
  cache.clear();
}

type Kind = 'pdf' | 'pptx' | 'unsupported';

function detectKind(mimeType: string | null, fileName: string): Kind {
  const m = (mimeType ?? '').toLowerCase();
  const lower = fileName.toLowerCase();
  if (m === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    m === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    lower.endsWith('.pptx')
  ) {
    return 'pptx';
  }
  return 'unsupported';
}
