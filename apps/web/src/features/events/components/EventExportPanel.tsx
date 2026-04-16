import type { SupabaseClient } from '@supabase/supabase-js';
import { Archive, FileSpreadsheet, FileText } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Database } from '@slidecenter/shared';
import type { EventRow } from '../repository';
import type { RoomRow } from '@/features/rooms/repository';
import type { SessionRow } from '@/features/sessions/repository';
import type { SpeakerRow } from '@/features/speakers/repository';
import {
  buildActivityLogCsv,
  buildEventReportPdf,
  buildEventSlidesZip,
  buildExportBaseName,
  downloadBlobFile,
  listActivityLogForEventExport,
  listCurrentReadySlidesForExport,
} from '../lib/event-export';

type ExportKind = 'zip' | 'csv' | 'pdf';

function sessionTypeLabel(t: TFunction, sessionType: string): string {
  const map: Record<string, string> = {
    talk: 'session.typeTalk',
    panel: 'session.typePanel',
    workshop: 'session.typeWorkshop',
    break: 'session.typeBreak',
    ceremony: 'session.typeCeremony',
  };
  const key = map[sessionType];
  return key ? t(key) : sessionType;
}

function eventStatusLabel(t: TFunction, status: string): string {
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

export interface EventExportPanelProps {
  supabase: SupabaseClient<Database>;
  event: EventRow;
  rooms: RoomRow[];
  sessions: SessionRow[];
  speakers: SpeakerRow[];
}

export function EventExportPanel({ supabase, event, rooms, sessions, speakers }: EventExportPanelProps) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState<ExportKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);

  const baseName = buildExportBaseName(event);

  const runZip = useCallback(async () => {
    setError(null);
    setBusy('zip');
    setZipProgress(null);
    try {
      const { rows, error: qErr } = await listCurrentReadySlidesForExport(supabase, event.id, speakers, sessions);
      if (qErr) throw new Error(qErr);
      if (!rows.length) {
        setError(t('event.export.errorZipEmpty'));
        return;
      }
      const blob = await buildEventSlidesZip(supabase, rows, (done, total) => {
        setZipProgress({ done, total });
      });
      downloadBlobFile(blob, `${baseName}_slides.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('event.export.errorZipFailed'));
    } finally {
      setBusy(null);
      setZipProgress(null);
    }
  }, [supabase, event.id, speakers, sessions, baseName, t]);

  const runCsv = useCallback(async () => {
    setError(null);
    setBusy('csv');
    try {
      const { rows, error: qErr } = await listActivityLogForEventExport(supabase, event.id);
      if (qErr) throw new Error(qErr);
      const csv = buildActivityLogCsv(rows, t);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      downloadBlobFile(blob, `${baseName}_activity_log.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('event.export.errorCsvFailed'));
    } finally {
      setBusy(null);
    }
  }, [supabase, event.id, baseName, t]);

  const runPdf = useCallback(async () => {
    setError(null);
    setBusy('pdf');
    try {
      const { rows: slides, error: sErr } = await listCurrentReadySlidesForExport(
        supabase,
        event.id,
        speakers,
        sessions,
      );
      if (sErr) throw new Error(sErr);
      const { rows: activityRows, error: aErr } = await listActivityLogForEventExport(supabase, event.id);
      if (aErr) throw new Error(aErr);

      const dateFmt = new Intl.DateTimeFormat(i18n.language.startsWith('en') ? 'en-GB' : 'it-IT', {
        dateStyle: 'short',
        timeStyle: 'short',
      });
      const generatedAtLabel = dateFmt.format(new Date());

      const blob = buildEventReportPdf({
        event,
        rooms,
        sessions,
        speakers,
        slides,
        activityRowCount: activityRows.length,
        t,
        generatedAtLabel,
        locale: i18n.language,
        formatSessionType: (st) => sessionTypeLabel(t, st),
        eventStatusLabel: eventStatusLabel(t, event.status),
        networkModeLabel: t(`event.networkMode_${event.network_mode ?? 'cloud'}`),
      });
      downloadBlobFile(blob, `${baseName}_report.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('event.export.errorPdfFailed'));
    } finally {
      setBusy(null);
    }
  }, [supabase, event, rooms, sessions, speakers, baseName, t, i18n.language]);

  return (
    <div className="rounded-xl border border-sc-primary/12 bg-sc-surface/60 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runZip()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-sc-primary/25 bg-sc-primary/10 px-4 py-3 text-sm font-medium text-sc-primary hover:bg-sc-primary/15 disabled:opacity-50 sm:min-w-40"
          aria-label={t('event.export.zipAria')}
        >
          <Archive className="h-4 w-4 shrink-0" aria-hidden />
          {busy === 'zip' ? t('event.export.zipBusy') : t('event.export.zipButton')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runCsv()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-sc-primary/25 bg-sc-elevated px-4 py-3 text-sm font-medium text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50 sm:min-w-40"
          aria-label={t('event.export.csvAria')}
        >
          <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
          {busy === 'csv' ? t('event.export.csvBusy') : t('event.export.csvButton')}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void runPdf()}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-sc-primary/25 bg-sc-elevated px-4 py-3 text-sm font-medium text-sc-text-secondary hover:bg-sc-elevated disabled:opacity-50 sm:min-w-40"
          aria-label={t('event.export.pdfAria')}
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden />
          {busy === 'pdf' ? t('event.export.pdfBusy') : t('event.export.pdfButton')}
        </button>
      </div>
      {zipProgress ? (
        <p className="mt-3 text-xs text-sc-text-muted" role="status">
          {t('event.export.zipProgress', { current: zipProgress.done, total: zipProgress.total })}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-sc-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
