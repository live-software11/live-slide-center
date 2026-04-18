import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, FileText, ImageOff, Loader2 } from 'lucide-react';
import { useNextUp } from '@/features/devices/hooks/useNextUp';
import { getThumbnailFor, type ThumbnailResult } from '@/lib/thumbnail';
import type { NextUpFile } from '@/features/presentations/repository';

/**
 * Sprint T-3-E (G10) — pannello "Prossimo file" sul PC tecnico/admin.
 *
 * Architettura del componente (vedi §0.21 STATO_E_TODO.md):
 *  1. `useNextUp(roomId)` ottiene il file in onda e quello successivo nella
 *     scaletta della sessione attiva. Polling 30s + trigger esterno
 *     (`versionTrigger`) per refetch immediato al cambio file in sala.
 *  2. Per ogni file rilevante (`next`) chiediamo il thumbnail asincrono via
 *     `getThumbnailFor()` (PDF: prima slide via pdf.js; PPTX: thumbnail.jpeg
 *     embedded; altri formati: placeholder generico). I blob URL sono in
 *     cache LRU in-memory: tab persistenti non rifanno il lavoro.
 *
 * Mostriamo SOLO il "next" (non il "current"): il file in onda e' gia'
 * comunicato dal `NowPlayingBadge` accanto. La card "Prossimo" e' la
 * vera novita' dello sprint: anticipa di un passo la regia per ridurre
 * sorprese all'inizio del file successivo.
 *
 * Quando NON renderizziamo nulla:
 *  - `enabled = false` (room senza sessione attiva).
 *  - `data.next` e' null (file in onda e' l'ultimo della scaletta o
 *    nessun file pronto in sessione).
 *  - errore di fetch (silenzioso lato UI: la dashboard rimane utile,
 *    Sentry catturera' l'eccezione lato repository).
 */
interface NextUpPreviewProps {
  roomId: string;
  /** Disattiva polling/fetch quando la room non ha sessione attiva. */
  enabled: boolean;
  /**
   * Quando questo valore cambia, useNextUp forza un refetch immediato.
   * Tipicamente `room_state.current_presentation_id` cosi' al cambio file
   * in sala il pannello scopre subito il nuovo "next".
   */
  versionTrigger?: string | number | null;
}

export function NextUpPreview({ roomId, enabled, versionTrigger = null }: NextUpPreviewProps) {
  const { data, loading } = useNextUp({ roomId, enabled, versionTrigger });

  if (!enabled) return null;
  if (loading && !data) return null; // Niente skeleton: stiamo evitando rumore visivo finche' non sappiamo se mostrare.
  if (!data?.next) return null;

  return <NextFileCard file={data.next} />;
}

interface NextFileCardProps {
  file: NextUpFile;
}

function NextFileCard({ file }: NextFileCardProps) {
  const { t } = useTranslation();
  // Tupla `[versionId, result]`: il render usa la coppia per evitare di
  // mostrare il thumbnail del file PRECEDENTE quando l'utente passa a un
  // nuovo file. Se `loaded.versionId !== file.versionId` la card sa che il
  // valore corrente non e' aggiornato e mostra lo spinner di caricamento.
  // Pattern privo di setState sincrono dentro l'effect (rules-of-hooks
  // friendly).
  const [loaded, setLoaded] = useState<{ versionId: string; result: ThumbnailResult } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const res = await getThumbnailFor({
        versionId: file.versionId,
        storageKey: file.storageKey,
        mimeType: file.mimeType,
        fileName: file.fileName,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setLoaded({ versionId: file.versionId, result: res });
      }
    })();
    return () => controller.abort();
  }, [file.versionId, file.storageKey, file.mimeType, file.fileName]);

  const thumb: ThumbnailResult | null = loaded && loaded.versionId === file.versionId ? loaded.result : null;

  return (
    <div
      className="mt-1 flex items-center gap-2 rounded-lg border border-sc-primary/25 bg-sc-primary/5 px-2 py-1.5 text-[11px] text-sc-text"
      title={t('roomPlayer.nextUp.aria', { name: file.fileName })}
    >
      <ThumbnailBox thumb={thumb} fileName={file.fileName} />
      <ChevronRight className="h-3 w-3 shrink-0 text-sc-primary/60" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold uppercase tracking-wide text-sc-primary">
            {t('roomPlayer.nextUp.label')}
          </span>
          <span className="shrink-0 text-sc-text-dim">
            {t('roomPlayer.nextUp.position', {
              n: file.positionInSession,
              total: file.totalInSession,
            })}
          </span>
        </div>
        <span className="truncate font-medium" title={file.fileName}>
          {file.fileName}
        </span>
        {file.speakerName ? (
          <span className="truncate text-sc-text-dim" title={file.speakerName}>
            {file.speakerName}
          </span>
        ) : null}
      </div>
    </div>
  );
}

interface ThumbnailBoxProps {
  thumb: ThumbnailResult | null;
  fileName: string;
}

/**
 * Box thumbnail 56x32 (16:9 a piccola scala) con quattro stati visivi:
 *  - loading: spinner muted.
 *  - ok (PDF/PPTX risolto): <img> con object-cover.
 *  - unsupported / render_failed: icona file generica.
 *  - aborted: niente (transitorio).
 */
function ThumbnailBox({ thumb, fileName }: ThumbnailBoxProps) {
  const { t } = useTranslation();
  // Loading iniziale (thumb === null) e dopo il primo set, per evitare
  // flicker stati intermedi.
  if (thumb === null) {
    return (
      <div
        className="flex h-8 w-14 shrink-0 items-center justify-center rounded border border-sc-primary/20 bg-sc-elevated"
        aria-label={t('roomPlayer.nextUp.thumbLoading')}
        title={t('roomPlayer.nextUp.thumbLoading')}
      >
        <Loader2 className="h-3 w-3 animate-spin text-sc-text-dim" aria-hidden="true" />
      </div>
    );
  }

  if (thumb.url) {
    return (
      <img
        src={thumb.url}
        alt=""
        className="h-8 w-14 shrink-0 rounded border border-sc-primary/20 bg-sc-elevated object-cover"
        loading="lazy"
        decoding="async"
      />
    );
  }

  // Sia 'unsupported' che 'render_failed' → fallback iconato. Distinguiamo
  // la tipologia di icona/title perche' 'unsupported' e' permanente, mentre
  // 'render_failed' suggerisce di riprovare al prossimo polling.
  const isUnsupported = thumb.reason === 'unsupported';
  const Icon = isUnsupported ? FileText : ImageOff;
  const titleKey = isUnsupported
    ? 'roomPlayer.nextUp.thumbUnsupported'
    : 'roomPlayer.nextUp.thumbFailed';

  return (
    <div
      className="flex h-8 w-14 shrink-0 items-center justify-center rounded border border-sc-primary/20 bg-sc-elevated"
      aria-label={t(titleKey, { name: fileName })}
      title={t(titleKey, { name: fileName })}
    >
      <Icon className="h-3 w-3 text-sc-text-dim" aria-hidden="true" />
    </div>
  );
}
