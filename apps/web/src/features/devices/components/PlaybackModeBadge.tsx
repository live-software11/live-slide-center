import { useTranslation } from 'react-i18next';
import { Gauge, Tv2, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PlaybackMode } from '../repository';

/**
 * Sprint A6 (GUIDA_OPERATIVA_v3 §2.A6) — badge admin per la modalita di
 * playback dichiarata dal PC sala. Mostra anche un'icona "scarica" lo stile
 * del chip lato Room Player per coerenza visiva.
 *
 * Variants:
 * - `compact`: solo icona + testo breve (per liste dense, es. lista sale).
 * - `full`: icona + testo + tooltip esteso (per la pagina dettaglio sala).
 */
const STYLES: Record<PlaybackMode, { className: string; Icon: LucideIcon }> = {
  auto: {
    className: 'border-sc-primary/30 bg-sc-primary/10 text-sc-primary',
    Icon: Gauge,
  },
  live: {
    className: 'border-sc-success/30 bg-sc-success/10 text-sc-success',
    Icon: Tv2,
  },
  turbo: {
    className: 'border-sc-accent/30 bg-sc-accent/10 text-sc-accent',
    Icon: Zap,
  },
};

interface PlaybackModeBadgeProps {
  mode: PlaybackMode;
  variant?: 'compact' | 'full';
}

export function PlaybackModeBadge({ mode, variant = 'compact' }: PlaybackModeBadgeProps) {
  const { t } = useTranslation();
  const cfg = STYLES[mode];
  const Icon = cfg.Icon;
  const label = t(`roomPlayer.playbackMode.short.${mode}`);
  const hint = t(`roomPlayer.playbackMode.hint.${mode}`);
  const sizeClass =
    variant === 'compact'
      ? 'px-1.5 py-0.5 text-[10px] gap-1'
      : 'px-2 py-1 text-xs gap-1.5';
  const iconSize = variant === 'compact' ? 'h-3 w-3' : 'h-3.5 w-3.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${cfg.className} ${sizeClass}`}
      title={hint}
      aria-label={`${t('roomPlayer.playbackMode.label')}: ${label}`}
    >
      <Icon className={`${iconSize} shrink-0`} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
