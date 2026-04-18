import { useTranslation } from 'react-i18next';
import { Cloud, CloudOff, Monitor, MonitorOff } from 'lucide-react';
import { useBackendStatus, type BackendStatus } from '@/lib/use-backend-status';

/**
 * Sprint J5 → esteso in Sprint O4 (GUIDA_OPERATIVA_v3 §4.G — UX parity).
 *
 * Chip indicator in header (footer sidebar). Mostra 3 stati semantici basati
 * su `useBackendStatus()`:
 *
 *   • CLOUD ONLINE  — verde   (sc-success)  — Vercel + Supabase raggiungibile
 *   • CLOUD OFFLINE — grigio  (sc-text-dim) — navigator.onLine = false
 *   • LAN           — blu     (sc-primary)  — desktop + admin server LAN OK
 *   • STANDALONE    — arancio (sc-accent)   — desktop + admin server unreachable
 *   • LOADING       — neutro                — primo render prima del check
 *
 * Tooltip hint i18n con descrizione lunga + (in desktop) latenza ms ultimo
 * health check.
 *
 * Discreta: sta nel footer della sidebar, sempre visibile, non invade la UI
 * principale. L'utente sa "su che backend sono adesso" con un colpo d'occhio.
 */
export function BackendModeBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  const info = useBackendStatus();

  const meta = describeStatus(info.status);
  const Icon = meta.icon;
  const tooltipHint = t(meta.hintKey);
  const tooltipFull = info.latencyMs !== null
    ? `${tooltipHint} · ${info.latencyMs}ms`
    : tooltipHint;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] font-medium tracking-wide uppercase ring-1 ${meta.colorClasses} ${className ?? ''}`}
      title={tooltipFull}
      role="status"
      aria-live="polite"
      aria-label={tooltipFull}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      <span className="truncate">{t(meta.shortKey)}</span>
    </div>
  );
}

interface StatusMeta {
  icon: typeof Cloud;
  shortKey: string;
  hintKey: string;
  colorClasses: string;
}

function describeStatus(status: BackendStatus): StatusMeta {
  switch (status) {
    case 'cloud-online':
      return {
        icon: Cloud,
        shortKey: 'backendMode.short.cloud',
        hintKey: 'backendMode.hint.cloud',
        colorClasses: 'bg-sc-primary/10 text-sc-primary ring-sc-primary/30',
      };
    case 'cloud-offline':
      return {
        icon: CloudOff,
        shortKey: 'backendMode.short.cloudOffline',
        hintKey: 'backendMode.hint.cloudOffline',
        colorClasses: 'bg-sc-text-dim/10 text-sc-text-dim ring-sc-text-dim/30',
      };
    case 'lan-connected':
      return {
        icon: Monitor,
        shortKey: 'backendMode.short.lan',
        hintKey: 'backendMode.hint.lan',
        colorClasses: 'bg-sc-primary/10 text-sc-primary ring-sc-primary/30',
      };
    case 'standalone':
      return {
        icon: MonitorOff,
        shortKey: 'backendMode.short.standalone',
        hintKey: 'backendMode.hint.standalone',
        colorClasses: 'bg-sc-accent/10 text-sc-accent ring-sc-accent/30',
      };
    case 'loading':
    default:
      return {
        icon: Monitor,
        shortKey: 'backendMode.short.loading',
        hintKey: 'backendMode.hint.loading',
        colorClasses: 'bg-sc-text-dim/10 text-sc-text-dim ring-sc-text-dim/30',
      };
  }
}
