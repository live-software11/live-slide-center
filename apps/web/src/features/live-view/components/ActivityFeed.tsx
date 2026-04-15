import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Database } from '@slidecenter/shared';

type ActivityRow = Database['public']['Tables']['activity_log']['Row'];

interface Props {
  entries: ActivityRow[];
  loading: boolean;
}

function actionIcon(action: string): string {
  if (action.startsWith('upload') || action.includes('version')) return '↑';
  if (action.startsWith('review') || action.includes('approved')) return '✓';
  if (action.includes('reject')) return '✕';
  if (action.startsWith('delete') || action.startsWith('remove')) return '−';
  if (action.startsWith('create') || action.startsWith('add')) return '+';
  return '•';
}

function actionColor(action: string): string {
  if (action.includes('approved')) return 'text-sc-success';
  if (action.includes('reject')) return 'text-sc-danger';
  if (action.startsWith('upload') || action.includes('version')) return 'text-sc-primary';
  if (action.startsWith('delete') || action.startsWith('remove')) return 'text-sc-warning';
  return 'text-sc-text-muted';
}

export function ActivityFeed({ entries, loading }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [locale],
  );

  return (
    <div className="flex flex-col rounded-xl border border-sc-primary/12 bg-sc-surface">
      <header className="flex items-center justify-between border-b border-sc-primary/12 px-4 py-3">
        <h3 className="text-sm font-semibold text-sc-text">{t('liveView.activityTitle')}</h3>
        {loading ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-sc-primary" title={t('common.loading')} />
        ) : null}
      </header>
      <div className="max-h-[420px] overflow-y-auto">
        {entries.length === 0 ? (
          <p className="p-4 text-xs text-sc-text-dim">{t('liveView.noActivity')}</p>
        ) : (
          <ul className="divide-y divide-sc-primary/10">
            {entries.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-2.5">
                <span className={`mt-0.5 shrink-0 text-sm font-bold ${actionColor(e.action)}`}>
                  {actionIcon(e.action)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-sc-text-secondary">
                    <span className="font-medium">{e.actor_name ?? e.actor}</span>
                    {' — '}
                    <span>{e.action}</span>
                    {e.entity_type ? (
                      <span className="text-sc-text-dim"> ({e.entity_type})</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-sc-text-dim">
                    {timeFmt.format(new Date(e.created_at))}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
