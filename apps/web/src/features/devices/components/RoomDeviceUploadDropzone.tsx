import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Loader2, Upload, X, XCircle } from 'lucide-react';
import {
  useRoomDeviceUpload,
  type RoomDeviceUploadStatus,
} from '../hooks/useRoomDeviceUpload';

/**
 * Sprint R-3 (G3) — Componente UI per upload da PC sala.
 *
 * Visibile in `RoomPlayerView` SOLO quando la sala ha una sessione corrente
 * (`room_state.current_session != null`). L'upload e' sempre legato a una
 * sessione: senza sessione corrente, non si sa "su che sessione" caricare.
 *
 * Il file viene caricato sulla sessione corrente automaticamente. Future:
 * R-3.b potra' aggiungere un selettore manuale tra le sessioni della sala.
 *
 * INTEGRAZIONE FILE-SYNC:
 *  - Su success, chiamiamo `onUploadComplete` cosi' il parent triggera
 *    `useFileSync.refreshNow()` e il file diventa visibile nella lista.
 *  - Il broadcast realtime `room_device_upload_completed` viene inviato dal
 *    backend (Edge Function finalize) all'admin: non serve fare niente lato sala.
 */

export interface RoomDeviceUploadDropzoneProps {
  deviceToken: string;
  /** Sessione corrente (`room_state.current_session.id`). */
  currentSessionId: string | null;
  /** Titolo della sessione corrente (per UI). */
  currentSessionTitle: string | null;
  /** Trigger refresh files lato parent (es. `useFileSync.refreshNow`). */
  onUploadComplete?: () => void;
}

export function RoomDeviceUploadDropzone({
  deviceToken,
  currentSessionId,
  currentSessionTitle,
  onUploadComplete,
}: RoomDeviceUploadDropzoneProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCountRef = useRef(0);

  const { job, busy, upload, cancel, reset } = useRoomDeviceUpload({
    deviceToken,
    onUploadComplete: () => onUploadComplete?.(),
  });

  const handleFiles = useCallback(
    (files: FileList | File[] | null | undefined) => {
      if (!files || files.length === 0) return;
      if (!currentSessionId) return;
      if (busy) return;
      const arr = Array.from(files);
      // Single-file: prendiamo il primo. Sprint R-3.b potra' permettere multi.
      const first = arr.find((f) => f && f.size > 0 && f.name.length > 0);
      if (!first) return;
      void upload(first, currentSessionId);
    },
    [currentSessionId, busy, upload],
  );

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentSessionId || busy) return;
    if (!e.dataTransfer?.types.includes('Files')) return;
    dragCountRef.current += 1;
    setDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = Math.max(0, dragCountRef.current - 1);
    if (dragCountRef.current === 0) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCountRef.current = 0;
    setDragOver(false);
    handleFiles(e.dataTransfer?.files);
  };

  const noSession = !currentSessionId;

  // ── UI: stato attivo (preparing/uploading/hashing/finalizing) ────────
  if (job && (job.status === 'preparing' || job.status === 'uploading' ||
              job.status === 'hashing' || job.status === 'finalizing')) {
    return <UploadActivePanel job={job.fileName} status={job.status} progress={job.progress} uploaded={job.uploaded} total={job.fileSize} onCancel={cancel} />;
  }

  // ── UI: success ───────────────────────────────────────────────────────
  if (job && job.status === 'done') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-sc-success/30 bg-sc-success/10 px-3 py-2.5">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-sc-success" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs text-sc-success">
          {t('roomPlayer.upload.success', { name: job.fileName })}
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg px-2 py-1 text-xs text-sc-success hover:bg-sc-success/15"
        >
          {t('roomPlayer.upload.successCta')}
        </button>
      </div>
    );
  }

  // ── UI: error ─────────────────────────────────────────────────────────
  if (job && job.status === 'error') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-sc-danger/30 bg-sc-danger/10 px-3 py-2.5">
        <XCircle className="h-5 w-5 shrink-0 text-sc-danger" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-xs text-sc-danger">
          {t(job.errorKey ?? 'roomPlayer.upload.error.generic')}
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg px-2 py-1 text-xs text-sc-danger hover:bg-sc-danger/15"
        >
          {t('common.close')}
        </button>
      </div>
    );
  }

  // ── UI: no current session ────────────────────────────────────────────
  if (noSession) {
    return (
      <div className="rounded-xl border border-dashed border-sc-warning/30 bg-sc-warning/5 px-4 py-3">
        <p className="text-xs text-sc-warning">{t('roomPlayer.upload.noCurrentSession')}</p>
      </div>
    );
  }

  // ── UI: idle (button + drag&drop) ─────────────────────────────────────
  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`relative rounded-xl border p-4 transition-colors ${
        dragOver
          ? 'border-sc-primary bg-sc-primary/15'
          : 'border-dashed border-sc-primary/25 bg-sc-surface/50 hover:bg-sc-surface'
      }`}
    >
      <input
        ref={fileInputRef}
        type="file"
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          // Reset cosi' selezionando lo STESSO file una seconda volta riparte upload.
          if (e.target) e.target.value = '';
        }}
      />

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-sc-primary/20 text-sm font-semibold text-sc-primary">
          {t('roomPlayer.upload.dragOverlay')}
        </div>
      )}

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sc-primary/15">
          <Upload className="h-4 w-4 text-sc-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-sc-text">{t('roomPlayer.upload.title')}</p>
          {currentSessionTitle && (
            <p className="truncate text-xs text-sc-primary">
              {t('roomPlayer.upload.currentSession', { title: currentSessionTitle })}
            </p>
          )}
          <p className="text-xs leading-relaxed text-sc-text-muted">{t('roomPlayer.upload.hint')}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sc-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-sc-primary/85"
          >
            <Upload className="h-3.5 w-3.5" />
            {t('roomPlayer.upload.selectButton')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Subcomponent: pannello attivo durante upload/hash/finalize
// ────────────────────────────────────────────────────────────────────────

interface UploadActivePanelProps {
  job: string;
  status: RoomDeviceUploadStatus;
  progress: number;
  uploaded: number;
  total: number;
  onCancel: () => void;
}

function UploadActivePanel({ job, status, progress, uploaded, total, onCancel }: UploadActivePanelProps) {
  const { t } = useTranslation();
  const pct = Math.min(100, Math.max(0, Math.round(progress * 100)));
  const label =
    status === 'preparing' ? t('roomPlayer.upload.preparing')
    : status === 'uploading' ? t('roomPlayer.upload.uploading', { percent: pct })
    : status === 'hashing' ? t('roomPlayer.upload.hashing')
    : status === 'finalizing' ? t('roomPlayer.upload.finalizing')
    : '';

  return (
    <div className="rounded-xl border border-sc-primary/25 bg-sc-primary/8 px-4 py-3">
      <div className="flex items-center gap-3">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-sc-primary" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-xs font-medium text-sc-text">{job}</p>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-1.5 py-1 text-sc-text-muted hover:text-sc-danger"
          aria-label={t('roomPlayer.upload.cancelButton')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-sc-primary/15">
        <div
          className="h-full bg-sc-primary transition-all"
          style={{ width: status === 'uploading' ? `${pct}%` : '100%' }}
        />
      </div>
      <p className="mt-1.5 text-xs text-sc-text-muted">
        {label}
        {status === 'uploading' && total > 0 && (
          <span className="ml-1 text-sc-text-dim">
            · {formatBytes(uploaded)} / {formatBytes(total)}
          </span>
        )}
      </p>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
