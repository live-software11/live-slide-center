import { PLAN_LIMITS, type TenantPlan, TENANT_PLANS } from '@slidecenter/shared';
import { CreditCard, ExternalLink } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/app/use-auth';
import { formatBytes } from '@/features/upload-portal/lib/format-bytes';
import { useEvents } from '@/features/events/hooks/useEvents';
import { TenantQuotaPanel } from '@/features/tenant/components/TenantQuotaPanel';
import { useTenantQuotaRow } from '@/features/tenant/hooks/useTenantQuotaRow';
import {
  countEventsWithStartInYearMonth,
  currentYearMonthLocal,
  isUnlimitedEventsPerMonth,
  isUnlimitedRoomsPerEvent,
} from '@/features/tenant/lib/quota-usage';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { getTenantIdFromSession } from '@/lib/session-tenant';
import { getBillingEnvUrls } from './lib/billing-env';

function formatLimit(n: number, t: (k: string) => string): string {
  if (n < 0) return t('billing.unlimited');
  return String(n);
}

function formatStorageCap(bytes: number, locale: string, t: (k: string) => string): string {
  if (bytes < 0) return t('billing.unlimited');
  return formatBytes(bytes, locale);
}

function isUnlimitedNumericCap(plan: TenantPlan, n: number): boolean {
  return plan === 'enterprise' || n < 0;
}

function PlanCard({
  plan,
  current,
  locale,
}: {
  plan: TenantPlan;
  current: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const L = PLAN_LIMITS[plan];
  const localeTag = locale.startsWith('en') ? 'en-GB' : 'it-IT';

  return (
    <div
      className={`rounded-2xl border p-5 ${current ? 'border-sc-primary/50 bg-sc-primary/8 ring-1 ring-sc-primary/25' : 'border-sc-primary/12 bg-sc-surface/50'
        }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-sc-text">{t(`tenantQuota.planLabels.${plan}`)}</h3>
        {current ? (
          <span className="shrink-0 rounded-full bg-sc-primary/20 px-2 py-0.5 text-xs font-medium text-sc-primary">
            {t('billing.currentPlanBadge')}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-sm text-sc-text-muted">{t(`billing.price_${plan}`)}</p>
      <ul className="mt-4 space-y-2 text-xs text-sc-text-secondary">
        <li>
          · {t('billing.featureStorage')}: {formatStorageCap(L.storageLimitBytes, localeTag, t)}
        </li>
        <li>
          · {t('billing.featureEventsMonth')}:{' '}
          {isUnlimitedEventsPerMonth(plan, L.maxEventsPerMonth)
            ? t('billing.unlimited')
            : formatLimit(L.maxEventsPerMonth, t)}
        </li>
        <li>
          · {t('billing.featureRoomsEvent')}:{' '}
          {isUnlimitedRoomsPerEvent(plan, L.maxRoomsPerEvent) ? t('billing.unlimited') : formatLimit(L.maxRoomsPerEvent, t)}
        </li>
        <li>
          · {t('billing.featureUsers')}:{' '}
          {isUnlimitedNumericCap(plan, L.maxUsersPerTenant) ? t('billing.unlimited') : formatLimit(L.maxUsersPerTenant, t)}
        </li>
        <li>
          · {t('billing.featureAgents')}:{' '}
          {isUnlimitedNumericCap(plan, L.maxAgentsPerEvent) ? t('billing.unlimited') : formatLimit(L.maxAgentsPerEvent, t)}
        </li>
        <li>
          · {t('billing.featureMaxFile')}: {formatStorageCap(L.maxFileSizeBytes, localeTag, t)}
        </li>
      </ul>
    </div>
  );
}

export default function BillingView() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const tenantId = getTenantIdFromSession(session);
  const quotaState = useTenantQuotaRow(supabase, tenantId);
  const { state: eventsState } = useEvents(supabase, tenantId);
  const yearMonthNow = useMemo(() => currentYearMonthLocal(), []);
  const eventsStartingThisMonth = useMemo(
    () => (eventsState.status === 'ready' ? countEventsWithStartInYearMonth(eventsState.events, yearMonthNow) : 0),
    [eventsState, yearMonthNow],
  );
  const urls = useMemo(() => getBillingEnvUrls(), []);

  const currentPlan = quotaState.state.status === 'ready' ? quotaState.state.row.plan : null;

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sc-primary/20 bg-sc-primary/10 text-sc-primary">
          <CreditCard className="h-6 w-6" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-sc-text">{t('billing.title')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-sc-text-muted">{t('billing.intro')}</p>
        </div>
      </div>

      {urls.liveWorksApp ? (
        <p className="mt-6">
          <a
            href={urls.liveWorksApp}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-sc-primary hover:underline"
          >
            {t('billing.liveWorksLink')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        </p>
      ) : null}

      <div className="mt-8 max-w-2xl">
        {quotaState.state.status === 'error' ? (
          <p className="text-sm text-sc-warning" role="alert">
            {quotaState.state.message === 'no_tenant_row'
              ? t('tenantQuota.loadErrorNoRow')
              : `${t('tenantQuota.loadError')} (${quotaState.state.message})`}
          </p>
        ) : null}
        {quotaState.state.status === 'ready' ? (
          <TenantQuotaPanel variant="eventsPage" row={quotaState.state.row} eventsInCurrentMonth={eventsStartingThisMonth} />
        ) : quotaState.state.status === 'loading' ? (
          <p className="text-xs text-sc-text-dim">{t('common.loading')}</p>
        ) : null}
      </div>

      <section className="mt-10" aria-labelledby="billing-plans-heading">
        <h2 id="billing-plans-heading" className="text-lg font-semibold text-sc-text">
          {t('billing.plansSectionTitle')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-dim">{t('billing.plansSectionIntro')}</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {TENANT_PLANS.map((plan) => (
            <PlanCard key={plan} plan={plan} current={plan === currentPlan} locale={i18n.language} />
          ))}
        </div>
      </section>

      <section className="mt-10 rounded-2xl border border-sc-primary/12 bg-sc-surface/60 p-6" aria-labelledby="billing-actions-heading">
        <h2 id="billing-actions-heading" className="text-lg font-semibold text-sc-text">
          {t('billing.actionsSectionTitle')}
        </h2>
        <p className="mt-1 text-sm text-sc-text-dim">{t('billing.actionsSectionIntro')}</p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {urls.customerPortal ? (
            <a
              href={urls.customerPortal}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sc-primary/30 bg-sc-primary/10 px-4 py-2.5 text-sm font-medium text-sc-primary hover:bg-sc-primary/15"
            >
              {t('billing.openCustomerPortal')}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          ) : null}

          {urls.checkoutStarter && (currentPlan === 'trial' || currentPlan === null) ? (
            <a
              href={urls.checkoutStarter}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sc-primary px-4 py-2.5 text-sm font-medium text-white hover:bg-sc-primary/85"
            >
              {t('billing.checkoutStarter')}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          ) : null}

          {urls.checkoutPro && (currentPlan === 'trial' || currentPlan === 'starter' || currentPlan === null) ? (
            <a
              href={urls.checkoutPro}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-sc-primary/25 bg-sc-elevated px-4 py-2.5 text-sm font-medium text-sc-text-secondary hover:bg-sc-elevated"
            >
              {t('billing.checkoutPro')}
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
            </a>
          ) : null}
        </div>

        {!urls.checkoutStarter && !urls.checkoutPro && !urls.customerPortal ? (
          <p className="mt-4 text-sm text-sc-text-muted">{t('billing.checkoutEnvMissing')}</p>
        ) : null}

        {currentPlan === 'enterprise' ? (
          <p className="mt-4 text-sm text-sc-text-secondary">{t('billing.enterpriseActiveHint')}</p>
        ) : null}

        {!urls.liveWorksApp && currentPlan !== 'enterprise' ? (
          <p className="mt-4 text-sm text-sc-text-muted">{t('billing.enterpriseContactHint')}</p>
        ) : null}
      </section>
    </div>
  );
}

export { BillingView as Component };
