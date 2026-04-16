import type { SupabaseClient } from '@supabase/supabase-js';
import type { TFunction } from 'i18next';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import type { Database } from '@slidecenter/shared';
import { createVersionDownloadUrlWithClient } from '@/features/presentations/repository';
import { formatBytes } from '@/features/upload-portal/lib/format-bytes';
import type { EventRow } from '../repository';
import type { RoomRow } from '@/features/rooms/repository';
import type { SessionRow } from '@/features/sessions/repository';
import type { SpeakerRow } from '@/features/speakers/repository';

export type ActivityLogExportRow = Pick<
  Database['public']['Tables']['activity_log']['Row'],
  'id' | 'created_at' | 'actor' | 'actor_id' | 'actor_name' | 'action' | 'entity_type' | 'entity_id' | 'metadata'
>;

export interface CurrentSlideExportRow {
  speakerId: string;
  speakerName: string;
  sessionTitle: string;
  presentationId: string;
  presentationStatus: string;
  versionNumber: number;
  fileName: string;
  storageKey: string;
  fileSizeBytes: number;
  fileHashSha256: string | null;
  versionCreatedAt: string;
}

export function sanitizeExportSegment(raw: string, maxLen = 72): string {
  const s = raw
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
  return s.length > 0 ? s : 'export';
}

export function buildExportBaseName(event: EventRow): string {
  return sanitizeExportSegment(event.name, 48).replace(/\s/g, '_');
}

export function downloadBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function listActivityLogForEventExport(
  supabase: SupabaseClient<Database>,
  eventId: string,
  limit = 5000,
): Promise<{ rows: ActivityLogExportRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id, created_at, actor, actor_id, actor_name, action, entity_type, entity_id, metadata')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as ActivityLogExportRow[], error: null };
}

export async function listCurrentReadySlidesForExport(
  supabase: SupabaseClient<Database>,
  eventId: string,
  speakers: SpeakerRow[],
  sessions: SessionRow[],
): Promise<{ rows: CurrentSlideExportRow[]; error: string | null }> {
  const { data: presentations, error: pErr } = await supabase
    .from('presentations')
    .select('id, speaker_id, current_version_id, status')
    .eq('event_id', eventId);
  if (pErr) return { rows: [], error: pErr.message };

  const speakerById = new Map(speakers.map((s) => [s.id, s]));
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const rows: CurrentSlideExportRow[] = [];
  for (const p of presentations ?? []) {
    if (!p.current_version_id) continue;
    const { data: ver, error: vErr } = await supabase
      .from('presentation_versions')
      .select(
        'id, file_name, storage_key, status, version_number, file_size_bytes, file_hash_sha256, created_at',
      )
      .eq('id', p.current_version_id)
      .maybeSingle();
    if (vErr || !ver || ver.status !== 'ready') continue;
    const sp = speakerById.get(p.speaker_id);
    if (!sp) continue;
    const sess = sessionById.get(sp.session_id);
    rows.push({
      speakerId: sp.id,
      speakerName: sp.full_name,
      sessionTitle: sess?.title ?? '',
      presentationId: p.id,
      presentationStatus: p.status,
      versionNumber: ver.version_number,
      fileName: ver.file_name,
      storageKey: ver.storage_key,
      fileSizeBytes: ver.file_size_bytes,
      fileHashSha256: ver.file_hash_sha256,
      versionCreatedAt: ver.created_at,
    });
  }
  return { rows, error: null };
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildActivityLogCsv(rows: ActivityLogExportRow[], t: TFunction): string {
  const headers = [
    t('event.export.csvColCreatedAt'),
    t('event.export.csvColActor'),
    t('event.export.csvColActorName'),
    t('event.export.csvColAction'),
    t('event.export.csvColEntityType'),
    t('event.export.csvColEntityId'),
    t('event.export.csvColMetadata'),
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    const meta =
      r.metadata === null || r.metadata === undefined
        ? ''
        : typeof r.metadata === 'string'
          ? r.metadata
          : JSON.stringify(r.metadata);
    lines.push(
      [
        csvEscape(r.created_at),
        csvEscape(String(r.actor)),
        csvEscape(r.actor_name ?? ''),
        csvEscape(r.action),
        csvEscape(r.entity_type ?? ''),
        csvEscape(r.entity_id ?? ''),
        csvEscape(meta),
      ].join(','),
    );
  }
  return `\ufeff${lines.join('\r\n')}`;
}

function presentationStatusLabel(t: TFunction, status: string): string {
  const key: Record<string, string> = {
    pending: 'presentation.statusPending',
    uploaded: 'presentation.statusUploaded',
    reviewed: 'presentation.statusReviewed',
    approved: 'presentation.statusApproved',
    rejected: 'presentation.statusRejected',
  };
  const k = key[status];
  return k ? t(k) : status;
}

function roomTypeLabel(t: TFunction, roomType: string): string {
  const key: Record<string, string> = {
    main: 'room.typeMain',
    breakout: 'room.typeBreakout',
    preview: 'room.typePreview',
    poster: 'room.typePoster',
  };
  const k = key[roomType];
  return k ? t(k) : roomType;
}

export function buildEventReportPdf(params: {
  event: EventRow;
  rooms: RoomRow[];
  sessions: SessionRow[];
  speakers: SpeakerRow[];
  slides: CurrentSlideExportRow[];
  activityRowCount: number;
  t: TFunction;
  generatedAtLabel: string;
  locale: string;
  formatSessionType: (sessionType: string) => string;
  eventStatusLabel: string;
  networkModeLabel: string;
}): Blob {
  const {
    event,
    rooms,
    sessions,
    speakers,
    slides,
    activityRowCount,
    t,
    generatedAtLabel,
    locale,
    formatSessionType,
    eventStatusLabel,
    networkModeLabel,
  } = params;
  const localeTag = locale.startsWith('en') ? 'en-GB' : 'it-IT';
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  let y = 18;
  const lineH = 5;
  const gap = 2;

  const nextPage = () => {
    doc.addPage();
    y = 18;
  };

  const ensure = (need: number) => {
    const maxY = doc.internal.pageSize.getHeight() - 16;
    if (y + need > maxY) nextPage();
  };

  doc.setFontSize(16);
  doc.text(t('event.export.pdfTitle'), margin, y);
  y += 10;
  doc.setFontSize(10);
  doc.text(`${t('event.name')}: ${event.name}`, margin, y);
  y += lineH;
  doc.text(`${t('event.startDate')}: ${event.start_date} → ${event.end_date}`, margin, y);
  y += lineH;
  doc.text(`${t('event.status')}: ${eventStatusLabel}`, margin, y);
  y += lineH;
  doc.text(`${t('event.networkMode')}: ${networkModeLabel}`, margin, y);
  y += lineH + gap;
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text(`${t('event.export.pdfGeneratedAt')}: ${generatedAtLabel}`, margin, y);
  doc.setTextColor(0);
  y += lineH + gap * 2;

  doc.setFontSize(12);
  ensure(10);
  doc.text(t('event.export.pdfSectionRooms'), margin, y);
  y += 8;
  doc.setFontSize(9);
  if (rooms.length === 0) {
    ensure(lineH);
    doc.text(t('event.export.pdfEmptyRooms'), margin, y);
    y += lineH + gap;
  } else {
    for (const r of rooms) {
      ensure(lineH);
      doc.text(`· ${r.name} (${roomTypeLabel(t, r.room_type)})`, margin, y);
      y += lineH;
    }
    y += gap;
  }

  doc.setFontSize(12);
  ensure(10);
  doc.text(t('event.export.pdfSectionSessions'), margin, y);
  y += 8;
  doc.setFontSize(9);
  const sessSorted = [...sessions].sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  if (sessSorted.length === 0) {
    ensure(lineH);
    doc.text(t('event.export.pdfEmptySessions'), margin, y);
    y += lineH + gap;
  } else {
    const roomName = (id: string) => rooms.find((x) => x.id === id)?.name ?? id;
    for (const s of sessSorted) {
      ensure(lineH * 2);
      const line = doc.splitTextToSize(
        `· ${s.title} — ${roomName(s.room_id)} — ${formatSessionType(s.session_type)} — ${s.scheduled_start.slice(0, 16)} → ${s.scheduled_end.slice(0, 16)}`,
        pageW - margin * 2,
      ) as string[];
      for (const ln of line) {
        doc.text(ln, margin, y);
        y += lineH;
      }
    }
    y += gap;
  }

  doc.setFontSize(12);
  ensure(10);
  doc.text(t('event.export.pdfSectionSpeakers'), margin, y);
  y += 8;
  doc.setFontSize(9);
  const spkSorted = [...speakers].sort((a, b) => a.display_order - b.display_order);
  if (spkSorted.length === 0) {
    ensure(lineH);
    doc.text(t('event.export.pdfEmptySpeakers'), margin, y);
    y += lineH + gap;
  } else {
    const sessTitle = (id: string) => sessions.find((x) => x.id === id)?.title ?? id;
    for (const sp of spkSorted) {
      ensure(lineH * 2);
      const email = sp.email?.trim() ? ` — ${sp.email}` : '';
      const line = doc.splitTextToSize(`· ${sp.full_name}${email} — ${sessTitle(sp.session_id)}`, pageW - margin * 2);
      for (const ln of line) {
        doc.text(ln, margin, y);
        y += lineH;
      }
    }
    y += gap;
  }

  doc.setFontSize(12);
  ensure(10);
  doc.text(t('event.export.pdfSectionSlides'), margin, y);
  y += 8;
  doc.setFontSize(9);
  if (slides.length === 0) {
    ensure(lineH);
    doc.text(t('event.export.pdfEmptySlides'), margin, y);
    y += lineH + gap;
  } else {
    for (const s of slides) {
      ensure(lineH * 3);
      const hashShort = s.fileHashSha256 ? `${s.fileHashSha256.slice(0, 12)}…` : '—';
      const line1 = doc.splitTextToSize(
        `· ${s.speakerName} — v${s.versionNumber} — ${presentationStatusLabel(t, s.presentationStatus)} — ${s.fileName}`,
        pageW - margin * 2,
      ) as string[];
      for (const ln of line1) {
        doc.text(ln, margin, y);
        y += lineH;
      }
      doc.text(
        `  ${t('presentation.fileSize')}: ${formatBytes(s.fileSizeBytes, localeTag)} — ${t('presentation.hash')}: ${hashShort}`,
        margin,
        y,
      );
      y += lineH + gap / 2;
    }
  }

  doc.setFontSize(12);
  ensure(10);
  doc.text(t('event.export.pdfSectionActivity'), margin, y);
  y += 8;
  doc.setFontSize(9);
  ensure(lineH);
  doc.text(t('event.export.pdfActivityRows', { count: activityRowCount }), margin, y);
  y += lineH + gap;

  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(t('event.export.pdfFooter'), margin, doc.internal.pageSize.getHeight() - 10);
  return doc.output('blob');
}

export async function buildEventSlidesZip(
  supabase: SupabaseClient<Database>,
  slides: CurrentSlideExportRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const folder = zip.folder('slides');
  if (!folder) throw new Error('zip_folder_failed');

  let i = 0;
  for (const row of slides) {
    const url = await createVersionDownloadUrlWithClient(supabase, row.storageKey);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch_failed_${res.status}`);
    const buf = await res.arrayBuffer();
    const base = sanitizeExportSegment(row.speakerName, 40);
    const fname = sanitizeExportSegment(row.fileName, 120);
    const path = `${base}_v${row.versionNumber}_${fname}`;
    folder.file(path, buf);
    i += 1;
    onProgress?.(i, slides.length);
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
