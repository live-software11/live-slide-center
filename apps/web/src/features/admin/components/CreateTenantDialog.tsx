import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, X, Copy, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import {
  CREATE_TENANT_ERROR_KEYS,
  createTenantWithInvite,
  suggestSlug,
  type CreateTenantInput,
  type CreateTenantResult,
  type TenantPlan,
} from '../repository';

interface CreateTenantDialogProps {
  supabase: SupabaseClient<Database>;
  onClose: () => void;
  onCreated: (tenantId: string) => void;
}

const TENANT_PLANS: TenantPlan[] = ['trial', 'starter', 'pro', 'enterprise'];

// Default per piano: storage / quote ragionevoli al momento della creazione.
// Andrea puo' modificarli dopo via AdminTenantDetailView (form quote esistente).
const PLAN_DEFAULTS: Record<TenantPlan, {
  storageGb: number;
  maxEvents: number;
  maxRooms: number;
  maxDevices: number;
}> = {
  trial: { storageGb: 5, maxEvents: 1, maxRooms: 2, maxDevices: 5 },
  starter: { storageGb: 50, maxEvents: 4, maxRooms: 8, maxDevices: 10 },
  pro: { storageGb: 250, maxEvents: 20, maxRooms: 32, maxDevices: 20 },
  enterprise: { storageGb: 1024, maxEvents: 100, maxRooms: 64, maxDevices: 50 },
};

const GB = 1024 * 1024 * 1024;

export function CreateTenantDialog({ supabase, onClose, onCreated }: CreateTenantDialogProps) {
  const { t } = useTranslation();

  const [name, setName] = useState('');
  // Slug derivato in render dal nome finche' l'utente non lo personalizza:
  // quando `slugOverride` e' null usiamo `suggestSlug(name)`; quando l'utente
  // edita lo slug, lo memorizziamo qui e diventa la fonte di verita'.
  // (Soluzione "Lifting State Up" che evita il pattern setState-in-effect.)
  const [slugOverride, setSlugOverride] = useState<string | null>(null);
  const slug = useMemo(() => slugOverride ?? suggestSlug(name), [slugOverride, name]);
  const [plan, setPlan] = useState<TenantPlan>('pro');
  const [storageGbStr, setStorageGbStr] = useState(String(PLAN_DEFAULTS.pro.storageGb));
  const [maxEventsStr, setMaxEventsStr] = useState(String(PLAN_DEFAULTS.pro.maxEvents));
  const [maxRoomsStr, setMaxRoomsStr] = useState(String(PLAN_DEFAULTS.pro.maxRooms));
  const [maxDevicesStr, setMaxDevicesStr] = useState(String(PLAN_DEFAULTS.pro.maxDevices));
  // Default: 1 anno da oggi (formato YYYY-MM-DD per <input type="date">)
  const defaultExpiry = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }, []);
  const [expiresAt, setExpiresAt] = useState(defaultExpiry);
  const [neverExpires, setNeverExpires] = useState(false);
  const [licenseKey, setLicenseKey] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRaw, setErrorRaw] = useState<string | null>(null);
  const [result, setResult] = useState<CreateTenantResult | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  // ── Reset quote ai default del piano quando cambia ───────────────────────
  const onChangePlan = useCallback((next: TenantPlan) => {
    setPlan(next);
    const d = PLAN_DEFAULTS[next];
    setStorageGbStr(String(d.storageGb));
    setMaxEventsStr(String(d.maxEvents));
    setMaxRoomsStr(String(d.maxRooms));
    setMaxDevicesStr(String(d.maxDevices));
  }, []);

  // ── ESC per chiudere (solo se non busy) ──────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !busy) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  // ── Validazione client-side leggera (la pesante e' nella RPC) ────────────
  const formErrors = useMemo(() => {
    const errs: string[] = [];
    if (name.trim().length < 2) errs.push(t('admin.createTenant.errors.invalidName'));
    if (!/^[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?$/.test(slug)) errs.push(t('admin.createTenant.errors.invalidSlug'));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail.trim())) errs.push(t('admin.createTenant.errors.invalidEmail'));
    const storageGb = Number(storageGbStr);
    if (!Number.isFinite(storageGb) || storageGb < 0 || storageGb > 100000) {
      errs.push(t('admin.createTenant.errors.invalidStorage'));
    }
    if (!Number.isInteger(Number(maxEventsStr)) || Number(maxEventsStr) < 0) {
      errs.push(t('admin.createTenant.errors.invalidMaxEvents'));
    }
    if (!Number.isInteger(Number(maxRoomsStr)) || Number(maxRoomsStr) < 0) {
      errs.push(t('admin.createTenant.errors.invalidMaxRooms'));
    }
    if (!Number.isInteger(Number(maxDevicesStr)) || Number(maxDevicesStr) < 0) {
      errs.push(t('admin.createTenant.errors.invalidMaxDevices'));
    }
    if (licenseKey.trim().length > 0 && !/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(licenseKey.trim())) {
      errs.push(t('admin.createTenant.errors.invalidLicenseFormat'));
    }
    return errs;
  }, [name, slug, adminEmail, storageGbStr, maxEventsStr, maxRoomsStr, maxDevicesStr, licenseKey, t]);

  const isFormValid = formErrors.length === 0;

  const onSubmit = useCallback(async () => {
    if (!isFormValid || busy) return;
    setBusy(true);
    setError(null);
    setErrorRaw(null);

    const storageGb = Number(storageGbStr);
    // Se piano Enterprise + 0 GB, interpretiamo come "illimitato" (-1). Altrimenti
    // converti GB → byte. 0 GB su piani non-Enterprise = 0 byte (storage bloccato).
    const storageLimitBytes = plan === 'enterprise' && storageGb === 0 ? -1 : Math.round(storageGb * GB);

    const input: CreateTenantInput = {
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      plan,
      storageLimitBytes,
      maxEventsPerMonth: Number(maxEventsStr),
      maxRoomsPerEvent: Number(maxRoomsStr),
      maxDevicesPerRoom: Number(maxDevicesStr),
      expiresAt: neverExpires ? null : new Date(`${expiresAt}T23:59:59Z`).toISOString(),
      licenseKey: licenseKey.trim().length > 0 ? licenseKey.trim().toUpperCase() : null,
      adminEmail: adminEmail.trim().toLowerCase(),
    };

    const { data, error: rpcError, errorCode } = await createTenantWithInvite(supabase, input);

    setBusy(false);

    if (rpcError || !data) {
      setErrorRaw(rpcError ?? 'unknown');
      // Cerca un codice noto nel messaggio (RAISE EXCEPTION 'codice' arriva nel
      // .message della PostgrestError).
      const knownKey = Object.entries(CREATE_TENANT_ERROR_KEYS).find(([code]) =>
        (rpcError ?? '').includes(code) || (errorCode ?? '').includes(code),
      )?.[1];
      setError(knownKey ?? 'admin.createTenant.errors.generic');
      return;
    }

    setResult(data);
    onCreated(data.tenantId);
  }, [
    isFormValid,
    busy,
    storageGbStr,
    plan,
    name,
    slug,
    maxEventsStr,
    maxRoomsStr,
    maxDevicesStr,
    neverExpires,
    expiresAt,
    licenseKey,
    adminEmail,
    supabase,
    onCreated,
  ]);

  const onCopyInvite = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.inviteUrl);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2500);
    } catch {
      // Clipboard API puo' fallire su Safari iOS senza interazione utente:
      // mostra l'URL in un input read-only sotto.
    }
  }, [result]);

  // ── Vista risultato (post-creazione) ─────────────────────────────────────
  if (result) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-tenant-result-title"
      >
        <div className="relative w-full max-w-lg rounded-2xl border border-sc-success/30 bg-sc-surface p-6 shadow-2xl">
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="absolute right-3 top-3 rounded-xl p-1 text-sc-text-muted hover:text-sc-text"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="mb-4 flex items-center gap-2 text-sc-success">
            <CheckCircle2 className="h-6 w-6" />
            <h2 id="create-tenant-result-title" className="text-lg font-semibold">
              {t('admin.createTenant.successTitle')}
            </h2>
          </div>

          <p className="text-sm text-sc-text-muted">
            {t('admin.createTenant.successBody', { email: result.adminEmail })}
          </p>

          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-sc-text-dim">
                {t('admin.createTenant.successInviteUrl')}
              </p>
              <div className="mt-1.5 flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={result.inviteUrl}
                  className="flex-1 rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-xs text-sc-text-secondary outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  type="button"
                  onClick={() => void onCopyInvite()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-sc-primary/30 bg-sc-elevated px-3 py-2 text-xs font-medium text-sc-text hover:bg-sc-primary/15"
                >
                  {copyState === 'copied' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copyState === 'copied' ? t('common.copied') : t('common.copy')}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-sc-text-dim">
                {t('admin.createTenant.successInviteHint', {
                  expiry: new Date(result.inviteExpiresAt).toLocaleDateString(),
                })}
              </p>
            </div>

            <div className="rounded-xl border border-sc-primary/15 bg-sc-bg/40 px-3 py-2 text-xs text-sc-text-muted">
              <p>
                {t('admin.createTenant.successSlug')}: <span className="font-mono text-sc-text">{result.slug}</span>
              </p>
              {result.licenseKey ? (
                <p className="mt-1">
                  {t('admin.createTenant.successLicense')}: <span className="font-mono text-sc-text">{result.licenseKey}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white hover:bg-sc-primary-deep"
            >
              {t('admin.createTenant.successClose')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Vista form (pre-creazione) ───────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-tenant-title"
    >
      <div className="relative max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-sc-primary/20 bg-sc-surface p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={t('common.close')}
          className="absolute right-3 top-3 rounded-xl p-1 text-sc-text-muted hover:text-sc-text disabled:opacity-50"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 id="create-tenant-title" className="text-lg font-semibold text-white">
          {t('admin.createTenant.title')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-muted">{t('admin.createTenant.intro')}</p>

        <form
          className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void onSubmit();
          }}
        >
          {/* ── Identita' azienda ─────────────────────────────────────────── */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-name">
              {t('admin.createTenant.fieldName')} *
            </label>
            <input
              id="ct-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              placeholder={t('admin.createTenant.fieldNamePlaceholder')}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-slug">
              {t('admin.createTenant.fieldSlug')} *
            </label>
            <input
              id="ct-slug"
              type="text"
              required
              value={slug}
              onChange={(e) => setSlugOverride(e.target.value.toLowerCase())}
              disabled={busy}
              placeholder="studio-xyz"
              pattern="[a-z0-9]([a-z0-9-]{1,62}[a-z0-9])?"
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.createTenant.fieldSlugHint')}</p>
          </div>

          {/* ── Piano + quote ─────────────────────────────────────────────── */}
          <div>
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-plan">
              {t('admin.colPlan')} *
            </label>
            <select
              id="ct-plan"
              value={plan}
              onChange={(e) => onChangePlan(e.target.value as TenantPlan)}
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            >
              {TENANT_PLANS.map((p) => (
                <option key={p} value={p}>
                  {t(`tenantQuota.planLabels.${p}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-storage">
              {t('admin.createTenant.fieldStorageGb')} *
            </label>
            <input
              id="ct-storage"
              type="text"
              inputMode="numeric"
              required
              value={storageGbStr}
              onChange={(e) => setStorageGbStr(e.target.value)}
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-sc-text-dim">
              {plan === 'enterprise'
                ? t('admin.createTenant.fieldStorageEnterpriseHint')
                : t('admin.createTenant.fieldStorageHint')}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-events">
              {t('tenantQuota.eventsThisMonthLabel')} *
            </label>
            <input
              id="ct-events"
              type="text"
              inputMode="numeric"
              required
              value={maxEventsStr}
              onChange={(e) => setMaxEventsStr(e.target.value)}
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-rooms">
              {t('tenantQuota.roomsThisEventLabel')} *
            </label>
            <input
              id="ct-rooms"
              type="text"
              inputMode="numeric"
              required
              value={maxRoomsStr}
              onChange={(e) => setMaxRoomsStr(e.target.value)}
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-devices">
              {t('admin.createTenant.fieldMaxDevices')} *
            </label>
            <input
              id="ct-devices"
              type="text"
              inputMode="numeric"
              required
              value={maxDevicesStr}
              onChange={(e) => setMaxDevicesStr(e.target.value)}
              disabled={busy}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.createTenant.fieldMaxDevicesHint')}</p>
          </div>

          {/* ── Scadenza commerciale ───────────────────────────────────── */}
          <div className="sm:col-span-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-expires">
                {t('admin.createTenant.fieldExpiresAt')}
              </label>
              <label className="flex items-center gap-1.5 text-xs text-sc-text-muted">
                <input
                  type="checkbox"
                  checked={neverExpires}
                  onChange={(e) => setNeverExpires(e.target.checked)}
                  disabled={busy}
                  className="h-3.5 w-3.5 accent-sc-primary"
                />
                {t('admin.createTenant.fieldExpiresNever')}
              </label>
            </div>
            <input
              id="ct-expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={busy || neverExpires}
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
          </div>

          {/* ── License key opzionale ──────────────────────────────────── */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-license">
              {t('admin.createTenant.fieldLicenseKey')}
            </label>
            <input
              id="ct-license"
              type="text"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
              disabled={busy}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 font-mono text-sm uppercase text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.createTenant.fieldLicenseKeyHint')}</p>
          </div>

          {/* ── Email primo admin ──────────────────────────────────────── */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-sc-text-muted" htmlFor="ct-email">
              {t('admin.createTenant.fieldAdminEmail')} *
            </label>
            <input
              id="ct-email"
              type="email"
              required
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              disabled={busy}
              placeholder="info@studio-xyz.com"
              className="mt-1.5 w-full rounded-xl border border-sc-primary/20 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
            />
            <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.createTenant.fieldAdminEmailHint')}</p>
          </div>

          {/* ── Errori validazione (client) ────────────────────────────── */}
          {formErrors.length > 0 ? (
            <div className="sm:col-span-2 rounded-xl border border-sc-warning/30 bg-sc-warning/10 px-3 py-2 text-xs text-sc-warning">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('admin.createTenant.formErrorsTitle')}
              </div>
              <ul className="ml-5 mt-1 list-disc space-y-0.5">
                {formErrors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ── Errore RPC (server) ────────────────────────────────────── */}
          {error ? (
            <div className="sm:col-span-2 rounded-xl border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger" role="alert">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t(error)}
              </div>
              {errorRaw && error === 'admin.createTenant.errors.generic' ? (
                <p className="mt-1 font-mono text-[11px] text-sc-danger/80">{errorRaw}</p>
              ) : null}
            </div>
          ) : null}

          {/* ── Azioni ─────────────────────────────────────────────────── */}
          <div className="sm:col-span-2 mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-xl border border-sc-primary/20 px-4 py-2 text-sm text-sc-text hover:bg-sc-elevated disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || !isFormValid}
              className="inline-flex items-center gap-2 rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sc-primary/20 hover:bg-sc-primary-deep disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? t('admin.createTenant.creating') : t('admin.createTenant.submitCta')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
