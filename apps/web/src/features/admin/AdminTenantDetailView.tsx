import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { formatBytes } from './lib/format-bytes';
import type { TenantRow } from './repository';
import { useAdminTenantDetail } from './hooks/useAdminTenantDetail';
import { isUnlimitedStorage } from '@/features/tenant/lib/quota-usage';

const TENANT_PLANS: Database['public']['Enums']['tenant_plan'][] = ['trial', 'starter', 'pro', 'enterprise'];

// Audit allineamento WORKS<->SC 2026-04-20: l'UI admin ora usa GB invece di
// byte (allineato a Live WORKS APP "GenerateLicenseDialog" e
// "QuickSlideCenterChip" che gia' lavorano in GB). Convenzione -1 = illimitato
// (Enterprise) preservata: l'utente puo' scrivere "-1" e viene salvato come -1
// senza conversione.
const BYTES_PER_GB = 1024 ** 3;

function bytesToGbDisplay(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes === -1) return '-1';
  if (!Number.isFinite(bytes)) return '';
  const gb = bytes / BYTES_PER_GB;
  // Mostra senza decimali superflui (es. 1, 1.5, 0.5).
  return Number.isInteger(gb) ? String(gb) : Number(gb.toFixed(2)).toString();
}

function gbDisplayToBytes(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  if (num === -1) return -1;
  if (num < 0) return null;
  return Math.round(num * BYTES_PER_GB);
}

function eventStatusLabel(t: (k: string) => string, status: string): string {
  const map: Record<string, string> = {
    draft: 'event.statusDraft',
    setup: 'event.statusSetup',
    active: 'event.statusActive',
    closed: 'event.statusClosed',
    archived: 'event.statusArchived',
  };
  const key = map[status];
  return key ? t(key) : status;
}

function TenantQuotaForm({
  tenant,
  tenantId,
  supabase,
  disabled,
  onAfterSave,
}: {
  tenant: TenantRow;
  tenantId: string;
  supabase: SupabaseClient<Database>;
  disabled: boolean;
  onAfterSave: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState(tenant.plan);
  // Audit allineamento WORKS<->SC 2026-04-20: storage in GB (non byte).
  const [storageGbStr, setStorageGbStr] = useState(bytesToGbDisplay(tenant.storage_limit_bytes));
  const [maxEventsStr, setMaxEventsStr] = useState(String(tenant.max_events_per_month));
  const [maxRoomsStr, setMaxRoomsStr] = useState(String(tenant.max_rooms_per_event));
  // Audit UI nomenclatura quote 2026-04-20: prefer max_devices_per_event (la
  // colonna nuova canonica) ma fallback alla vecchia per safety durante la
  // finestra di rollout. Lo stato locale rappresenta il valore "per evento".
  const [maxDevicesStr, setMaxDevicesStr] = useState(
    String(tenant.max_devices_per_event ?? tenant.max_devices_per_room)
  );
  const [maxActiveEventsStr, setMaxActiveEventsStr] = useState(
    tenant.max_active_events === null || tenant.max_active_events === undefined
      ? ''
      : String(tenant.max_active_events)
  );
  const [expiresAtStr, setExpiresAtStr] = useState(
    tenant.expires_at ? tenant.expires_at.slice(0, 10) : ''
  );
  const [saveMsg, setSaveMsg] = useState<'idle' | 'ok' | 'err'>('idle');
  const [saveDetail, setSaveDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const storageRatio =
    tenant.storage_limit_bytes > 0
      ? Math.min(100, (tenant.storage_used_bytes / tenant.storage_limit_bytes) * 100)
      : 0;

  const onSaveQuotas = useCallback(async () => {
    // Audit allineamento WORKS<->SC 2026-04-20: storage convertito da GB a byte
    // prima del save. Convenzione -1 = illimitato preservata.
    const storage_limit_bytes = gbDisplayToBytes(storageGbStr);
    const max_events_per_month = Number(maxEventsStr);
    const max_rooms_per_event = Number(maxRoomsStr);
    const max_devices_per_event = Number(maxDevicesStr);
    if (
      storage_limit_bytes === null ||
      !Number.isFinite(storage_limit_bytes) ||
      !Number.isInteger(max_events_per_month) ||
      !Number.isInteger(max_rooms_per_event) ||
      !Number.isInteger(max_devices_per_event)
    ) {
      setSaveMsg('err');
      setSaveDetail(t('admin.tenantDetailQuotaInvalid'));
      return;
    }
    if (max_events_per_month < 0 || max_rooms_per_event < 0 || max_devices_per_event < 0) {
      setSaveMsg('err');
      setSaveDetail(t('admin.tenantDetailQuotaInvalid'));
      return;
    }

    /**
     * Audit bidirezionalita 2026-04-19 (GAP-4): supporto -1 (illimitato) per
     * `max_active_events`. Stringa vuota = NULL (default = unlimited per coerenza
     * con la migration `20260420100000_max_active_events.sql`).
     */
    let max_active_events: number | null = null;
    if (maxActiveEventsStr.trim() !== '') {
      const parsed = Number(maxActiveEventsStr);
      if (!Number.isInteger(parsed) || parsed < -1) {
        setSaveMsg('err');
        setSaveDetail(t('admin.tenantDetailQuotaInvalid'));
        return;
      }
      max_active_events = parsed;
    }

    /**
     * Audit bidirezionalita 2026-04-19 (GAP-4): expires_at opzionale.
     * Stringa vuota = NULL (lifetime / no scadenza). Stringa = ISO date YYYY-MM-DD,
     * convertita in mezzanotte UTC della data scelta. Validazione minima.
     */
    let expires_at: string | null = null;
    if (expiresAtStr.trim() !== '') {
      const parsedDate = new Date(`${expiresAtStr}T23:59:59Z`);
      if (Number.isNaN(parsedDate.getTime())) {
        setSaveMsg('err');
        setSaveDetail(t('admin.tenantDetailQuotaInvalid'));
        return;
      }
      expires_at = parsedDate.toISOString();
    }

    setSaving(true);
    setSaveMsg('idle');
    // Audit UI nomenclatura quote 2026-04-20: scriviamo SU ENTRAMBE le colonne
    // (max_devices_per_room legacy + max_devices_per_event canonica) per
    // mantenere allineamento durante la finestra di rollout. La RPC
    // licensing_apply_quota fa lo stesso quando WORKS pusha quote via Edge Fn.
    const { error } = await supabase
      .from('tenants')
      .update({
        plan,
        storage_limit_bytes,
        max_events_per_month,
        max_rooms_per_event,
        max_devices_per_room: max_devices_per_event,
        max_devices_per_event: max_devices_per_event,
        max_active_events,
        expires_at,
      })
      .eq('id', tenantId);
    setSaving(false);
    if (error) {
      setSaveMsg('err');
      setSaveDetail(error.message);
      return;
    }
    setSaveMsg('ok');
    setSaveDetail(null);
    await onAfterSave();
  }, [
    tenantId,
    supabase,
    plan,
    storageGbStr,
    maxEventsStr,
    maxRoomsStr,
    maxDevicesStr,
    maxActiveEventsStr,
    expiresAtStr,
    onAfterSave,
    t,
  ]);

  return (
    <section className="rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.tenantDetailQuotasTitle')}</h2>
      <p className="mt-2 text-xs text-sc-text-muted">{t('admin.tenantDetailQuotasIntro')}</p>

      <div className="mt-4">
        <p className="text-xs font-medium text-sc-text-muted">{t('admin.tenantDetailStorageUsed')}</p>
        <p className="mt-1 text-sm text-sc-text">{formatBytes(tenant.storage_used_bytes)}</p>
        {!isUnlimitedStorage(tenant.plan, tenant.storage_limit_bytes) && tenant.storage_limit_bytes > 0 ? (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-sc-bg">
            <div
              className="h-full rounded-full bg-sc-primary transition-all"
              style={{ width: `${storageRatio}%` }}
            />
          </div>
        ) : null}
      </div>

      <label className="mt-5 block text-xs font-medium text-sc-text-muted" htmlFor="adm-plan">
        {t('admin.colPlan')}
      </label>
      <select
        id="adm-plan"
        value={plan}
        onChange={(e) => setPlan(e.target.value as Database['public']['Enums']['tenant_plan'])}
        disabled={disabled || saving}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      >
        {TENANT_PLANS.map((p) => (
          <option key={p} value={p}>
            {t(`tenantQuota.planLabels.${p}`)}
          </option>
        ))}
      </select>

      <label className="mt-4 block text-xs font-medium text-sc-text-muted" htmlFor="adm-storage">
        {t('admin.tenantDetailStorageLimitGb')}
      </label>
      <input
        id="adm-storage"
        type="text"
        inputMode="decimal"
        value={storageGbStr}
        onChange={(e) => setStorageGbStr(e.target.value)}
        disabled={disabled || saving}
        placeholder={t('admin.tenantDetailStorageLimitGbPlaceholder')}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      />
      <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.tenantDetailStorageLimitGbHint')}</p>

      <label className="mt-4 block text-xs font-medium text-sc-text-muted" htmlFor="adm-ev">
        {t('admin.tenantDetailMaxEventsPerMonth')}
      </label>
      <input
        id="adm-ev"
        type="text"
        inputMode="numeric"
        value={maxEventsStr}
        onChange={(e) => setMaxEventsStr(e.target.value)}
        disabled={disabled || saving}
        placeholder={t('admin.tenantDetailMaxEventsPerMonthPlaceholder')}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      />
      <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.tenantDetailMaxEventsPerMonthHint')}</p>

      <label className="mt-4 block text-xs font-medium text-sc-text-muted" htmlFor="adm-rm">
        {t('tenantQuota.roomsThisEventLabel')} ({t('admin.tenantDetailMaxNumericHint')})
      </label>
      <input
        id="adm-rm"
        type="text"
        inputMode="numeric"
        value={maxRoomsStr}
        onChange={(e) => setMaxRoomsStr(e.target.value)}
        disabled={disabled || saving}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      />

      <label className="mt-4 block text-xs font-medium text-sc-text-muted" htmlFor="adm-dev">
        {t('admin.tenantDetailMaxDevicesPerEvent')} ({t('admin.tenantDetailMaxNumericHint')})
      </label>
      <input
        id="adm-dev"
        type="text"
        inputMode="numeric"
        value={maxDevicesStr}
        onChange={(e) => setMaxDevicesStr(e.target.value)}
        disabled={disabled || saving}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      />
      <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.tenantDetailMaxDevicesPerEventHint')}</p>

      <label className="mt-4 block text-xs font-medium text-sc-text-muted" htmlFor="adm-active-ev">
        {t('admin.tenantDetailMaxActiveEvents')}
      </label>
      <input
        id="adm-active-ev"
        type="text"
        inputMode="numeric"
        value={maxActiveEventsStr}
        onChange={(e) => setMaxActiveEventsStr(e.target.value)}
        disabled={disabled || saving}
        placeholder={t('admin.tenantDetailMaxActiveEventsPlaceholder')}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      />
      <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.tenantDetailMaxActiveEventsHint')}</p>

      <label className="mt-4 block text-xs font-medium text-sc-text-muted" htmlFor="adm-expires">
        {t('admin.tenantDetailExpiresAt')}
      </label>
      <input
        id="adm-expires"
        type="date"
        value={expiresAtStr}
        onChange={(e) => setExpiresAtStr(e.target.value)}
        disabled={disabled || saving}
        className="mt-1.5 w-full rounded-xl border border-sc-primary/15 bg-sc-bg px-3 py-2 font-mono text-sm text-sc-text outline-none focus:border-sc-primary/40 focus:ring-2 focus:ring-sc-ring/25 disabled:opacity-50"
      />
      <p className="mt-1 text-[11px] text-sc-text-dim">{t('admin.tenantDetailExpiresAtHint')}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => void onSaveQuotas()}
          className="rounded-xl bg-sc-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-sc-primary/20 hover:bg-sc-primary-deep disabled:opacity-50"
        >
          {t('admin.tenantDetailSaveQuotas')}
        </button>
        {saveMsg === 'ok' ? <span className="text-sm text-sc-success">{t('admin.tenantDetailSaveOk')}</span> : null}
        {saveMsg === 'err' ? (
          <span className="text-sm text-sc-danger" role="alert">
            {saveDetail ?? t('admin.tenantDetailSaveErr')}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export default function AdminTenantDetailView() {
  const { t } = useTranslation();
  const { tenantId } = useParams<{ tenantId: string }>();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const { state, reload } = useAdminTenantDetail(supabase, tenantId);

  const [busy, setBusy] = useState(false);

  const onToggleSuspend = useCallback(async () => {
    if (state.status !== 'ready') return;
    const row = state.bundle.tenant;
    const next = !row.suspended;
    const ok = next
      ? window.confirm(t('admin.tenantSuspendConfirm'))
      : window.confirm(t('admin.tenantUnsuspendConfirm'));
    if (!ok) return;
    setBusy(true);
    const { error } = await supabase.from('tenants').update({ suspended: next }).eq('id', row.id);
    setBusy(false);
    if (error) {
      window.alert(error.message);
      return;
    }
    await reload();
  }, [state, supabase, reload, t]);

  if (state.status === 'loading') {
    return (
      <div className="p-6 lg:p-8 text-sc-text-muted">
        {t('common.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-danger" role="alert">
          {t('admin.tenantDetailLoadError')}: {state.message}
        </p>
        <button
          type="button"
          onClick={() => void reload()}
          className="mt-4 rounded-xl bg-sc-elevated px-4 py-2 text-sm text-sc-text hover:bg-sc-primary/10"
        >
          {t('common.refresh')}
        </button>
      </div>
    );
  }

  if (state.status === 'not_found') {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sc-text-muted">{t('admin.tenantDetailNotFound')}</p>
        <Link to="/admin/tenants" className="mt-4 inline-block text-sm font-semibold text-sc-primary hover:underline">
          {t('admin.tenantDetailBackList')}
        </Link>
      </div>
    );
  }

  const { tenant, users, events, activity } = state.bundle;

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/admin/tenants"
            className="text-xs font-semibold uppercase tracking-wide text-sc-primary hover:text-sc-primary-deep hover:underline"
          >
            {t('admin.tenantDetailBackList')}
          </Link>
          <h1 className="mt-2 flex flex-wrap items-center gap-3 text-2xl font-bold text-sc-text">
            {tenant.name}
            {tenant.suspended ? (
              <span className="rounded-full bg-sc-danger/15 px-2.5 py-0.5 text-xs font-semibold text-sc-danger">
                {t('admin.tenantSuspendedBadge')}
              </span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-sc-text-muted">
            {t('admin.tenantDetailSlug')}: <span className="font-mono text-sc-text-secondary">{tenant.slug}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TenantQuotaForm
          key={tenant.updated_at}
          tenant={tenant}
          tenantId={tenant.id}
          supabase={supabase}
          disabled={busy}
          onAfterSave={reload}
        />

        <section className="rounded-xl border border-sc-accent/15 bg-sc-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-sc-accent">{t('admin.tenantDetailAccessTitle')}</h2>
          <p className="mt-2 text-sm leading-relaxed text-sc-text-muted">{t('admin.tenantDetailAccessBody')}</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onToggleSuspend()}
            className={`mt-5 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${tenant.suspended
              ? 'bg-sc-success/20 text-sc-success hover:bg-sc-success/30'
              : 'bg-sc-danger/15 text-sc-danger hover:bg-sc-danger/25'
              }`}
          >
            {tenant.suspended ? t('admin.tenantDetailUnsuspendCta') : t('admin.tenantDetailSuspendCta')}
          </button>
        </section>
      </div>

      <section className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.tenantDetailTeamTitle')}</h2>
        <p className="mt-1 text-xs text-sc-text-muted">{t('admin.tenantDetailTeamIntro')}</p>
        {users.length === 0 ? (
          <p className="mt-4 text-sm text-sc-text-dim">{t('admin.tenantDetailTeamEmpty')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-sc-primary/12">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-sc-primary/12 bg-sc-bg/80 text-xs uppercase text-sc-text-dim">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('auth.email')}</th>
                  <th className="px-3 py-2 font-medium">{t('speaker.fullName')}</th>
                  <th className="px-3 py-2 font-medium">{t('auth.role')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sc-primary/10">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-sc-elevated/40">
                    <td className="px-3 py-2 font-mono text-xs text-sc-text-secondary">{u.email}</td>
                    <td className="px-3 py-2 text-sc-text">{u.full_name}</td>
                    <td className="px-3 py-2 text-sc-text-muted">{t(`role.${u.role}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.tenantDetailEventsTitle')}</h2>
        <p className="mt-1 text-xs text-sc-text-muted">{t('admin.tenantDetailEventsIntro')}</p>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-sc-text-dim">{t('admin.tenantDetailEventsEmpty')}</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-sc-primary/12">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="border-b border-sc-primary/12 bg-sc-bg/80 text-xs uppercase text-sc-text-dim">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('event.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('event.startDate')}</th>
                  <th className="px-3 py-2 font-medium">{t('event.status')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sc-primary/10">
                {events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-sc-elevated/40">
                    <td className="px-3 py-2 text-sc-text">{ev.name}</td>
                    <td className="px-3 py-2 text-sc-text-muted">{ev.start_date}</td>
                    <td className="px-3 py-2 text-sc-text-secondary">{eventStatusLabel(t, ev.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-sc-primary/12 bg-sc-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-sc-text-dim">{t('admin.tenantDetailLogTitle')}</h2>
        <p className="mt-1 text-xs text-sc-text-muted">{t('admin.tenantDetailLogIntro')}</p>
        {activity.length === 0 ? (
          <p className="mt-4 text-sm text-sc-text-dim">{t('admin.tenantDetailLogEmpty')}</p>
        ) : (
          <ul className="mt-4 max-h-[420px] space-y-2 overflow-y-auto text-sm">
            {activity.map((log) => (
              <li
                key={log.id}
                className="rounded-lg border border-sc-primary/10 bg-sc-bg/50 px-3 py-2 font-mono text-xs text-sc-text-secondary"
              >
                <span className="text-sc-text-dim">{new Date(log.created_at).toLocaleString()}</span>{' '}
                <span className="text-sc-text">{log.action}</span>
                {log.entity_type ? (
                  <span className="text-sc-text-muted">
                    {' '}
                    · {log.entity_type}
                    {log.entity_id ? ` ${log.entity_id.slice(0, 8)}…` : ''}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export { AdminTenantDetailView as Component };
