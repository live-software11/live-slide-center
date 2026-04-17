import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; latencyMs: number; detail?: string }
  | { status: 'fail'; message: string };

type CountersState =
  | { status: 'loading' }
  | { status: 'ready'; data: TenantHealthRow }
  | { status: 'error'; message: string };

type TenantHealthRow = {
  tenants_total: number;
  tenants_active: number;
  tenants_suspended: number;
  events_total: number;
  events_active: number;
  users_total: number;
  users_signups_7d: number;
  db_size_mb: number;
  as_of: string;
};

const PINGED_FUNCTIONS = ['team-invite-accept', 'licensing-sync'];

export default function AdminHealthView() {
  const { t, i18n } = useTranslation();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [supabasePing, setSupabasePing] = useState<CheckState>({ status: 'idle' });
  const [counters, setCounters] = useState<CountersState>({ status: 'loading' });
  const [edgePings, setEdgePings] = useState<Record<string, CheckState>>(() =>
    Object.fromEntries(PINGED_FUNCTIONS.map((fn) => [fn, { status: 'idle' } as CheckState])),
  );

  const dateFmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language?.startsWith('en') ? 'en-US' : 'it-IT', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }),
    [i18n.language],
  );

  const runSupabasePing = useCallback(async () => {
    setSupabasePing({ status: 'checking' });
    const t0 = performance.now();
    try {
      const { error } = await supabase.from('tenants').select('id', { count: 'exact', head: true }).limit(1);
      const latency = Math.round(performance.now() - t0);
      if (error) {
        setSupabasePing({ status: 'fail', message: error.message });
        return;
      }
      setSupabasePing({ status: 'ok', latencyMs: latency });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown_error';
      setSupabasePing({ status: 'fail', message });
    }
  }, [supabase]);

  const runEdgePings = useCallback(async () => {
    setEdgePings(Object.fromEntries(PINGED_FUNCTIONS.map((fn) => [fn, { status: 'checking' } as CheckState])));
    const results: Record<string, CheckState> = {};
    await Promise.all(
      PINGED_FUNCTIONS.map(async (fn) => {
        const t0 = performance.now();
        try {
          const { error } = await supabase.functions.invoke(fn, { body: { healthcheck: true } });
          const latency = Math.round(performance.now() - t0);
          // Per "team-invite-accept" e "licensing-sync" un body senza credenziali ritorna 4xx:
          // questa risposta significa che la function e' raggiungibile/online (auth gate attivo).
          if (error) {
            const msg = error.message ?? 'unknown';
            const isOnline = /401|403|400|invalid/i.test(msg);
            results[fn] = isOnline
              ? { status: 'ok', latencyMs: latency, detail: 'reachable_auth_gated' }
              : { status: 'fail', message: msg };
            return;
          }
          results[fn] = { status: 'ok', latencyMs: latency };
        } catch (err) {
          results[fn] = { status: 'fail', message: err instanceof Error ? err.message : 'unknown_error' };
        }
      }),
    );
    setEdgePings(results);
  }, [supabase]);

  const runCounters = useCallback(async () => {
    setCounters({ status: 'loading' });
    try {
      const { data, error } = await supabase.rpc('tenant_health');
      if (error) throw error;
      setCounters({ status: 'ready', data: data as TenantHealthRow });
    } catch (err) {
      setCounters({ status: 'error', message: err instanceof Error ? err.message : 'unknown_error' });
    }
  }, [supabase]);

  const refreshAll = useCallback(() => {
    void runSupabasePing();
    void runEdgePings();
    void runCounters();
  }, [runSupabasePing, runEdgePings, runCounters]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-sc-text">{t('health.pageTitle')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-sc-text-muted">{t('health.pageIntro')}</p>
        </div>
        <button
          type="button"
          onClick={refreshAll}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sc-accent/30 bg-sc-accent/10 px-4 py-2 text-sm font-medium text-sc-accent transition-colors hover:bg-sc-accent/15"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t('health.refresh')}
        </button>
      </div>

      <section className="mt-8 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-sc-accent/15 bg-sc-surface/60 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-base font-semibold text-sc-text">{t('health.supabase')}</h2>
            <CheckBadge state={supabasePing} />
          </div>
          <p className="mt-2 text-xs text-sc-text-muted">
            {supabasePing.status === 'ok' ? `${supabasePing.latencyMs} ms` : null}
            {supabasePing.status === 'fail' ? supabasePing.message : null}
            {supabasePing.status === 'checking' ? t('health.checking') : null}
          </p>
        </div>

        <div className="rounded-xl border border-sc-accent/15 bg-sc-surface/60 p-5">
          <h2 className="text-base font-semibold text-sc-text">{t('health.edgeFunctions')}</h2>
          <ul className="mt-3 space-y-2">
            {PINGED_FUNCTIONS.map((fn) => {
              const st = edgePings[fn] ?? { status: 'idle' };
              return (
                <li key={fn} className="flex items-center justify-between gap-2 rounded-lg bg-sc-bg/40 px-3 py-2">
                  <span className="font-mono text-xs text-sc-text-muted">{fn}</span>
                  <div className="flex items-center gap-2">
                    {st.status === 'ok' ? (
                      <span className="text-xs text-sc-text-dim">{st.latencyMs} ms</span>
                    ) : null}
                    {st.status === 'fail' ? (
                      <span className="max-w-[200px] truncate text-xs text-sc-danger" title={st.message}>
                        {st.message}
                      </span>
                    ) : null}
                    <CheckBadge state={st} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="mt-8 rounded-xl border border-sc-accent/15 bg-sc-surface/60 p-5">
        <h2 className="text-base font-semibold text-sc-text">{t('health.counters')}</h2>
        {counters.status === 'loading' ? (
          <p className="mt-3 text-sm text-sc-text-muted">{t('common.loading')}</p>
        ) : null}
        {counters.status === 'error' ? (
          <p className="mt-3 text-sm text-sc-danger" role="alert">
            {counters.message}
          </p>
        ) : null}
        {counters.status === 'ready' ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <CounterCard label={t('health.tenantsTotal')} value={counters.data.tenants_total} />
              <CounterCard label={t('health.tenantsActive')} value={counters.data.tenants_active} tone="success" />
              <CounterCard label={t('health.tenantsSuspended')} value={counters.data.tenants_suspended} tone="warning" />
              <CounterCard label={t('health.eventsTotal')} value={counters.data.events_total} />
              <CounterCard label={t('health.eventsActive')} value={counters.data.events_active} tone="success" />
              <CounterCard label={t('health.usersTotal')} value={counters.data.users_total} />
              <CounterCard label={t('health.signups7d')} value={counters.data.users_signups_7d} tone="success" />
              <CounterCard label={t('health.dbSizeMb')} value={Number(counters.data.db_size_mb).toFixed(1)} />
            </div>
            <p className="mt-4 text-xs text-sc-text-dim">
              {t('health.asOf', { date: dateFmt.format(new Date(counters.data.as_of)) })}
            </p>
          </>
        ) : null}
      </section>
    </div>
  );
}

function CheckBadge({ state }: { state: CheckState }) {
  const { t } = useTranslation();
  if (state.status === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden />
        {t('health.ok')}
      </span>
    );
  }
  if (state.status === 'fail') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-700/50 bg-red-950/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-300">
        <XCircle className="h-3 w-3" aria-hidden />
        {t('health.fail')}
      </span>
    );
  }
  if (state.status === 'checking') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-sc-primary/30 bg-sc-primary/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sc-primary">
        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden />
        {t('health.checking')}
      </span>
    );
  }
  return null;
}

function CounterCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'success' | 'warning';
}) {
  const colorClass = tone === 'success' ? 'text-emerald-300' : tone === 'warning' ? 'text-amber-300' : 'text-sc-text';
  return (
    <div className="rounded-lg border border-sc-primary/12 bg-sc-bg/40 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-sc-text-dim">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tabular-nums ${colorClass}`}>{value}</p>
    </div>
  );
}

export { AdminHealthView as Component };
