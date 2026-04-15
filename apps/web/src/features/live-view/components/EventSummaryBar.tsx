import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LiveEventSnapshot } from '../repository';

interface Props {
  snapshot: LiveEventSnapshot;
  eventName: string;
}

export function EventSummaryBar({ snapshot, eventName }: Props) {
  const { t } = useTranslation();

  const stats = useMemo(() => {
    let totalSpeakers = 0;
    let uploaded = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of snapshot.rooms) {
      totalSpeakers += r.speakers.length;
      for (const p of r.presentations) {
        if (p.status === 'uploaded' || p.status === 'reviewed' || p.status === 'approved') uploaded++;
        if (p.status === 'approved') approved++;
        if (p.status === 'rejected') rejected++;
      }
    }
    return { rooms: snapshot.rooms.length, totalSpeakers, uploaded, approved, rejected };
  }, [snapshot]);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-zinc-800 bg-[#141416] px-5 py-3">
      <h2 className="text-sm font-semibold text-zinc-50 sm:text-base">{eventName}</h2>
      <Stat label={t('liveView.statRooms')} value={stats.rooms} />
      <Stat label={t('liveView.statSpeakers')} value={stats.totalSpeakers} />
      <Stat label={t('liveView.statUploaded')} value={stats.uploaded} color="text-blue-400" />
      <Stat label={t('liveView.statApproved')} value={stats.approved} color="text-emerald-400" />
      {stats.rejected > 0 ? (
        <Stat label={t('liveView.statRejected')} value={stats.rejected} color="text-red-400" />
      ) : null}
    </div>
  );
}

function Stat({ label, value, color = 'text-zinc-100' }: { label: string; value: number; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-lg font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-xs text-zinc-500">{label}</span>
    </div>
  );
}
