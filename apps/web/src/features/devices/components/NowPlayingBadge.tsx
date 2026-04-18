import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Radio } from 'lucide-react';

/**
 * Sprint I (GUIDA_OPERATIVA_v3 §3.E E4) — badge "In onda" lato admin.
 *
 * Mostrato sotto la card di una sala quando `room_state.current_presentation_id`
 * e' settato. Visualizza:
 * - icona radio pulsante (verde, segnale "live");
 * - "In onda: {fileName}";
 * - tempo trascorso dall'apertura ("avviato 12s fa", "avviato 3m fa") che
 *   si auto-aggiorna ogni 10 secondi.
 *
 * Implementazione tempo trascorso: `useState` con `setInterval(10s)`. Non
 * usiamo Intl.RelativeTimeFormat dinamico perche' vogliamo controllo fine
 * sui breakpoint ("ora" / "Ns fa" / "Nm fa" / "Nh fa") e perche' la
 * formattazione "qualche secondo fa" cambia di lingua in lingua. Le label
 * sono in i18n key `roomPlayer.nowPlaying.*`.
 *
 * Re-render: l'`useState` triggera un re-render ogni 10s ma solo del badge
 * (non dell'intera EventDetailView). 10s e' il giusto compromesso fra
 * "vivo" e "non sprecato in ticking inutile".
 */
interface NowPlayingBadgeProps {
  fileName: string;
  /** ISO timestamp `room_state.last_play_started_at`. Null = "qualche istante fa". */
  startedAt: string | null;
}

function formatElapsed(t: (k: string, opts?: Record<string, unknown>) => string, startedAtMs: number | null): string {
  if (!startedAtMs) return t('roomPlayer.nowPlaying.timeJust');
  const diffSec = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));
  if (diffSec < 5) return t('roomPlayer.nowPlaying.timeJust');
  if (diffSec < 60) return t('roomPlayer.nowPlaying.timeSeconds', { count: diffSec });
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return t('roomPlayer.nowPlaying.timeMinutes', { count: diffMin });
  const diffH = Math.floor(diffMin / 60);
  return t('roomPlayer.nowPlaying.timeHours', { count: diffH });
}

export function NowPlayingBadge({ fileName, startedAt }: NowPlayingBadgeProps) {
  const { t } = useTranslation();
  const startedAtMs = startedAt ? Date.parse(startedAt) : null;
  // Tick solo per forzare re-render del label "Ns fa". Non serve che il
  // valore reale sia in stato, ci basta una dipendenza che cambi.
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1.5 rounded-lg border border-sc-success/30 bg-sc-success/10 px-2 py-1 text-[11px] text-sc-success"
      title={t('roomPlayer.nowPlaying.aria', { name: fileName })}
    >
      <Radio className="h-3 w-3 shrink-0 animate-pulse" aria-hidden="true" />
      <span className="font-semibold uppercase tracking-wide">{t('roomPlayer.nowPlaying.label')}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{fileName}</span>
      <span className="shrink-0 text-sc-success/80">· {formatElapsed(t, startedAtMs)}</span>
    </div>
  );
}
