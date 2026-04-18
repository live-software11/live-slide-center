/**
 * Sprint T-3-E (G10) — Estrazione thumbnail embedded in un .pptx.
 *
 * Ogni file Office Open XML (.pptx, .xlsx, .docx) contiene un thumbnail
 * JPEG generato da PowerPoint/Keynote/LibreOffice al momento del salvataggio.
 * E' tipicamente alla path `docProps/thumbnail.jpeg` (o `.jpg`).
 *
 * Per i .pptx il thumbnail rappresenta SEMPRE la prima slide: e' esattamente
 * cio' che ci serve per il pannello Next-Up. Niente bisogno di pdf.js o
 * conversione server-side.
 *
 * Limitazioni:
 *  - se il file e' stato esportato senza thumbnail (rara opzione "salva
 *    senza miniatura"), restituiamo `null` e il chiamante mostra un
 *    placeholder.
 *  - JSZip lavora interamente in memoria: limitiamo l'input a `MAX_BYTES`
 *    per evitare di soffocare il browser con .pptx multi-GB.
 */

import JSZip from 'jszip';

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB: oltre, skip.

interface ExtractOptions {
  signal?: AbortSignal;
}

/**
 * Cerca il thumbnail embedded e lo restituisce come `Blob`. Best-effort:
 * non lancia eccezioni, restituisce `null` in caso di file non valido,
 * mancanza del thumbnail o operazione annullata.
 */
export async function extractPptxThumbnailBlob(
  pptxBytes: ArrayBuffer,
  options: ExtractOptions = {},
): Promise<Blob | null> {
  const { signal } = options;
  if (signal?.aborted) return null;
  if (pptxBytes.byteLength > MAX_BYTES) return null;

  try {
    const zip = await JSZip.loadAsync(pptxBytes);
    if (signal?.aborted) return null;

    // Le path conosciute, in ordine di probabilita'. Office le scrive in
    // lowercase ma alcuni esportatori (Keynote) usano `.jpg`.
    const candidates = [
      'docProps/thumbnail.jpeg',
      'docProps/thumbnail.jpg',
      'docProps/thumbnail.png',
    ];

    for (const candidate of candidates) {
      const file = zip.file(candidate);
      if (!file) continue;
      const blob = await file.async('blob');
      if (signal?.aborted) return null;
      // JSZip restituisce un Blob senza MIME type esplicito: lo settiamo noi
      // basandoci sull'estensione, cosi' <img src> lo decodifica correttamente.
      const mime = candidate.endsWith('.png') ? 'image/png' : 'image/jpeg';
      return new Blob([blob], { type: mime });
    }

    return null;
  } catch {
    return null;
  }
}
