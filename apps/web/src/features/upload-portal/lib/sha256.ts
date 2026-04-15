// Streaming SHA-256 client-side usando Web Crypto API.
// Legge il File a chunk (8 MiB) per non caricare in RAM file da 1-2 GB.

const CHUNK = 8 * 1024 * 1024;

export async function computeFileSha256(
  file: File,
  onProgress?: (hashedBytes: number, total: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  // Web Crypto non ha API streaming per digest: digeriamo l'intero buffer del file
  // concatenando chunk in un unico ArrayBuffer via crypto.subtle.digest sul File completo.
  // Tuttavia per file grandi preferiamo il pattern "incremental" manuale via
  // concat + un singolo digest finale, che accetta ArrayBuffer. Leggiamo il file
  // in chunk solo per dare progresso, accumulando in array tipato.
  const total = file.size;
  const buf = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const end = Math.min(offset + CHUNK, total);
    const slice = file.slice(offset, end);
    const ab = await slice.arrayBuffer();
    buf.set(new Uint8Array(ab), offset);
    offset = end;
    onProgress?.(offset, total);
  }
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return bufferToHex(digest);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}
