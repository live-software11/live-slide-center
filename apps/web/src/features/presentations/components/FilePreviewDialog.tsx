import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Download, FileText, Loader2, Music, X } from 'lucide-react';
import { VersionBadge } from '@/features/devices/components/VersionBadge';

/**
 * Sprint I (GUIDA_OPERATIVA_v3 §3.D) — dialog full-screen riusabile per
 * l'anteprima inline di un file di una presentation.
 *
 * Riusato da:
 * - Admin (`SessionFilesPanel`): click sul nome file -> preview con signed
 *   URL Supabase Storage (creata via `createVersionPreviewUrl`).
 * - PC sala (`RoomPlayerView` / `FileSyncStatus`): bottone "Apri sul PC" sui
 *   file gia' downloadati -> preview con object URL del blob LOCALE
 *   (regola sovrana §0.2: la sala usa SOLO i file in cartella, mai cloud).
 *   Guard runtime nell'hook `useFilePreviewSource` con `enforceLocalOnly:true`
 *   protegge da regressioni future.
 *
 * Renderer per MIME:
 * - `application/pdf` -> <iframe> (compat browser migliore di <embed>).
 * - `image/*` -> <img>.
 * - `video/*` -> <video controls>.
 * - `audio/*` -> <audio controls>.
 * - altri (pptx, keynote, zip, ...) -> card fallback con icona generica e
 *   bottone "Scarica" (admin) o "Apri" (sala) — la sala non puo' aprire
 *   .pptx con app esterna dal browser cloud (limitazione web spiegata in
 *   §3.E E2 della guida); il vero launcher arriva con SLIDE CENTER Desktop.
 *
 * Sorgente:
 * - `sourceUrl: string | null` -> URL gia' pronta (signed URL o object URL).
 * - `sourceLoading: boolean` -> spinner mentre la sorgente viene preparata.
 * - `sourceError: string | null` -> messaggio i18n key se la preparazione fallisce.
 *
 * Lifecycle:
 * - Esc / click sul backdrop / X -> chiude.
 * - Niente cleanup degli object URL qui: il chiamante (hook
 *   `useFilePreviewSource`) e' responsabile di `URL.revokeObjectURL`.
 */
export interface FilePreviewDialogProps {
  open: boolean;
  onClose: () => void;
  fileName: string;
  /** MIME type "fonte di verita'": presentation_versions.mime_type. */
  mime: string;
  sourceUrl: string | null;
  sourceLoading: boolean;
  /** Chiave i18n di errore (es. `filePreview.errors.localNotFound`). */
  sourceError: string | null;
  /**
   * Azione opzionale per "Scarica" sul fallback (admin) o link diretto.
   * Se omessa, il bottone non viene mostrato.
   */
  onDownload?: () => void;
  /**
   * Sprint T-1 (G8) — info versione "in onda". Quando passato, mostra un
   * badge overlay top-right durante l'anteprima fullscreen (auto-fade 5s,
   * ricompare on mouse move / touch). Verde se la corrente e' anche la
   * piu' recente, giallo se l'admin ha riportato indietro la corrente
   * (esiste una versione piu' nuova). Mantiene `null` per i contesti admin
   * dove l'info non e' rilevante (la mostriamo solo lato PC sala).
   */
  versionInfo?: {
    number: number | null;
    total: number | null;
  } | null;
}

function pickRenderer(mime: string): 'pdf' | 'image' | 'video' | 'audio' | 'fallback' {
  const m = mime?.toLowerCase() ?? '';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'fallback';
}

export function FilePreviewDialog({
  open,
  onClose,
  fileName,
  mime,
  sourceUrl,
  sourceLoading,
  sourceError,
  onDownload,
  versionInfo,
}: FilePreviewDialogProps) {
  const { t } = useTranslation();
  // Sprint T-1 (G8): wakeKey alimenta il `<VersionBadge variant="overlay">`.
  // Ogni evento utente nel dialog (mouse move, touch, keypress) lo incrementa
  // → il badge ricompare e ricalcola il timer 5s di auto-fade. UX standard
  // dei video player web.
  const [wakeKey, setWakeKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else setWakeKey((k) => k + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const renderer = pickRenderer(mime);
  const showVersionOverlay =
    versionInfo != null && versionInfo.number != null && versionInfo.total != null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-sc-background/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('filePreview.aria', { name: fileName })}
      // Click sul backdrop chiude SOLO se il click e' sull'overlay (non sul contenuto).
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // Sprint T-1 (G8): mouse move / touch dentro il dialog "sveglia" il
      // badge versione overlay (auto-fade dopo 5s). Stesso comportamento di
      // un player video web standard.
      onMouseMove={() => setWakeKey((k) => k + 1)}
      onTouchStart={() => setWakeKey((k) => k + 1)}
    >
      {/* Header sticky */}
      <header className="flex items-center gap-3 border-b border-sc-primary/12 bg-sc-surface/90 px-4 py-3">
        <FileText className="h-4 w-4 shrink-0 text-sc-text-dim" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-sc-text" title={fileName}>
          {fileName}
        </h2>
        <span className="text-[11px] uppercase tracking-wide text-sc-text-dim">{mime || '—'}</span>
        {onDownload && (
          <button
            type="button"
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/30 bg-sc-primary/10 px-3 py-1.5 text-xs font-medium text-sc-primary hover:bg-sc-primary/20"
          >
            <Download className="h-3.5 w-3.5" />
            {t('filePreview.download')}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-sc-text-dim hover:bg-sc-elevated hover:text-sc-text"
          aria-label={t('filePreview.close')}
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      {/* Body */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {/* Sprint T-1 (G8): badge "vN/M" overlay top-right durante il
            playback. Auto-fade dopo 5s, ricompare on mouse-move/touch/keypress.
            Verde se la corrente e' anche la latest, giallo se l'admin ha
            riportato indietro la corrente (esiste una versione piu' nuova). */}
        {showVersionOverlay && (
          <div className="pointer-events-none absolute right-6 top-6 z-10 flex items-center">
            <div className="pointer-events-auto">
              <VersionBadge
                versionNumber={versionInfo!.number}
                versionTotal={versionInfo!.total}
                variant="overlay"
                wakeKey={wakeKey}
                fadeAfterMs={5_000}
              />
            </div>
          </div>
        )}
        {sourceLoading ? (
          <div className="flex flex-col items-center gap-2 text-sc-text-dim">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">{t('filePreview.loading')}</p>
          </div>
        ) : sourceError ? (
          <div className="flex max-w-md flex-col items-center gap-2 rounded-xl border border-sc-danger/30 bg-sc-danger/10 px-6 py-8 text-center">
            <AlertCircle className="h-6 w-6 text-sc-danger" />
            <p className="text-sm font-medium text-sc-danger">
              {t(`filePreview.errors.${sourceError}`, { defaultValue: t('filePreview.errors.generic') })}
            </p>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/30 bg-sc-primary/10 px-3 py-1.5 text-xs font-medium text-sc-primary hover:bg-sc-primary/20"
              >
                <Download className="h-3.5 w-3.5" />
                {t('filePreview.download')}
              </button>
            )}
          </div>
        ) : !sourceUrl ? (
          <p className="text-sm text-sc-text-dim">{t('filePreview.errors.generic')}</p>
        ) : renderer === 'pdf' ? (
          <iframe
            src={sourceUrl}
            title={fileName}
            className="h-full w-full rounded-xl border border-sc-primary/12 bg-white"
          />
        ) : renderer === 'image' ? (
          <img
            src={sourceUrl}
            alt={fileName}
            className="max-h-full max-w-full rounded-xl object-contain shadow-lg"
          />
        ) : renderer === 'video' ? (
          // controls + autoplay disattivato: l'utente decide se partire (anche
          // perche' un autoplay con audio e' bloccato dal browser su molte
          // piattaforme e darebbe l'illusione di "rotto").
          <video
            src={sourceUrl}
            controls
            className="max-h-full max-w-full rounded-xl bg-black shadow-lg"
          />
        ) : renderer === 'audio' ? (
          <div className="flex w-full max-w-md flex-col items-center gap-3 rounded-xl border border-sc-primary/12 bg-sc-surface px-6 py-8">
            <Music className="h-10 w-10 text-sc-primary" aria-hidden="true" />
            <p className="text-sm font-medium text-sc-text">{fileName}</p>
            <audio src={sourceUrl} controls className="w-full" />
          </div>
        ) : (
          <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-sc-primary/12 bg-sc-surface px-6 py-8 text-center">
            <FileText className="h-10 w-10 text-sc-text-dim" aria-hidden="true" />
            <p className="text-sm font-medium text-sc-text">{fileName}</p>
            <p className="text-xs text-sc-text-dim">{t('filePreview.unsupported.description')}</p>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-sc-primary/30 bg-sc-primary/10 px-3 py-1.5 text-xs font-medium text-sc-primary hover:bg-sc-primary/20"
              >
                <Download className="h-3.5 w-3.5" />
                {t('filePreview.unsupported.download')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
