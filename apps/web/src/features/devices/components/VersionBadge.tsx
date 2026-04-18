import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, History, Layers } from 'lucide-react';

/**
 * Sprint T-1 (G8 — chiude il gap "versione in onda non visibile a colpo
 * d'occhio in sala").
 *
 * Il PC sala mostra in chiaro quale `version_number` di un file e' stato
 * scelto come `current_version_id` dall'admin, e quante versioni totali
 * esistono di quella stessa presentation:
 *
 *   - `inline`: badge piccolo accanto al filename, sempre visibile.
 *     Usato dentro `FileSyncStatus` (lista file della sala).
 *
 *   - `overlay`: badge grande in alto a destra del `FilePreviewDialog`,
 *     visibile durante il "playback" (anteprima fullscreen). Auto-fade dopo
 *     5s, ricompare on hover/move/touch (UX standard player video).
 *
 * Color coding (sovrano):
 *
 *   - `versionNumber === versionTotal` → la corrente e' anche la PIU' RECENTE.
 *     Verde / `sc-success`. Icona `CheckCircle2`.
 *   - `versionNumber < versionTotal`   → l'admin ha riportato indietro la
 *     corrente, esiste una v(`versionTotal`) piu' nuova non scelta.
 *     Giallo / `sc-warning`. Icona `History`. Tooltip esplicito.
 *   - `versionTotal === 1`             → unica versione caricata, badge
 *     neutro (icona `Layers`). Mostriamo "v1" minimal senza colorazione.
 *
 * Se uno dei due valori e' null/undefined (bootstrap pre-T-1), il componente
 * non rende nulla — backward compat al 100%.
 */
export interface VersionBadgeProps {
  versionNumber: number | null | undefined;
  versionTotal: number | null | undefined;
  /**
   * Se `'inline'`: chip statico per liste/card (default).
   * Se `'overlay'`: badge fluttuante con auto-fade per fullscreen player.
   */
  variant?: 'inline' | 'overlay';
  /**
   * Solo per `variant='overlay'`. Trigger esterno per "wake-up" del badge:
   * cambia ad ogni mossa mouse / touch / keypress nel container parent.
   * Quando cambia, il badge ricompare e ricalcola il timer 5s.
   */
  wakeKey?: number;
  /**
   * Solo per `variant='overlay'`. Tempo (ms) prima che il badge svanisca.
   * Default 5000 (5s). 0 disabilita l'auto-fade (sempre visibile).
   */
  fadeAfterMs?: number;
  className?: string;
}

export function VersionBadge({
  versionNumber,
  versionTotal,
  variant = 'inline',
  wakeKey,
  fadeAfterMs = 5_000,
  className = '',
}: VersionBadgeProps) {
  const { t } = useTranslation();
  // Sprint T-1 — pattern "derived state from props" raccomandato da React 19
  // (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  // Quando `wakeKey` cambia, resettiamo `visible=true` durante il render body
  // (non dentro useEffect: la regola `react-hooks/set-state-in-effect`
  // esplicitamente vieta setState sincrono in effect, perche' causa render a
  // cascata). L'effect successivo gestisce solo il timer di nascondimento.
  const [visible, setVisible] = useState(true);
  const [lastWakeKey, setLastWakeKey] = useState(wakeKey);
  if (wakeKey !== lastWakeKey) {
    setLastWakeKey(wakeKey);
    setVisible(true);
  }

  useEffect(() => {
    if (variant !== 'overlay' || fadeAfterMs <= 0) return;
    if (!visible) return;
    const id = setTimeout(() => setVisible(false), fadeAfterMs);
    return () => clearTimeout(id);
  }, [variant, fadeAfterMs, visible]);

  if (versionNumber == null || versionTotal == null) return null;
  if (versionTotal < 1) return null;

  const isLatest = versionNumber === versionTotal;
  const isSingle = versionTotal === 1;

  // Color coding sovrano:
  //  - latest (verde): la sala sta proiettando l'ultima versione caricata
  //  - older (giallo): la sala sta proiettando una versione PRECEDENTE per
  //    scelta esplicita dell'admin → utile a chi e' in regia per capire
  //    a colpo d'occhio se "la roba mostrata" e' allineata alle slide piu'
  //    fresche o se invece c'e' un rollback intenzionale
  //  - single (neutro): una sola versione caricata, nessun rischio di confusione
  const tone: 'latest' | 'older' | 'single' = isSingle
    ? 'single'
    : isLatest
      ? 'latest'
      : 'older';

  // Stile inline (chip piccolo dentro la lista file) vs overlay (badge grande
  // top-right in fullscreen player). I colori sono identici, cambia solo size,
  // shadow e l'animazione di opacita'.
  const Icon = tone === 'older' ? History : tone === 'latest' ? CheckCircle2 : Layers;

  const toneClasses =
    tone === 'older'
      ? 'border-sc-warning/50 bg-sc-warning/15 text-sc-warning'
      : tone === 'latest'
        ? 'border-sc-success/40 bg-sc-success/15 text-sc-success'
        : 'border-sc-primary/30 bg-sc-primary/10 text-sc-primary';

  const sizeClasses =
    variant === 'overlay'
      ? 'gap-1.5 px-3 py-1.5 text-sm shadow-lg backdrop-blur-sm'
      : 'gap-1 px-2 py-0.5 text-[10px]';

  const visibilityClasses =
    variant === 'overlay'
      ? `transition-opacity duration-500 ${visible ? 'opacity-100' : 'opacity-0'} ${visible ? '' : 'pointer-events-none'}`
      : '';

  const labelKey = isSingle ? 'roomPlayer.versionBadge.single' : 'roomPlayer.versionBadge.label';
  const tooltipKey =
    tone === 'older'
      ? 'roomPlayer.versionBadge.tooltipOlder'
      : tone === 'latest'
        ? 'roomPlayer.versionBadge.tooltipLatest'
        : 'roomPlayer.versionBadge.tooltipSingle';

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border font-semibold uppercase tracking-wide ${toneClasses} ${sizeClasses} ${visibilityClasses} ${className}`}
      title={t(tooltipKey, { n: versionNumber, total: versionTotal })}
      aria-label={t('roomPlayer.versionBadge.aria', { n: versionNumber, total: versionTotal })}
      // Su mouse-enter del badge stesso, lo "teniamo vivo" anche se l'utente
      // non muove il mouse altrove (overlay variant). Usiamo un setter non
      // sincrono — il pattern derived-state raccomandato gia' resetta sul
      // cambio di `wakeKey` esterno; questo e' un wake "manuale" extra.
      onMouseEnter={
        variant === 'overlay'
          ? () => {
              if (!visible) setVisible(true);
            }
          : undefined
      }
    >
      <Icon
        className={variant === 'overlay' ? 'h-4 w-4' : 'h-3 w-3'}
        aria-hidden="true"
      />
      <span>{t(labelKey, { n: versionNumber, total: versionTotal })}</span>
    </span>
  );
}
