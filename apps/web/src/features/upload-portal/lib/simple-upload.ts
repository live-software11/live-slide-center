// Sprint X-1 (19 aprile 2026, parita' UX desktop): wrapper di upload non-TUS
// per il backend Rust embedded della build DESKTOP.
//
// PROBLEMA: la SPA usava SEMPRE `startTusUpload` (Sprint base) che colpisce
// `${backendUrl}/storage/v1/upload/resumable` (protocollo TUS Resumable di
// Supabase Storage). Il server Rust desktop (`apps/desktop/src-tauri/src/
// server/routes/storage_routes.rs`) NON implementa TUS — espone solo il
// classico `POST /storage/v1/object/{bucket}/{*key}` con body=bytes.
// Risultato: in modalita' desktop ogni upload falliva con 404 dopo l'init,
// la `presentation_versions` veniva creata in stato 'uploading' e poi
// cancellata da `abort_upload_version_admin`, l'utente vedeva "errore di
// rete" senza file in lista. Esperienza ROTTA rispetto al cloud.
//
// SOLUZIONE: in desktop facciamo un singolo POST chunked con `XMLHttpRequest`
// (per avere il callback nativo `upload.onprogress`) verso l'endpoint Rust.
// In cloud restiamo su TUS resumable (necessario per upload >100 MB su
// connessioni instabili in produzione live).
//
// La discriminazione mode (cloud vs desktop) avviene nel CHIAMANTE
// (`useUploadQueue.ts` + `AdminUploaderInline.tsx`), non qui dentro: cosi'
// questo modulo resta una primitive facile da testare in isolamento.

export interface SimpleUploadOptions {
  /** URL base del backend Rust (es. `http://127.0.0.1:7300`). */
  baseUrl: string;
  /** Admin token desktop (UUID v4) — usato come Bearer + apikey. */
  adminToken: string;
  /** Nome bucket (sempre `presentations` per i flussi attuali). */
  bucket: string;
  /** Storage key restituita dalla RPC `init_upload_*` (path sotto bucket). */
  objectName: string;
  file: File;
  onProgress: (uploaded: number, total: number) => void;
  onSuccess: () => void;
  onError: (err: Error) => void;
}

export interface SimpleUploadHandle {
  abort(): void;
}

export function startSimpleUpload(opts: SimpleUploadOptions): SimpleUploadHandle {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  // L'endpoint Rust e' `POST /storage/v1/object/{bucket}/{*key}`. Il `*key`
  // accetta segmenti con `/` quindi NON dobbiamo encodeURIComponent il path
  // intero (perderemmo gli slash della gerarchia). Encodiamo solo i singoli
  // segmenti preservando i separatori, esattamente come fa Supabase Storage.
  const safeKey = opts.objectName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const url = `${opts.baseUrl.replace(/\/$/, '')}/storage/v1/object/${encodeURIComponent(opts.bucket)}/${safeKey}`;

  xhr.open('POST', url, true);
  xhr.setRequestHeader('Authorization', `Bearer ${opts.adminToken}`);
  xhr.setRequestHeader('apikey', opts.adminToken);
  xhr.setRequestHeader(
    'Content-Type',
    opts.file.type || 'application/octet-stream',
  );
  xhr.setRequestHeader('x-upsert', 'true');

  xhr.upload.onprogress = (ev) => {
    if (aborted) return;
    if (ev.lengthComputable) {
      opts.onProgress(ev.loaded, ev.total);
    } else {
      // Server senza Content-Length: stimiamo dal file size totale.
      opts.onProgress(ev.loaded, opts.file.size);
    }
  };

  xhr.onload = () => {
    if (aborted) return;
    if (xhr.status >= 200 && xhr.status < 300) {
      // Force progress al 100% per UI consistency anche se l'ultimo chunk
      // non ha triggerato `onprogress` (XHR puo' essere "lossy" sull'ultimo
      // evento prima del `load`).
      opts.onProgress(opts.file.size, opts.file.size);
      opts.onSuccess();
      return;
    }
    let serverMessage = '';
    try {
      serverMessage = xhr.responseText || '';
    } catch {
      serverMessage = '';
    }
    opts.onError(
      new Error(
        `simple_upload_http_${xhr.status}: ${serverMessage.slice(0, 200) || xhr.statusText}`,
      ),
    );
  };

  xhr.onerror = () => {
    if (aborted) return;
    opts.onError(new Error('simple_upload_network_error'));
  };

  xhr.ontimeout = () => {
    if (aborted) return;
    opts.onError(new Error('simple_upload_timeout'));
  };

  xhr.onabort = () => {
    // Aborti volontari NON triggerano onError (consistente con tus-js-client).
    aborted = true;
  };

  // Niente timeout esplicito: in desktop l'upload va su localhost (~ms) ma
  // l'utente potrebbe selezionare un file da 5 GB su HDD lento. Lasciamo
  // illimitato e affidiamoci al cancel manuale.

  xhr.send(opts.file);

  return {
    abort() {
      aborted = true;
      try {
        xhr.abort();
      } catch {
        // gia' completato o gia' abortito: noop.
      }
    },
  };
}
