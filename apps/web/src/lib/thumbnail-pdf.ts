/**
 * Sprint T-3-E (G10) — Generatore thumbnail prima pagina di un PDF.
 *
 * pdfjs-dist e' importato dinamicamente (lazy) per due motivi:
 *  1. Bundle splitting: il chunk pdf.js (~300 KB gzip) entra solo quando
 *     l'admin apre EventDetailView e c'e' davvero un file PDF da preview.
 *     I PC sala (auto-deploy in produzione) non lo scaricano mai perche'
 *     RoomPlayerView non monta NextUpPreview.
 *  2. Worker config: pdfjs richiede `GlobalWorkerOptions.workerSrc`
 *     impostato prima del primo `getDocument`. Lo facciamo una sola volta
 *     a livello di modulo, con ?url di Vite per ottenere l'URL hashata
 *     del file worker.
 *
 * Renderizziamo la pagina su un OffscreenCanvas (o canvas DOM in fallback)
 * a un DPR contenuto (1.5) per avere un thumbnail nitido senza esagerare
 * con i pixel: la card di destinazione e' ~240x135 px, qualunque cosa
 * sopra 480x270 e' uno spreco di RAM.
 */

// `pdfjs-dist` 5.x espone tipi solo dal sottopath `types/`. Per evitare
// di importarli in modo statico (e quindi forzare la presenza del package
// nel bundle) tipizziamo localmente solo i pezzi che ci servono.
type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: {
    canvasContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }) => { promise: Promise<void> };
  cleanup: () => void;
};

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<PdfPage>;
  destroy: () => Promise<void>;
};

type PdfModule = {
  getDocument: (params: {
    data: ArrayBuffer;
    disableAutoFetch?: boolean;
    disableStream?: boolean;
  }) => { promise: Promise<PdfDoc> };
  GlobalWorkerOptions: { workerSrc: string };
};

let pdfModulePromise: Promise<PdfModule> | null = null;

function loadPdfJs(): Promise<PdfModule> {
  if (pdfModulePromise) return pdfModulePromise;
  // Vite: importiamo il worker come URL hashato. `pdfjs-dist` >= 4 esporta
  // `pdf.worker.min.mjs` come ES module (no CJS shim necessario).
  pdfModulePromise = (async () => {
    const [pdfModuleRaw, workerUrlModule] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    const pdfModule = pdfModuleRaw as unknown as PdfModule;
    pdfModule.GlobalWorkerOptions.workerSrc = (workerUrlModule as { default: string }).default;
    return pdfModule;
  })().catch((err) => {
    pdfModulePromise = null;
    throw err;
  });
  return pdfModulePromise;
}

interface RenderOptions {
  /** Larghezza target del thumbnail in CSS px. Default 240. */
  targetWidth?: number;
  /** AbortSignal opzionale per cancellare il rendering. */
  signal?: AbortSignal;
}

/**
 * Renderizza la prima pagina del PDF in un blob PNG. Restituisce `null` se
 * il PDF non e' valido o l'operazione viene annullata. Non lancia eccezioni
 * sui PDF malformati: e' un best-effort.
 */
export async function renderFirstPagePngBlob(
  pdfBytes: ArrayBuffer,
  options: RenderOptions = {},
): Promise<Blob | null> {
  const { targetWidth = 240, signal } = options;
  if (signal?.aborted) return null;

  let doc: PdfDoc | null = null;
  let page: PdfPage | null = null;

  try {
    const pdf = await loadPdfJs();
    if (signal?.aborted) return null;

    // disableAutoFetch + disableStream: stiamo passando un buffer in-memory
    // gia' completo, non vogliamo che pdfjs tenti di fare fetch streaming.
    doc = await pdf.getDocument({ data: pdfBytes, disableAutoFetch: true, disableStream: true }).promise;
    if (signal?.aborted) return null;
    if (doc.numPages < 1) return null;

    page = await doc.getPage(1);
    if (signal?.aborted) return null;

    // Calcoliamo lo scale per arrivare a `targetWidth` CSS px.
    const naturalViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / naturalViewport.width;
    const viewport = page.getViewport({ scale });

    // OffscreenCanvas dove disponibile (Chromium, Firefox 105+); altrimenti
    // fallback su canvas DOM detached.
    let blob: Blob | null = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (signal?.aborted) return null;
      blob = await canvas.convertToBlob({ type: 'image/png' });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (signal?.aborted) return null;
      blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });
    }

    return blob;
  } catch {
    // Best-effort: il chiamante decide come degradare la UI.
    return null;
  } finally {
    try {
      page?.cleanup();
    } catch {
      /* ignora */
    }
    try {
      await doc?.destroy();
    } catch {
      /* ignora */
    }
  }
}
