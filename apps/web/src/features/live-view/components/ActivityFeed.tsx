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
  if (action.includes('approved')) return 'text-emerald-400';
  if (action.includes('reject')) return 'text-red-400';
  if (action.startsWith('upload') || action.includes('version')) return 'text-blue-400';
  if (action.startsWith('delete') || action.startsWith('remove')) return 'text-amber-400';
  return 'text-zinc-400';
}

export function ActivityFeed({ entries, loading }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    [locale],
  );

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 bg-[#141416]">
      <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-100">{t('liveView.activityTitle')}</h3>
        {loading ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" title={t('common.loading')} />
        ) : null}
      </header>
      <div className="max-h-[420px] overflow-y-auto">
        {entries.length === 0 ? (
          <p className="p-4 text-xs text-zinc-500">{t('liveView.noActivity')}</p>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {entries.map((e) => (
              <li key={e.id} className="flex gap-3 px-4 py-2.5">
                <span className={`mt-0.5 shrink-0 text-sm font-bold ${actionColor(e.action)}`}>
                  {actionIcon(e.action)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-300">
                    <span className="font-medium">{e.actor_name ?? e.actor}</span>
                    {' — '}
                    <span>{e.action}</span>
                    {e.entity_type ? (
                      <span className="text-zinc-500"> ({e.entity_type})</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
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
