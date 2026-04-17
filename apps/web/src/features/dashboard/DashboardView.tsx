import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Calendar, HardDrive, ShieldCheck, Activity, ArrowRight } from 'lucide-react';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import { useAuth } from '@/app/use-auth';
import { useTenantWarnings } from '@/features/notifications/hooks/useTenantWarnings';
import type { EventRow } from '@/features/events/repository';

type EventSummary = Pick<EventRow, 'id' | 'name' | 'status' | 'start_date' | 'end_date'>;

interface EventStats {
  total: number;
  active: number;
  upcomingNext: EventSummary | null;
}

export default function DashboardView() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const role = session?.user?.app_metadata?.role as string | undefined;
  const { license, storage, loading: warningsLoading } = useTenantWarnings();

  const [eventStats, setEventStats] = useState<EventStats | null>(null);
  const [loadingEvents, setLoadingEvents] = useState(false);

  const enabled = role !== 'super_admin';

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setLoadingEvents(true);
    });
    void (async () => {
      const { data, error } = await supabase
        .from('events')
        .select('id,name,status,start_date,end_date')
        .order('start_date', { ascending: true });
      if (cancelled) return;
      if (error) {
        setEventStats({ total: 0, active: 0, upcomingNext: null });
      } else {
        const rows = (data ?? []) as EventSummary[];
        const now = Date.now();
        const upcoming = rows.find((r) => new Date(r.start_date).getTime() >= now) ?? null;
        const active = rows.filter((r) => r.status === 'active' || r.status === 'setup').length;
        setEventStats({ total: rows.length, active, upcomingNext: upcoming });
      }
      setLoadingEvents(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, enabled]);

  if (role === 'super_admin') {
    return (
      <div className="p-6 lg:p-8">
        <h1 className="text-2xl font-bold text-sc-text">{t('nav.dashboard')}</h1>
        <p className="mt-2 text-sc-text-muted">{t('dashboard.superAdminHint')}</p>
        <div className="mt-6">
          <Link
            to="/admin"
            className="inline-flex items-center gap-2 rounded-lg bg-sc-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sc-accent/90"
          >
            {t('admin.navOverview')} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  const locale = i18n.language === 'en' ? 'en-GB' : 'it-IT';

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-sc-text">{t('nav.dashboard')}</h1>
        <p className="mt-1 text-sm text-sc-text-muted">{t('dashboard.subtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <DashboardCard
          icon={<Calendar className="h-5 w-5" />}
          title={t('dashboard.events.title')}
          value={loadingEvents ? '—' : String(eventStats?.total ?? 0)}
          hint={
            loadingEvents
              ? t('dashboard.loading')
              : eventStats?.active
                ? t('dashboard.events.active', { count: eventStats.active })
                : t('dashboard.events.empty')
          }
          accent="primary"
          href="/events"
          ctaLabel={t('dashboard.events.cta')}
        />

        <DashboardCard
          icon={<HardDrive className="h-5 w-5" />}
          title={t('dashboard.storage.title')}
          value={
            warningsLoading || !storage
              ? '—'
              : `${Math.round(storage.used_bytes / 1024 / 1024)} MB`
          }
          hint={
            warningsLoading || !storage
              ? t('dashboard.loading')
              : storage.limit_bytes > 0
                ? t('dashboard.storage.usage', {
                  percent: storage.percent?.toFixed(0) ?? '0',
                  limit: Math.round(storage.limit_bytes / 1024 / 1024),
                })
                : t('dashboard.storage.unlimited')
          }
          progress={storage?.percent ?? null}
          tone={
            storage?.threshold === 'critical'
              ? 'danger'
              : storage?.threshold === 'warning'
                ? 'warning'
                : 'primary'
          }
          accent="primary"
          href="/billing"
          ctaLabel={t('dashboard.storage.cta')}
        />

        <DashboardCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title={t('dashboard.license.title')}
          value={
            warningsLoading || !license
              ? '—'
              : license.suspended
                ? t('dashboard.license.suspended')
                : license.expires_at
                  ? new Date(license.expires_at).toLocaleDateString(locale)
                  : t('dashboard.license.unlimited')
          }
          hint={
            warningsLoading || !license
              ? t('dashboard.loading')
              : license.days_remaining !== null
                ? t('dashboard.license.daysRemaining', { count: license.days_remaining })
                : t('dashboard.license.activePlan', { plan: license.plan ?? '—' })
          }
          tone={
            license?.threshold === 'expired' || license?.threshold === 'critical'
              ? 'danger'
              : license?.threshold === 'warning'
                ? 'warning'
                : 'primary'
          }
          accent="primary"
          href="/billing"
          ctaLabel={t('dashboard.license.cta')}
        />
      </div>

      {eventStats?.upcomingNext ? (
        <section className="mt-6 rounded-2xl border border-sc-primary/15 bg-sc-surface p-5">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-sc-text-dim">
            <Activity className="h-4 w-4" />
            {t('dashboard.upcoming.title')}
          </div>
          <h2 className="mt-2 text-lg font-semibold text-sc-text">{eventStats.upcomingNext.name}</h2>
          <p className="mt-1 text-sm text-sc-text-muted">
            {new Date(eventStats.upcomingNext.start_date).toLocaleDateString(locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
            {' → '}
            {new Date(eventStats.upcomingNext.end_date).toLocaleDateString(locale, {
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <div className="mt-3">
            <Link
              to={`/events/${eventStats.upcomingNext.id}`}
              className="inline-flex items-center gap-2 rounded-lg bg-sc-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sc-primary-strong"
            >
              {t('dashboard.upcoming.open')} <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

interface DashboardCardProps {
  icon: React.ReactNode;
  title: string;
  value: string;
  hint?: string;
  progress?: number | null;
  tone?: 'primary' | 'warning' | 'danger';
  accent?: 'primary' | 'accent';
  href?: string;
  ctaLabel?: string;
}

function DashboardCard({ icon, title, value, hint, progress, tone = 'primary', href, ctaLabel }: DashboardCardProps) {
  const ringClass =
    tone === 'danger'
      ? 'border-sc-danger/30'
      : tone === 'warning'
        ? 'border-amber-500/30'
        : 'border-sc-primary/15';
  const progressClass =
    tone === 'danger' ? 'bg-sc-danger' : tone === 'warning' ? 'bg-amber-500' : 'bg-sc-primary';
  return (
    <article className={`flex flex-col gap-3 rounded-2xl border ${ringClass} bg-sc-surface p-5`}>
      <div className="flex items-center justify-between">
        <span className="text-sc-text-muted">{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide text-sc-text-dim">{title}</span>
      </div>
      <p className="text-2xl font-bold text-sc-text">{value}</p>
      {hint ? <p className="text-xs text-sc-text-muted">{hint}</p> : null}
      {progress !== null && progress !== undefined ? (
        <div className="h-2 w-full overflow-hidden rounded-full bg-sc-text/10" aria-hidden>
          <div
            className={`h-full rounded-full ${progressClass} transition-all`}
            style={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
          />
        </div>
      ) : null}
      {href && ctaLabel ? (
        <Link
          to={href}
          className="mt-auto inline-flex items-center gap-1 self-start text-xs font-semibold text-sc-primary transition-colors hover:text-sc-primary-strong"
        >
          {ctaLabel} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </article>
  );
}

export { DashboardView as Component };
