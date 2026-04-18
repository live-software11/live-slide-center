// ════════════════════════════════════════════════════════════════════════════
// Sprint D1 — DesktopLicenseView
// ════════════════════════════════════════════════════════════════════════════
//
// Route `/centro-slide/licenza`. Pagina full per:
//   • Mostrare lo stato licenza corrente (active / gracePeriod / graceExpired
//     / revoked / tenantSuspended / notBound / error).
//   • Permettere all'utente di incollare un magic-link per fare il bind del PC.
//   • Pulsanti "Verifica ora" e "Scollega".
//
// In modalita cloud (no Tauri) mostra un avviso "Funzione disponibile solo
// nella versione desktop installata".
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, KeyRound, Loader2, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { getBackendMode } from '@/lib/backend-mode';
import {
  bindDesktopLicense,
  getDesktopLicenseStatus,
  resetDesktopLicense,
  verifyDesktopLicenseNow,
  type DesktopLicenseStatus,
} from '@/lib/desktop-bridge';

function mapBindError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('token_invalid') || lower.includes('invalid_token') || lower.includes('not_found')) {
    return 'invalid';
  }
  if (lower.includes('already_consumed') || lower.includes('exhausted')) return 'alreadyConsumed';
  if (lower.includes('tenant_suspended') || lower.includes('suspended')) return 'tenantSuspended';
  if (lower.includes('rate') || lower.includes('429')) return 'rateLimited';
  if (lower.includes('network') || lower.includes('reqwest')) return 'network';
  return 'generic';
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function StatusCard({ status }: { status: DesktopLicenseStatus }) {
  const { t } = useTranslation();
  let label = '';
  let color = 'bg-slate-500';
  switch (status.kind) {
    case 'active':
      label = t('desktopLicense.status.active');
      color = 'bg-emerald-500';
      break;
    case 'gracePeriod':
      label = t('desktopLicense.status.gracePeriod');
      color = 'bg-amber-500';
      break;
    case 'graceExpired':
      label = t('desktopLicense.status.graceExpired');
      color = 'bg-red-500';
      break;
    case 'revoked':
      label = t('desktopLicense.status.revoked');
      color = 'bg-red-600';
      break;
    case 'tenantSuspended':
      label = t('desktopLicense.status.tenantSuspended');
      color = 'bg-red-600';
      break;
    case 'notBound':
      label = t('desktopLicense.status.notBound');
      color = 'bg-slate-500';
      break;
    case 'error':
      label = t('desktopLicense.status.error');
      color = 'bg-red-700';
      break;
  }

  const tenantName = 'tenantName' in status ? status.tenantName : null;
  const plan = 'plan' in status ? status.plan : null;
  const expiresAt = 'expiresAt' in status ? status.expiresAt : null;
  const lastVerifiedAt = 'lastVerifiedAt' in status ? status.lastVerifiedAt : null;
  const graceUntil = 'graceUntil' in status ? status.graceUntil : null;
  const daysRemaining = 'daysRemaining' in status ? status.daysRemaining : null;

  return (
    <div className="rounded-lg border border-sc-border bg-sc-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-3">
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide text-sc-text-muted">
          {t('desktopLicense.status.label')}
        </span>
        <span className="text-sm font-semibold text-sc-text">{label}</span>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        {tenantName ? (
          <>
            <dt className="text-sc-text-muted">{t('desktopLicense.status.tenantName')}</dt>
            <dd className="font-medium text-sc-text">{tenantName}</dd>
          </>
        ) : null}
        {plan ? (
          <>
            <dt className="text-sc-text-muted">{t('desktopLicense.status.plan')}</dt>
            <dd className="font-medium text-sc-text">{plan}</dd>
          </>
        ) : null}
        {expiresAt !== undefined ? (
          <>
            <dt className="text-sc-text-muted">{t('desktopLicense.status.expiresAt')}</dt>
            <dd className="font-medium text-sc-text">
              {expiresAt ? formatDate(expiresAt) : t('desktopLicense.status.noExpiry')}
            </dd>
          </>
        ) : null}
        {lastVerifiedAt ? (
          <>
            <dt className="text-sc-text-muted">{t('desktopLicense.status.lastVerifiedAt')}</dt>
            <dd className="font-medium text-sc-text">{formatDate(lastVerifiedAt)}</dd>
          </>
        ) : null}
        {graceUntil ? (
          <>
            <dt className="text-sc-text-muted">{t('desktopLicense.status.graceUntil')}</dt>
            <dd className="font-medium text-sc-text">{formatDate(graceUntil)}</dd>
          </>
        ) : null}
        {daysRemaining !== null ? (
          <>
            <dt className="text-sc-text-muted">{t('desktopLicense.status.daysRemaining', { days: daysRemaining })}</dt>
            <dd />
          </>
        ) : null}
      </dl>
    </div>
  );
}

function DesktopLicenseView() {
  const { t } = useTranslation();
  const isDesktop = getBackendMode() === 'desktop';
  const [status, setStatus] = useState<DesktopLicenseStatus | null>(null);
  const [magicLink, setMagicLink] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [bindSuccess, setBindSuccess] = useState(false);
  const [verifyMessage, setVerifyMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const s = await getDesktopLicenseStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    let cancelled = false;
    void (async () => {
      const s = await getDesktopLicenseStatus();
      if (!cancelled) setStatus(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [isDesktop]);

  async function handleBind(e: React.FormEvent) {
    e.preventDefault();
    setBindError(null);
    setBindSuccess(false);
    const trimmed = magicLink.trim();
    if (!trimmed) {
      setBindError(t('desktopLicense.bind.errors.empty'));
      return;
    }
    setSubmitting(true);
    const res = await bindDesktopLicense({ magicLink: trimmed, deviceName: deviceName.trim() || undefined });
    setSubmitting(false);
    if (!res.ok) {
      const code = mapBindError(res.error ?? '');
      const key = `desktopLicense.bind.errors.${code}`;
      setBindError(t(key, { error: res.error ?? '' }));
      return;
    }
    setBindSuccess(true);
    setMagicLink('');
    setDeviceName('');
    await refresh();
  }

  async function handleVerify() {
    if (verifying) return;
    setVerifying(true);
    setVerifyMessage(null);
    const res = await verifyDesktopLicenseNow();
    setVerifying(false);
    if (res.ok) {
      setVerifyMessage({ ok: true, text: t('desktopLicense.actions.verifyOk') });
    } else {
      setVerifyMessage({
        ok: false,
        text: t('desktopLicense.actions.verifyError', { error: res.error ?? '' }),
      });
    }
    await refresh();
  }

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    await resetDesktopLicense();
    setResetting(false);
    setConfirmReset(false);
    await refresh();
  }

  if (!isDesktop) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6 text-center text-sm text-sc-text">
          {t('desktopLicense.title')} — {t('desktopLicense.subtitle')}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-sc-text">{t('desktopLicense.title')}</h1>
        <p className="mt-1 text-sm text-sc-text-muted">{t('desktopLicense.subtitle')}</p>
      </header>

      {status ? <StatusCard status={status} /> : (
        <div className="flex items-center gap-2 rounded-lg border border-sc-border bg-sc-surface p-4 text-sm text-sc-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      )}

      {status && status.kind !== 'active' ? (
        <section className="rounded-lg border border-sc-border bg-sc-surface p-4 shadow-sm">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-sc-text">
            <KeyRound className="h-4 w-4 text-sc-primary" aria-hidden />
            {t('desktopLicense.bind.title')}
          </h2>
          <p className="mb-3 text-xs text-sc-text-muted">{t('desktopLicense.bind.instructions')}</p>
          <form onSubmit={handleBind} className="space-y-3">
            <div>
              <label htmlFor="magic-link" className="mb-1 block text-xs font-medium text-sc-text">
                {t('desktopLicense.bind.magicLinkLabel')}
              </label>
              <input
                id="magic-link"
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={magicLink}
                onChange={(e) => setMagicLink(e.target.value)}
                placeholder={t('desktopLicense.bind.magicLinkPlaceholder')}
                className="w-full rounded-md border border-sc-border bg-sc-bg px-3 py-2 text-sm text-sc-text placeholder:text-sc-text-muted focus:border-sc-primary focus:outline-none focus:ring-2 focus:ring-sc-primary/30"
              />
            </div>
            <div>
              <label htmlFor="device-name" className="mb-1 block text-xs font-medium text-sc-text">
                {t('desktopLicense.bind.deviceNameLabel')}
              </label>
              <input
                id="device-name"
                type="text"
                autoComplete="off"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={t('desktopLicense.bind.deviceNamePlaceholder')}
                className="w-full rounded-md border border-sc-border bg-sc-bg px-3 py-2 text-sm text-sc-text placeholder:text-sc-text-muted focus:border-sc-primary focus:outline-none focus:ring-2 focus:ring-sc-primary/30"
              />
            </div>
            {bindError ? (
              <div className="rounded-md border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger">
                {bindError}
              </div>
            ) : null}
            {bindSuccess ? (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden />
                {t('desktopLicense.bind.success')}
              </div>
            ) : null}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-md bg-sc-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sc-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <KeyRound className="h-4 w-4" aria-hidden />
                )}
                <span>{submitting ? t('desktopLicense.bind.submitting') : t('desktopLicense.bind.submit')}</span>
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {status && status.kind !== 'notBound' ? (
        <section className="rounded-lg border border-sc-border bg-sc-surface p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void handleVerify()}
              disabled={verifying}
              className="inline-flex items-center gap-2 rounded-md border border-sc-border bg-sc-bg px-3 py-2 text-sm font-medium text-sc-text transition-colors hover:bg-sc-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {verifying ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-4 w-4" aria-hidden />
              )}
              <span>{verifying ? t('desktopLicense.actions.verifying') : t('desktopLicense.actions.verifyNow')}</span>
            </button>
            {confirmReset ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-sc-text-muted">{t('desktopLicense.actions.resetConfirmTitle')}</span>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="inline-flex items-center rounded-md border border-sc-border px-3 py-1.5 text-xs font-medium text-sc-text hover:bg-sc-primary/10"
                >
                  {t('desktopLicense.actions.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={resetting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-sc-danger px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  {t('desktopLicense.actions.resetConfirmAction')}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmReset(true)}
                className="inline-flex items-center gap-2 rounded-md border border-sc-danger/30 bg-sc-danger/5 px-3 py-2 text-sm font-medium text-sc-danger transition-colors hover:bg-sc-danger/15"
              >
                <Unplug className="h-4 w-4" aria-hidden />
                <span>{t('desktopLicense.actions.reset')}</span>
              </button>
            )}
          </div>
          {verifyMessage ? (
            <div
              className={`mt-3 rounded-md border px-3 py-2 text-xs ${
                verifyMessage.ok
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-sc-danger/30 bg-sc-danger/10 text-sc-danger'
              }`}
            >
              {verifyMessage.text}
            </div>
          ) : null}
          {confirmReset ? (
            <p className="mt-3 text-xs text-sc-text-muted">{t('desktopLicense.actions.resetConfirmBody')}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

export default DesktopLicenseView;
export { DesktopLicenseView as Component };
