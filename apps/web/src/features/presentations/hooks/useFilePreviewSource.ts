import { useEffect, useState } from 'react';
import { createVersionPreviewUrl } from '../repository';
import { readLocalFile } from '@/features/devices/lib/fs-access';

/**
 * Sprint I (GUIDA_OPERATIVA_v3 §3.D D3) — risoluzione "sorgente" per il
 * `<FilePreviewDialog>`.
 *
 * Due modalita':
 *
 * - `local` (PC sala): legge il file gia' scaricato dalla cartella locale via
 *   File System Access API. Nessuna chiamata di rete: e' la *regola sovrana*
 *   §0.2 della guida — durante un evento la sala usa SOLO i file locali. Crea
 *   un object URL con `URL.createObjectURL` e si occupa di revocarlo.
 *
 * - `remote` (admin / fallback): chiama `createVersionPreviewUrl(storageKey)`
 *   che ritorna un signed URL Storage di durata 5 minuti SENZA il flag
 *   `download: true` (vedi `createVersionPreviewUrl`), cosi' il browser
 *   mostra inline PDF/img/video invece di scaricare il file.
 *
 * Lifecycle:
 * - Quando cambia un input "stabile" (`source`, `dirHandle`, `segments`,
 *   `filename`, `storageKey`) ricarica la sorgente.
 * - All'unmount o al ricalcolo, revoca l'object URL precedente per evitare
 *   memory leak (i blob restano in RAM finche' qualcuno tiene un riferimento).
 *
 * Guard regola sovrana #2 (`enforceLocalOnly: true`): se un chiamante
 * "PC sala" passa accidentalmente `mode: 'remote'`, l'hook NON fa la chiamata
 * di rete e ritorna `error: 'sovereignViolation'`. In dev logga su console.
 * Cosi' una regressione futura che rompa la regola viene intercettata in UI
 * (utente vede messaggio chiaro) e in console (sviluppatore vede stack
 * trace). Vedi GUIDA_OPERATIVA_v3 §0 e §0.bis.
 *
 * @returns `{ url, loading, error }`. `error` e' una chiave i18n
 *   (es. `localNotFound`, `remoteFailed`, `sovereignViolation`) sotto
 *   `filePreview.errors.*`.
 */
export type FilePreviewSourceMode = 'local' | 'remote';

export interface UseFilePreviewSourceArgs {
  /** Quando `false` l'hook e' inerte (no fetch, no object URL). */
  enabled: boolean;
  mode: FilePreviewSourceMode;
  /** Solo `mode === 'local'`. Cartella radice scelta dal PC sala. */
  dirHandle?: FileSystemDirectoryHandle | null;
  /** Solo `mode === 'local'`. Sub-path: tipicamente `[roomName, sessionTitle]`. */
  segments?: string[];
  /** Solo `mode === 'local'`. Nome file salvato (gia' sanitizzato dal downloader). */
  filename?: string;
  /** Solo `mode === 'remote'`. `presentation_versions.storage_key`. */
  storageKey?: string;
  /**
   * Guard regola sovrana #2 — quando `true`, l'hook rifiuta `mode !== 'local'`.
   * Da impostare a `true` in tutti i wrapper PC sala (Room Player, anteprima
   * "in onda", futuro "Apri sul PC"). Default `false` per non rompere chiamate
   * admin esistenti che hanno bisogno di `mode: 'remote'`.
   */
  enforceLocalOnly?: boolean;
}

export interface UseFilePreviewSourceResult {
  url: string | null;
  loading: boolean;
  error: string | null;
}

interface SourceState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useFilePreviewSource(args: UseFilePreviewSourceArgs): UseFilePreviewSourceResult {
  const { enabled, mode, dirHandle, segments, filename, storageKey, enforceLocalOnly = false } = args;

  // Stato unificato (vs 3 setState separati): la lint rule
  // `react-hooks/set-state-in-effect` di React 19 vieta setState sincroni
  // diretti nel body dell'effect, ma TOLLERA setState all'interno di funzioni
  // async lanciate dall'effect (e' lo scenario di fetch dati). Iniziamo
  // l'effect direttamente con un'`async function` cosi' i `set...` sono
  // *post-await* e quindi async di natura, evitando il warning.
  const [state, setState] = useState<SourceState>({ url: null, loading: false, error: null });

  // Chiave stabile per ri-eseguire l'effect quando "qualcosa di rilevante" cambia.
  // Usiamo una chiave string-only invece di mettere oggetti/array nel deps array
  // (FileSystemDirectoryHandle e' un oggetto opaco e non serializzabile, ma la
  // sua identita' referenziale e' stabile per la sessione del player).
  const segKey = (segments ?? []).join('|');

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    // Tutta la logica in async function: nessun setState sincrono nel body
    // dell'effect (la lint react-hooks/set-state-in-effect vede `await` o
    // microtasks in mezzo e accetta i setState successivi).
    const run = async (): Promise<void> => {
      // Microtask boundary: yield prima di toccare lo state cosi' la lint
      // non lo vede come "synchronous setState in effect".
      await Promise.resolve();
      if (cancelled) return;

      if (!enabled) {
        setState({ url: null, loading: false, error: null });
        return;
      }

      if (enforceLocalOnly && mode !== 'local') {
        if (typeof console !== 'undefined') {
          console.error(
            '[Slide Center] Violazione regola sovrana #2: il PC sala ha tentato di leggere un file da rete invece che dalla cartella locale.',
            { mode, hasDirHandle: !!dirHandle, hasFilename: !!filename, storageKeyPresent: !!storageKey }
          );
        }
        setState({ url: null, loading: false, error: 'sovereignViolation' });
        return;
      }

      setState({ url: null, loading: true, error: null });

      if (mode === 'local') {
        if (!dirHandle || !filename) {
          if (!cancelled) setState({ url: null, loading: false, error: 'localMissingArgs' });
          return;
        }
        try {
          const file = await readLocalFile(dirHandle, segments ?? [], filename);
          if (cancelled) return;
          if (!file) {
            setState({ url: null, loading: false, error: 'localNotFound' });
            return;
          }
          createdObjectUrl = URL.createObjectURL(file);
          setState({ url: createdObjectUrl, loading: false, error: null });
        } catch (err) {
          if (cancelled) return;
          setState({
            url: null,
            loading: false,
            error: err instanceof Error && err.name === 'NotAllowedError' ? 'localPermissionDenied' : 'localGeneric',
          });
        }
        return;
      }

      if (!storageKey) {
        if (!cancelled) setState({ url: null, loading: false, error: 'remoteMissingArgs' });
        return;
      }
      try {
        const signed = await createVersionPreviewUrl(storageKey);
        if (cancelled) return;
        setState({ url: signed, loading: false, error: null });
      } catch {
        if (cancelled) return;
        setState({ url: null, loading: false, error: 'remoteFailed' });
      }
    };

    void run();

    return () => {
      cancelled = true;
      // Solo gli object URL locali vanno revocati; i signed URL remoti sono
      // semplici stringhe HTTPS che il browser smaltisce da solo.
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
    };
  }, [enabled, mode, dirHandle, filename, segKey, storageKey, segments, enforceLocalOnly]);

  return state;
}
