import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import type { ValidationWarning } from '@slidecenter/shared';

/**
 * Sprint T-3-A (G10) — Badge issue di validazione file.
 *
 * Visualizza:
 *   - validation_warnings === null  → spinner muto "validating…" (attesa
 *     prima call dell Edge Function, max 2 min).
 *   - validation_warnings === []    → nessun badge (file pulito).
 *   - validation_warnings.length>0  → pill colorato con N issue + tooltip
 *     dettagliato (popover su hover/click).
 *
 * Severity color:
 *   - error    → rosso (file probabilmente non si apre)
 *   - warning  → giallo (azione consigliata, ma file utilizzabile)
 *   - info     → grigio chiaro (nessuna azione richiesta)
 *
 * I codici warning hanno chiavi i18n stable in
 * `presentations.validation.codes.<code>` (vedi i18n IT/EN). Se la chiave
 * manca, fallback al `message` inglese del payload.
 */
interface ValidationIssuesBadgeProps {
  warnings: ValidationWarning[] | null;
  /** Hint accessibile, mostrato come tooltip "title" sul badge collassato. */
  fileName?: string;
}

export function ValidationIssuesBadge({ warnings, fileName }: ValidationIssuesBadgeProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Conta e severity dominante calcolati SEMPRE (rules-of-hooks).
  const counts = useMemo(() => {
    if (!warnings) return { errors: 0, warns: 0, infos: 0 };
    let errors = 0;
    let warns = 0;
    let infos = 0;
    for (const w of warnings) {
      if (w.severity === 'error') errors += 1;
      else if (w.severity === 'warning') warns += 1;
      else infos += 1;
    }
    return { errors, warns, infos };
  }, [warnings]);

  // Caso 1: ancora non validato → spinner muto
  if (warnings === null) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-md bg-sc-text-dim/10 px-1.5 py-0.5 text-[10px] text-sc-text-dim"
        title={t('presentations.validation.pendingTooltip', { defaultValue: 'Validation in progress…' })}
        aria-label={t('presentations.validation.pending', { defaultValue: 'Checking file…' })}
      >
        <span
          className="h-2 w-2 animate-pulse rounded-full bg-sc-text-dim/60"
          aria-hidden="true"
        />
        {t('presentations.validation.pending', { defaultValue: 'Checking…' })}
      </span>
    );
  }

  // Caso 2: validato senza issue → niente badge
  if (warnings.length === 0) return null;

  // Caso 3: una o più issue → pill + popover
  const dominantSeverity: ValidationWarning['severity'] =
    counts.errors > 0 ? 'error' : counts.warns > 0 ? 'warning' : 'info';

  const Icon = dominantSeverity === 'error' ? AlertCircle : dominantSeverity === 'warning' ? AlertTriangle : Info;

  const badgeClasses =
    dominantSeverity === 'error'
      ? 'bg-sc-danger/15 text-sc-danger ring-1 ring-sc-danger/30 hover:bg-sc-danger/25'
      : dominantSeverity === 'warning'
        ? 'bg-yellow-400/15 text-yellow-700 ring-1 ring-yellow-400/40 hover:bg-yellow-400/25 dark:text-yellow-400'
        : 'bg-sc-text-dim/10 text-sc-text-dim ring-1 ring-sc-text-dim/20 hover:bg-sc-text-dim/15';

  const total = warnings.length;
  const buttonLabel = t('presentations.validation.issuesCount', {
    count: total,
    defaultValue_one: '{{count}} issue',
    defaultValue_other: '{{count}} issues',
  });

  const ariaLabel = fileName
    ? t('presentations.validation.issuesAria', {
        count: total,
        name: fileName,
        defaultValue: '{{count}} validation issue(s) on {{name}}',
      })
    : buttonLabel;

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium transition ${badgeClasses}`}
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <Icon className="h-3 w-3" aria-hidden="true" />
        {buttonLabel}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t('presentations.validation.detailsTitle', { defaultValue: 'File validation details' })}
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-xl border border-sc-border bg-sc-surface p-3 text-[11px] text-sc-text shadow-xl"
        >
          <div className="mb-2 flex items-center justify-between gap-2 border-b border-sc-border pb-1.5">
            <span className="font-semibold uppercase tracking-wide text-sc-text-dim">
              {t('presentations.validation.detailsTitle', { defaultValue: 'File validation' })}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded text-sc-text-dim hover:text-sc-text"
              aria-label={t('common.close', { defaultValue: 'Close' })}
            >
              ×
            </button>
          </div>
          <ul className="space-y-1.5">
            {warnings.slice(0, 12).map((w, idx) => (
              <li key={`${w.code}-${idx}`} className="flex items-start gap-1.5">
                <SeverityDot severity={w.severity} />
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">{translateWarning(t, w)}</p>
                </div>
              </li>
            ))}
            {warnings.length > 12 && (
              <li className="pt-1 text-[10px] italic text-sc-text-dim">
                {t('presentations.validation.moreIssues', {
                  count: warnings.length - 12,
                  defaultValue: '…and {{count}} more',
                })}
              </li>
            )}
          </ul>
        </div>
      )}
    </span>
  );
}

function SeverityDot({ severity }: { severity: ValidationWarning['severity'] }) {
  const cls =
    severity === 'error'
      ? 'bg-sc-danger'
      : severity === 'warning'
        ? 'bg-yellow-500'
        : 'bg-sc-text-dim/60';
  return (
    <span
      className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cls}`}
      aria-hidden="true"
    />
  );
}

/**
 * Traduzione del warning. Strategia:
 * - chiave i18n primaria: `presentations.validation.codes.<code>`
 * - se i18n ha la chiave → usala (eventualmente con interpolation dei `details`)
 * - altrimenti → fallback al `message` inglese
 *
 * Per ora la tabella delle traduzioni IT/EN copre i codici emessi dalla v1
 * dell Edge function (vedi `supabase/functions/slide-validator/index.ts`).
 */
function translateWarning(
  t: ReturnType<typeof useTranslation>['t'],
  w: ValidationWarning,
): string {
  const key = `presentations.validation.codes.${w.code}`;
  // Se la chiave esiste, usala (fallback automatico al message inglese se mancante)
  return t(key, { defaultValue: w.message, ...flattenDetails(w.details) });
}

function flattenDetails(details: Record<string, unknown> | undefined): Record<string, string | number> {
  if (!details) return {};
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(details)) {
    if (typeof v === 'string' || typeof v === 'number') {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 5).join(', ');
    }
  }
  return out;
}
