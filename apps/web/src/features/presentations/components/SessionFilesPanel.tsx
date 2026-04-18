import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Folder, FolderInput, GripVertical, Trash2, UploadCloud, X } from 'lucide-react';
import { formatBytes } from '@/features/upload-portal/lib/format-bytes';
import {
  createVersionDownloadUrl,
  deletePresentationAdmin,
  movePresentationToSession,
  type Presentation,
  type PresentationVersion,
} from '@/features/presentations/repository';
import {
  MAX_TOTAL_BYTES,
  zipBulkDownload,
  type ZipBulkDownloadProgress,
} from '@/features/presentations/lib/zip-bulk-download';
import {
  isFilesDragActive,
  isPresentationDragActive,
  readPresentationDragData,
  setPresentationDragData,
} from '@/features/presentations/lib/drag-presentation';
import {
  extractFilesFromDataTransfer,
  extractFilesFromInputDirectory,
  FOLDER_TRAVERSAL_LIMITS,
  type FolderTraversalResult,
} from '@/features/presentations/lib/folder-traversal';
import {
  useUploadQueue,
  type UploadJob,
} from '@/features/presentations/hooks/useUploadQueue';
import { useFilePreviewSource } from '@/features/presentations/hooks/useFilePreviewSource';
import { useValidationTrigger } from '@/features/presentations/hooks/useValidationTrigger';
import { FilePreviewDialog } from '@/features/presentations/components/FilePreviewDialog';
import { ValidationIssuesBadge } from '@/features/presentations/components/ValidationIssuesBadge';
import type { ValidationWarning } from '@slidecenter/shared';
import { getSupabaseBrowserClient } from '@/lib/supabase';

/**
 * Sprint G (§3.B) — multi-select + bulk action.
 * Sprint H (§3.C) — drag&drop multi-file (C1+C2) + drag tra sessioni (C3).
 * Sprint S-1 (§G4) — drag&drop CARTELLE intere con sotto-cartelle (DataTransferItem
 * + webkitGetAsEntry ricorsivo). Il path relativo viene preservato come
 * prefisso del filename in `presentation_versions.file_name`.
 *
 * Drop zone discrimina:
 *  - `Files` dal SO → enqueue su `useUploadQueue` (multipli OK). Se uno dei
 *    file droppati e' una cartella (`webkitGetAsEntry().isDirectory`),
 *    eseguiamo traversal ricorsivo via `extractFilesFromDataTransfer` e
 *    rinominiamo ogni File con `relativePath` (max 500 file, max 10 livelli).
 *  - `application/x-slidecenter-presentation` → bypass upload, chiama
 *    `movePresentationToSession` (C3). La sorgente e' un `<li>` di un'altra
 *    sessione (anche dello stesso evento). Visual feedback: border blu vs
 *    border verde a seconda del tipo di drag.
 *
 * Coda upload (C2): hook `useUploadQueue` espone `jobs[], enqueue, cancel,
 * clearFinished`. Concurrency 1 (vedi rationale nell'hook). Pannello "Coda"
 * compare automaticamente sotto la drop zone quando `jobs.length > 0`.
 */

interface MoveTargetSession {
  id: string;
  title: string;
  roomId: string;
  roomName: string;
}

interface SessionFilesPanelProps {
  sessionId: string;
  /** Nome sessione, per label drop-zone. */
  sessionTitle: string;
  /** True quando la sessione e' visibile (panel collapsed gestisce parent). */
  enabled: boolean;
  /**
   * Lista delle sessioni disponibili come destinazione "Sposta" (Sprint G B3).
   * Includere TUTTE le sessioni dell'evento (anche quella corrente: la
   * filtriamo qui sotto). Se omesso o vuoto, il bottone "Sposta" e' nascosto.
   */
  moveTargets?: MoveTargetSession[];
}

interface FileRow {
  presentationId: string;
  versionId: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  storageKey: string;
  speakerName: string | null;
  status: PresentationVersion['status'];
  /** Sprint I (anteprima): MIME ufficiale lato server (può essere `application/octet-stream` per upload legacy). */
  mimeType: string;
  /**
   * Sprint T-3-A (G10): warnings dal validator.
   *  - `null` = non ancora validato (l hook `useValidationTrigger` partira')
   *  - `[]`   = validato senza issue
   *  - `[...]` = N issue da mostrare nel badge
   */
  validationWarnings: ValidationWarning[] | null;
}

type BulkAction = 'idle' | 'zip' | 'move' | 'delete';

interface BulkProgress {
  current: number;
  total: number;
  bytes?: number;
  bytesTotal?: number;
}

interface BulkSummary {
  ok: number;
  failed: number;
  skipped?: number;
  failedNames: string[];
}

type DropMode = 'idle' | 'files' | 'presentation';

export function SessionFilesPanel({
  sessionId,
  sessionTitle,
  enabled,
  moveTargets,
}: SessionFilesPanelProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('en') ? 'en-US' : 'it-IT';
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  const supabaseUrl = useMemo(() => import.meta.env.VITE_SUPABASE_URL as string, []);
  const anonKey = useMemo(() => import.meta.env.VITE_SUPABASE_ANON_KEY as string, []);

  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dropMode, setDropMode] = useState<DropMode>('idle');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Sprint I (§3.D): file selezionato per anteprima inline. Apre <FilePreviewDialog>.
  const [previewFile, setPreviewFile] = useState<FileRow | null>(null);
  // Sprint H C3: feedback transient quando un file e' stato spostato qui da
  // un'altra sessione. Reset dopo 2.5s.
  const [crossDropFeedback, setCrossDropFeedback] = useState<
    | { kind: 'success'; fileName: string }
    | { kind: 'error'; fileName: string; messageKey: string }
    | null
  >(null);

  // Sprint S-1: feedback transient quando l'utente droppa una cartella.
  // Mostra "N file aggiunti dalla cartella «X»" + warning per scarti
  // (vuoti, duplicati, filename troppo lunghi, troncamento).
  const [folderDropFeedback, setFolderDropFeedback] = useState<
    | {
        kind: 'success';
        rootFolderName: string;
        added: number;
        emptyFiles: number;
        duplicates: number;
        filenameTooLong: number;
        truncated: boolean;
      }
    | { kind: 'empty'; rootFolderName: string }
    | null
  >(null);

  // Sprint G — multi-select.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkAction>('idle');
  const [bulkProgress, setBulkProgress] = useState<BulkProgress | null>(null);
  const [bulkSummary, setBulkSummary] = useState<BulkSummary | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Sprint S-1: secondo input dedicato a `webkitdirectory` (sfoglia cartella).
  // Non riutilizziamo `inputRef` perche' avere `webkitdirectory` impostato
  // statico bloccherebbe la selezione di file singoli ("Sfoglia file"). Quindi
  // due input distinti, due bottoni distinti.
  const folderInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const bulkAbortRef = useRef<AbortController | null>(null);
  const dragCounterRef = useRef(0);

  const loadFiles = useCallback(async () => {
    if (!enabled || !sessionId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: presentations, error: pErr } = await supabase
        .from('presentations')
        .select('id, speaker_id, current_version_id')
        .eq('session_id', sessionId);
      if (pErr) throw pErr;

      const presList = (presentations ?? []) as Pick<Presentation, 'id' | 'speaker_id' | 'current_version_id'>[];
      if (presList.length === 0) {
        setFiles([]);
        return;
      }

      const presIds = presList.map((p) => p.id);
      const speakerIds = presList
        .map((p) => p.speaker_id)
        .filter((id): id is string => typeof id === 'string');

      const [{ data: versions, error: vErr }, { data: speakers, error: sErr }] = await Promise.all([
        supabase
          .from('presentation_versions')
          .select(
            'id, presentation_id, file_name, file_size_bytes, mime_type, created_at, storage_key, status, validation_warnings',
          )
          .in('presentation_id', presIds)
          .order('created_at', { ascending: false }),
        speakerIds.length > 0
          ? supabase.from('speakers').select('id, full_name').in('id', speakerIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (vErr) throw vErr;
      if (sErr) throw sErr;

      const speakerNameById = new Map<string, string>(
        (speakers ?? []).map((s) => [s.id as string, s.full_name as string]),
      );

      const versionsList = (versions ?? []) as Array<{
        id: string;
        presentation_id: string;
        file_name: string;
        file_size_bytes: number;
        mime_type: string | null;
        created_at: string;
        storage_key: string;
        status: PresentationVersion['status'];
        validation_warnings: ValidationWarning[] | null;
      }>;

      const presentationById = new Map(presList.map((p) => [p.id, p]));

      const rows: FileRow[] = versionsList
        .map((v) => {
          const pres = presentationById.get(v.presentation_id);
          if (!pres) return null;
          if (pres.current_version_id && pres.current_version_id !== v.id) return null;
          if (!pres.current_version_id && v.status !== 'ready') return null;
          const speakerName = pres.speaker_id ? speakerNameById.get(pres.speaker_id) ?? null : null;
          return {
            presentationId: pres.id,
            versionId: v.id,
            fileName: v.file_name,
            fileSize: v.file_size_bytes,
            createdAt: v.created_at,
            storageKey: v.storage_key,
            speakerName,
            status: v.status,
            mimeType: v.mime_type ?? 'application/octet-stream',
            validationWarnings: v.validation_warnings,
          };
        })
        .filter((r): r is FileRow => r !== null)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      if (mountedRef.current) setFiles(rows);
    } catch (e) {
      if (mountedRef.current) setLoadError((e as { message?: string })?.message ?? 'load_failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      bulkAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Sprint H C2: coda upload.
  const queue = useUploadQueue({
    sessionId,
    supabaseUrl,
    anonKey,
    onJobDone: () => void loadFiles(),
  });

  // Sprint T-3-A (G10): trigger validator warn-only.
  // Al cambio della lista file (`files.length` come trigger) o al primo open
  // del pannello, kick l Edge function `slide-validator`. Throttle 60s.
  // Quando finisce, refresha la lista per mostrare i badge.
  useValidationTrigger({
    sessionId,
    enabled,
    versionsTrigger: files.length,
    onValidated: () => void loadFiles(),
  });

  // Sprint G: purga selezione su cambio file (vedi rationale Sprint G).
  const [trackedFileIds, setTrackedFileIds] = useState<string>('');
  const fileIdsKey = useMemo(() => files.map((f) => f.presentationId).join(','), [files]);
  if (trackedFileIds !== fileIdsKey) {
    setTrackedFileIds(fileIdsKey);
    if (selected.size > 0) {
      const validIds = new Set(files.map((f) => f.presentationId));
      let changed = false;
      const next = new Set<string>();
      for (const id of selected) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      if (changed) setSelected(next);
    }
  }

  // Sprint H C3: feedback transient drop "muovi qui".
  useEffect(() => {
    if (!crossDropFeedback) return;
    const tid = window.setTimeout(() => setCrossDropFeedback(null), 2500);
    return () => window.clearTimeout(tid);
  }, [crossDropFeedback]);

  // Sprint S-1: feedback transient drop "cartella". Tempo lungo (5s) perche'
  // contiene piu' info da leggere (count + warning).
  useEffect(() => {
    if (!folderDropFeedback) return;
    const tid = window.setTimeout(() => setFolderDropFeedback(null), 5000);
    return () => window.clearTimeout(tid);
  }, [folderDropFeedback]);

  const onPick = useCallback(
    (incoming: FileList | File[] | null) => {
      if (!incoming) return;
      const list = Array.from(incoming);
      if (list.length === 0) return;
      queue.enqueue(list);
    },
    [queue],
  );

  /**
   * Sprint S-1: gestione drop di una CARTELLA (uno o piu' folder root).
   * Chiamato dal `onDrop` quando rilevato `webkitGetAsEntry().isDirectory`
   * su almeno un item, oppure dal `<input webkitdirectory>` (change event).
   *
   * - In caso di drop misto (file + cartelle), tutto viene unificato dalla
   *   utility con `relativePath = file.name` per i file diretti.
   * - I file vengono accodati alla coda upload con il path relativo come
   *   nome (es. "Conferenza-2026/Sala-1/intro.pptx").
   * - Mostra feedback transient con summary (added/duplicati/vuoti/troncati).
   */
  const handleFolderDropResult = useCallback(
    (result: FolderTraversalResult) => {
      if (result.files.length === 0) {
        setFolderDropFeedback({
          kind: 'empty',
          rootFolderName: result.rootFolderName || '',
        });
        return;
      }
      queue.enqueue(result.files);
      setFolderDropFeedback({
        kind: 'success',
        rootFolderName: result.rootFolderName || '',
        added: result.files.length,
        emptyFiles: result.emptyFiles,
        duplicates: result.duplicates,
        filenameTooLong: result.filenameTooLong,
        truncated: result.truncated,
      });
    },
    [queue],
  );

  const onDownload = useCallback(async (storageKey: string, versionId: string) => {
    setActionBusy(`dl:${versionId}`);
    try {
      const url = await createVersionDownloadUrl(storageKey);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setActionBusy(null);
    }
  }, []);

  const onDelete = useCallback(
    async (presentationId: string) => {
      setActionBusy(`del:${presentationId}`);
      try {
        await deletePresentationAdmin(presentationId);
        setPendingDelete(null);
        await loadFiles();
      } finally {
        setActionBusy(null);
      }
    },
    [loadFiles],
  );

  // ────────────────────────────────────────────────────────────────────
  // Sprint G: bulk actions (invariati)
  // ────────────────────────────────────────────────────────────────────

  const allSelected = files.length > 0 && selected.size === files.length;
  const someSelected = selected.size > 0 && selected.size < files.length;
  const selectedFiles = useMemo(
    () => files.filter((f) => selected.has(f.presentationId)),
    [files, selected],
  );
  const selectedTotalBytes = useMemo(
    () => selectedFiles.reduce((acc, f) => acc + f.fileSize, 0),
    [selectedFiles],
  );

  const toggleSelected = useCallback((presentationId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(presentationId)) next.delete(presentationId);
      else next.add(presentationId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === files.length && files.length > 0) return new Set();
      return new Set(files.map((f) => f.presentationId));
    });
  }, [files]);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setBulkSummary(null);
    setBulkError(null);
  }, []);

  const cancelBulk = useCallback(() => {
    bulkAbortRef.current?.abort();
  }, []);

  const onBulkZip = useCallback(async () => {
    if (selectedFiles.length === 0 || bulkAction !== 'idle') return;
    setBulkError(null);
    setBulkSummary(null);
    setBulkAction('zip');
    setBulkProgress({ current: 0, total: selectedFiles.length, bytes: 0, bytesTotal: selectedTotalBytes });
    const controller = new AbortController();
    bulkAbortRef.current = controller;
    try {
      const items = selectedFiles.map((f) => ({
        versionId: f.versionId,
        fileName: f.fileName,
        fileSizeBytes: f.fileSize,
        storageKey: f.storageKey,
      }));
      const archiveName = `${sessionTitle} — ${new Date().toISOString().slice(0, 10)}`;
      await zipBulkDownload(
        items,
        archiveName,
        (p: ZipBulkDownloadProgress) => {
          if (!mountedRef.current) return;
          setBulkProgress({
            current: p.completed,
            total: p.total,
            bytes: p.bytesProcessed,
            bytesTotal: p.bytesTotal,
          });
        },
        controller.signal,
      );
      if (mountedRef.current) {
        setBulkSummary({
          ok: selectedFiles.length,
          failed: 0,
          failedNames: [],
        });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : 'zip_download_failed';
      if (msg === 'zip_too_large') setBulkError('bulkActions.errors.zipTooLarge');
      else if (msg === 'zip_aborted') setBulkError('bulkActions.errors.aborted');
      else setBulkError('bulkActions.errors.zipFailed');
    } finally {
      if (mountedRef.current) {
        setBulkAction('idle');
        setBulkProgress(null);
      }
      bulkAbortRef.current = null;
    }
  }, [bulkAction, selectedFiles, selectedTotalBytes, sessionTitle]);

  const onBulkDelete = useCallback(async () => {
    if (selectedFiles.length === 0 || bulkAction !== 'idle') return;
    setBulkError(null);
    setBulkSummary(null);
    setBulkAction('delete');
    setBulkProgress({ current: 0, total: selectedFiles.length });
    setPendingBulkDelete(false);
    const failedNames: string[] = [];
    let ok = 0;
    for (let i = 0; i < selectedFiles.length; i += 1) {
      const f = selectedFiles[i];
      if (!mountedRef.current) return;
      setBulkProgress({ current: i + 1, total: selectedFiles.length });
      try {
        await deletePresentationAdmin(f.presentationId);
        ok += 1;
      } catch {
        failedNames.push(f.fileName);
      }
    }
    if (!mountedRef.current) return;
    setBulkAction('idle');
    setBulkProgress(null);
    setBulkSummary({ ok, failed: failedNames.length, failedNames });
    setSelected(new Set());
    await loadFiles();
  }, [bulkAction, loadFiles, selectedFiles]);

  const onBulkMove = useCallback(async () => {
    if (selectedFiles.length === 0 || !moveTargetId || bulkAction !== 'idle') return;
    setBulkError(null);
    setBulkSummary(null);
    setBulkAction('move');
    setBulkProgress({ current: 0, total: selectedFiles.length });
    setMoveDialogOpen(false);
    const failedNames: string[] = [];
    let ok = 0;
    let skipped = 0;
    for (let i = 0; i < selectedFiles.length; i += 1) {
      const f = selectedFiles[i];
      if (!mountedRef.current) return;
      setBulkProgress({ current: i + 1, total: selectedFiles.length });
      try {
        const res = await movePresentationToSession(f.presentationId, moveTargetId);
        if (res.skipped) skipped += 1;
        else ok += 1;
      } catch {
        failedNames.push(f.fileName);
      }
    }
    if (!mountedRef.current) return;
    setBulkAction('idle');
    setBulkProgress(null);
    setBulkSummary({ ok, failed: failedNames.length, skipped, failedNames });
    setSelected(new Set());
    setMoveTargetId(null);
    await loadFiles();
  }, [bulkAction, loadFiles, moveTargetId, selectedFiles]);

  const bulkBusy = bulkAction !== 'idle';

  const availableMoveTargets = useMemo(
    () => (moveTargets ?? []).filter((s) => s.id !== sessionId),
    [moveTargets, sessionId],
  );
  const moveTargetsByRoom = useMemo(() => {
    const map = new Map<string, { roomName: string; sessions: MoveTargetSession[] }>();
    for (const s of availableMoveTargets) {
      const existing = map.get(s.roomId);
      if (existing) existing.sessions.push(s);
      else map.set(s.roomId, { roomName: s.roomName, sessions: [s] });
    }
    return Array.from(map.entries()).map(([roomId, v]) => ({
      roomId,
      roomName: v.roomName,
      sessions: v.sessions,
    }));
  }, [availableMoveTargets]);

  // ────────────────────────────────────────────────────────────────────
  // Sprint H — drop handlers (files vs presentation)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Usiamo `dragCounterRef` perche' `dragenter`/`dragleave` sparano anche
   * quando il cursore entra/esce su un *figlio* della drop zone, causando
   * flicker del border. Il counter va > 0 quando entriamo nella zona,
   * scende a 0 quando ne usciamo davvero.
   */
  const onDragEnter = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    dragCounterRef.current += 1;
    const dt = e.dataTransfer;
    if (isPresentationDragActive(dt)) setDropMode('presentation');
    else if (isFilesDragActive(dt)) setDropMode('files');
  }, []);

  const onDragOver = useCallback((e: React.DragEvent<HTMLElement>) => {
    e.preventDefault();
    const dt = e.dataTransfer;
    // Imposta il cursor coerente: 'move' per drag tra sessioni, 'copy' per
    // upload da SO. Senza questo Chrome mostra "+" anche per move.
    if (isPresentationDragActive(dt)) {
      dt.dropEffect = 'move';
      if (dropMode !== 'presentation') setDropMode('presentation');
    } else if (isFilesDragActive(dt)) {
      dt.dropEffect = 'copy';
      if (dropMode !== 'files') setDropMode('files');
    }
  }, [dropMode]);

  const onDragLeave = useCallback(() => {
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setDropMode('idle');
  }, []);

  const handleCrossSessionDrop = useCallback(
    async (presentationId: string, fileName: string) => {
      try {
        const res = await movePresentationToSession(presentationId, sessionId);
        if (res.skipped) {
          // L'utente ha trascinato un file gia' presente in questa sessione.
          // Non e' un errore, ma lo segnaliamo come "no-op".
          setCrossDropFeedback({ kind: 'success', fileName });
        } else {
          setCrossDropFeedback({ kind: 'success', fileName });
          await loadFiles();
        }
      } catch (err) {
        const msg = (err as { message?: string })?.message ?? '';
        const messageKey =
          msg.includes('cross_event_move_not_allowed')
            ? 'sessionFiles.dragMove.errorCrossEvent'
            : msg.includes('event_closed_or_archived')
              ? 'sessionFiles.dragMove.errorEventClosed'
              : msg.includes('role_forbidden')
                ? 'sessionFiles.dragMove.errorForbidden'
                : 'sessionFiles.dragMove.errorGeneric';
        setCrossDropFeedback({ kind: 'error', fileName, messageKey });
      }
    },
    [loadFiles, sessionId],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setDropMode('idle');
      const dt = e.dataTransfer;
      // Sprint H C3: drop di una presentation da altra sessione.
      const presentationDrag = readPresentationDragData(dt);
      if (presentationDrag) {
        // Se la sorgente e' la stessa sessione → no-op silenzioso (non
        // confondere l'utente con messaggi di errore).
        if (presentationDrag.fromSessionId === sessionId) return;
        void handleCrossSessionDrop(presentationDrag.presentationId, presentationDrag.fileName);
        return;
      }
      // Sprint S-1 (G4) + Sprint H C1: drop di file/cartelle dal SO.
      //
      // IMPORTANTE: `extractFilesFromDataTransfer` deve essere chiamata
      // SUBITO con `dt` per leggere `webkitGetAsEntry()` PRIMA che il
      // browser invalidi gli items (succede dopo il primo microtask
      // post-drop). La utility raccoglie gli entry sincroni nel primo
      // step, poi traversa async. Funziona sia per drop di SOLE cartelle,
      // sia per drop misto (file + cartelle), sia per drop di soli file
      // (ricade automaticamente su `dt.files` per browser legacy).
      const hasItems = dt.items && dt.items.length > 0;
      const hasFiles = dt.files && dt.files.length > 0;
      if (!hasItems && !hasFiles) return;
      void extractFilesFromDataTransfer(dt).then((result) => {
        if (result.containedFolders) {
          // Almeno una cartella → mostra feedback dedicato (count + warning).
          handleFolderDropResult(result);
        } else if (result.files.length > 0) {
          // Solo file singoli → flusso "drop file" classico, senza feedback
          // verboso. La coda mostra il progresso per ogni file.
          queue.enqueue(result.files);
        }
      });
    },
    [handleCrossSessionDrop, handleFolderDropResult, queue, sessionId],
  );

  if (!enabled) return null;

  // Visual feedback drop zone: blu (primary) per upload da SO, arancione
  // (accent) per drag tra sessioni — distinzione visiva netta.
  const dropBorderClass =
    dropMode === 'presentation'
      ? 'border-sc-accent bg-sc-accent/15'
      : dropMode === 'files'
        ? 'border-sc-primary bg-sc-primary/15'
        : 'border-sc-primary/20 bg-sc-surface/40';

  const dropLabel =
    dropMode === 'presentation'
      ? t('sessionFiles.dragMove.dropHere', { name: sessionTitle })
      : t('sessionFiles.dropTitle', { name: sessionTitle });

  return (
    <div
      className="mt-3 rounded-xl border border-sc-primary/12 bg-sc-bg/40 p-3 space-y-3"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-3 py-3 text-center transition ${dropBorderClass} ${queue.busy ? 'opacity-60' : ''}`}
      >
        <UploadCloud className="h-5 w-5 text-sc-primary" aria-hidden="true" />
        <p className="text-xs font-medium text-sc-text">{dropLabel}</p>
        <p className="text-[11px] text-sc-text-dim">
          {dropMode === 'presentation'
            ? t('sessionFiles.dragMove.hint')
            : t('sessionFiles.dropHintFolder', {
                limit: FOLDER_TRAVERSAL_LIMITS.maxFilesPerDrop,
              })}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = e.target.files;
            e.target.value = '';
            onPick(list);
          }}
        />
        {/* Sprint S-1 (G4): input dedicato a "Sfoglia cartella".
            L'attributo `webkitdirectory` (Chrome/Edge/Safari) NON e' nei types
            React 19; `directory` (alias Firefox legacy) invece c'e'. Settiamo
            entrambi via spread su un oggetto cast a `Record<string, string>`
            cosi' evitiamo `@ts-expect-error` rompibile. Per il browser sono
            attributi HTML non-standard ma riconosciuti dal codice nativo. */}
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="hidden"
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            const list = e.target.files;
            e.target.value = '';
            const result = extractFilesFromInputDirectory(list);
            handleFolderDropResult(result);
          }}
        />
        <div className="flex flex-wrap justify-center gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-xl border border-sc-primary/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated"
          >
            {t('sessionFiles.pickFile')}
          </button>
          <button
            type="button"
            onClick={() => folderInputRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-xl border border-sc-primary/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated"
          >
            <Folder className="h-3 w-3" aria-hidden="true" />
            {t('sessionFiles.pickFolder')}
          </button>
        </div>
      </div>

      {/* Sprint H C2: coda upload */}
      {queue.jobs.length > 0 && (
        <UploadQueuePanel
          jobs={queue.jobs}
          counts={queue.counts}
          onCancel={queue.cancel}
          onClearFinished={queue.clearFinished}
          locale={locale}
          t={t}
        />
      )}

      {/* Sprint S-1: feedback transient drop cartella (5s).
          Mostra "N file aggiunti dalla cartella «X»" + warning aggregati.
          Empty: "La cartella «X» e' vuota o non contiene file validi". */}
      {folderDropFeedback && (
        <div
          role="status"
          className={`rounded border px-2.5 py-1.5 text-[11px] ${
            folderDropFeedback.kind === 'success'
              ? 'border-sc-success/30 bg-sc-success/10 text-sc-success'
              : 'border-sc-warning/30 bg-sc-warning/10 text-sc-warning'
          }`}
        >
          {folderDropFeedback.kind === 'success' ? (
            <>
              <p className="font-medium">
                {folderDropFeedback.rootFolderName
                  ? t('sessionFiles.folderEnqueued', {
                      count: folderDropFeedback.added,
                      folder: folderDropFeedback.rootFolderName,
                    })
                  : t('sessionFiles.folderEnqueuedNoName', {
                      count: folderDropFeedback.added,
                    })}
              </p>
              {(folderDropFeedback.emptyFiles > 0
                || folderDropFeedback.duplicates > 0
                || folderDropFeedback.filenameTooLong > 0
                || folderDropFeedback.truncated) && (
                <ul className="mt-1 list-disc pl-4">
                  {folderDropFeedback.emptyFiles > 0 && (
                    <li>{t('sessionFiles.folderWarnEmpty', { count: folderDropFeedback.emptyFiles })}</li>
                  )}
                  {folderDropFeedback.duplicates > 0 && (
                    <li>{t('sessionFiles.folderWarnDup', { count: folderDropFeedback.duplicates })}</li>
                  )}
                  {folderDropFeedback.filenameTooLong > 0 && (
                    <li>{t('sessionFiles.folderWarnNameLen', { count: folderDropFeedback.filenameTooLong })}</li>
                  )}
                  {folderDropFeedback.truncated && (
                    <li>{t('sessionFiles.folderWarnTruncated', { limit: FOLDER_TRAVERSAL_LIMITS.maxFilesPerDrop })}</li>
                  )}
                </ul>
              )}
            </>
          ) : (
            <p>
              {folderDropFeedback.rootFolderName
                ? t('sessionFiles.folderEmpty', { folder: folderDropFeedback.rootFolderName })
                : t('sessionFiles.folderEmptyNoName')}
            </p>
          )}
        </div>
      )}

      {/* Sprint H C3: feedback transient drop "muovi qui" */}
      {crossDropFeedback && (
        <div
          role="status"
          className={`rounded border px-2.5 py-1.5 text-[11px] ${
            crossDropFeedback.kind === 'success'
              ? 'border-sc-success/30 bg-sc-success/10 text-sc-success'
              : 'border-sc-danger/30 bg-sc-danger/10 text-sc-danger'
          }`}
        >
          {crossDropFeedback.kind === 'success'
            ? t('sessionFiles.dragMove.movedOk', { name: crossDropFeedback.fileName })
            : t(crossDropFeedback.messageKey, { name: crossDropFeedback.fileName })}
        </div>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-sc-text-muted">
            {t('sessionFiles.listTitle', { count: files.length })}
          </h4>
          {files.length > 0 && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-sc-text-muted">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={toggleSelectAll}
                disabled={bulkBusy}
                className="h-3.5 w-3.5 cursor-pointer rounded border-sc-primary/30 accent-sc-primary"
                aria-label={t('bulkActions.selectAllAria')}
              />
              {t('bulkActions.selectAll')}
            </label>
          )}
        </div>

        {selected.size > 0 && (
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-sc-primary/30 bg-sc-primary/5 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-sc-text">
                {t('bulkActions.selectedCount', {
                  count: selected.size,
                  size: formatBytes(selectedTotalBytes, locale),
                })}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={bulkBusy || selectedTotalBytes > MAX_TOTAL_BYTES}
                  onClick={() => void onBulkZip()}
                  title={
                    selectedTotalBytes > MAX_TOTAL_BYTES
                      ? t('bulkActions.errors.zipTooLarge')
                      : undefined
                  }
                  className="inline-flex items-center gap-1 rounded-xl border border-sc-primary/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Download className="h-3 w-3" />
                  {t('bulkActions.downloadZip')}
                </button>
                {availableMoveTargets.length > 0 && (
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => {
                      setBulkSummary(null);
                      setBulkError(null);
                      setMoveDialogOpen(true);
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-sc-primary/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <FolderInput className="h-3 w-3" />
                    {t('bulkActions.moveToSession')}
                  </button>
                )}
                {pendingBulkDelete ? (
                  <>
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => void onBulkDelete()}
                      className="rounded-xl bg-sc-danger px-2.5 py-1 text-xs font-medium text-white hover:bg-sc-danger/80 disabled:opacity-50"
                    >
                      {t('bulkActions.confirmDelete', { count: selected.size })}
                    </button>
                    <button
                      type="button"
                      disabled={bulkBusy}
                      onClick={() => setPendingBulkDelete(false)}
                      className="rounded-xl border border-sc-primary/20 px-2.5 py-1 text-xs text-sc-text-secondary hover:bg-sc-elevated"
                    >
                      {t('common.cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => setPendingBulkDelete(true)}
                    className="inline-flex items-center gap-1 rounded-xl border border-sc-danger/30 bg-sc-surface px-2.5 py-1 text-xs text-sc-danger hover:bg-sc-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" />
                    {t('bulkActions.delete')}
                  </button>
                )}
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={clearSelection}
                  aria-label={t('bulkActions.clearSelectionAria')}
                  className="inline-flex items-center gap-1 rounded-xl border border-sc-primary/20 px-2 py-1 text-xs text-sc-text-muted hover:bg-sc-elevated disabled:opacity-50"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            {bulkProgress && (
              <BulkProgressBar
                action={bulkAction}
                current={bulkProgress.current}
                total={bulkProgress.total}
                bytes={bulkProgress.bytes}
                bytesTotal={bulkProgress.bytesTotal}
                locale={locale}
                onCancel={bulkAction === 'zip' ? cancelBulk : undefined}
                t={t}
              />
            )}

            {bulkSummary && !bulkBusy && (
              <div
                className={`rounded border px-2.5 py-1.5 text-[11px] ${
                  bulkSummary.failed > 0
                    ? 'border-sc-warning/30 bg-sc-warning/10 text-sc-warning'
                    : 'border-sc-success/30 bg-sc-success/10 text-sc-success'
                }`}
                role="status"
              >
                <p>
                  {t('bulkActions.summary', {
                    ok: bulkSummary.ok,
                    failed: bulkSummary.failed,
                    skipped: bulkSummary.skipped ?? 0,
                  })}
                </p>
                {bulkSummary.failedNames.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {bulkSummary.failedNames.slice(0, 5).map((name) => (
                      <li key={name} className="break-all">
                        {name}
                      </li>
                    ))}
                    {bulkSummary.failedNames.length > 5 && (
                      <li>
                        {t('bulkActions.summaryAndMore', {
                          count: bulkSummary.failedNames.length - 5,
                        })}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}

            {bulkError && !bulkBusy && (
              <p
                className="rounded border border-sc-danger/30 bg-sc-danger/10 px-2.5 py-1.5 text-[11px] text-sc-danger"
                role="alert"
              >
                {t(bulkError)}
              </p>
            )}
          </div>
        )}

        {loading && files.length === 0 ? (
          <p className="mt-2 text-xs text-sc-text-dim">{t('common.loading')}</p>
        ) : loadError ? (
          <p className="mt-2 text-xs text-sc-danger">{loadError}</p>
        ) : files.length === 0 ? (
          <p className="mt-2 text-xs text-sc-text-dim">{t('sessionFiles.empty')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-sc-primary/12 rounded border border-sc-primary/12">
            {files.map((f) => {
              const isSelected = selected.has(f.presentationId);
              return (
                <li
                  key={f.versionId}
                  draggable={availableMoveTargets.length > 0 && !bulkBusy && !queue.busy}
                  onDragStart={(e) => {
                    setPresentationDragData(e.dataTransfer, {
                      presentationId: f.presentationId,
                      fromSessionId: sessionId,
                      fileName: f.fileName,
                    });
                  }}
                  className={`flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:justify-between ${
                    isSelected ? 'bg-sc-primary/5' : ''
                  } ${
                    availableMoveTargets.length > 0 && !bulkBusy && !queue.busy
                      ? 'cursor-grab active:cursor-grabbing'
                      : ''
                  }`}
                  title={
                    availableMoveTargets.length > 0
                      ? t('sessionFiles.dragMove.rowHint')
                      : undefined
                  }
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(f.presentationId)}
                      disabled={bulkBusy}
                      aria-label={t('bulkActions.selectFileAria', { name: f.fileName })}
                      className="mt-1 h-3.5 w-3.5 cursor-pointer rounded border-sc-primary/30 accent-sc-primary disabled:cursor-not-allowed"
                    />
                    {availableMoveTargets.length > 0 && (
                      <GripVertical
                        className="mt-1 h-3.5 w-3.5 shrink-0 text-sc-text-dim"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start gap-1.5">
                        <button
                          type="button"
                          onClick={() => setPreviewFile(f)}
                          className="break-all text-left text-sm text-sc-text transition hover:text-sc-primary hover:underline"
                          title={t('sessionFiles.previewHint', { name: f.fileName })}
                        >
                          {f.fileName}
                        </button>
                        <ValidationIssuesBadge
                          warnings={f.validationWarnings}
                          fileName={f.fileName}
                        />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-sc-text-dim">
                        <span>{dateTimeFmt.format(new Date(f.createdAt))}</span>
                        <span>·</span>
                        <span>{formatBytes(f.fileSize, locale)}</span>
                        {f.speakerName ? (
                          <>
                            <span>·</span>
                            <span className="rounded-full border border-sc-primary/20 bg-sc-surface px-1.5 py-0.5 text-[10px] text-sc-text-muted">
                              {t('sessionFiles.bySpeaker', { name: f.speakerName })}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={actionBusy === `dl:${f.versionId}` || bulkBusy}
                      onClick={() => void onDownload(f.storageKey, f.versionId)}
                      className="inline-flex items-center gap-1 rounded-xl border border-sc-primary/20 px-2 py-1 text-xs text-sc-text hover:bg-sc-elevated disabled:opacity-50"
                    >
                      <Download className="h-3 w-3" />
                      {t('sessionFiles.download')}
                    </button>
                    {pendingDelete === f.presentationId ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={actionBusy === `del:${f.presentationId}` || bulkBusy}
                          onClick={() => void onDelete(f.presentationId)}
                          className="rounded-xl bg-sc-danger px-2 py-1 text-xs font-medium text-white hover:bg-sc-danger/80 disabled:opacity-50"
                        >
                          {t('common.confirmDelete')}
                        </button>
                        <button
                          type="button"
                          disabled={actionBusy === `del:${f.presentationId}` || bulkBusy}
                          onClick={() => setPendingDelete(null)}
                          className="rounded-xl border border-sc-primary/20 px-2 py-1 text-xs text-sc-text-secondary hover:bg-sc-elevated"
                        >
                          {t('common.cancel')}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => setPendingDelete(f.presentationId)}
                        aria-label={t('sessionFiles.deleteAria', { name: f.fileName })}
                        className="inline-flex items-center gap-1 rounded-xl border border-sc-danger/30 px-2 py-1 text-xs text-sc-danger hover:bg-sc-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('common.delete')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {moveDialogOpen && (
        <MoveSessionDialog
          targetsByRoom={moveTargetsByRoom}
          selectedTargetId={moveTargetId}
          onSelectTarget={setMoveTargetId}
          onClose={() => {
            setMoveDialogOpen(false);
            setMoveTargetId(null);
          }}
          onConfirm={() => void onBulkMove()}
          fileCount={selectedFiles.length}
          t={t}
        />
      )}
      {/* Sprint I (§3.D): anteprima inline (PDF/img/video/...) lato admin via signed URL. */}
      {previewFile && (
        <PreviewDialogContainer
          file={previewFile}
          onClose={() => setPreviewFile(null)}
        />
      )}
    </div>
  );
}

/**
 * Sprint I — wrapper che incapsula l'hook `useFilePreviewSource` per il
 * `<FilePreviewDialog>` lato admin (sempre `mode: 'remote'`).
 *
 * Separato dal componente padre per semplificare il lifecycle: l'hook
 * `useFilePreviewSource` viene "smontato" insieme al dialog quando l'utente
 * chiude (cosi' l'eventuale object URL viene revocato senza dover cablare
 * cleanup manuale; per la modalita' remote non ci sono object URL da
 * revocare ma la pulizia "automatica" e' una proprieta' utile da preservare).
 */
function PreviewDialogContainer({
  file,
  onClose,
}: {
  file: FileRow;
  onClose: () => void;
}) {
  const { url, loading, error } = useFilePreviewSource({
    enabled: true,
    mode: 'remote',
    storageKey: file.storageKey,
  });

  // Bottone "Scarica" nel dialog: crea un signed URL forzando download (storage
  // RLS valida lato server, niente download arbitrario di file di altri tenant).
  const onDownload = useCallback(() => {
    void (async () => {
      try {
        const downloadUrl = await createVersionDownloadUrl(file.storageKey);
        window.open(downloadUrl, '_blank', 'noopener,noreferrer');
      } catch {
        // Best-effort: l'errore lo vede gia' la UI di preview (sourceError).
      }
    })();
  }, [file.storageKey]);

  return (
    <FilePreviewDialog
      open
      onClose={onClose}
      fileName={file.fileName}
      mime={file.mimeType}
      sourceUrl={url}
      sourceLoading={loading}
      sourceError={error}
      onDownload={onDownload}
    />
  );
}

/**
 * Sprint H C2: pannello coda upload.
 * Lista riga per file con: nome, status, progress bar, bottone X (cancel
 * o rimuovi se terminale). Header con count "{active}/{total}" + bottone
 * "Pulisci completati" che fa `clearFinished`.
 */
function UploadQueuePanel({
  jobs,
  counts,
  onCancel,
  onClearFinished,
  locale,
  t,
}: {
  jobs: UploadJob[];
  counts: { total: number; pending: number; active: number; done: number; error: number };
  onCancel: (id: string) => void;
  onClearFinished: () => void;
  locale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const hasFinished = counts.done > 0 || counts.error > 0;
  return (
    <div className="rounded-xl border border-sc-primary/12 bg-sc-surface/40 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-sc-text-muted">
          {t('queueUpload.title', {
            active: counts.active + counts.pending,
            total: counts.total,
          })}
        </p>
        {hasFinished && (
          <button
            type="button"
            onClick={onClearFinished}
            className="text-[11px] text-sc-text-dim hover:text-sc-text"
          >
            {t('queueUpload.clearFinished')}
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {jobs.map((j) => (
          <UploadQueueRow key={j.id} job={j} onCancel={onCancel} locale={locale} t={t} />
        ))}
      </ul>
    </div>
  );
}

function UploadQueueRow({
  job,
  onCancel,
  locale,
  t,
}: {
  job: UploadJob;
  onCancel: (id: string) => void;
  locale: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const pct = Math.floor(job.progress * 100);
  const statusText =
    job.status === 'pending' ? t('queueUpload.statusPending')
    : job.status === 'uploading' ? t('queueUpload.statusUploading', { pct })
    : job.status === 'hashing' ? t('queueUpload.statusHashing')
    : job.status === 'finalizing' ? t('queueUpload.statusFinalizing')
    : job.status === 'done' ? t('queueUpload.statusDone')
    : job.status === 'cancelled' ? t('queueUpload.statusCancelled')
    : job.errorKey ? t(job.errorKey)
    : t('queueUpload.statusError');

  const statusColor =
    job.status === 'done' ? 'text-sc-success'
    : job.status === 'error' ? 'text-sc-danger'
    : job.status === 'cancelled' ? 'text-sc-text-dim'
    : 'text-sc-text-muted';

  // Bottone X: durante uploading e' "annulla", su terminale e' "rimuovi dalla lista"
  const canRemove = job.status === 'done' || job.status === 'error' || job.status === 'cancelled';
  const canCancel = job.status === 'pending' || job.status === 'uploading' || job.status === 'hashing' || job.status === 'finalizing';

  return (
    <li className="flex flex-col gap-1 rounded-lg bg-sc-bg/30 px-2 py-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="truncate font-medium text-sc-text" title={job.fileName}>
          {job.fileName}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <span className={statusColor}>{statusText}</span>
          {job.status === 'uploading' && (
            <span className="text-sc-text-dim">
              {formatBytes(job.uploaded, locale)} / {formatBytes(job.fileSize, locale)}
            </span>
          )}
          {(canCancel || canRemove) && (
            <button
              type="button"
              onClick={() => onCancel(job.id)}
              aria-label={
                canCancel
                  ? t('queueUpload.cancelAria', { name: job.fileName })
                  : t('queueUpload.removeAria', { name: job.fileName })
              }
              className="text-sc-text-dim hover:text-sc-danger"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
      {(job.status === 'uploading' || job.status === 'pending') && (
        <div className="h-1 w-full overflow-hidden rounded bg-sc-elevated">
          <div
            className={`h-full transition-[width] ${job.status === 'pending' ? 'bg-sc-primary/30' : 'bg-sc-primary'}`}
            style={{ width: `${job.status === 'pending' ? 4 : pct}%` }}
            role="progressbar"
            aria-valuenow={job.status === 'pending' ? 0 : pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </li>
  );
}

/**
 * Sprint G: barra progresso unificata per tutte le bulk action.
 */
function BulkProgressBar({
  action,
  current,
  total,
  bytes,
  bytesTotal,
  locale,
  onCancel,
  t,
}: {
  action: BulkAction;
  current: number;
  total: number;
  bytes?: number;
  bytesTotal?: number;
  locale: string;
  onCancel?: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const pct = total > 0 ? Math.floor((current / total) * 100) : 0;
  const labelKey =
    action === 'zip' ? 'bulkActions.progressZip'
    : action === 'move' ? 'bulkActions.progressMove'
    : action === 'delete' ? 'bulkActions.progressDelete'
    : 'bulkActions.progressGeneric';
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px] text-sc-text-muted">
        <span className="truncate">{t(labelKey, { current, total })}</span>
        <div className="flex items-center gap-2">
          {bytes !== undefined && bytesTotal !== undefined && bytesTotal > 0 && (
            <span>
              {formatBytes(bytes, locale)} / {formatBytes(bytesTotal, locale)}
            </span>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sc-danger hover:text-sc-danger/80"
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded bg-sc-elevated">
        <div
          className="h-full bg-sc-primary transition-[width]"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
    </div>
  );
}

/**
 * Sprint G B3: dialog modale "Sposta in altra sessione".
 */
function MoveSessionDialog({
  targetsByRoom,
  selectedTargetId,
  onSelectTarget,
  onClose,
  onConfirm,
  fileCount,
  t,
}: {
  targetsByRoom: Array<{ roomId: string; roomName: string; sessions: MoveTargetSession[] }>;
  selectedTargetId: string | null;
  onSelectTarget: (id: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  fileCount: number;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-xl border border-sc-primary/20 bg-sc-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-dialog-title"
      >
        <div className="flex items-center justify-between border-b border-sc-primary/12 px-4 py-3">
          <h3 id="move-dialog-title" className="text-sm font-semibold text-sc-text">
            {t('bulkActions.moveDialog.title', { count: fileCount })}
          </h3>
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={onClose}
            className="rounded-md p-1 text-sc-text-muted hover:bg-sc-elevated"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto px-4 py-3">
          {targetsByRoom.length === 0 ? (
            <p className="text-xs text-sc-text-dim">{t('bulkActions.moveDialog.noTargets')}</p>
          ) : (
            <ul className="space-y-3">
              {targetsByRoom.map((room) => (
                <li key={room.roomId}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sc-text-muted">
                    {room.roomName}
                  </p>
                  <ul className="space-y-1">
                    {room.sessions.map((s) => (
                      <li key={s.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-sc-text hover:bg-sc-elevated">
                          <input
                            type="radio"
                            name="move-target"
                            value={s.id}
                            checked={selectedTargetId === s.id}
                            onChange={() => onSelectTarget(s.id)}
                            className="h-3.5 w-3.5 accent-sc-primary"
                          />
                          {s.title}
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-sc-primary/12 bg-sc-bg/30 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-sc-primary/20 px-3 py-1.5 text-sm text-sc-text-secondary hover:bg-sc-elevated"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={!selectedTargetId}
            onClick={onConfirm}
            className="inline-flex items-center gap-1 rounded-xl bg-sc-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-sc-primary/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FolderInput className="h-3.5 w-3.5" />
            {t('bulkActions.moveDialog.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
