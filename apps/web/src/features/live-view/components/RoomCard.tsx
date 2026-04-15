import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LiveRoomData } from '../repository';

interface Props {
  data: LiveRoomData;
}

function presentationStatusColor(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-sc-success';
    case 'uploaded':
    case 'reviewed':
      return 'bg-sc-primary';
    case 'rejected':
      return 'bg-red-500';
    default:
      return 'bg-zinc-600';
  }
}

export function RoomCard({ data }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const timeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  );

  const { room, sessions, speakers, presentations } = data;

  const now = new Date();
  const currentSession = sessions.find(
    (s) => new Date(s.scheduled_start) <= now && new Date(s.scheduled_end) > now,
  );
  const nextSession = sessions.find((s) => new Date(s.scheduled_start) > now);

  const totalSpeakers = speakers.length;
  const uploadedCount = presentations.filter(
    (p) => p.status === 'uploaded' || p.status === 'reviewed' || p.status === 'approved',
  ).length;
  const approvedCount = presentations.filter((p) => p.status === 'approved').length;

  const uploadRatio = totalSpeakers > 0 ? uploadedCount / totalSpeakers : 0;
  const barColor =
    uploadRatio >= 1 ? 'bg-sc-success' : uploadRatio > 0.5 ? 'bg-sc-primary' : uploadRatio > 0 ? 'bg-sc-warning' : 'bg-zinc-700';

  return (
    <div className="flex flex-col rounded-xl border border-sc-primary/12 bg-sc-surface p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-50">{room.name}</h3>
          <p className="text-[10px] uppercase tracking-wide text-sc-text-dim">
            {t(`room.type${capitalize(room.room_type)}`)}
          </p>
        </div>
        <span className="shrink-0 text-xs font-mono tabular-nums text-sc-text-muted">
          {uploadedCount}/{totalSpeakers}
        </span>
      </header>

      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-sc-elevated">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.round(uploadRatio * 100)}%` }}
        />
      </div>

      {currentSession ? (
        <div className="mb-2 rounded-md border border-blue-900/40 bg-blue-950/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-sc-primary">{t('liveView.nowPlaying')}</p>
          <p className="mt-0.5 text-sm font-medium text-sc-text line-clamp-1">{currentSession.title}</p>
          <p className="text-xs text-sc-text-muted">
            {timeFmt.format(new Date(currentSession.scheduled_start))} – {timeFmt.format(new Date(currentSession.scheduled_end))}
          </p>
        </div>
      ) : (
        <div className="mb-2 rounded-md border border-sc-primary/12 bg-sc-surface/40 px-3 py-2">
          <p className="text-[10px] text-sc-text-dim">{t('liveView.noCurrentSession')}</p>
        </div>
      )}

      {nextSession && (!currentSession || nextSession.id !== currentSession.id) ? (
        <div className="mb-3 rounded-md border border-sc-primary/12 bg-sc-surface/40 px-3 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-sc-text-dim">{t('liveView.upNext')}</p>
          <p className="text-xs text-sc-text-secondary line-clamp-1">{nextSession.title}</p>
          <p className="text-[10px] text-sc-text-dim">
            {timeFmt.format(new Date(nextSession.scheduled_start))}
          </p>
        </div>
      ) : null}

      {speakers.length > 0 ? (
        <ul className="mt-auto space-y-1">
          {speakers.slice(0, 6).map((sp) => {
            const pres = presentations.find((p) => p.speaker_id === sp.id);
            return (
              <li key={sp.id} className="flex items-center gap-2 text-xs">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${pres ? presentationStatusColor(pres.status) : 'bg-zinc-700'}`}
                  title={pres ? t(`presentation.status${capitalize(pres.status)}`) : t('presentation.statusPending')}
                />
                <span className="truncate text-sc-text-secondary">{sp.full_name}</span>
              </li>
            );
          })}
          {speakers.length > 6 ? (
            <li className="text-[10px] text-sc-text-dim">
              {t('liveView.moreItems', { count: speakers.length - 6 })}
            </li>
          ) : null}
        </ul>
      ) : null}

      <footer className="mt-3 border-t border-sc-primary/12 pt-2 text-[10px] text-sc-text-dim">
        {t('liveView.approvedCount', { count: approvedCount, total: totalSpeakers })}
      </footer>
    </div>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
