/**
 * Sprint T-3-A (G10) — schema warning emesso dall'Edge Function `slide-validator`
 * e persistito in `presentation_versions.validation_warnings JSONB`.
 *
 * In `database.ts` (auto-generato) la colonna e' tipata come `Json | null`
 * (Postgres jsonb generico). I consumer che leggono quella colonna fanno
 * cast esplicito a `ValidationWarning[]`. La definizione "ricca" vive qui
 * per restare allineabile via `pnpm db:types` senza drift checker (vedi
 * .github/workflows/db-types-drift.yml).
 *
 * - `code` e' la chiave i18n stable (es. 'pptx_fonts_not_embedded').
 * - `message` e' il fallback in inglese.
 * - `details` e' payload diagnostico libero (chiavi specifiche per code).
 */
export interface ValidationWarning {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}
