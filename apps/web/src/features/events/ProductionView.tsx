/**
 * Sprint U-3 (UX Round 2 — File Explorer V2 "stile Esplora Risorse")
 * ============================================================================
 * Andrea ha esplicitato: "i files devono essere semplici da gestire e
 * spostare, navigazione stile Windows". Riscrittura completa della Production
 * view per riprodurre l'esperienza di Esplora Risorse (3 pannelli + toolbar +
 * breadcrumb), su misura per chi gestisce un evento dal vivo.
 *
 * COSA FACCIAMO QUI:
 *   - 3 pannelli: tree cartelle (sx) | grid/list file (centro) | dettagli (dx).
 *   - Toolbar in alto: Su, Nuova cartella, Carica file, Carica cartella,
 *     vista lista/griglia, ordinamento, ricerca, sessione di destinazione.
 *   - Breadcrumb cliccabile (Evento > Cartella > Sotto > ...).
 *   - Vista speciale "Tutti i file" (root virtuale): mostra TUTTI i file
 *     dell'evento in flatten con la colonna "Cartella" come breadcrumb.
 *   - Drag&drop completo:
 *       (a) PC → tree (sx): upload in folder droppata (con creazione
 *           gerarchia se cartella nested).
 *       (b) PC → centro: upload nella folder corrente.
 *       (c) file centro → tree (sx) o cartella centro: move.
 *   - Multi-selezione: click=single, Ctrl/Cmd+click=toggle, Shift+click=range.
 *   - Rinomina file (display name): F2 sulla selezione singola, doppio-click
 *     sul nome nella detail-pane, oppure context menu Rinomina.
 *   - Modal "scegli sessione" inline nella toolbar (se >1 sessione l'utente
 *     deve scegliere dove "atterra" l'upload — vincolo schema:
 *     presentations.session_id NOT NULL).
 *   - Reuse pipeline upload TUS via `useUploadQueue` (riuso totale).
 *   - Reuse `extractFilesFromDataTransfer` / `extractFilesFromInputDirectory`
 *     per ricostruire gerarchia cartelle dal SO.
 *
 * COSA NON FACCIAMO (rinviato a U-3.x se serve):
 *   - Anteprima inline nel detail-pane (per ora il preview e' via dialog).
 *   - Cestino con undo (delete = irreversibile, consenso utente richiesto).
 *   - Operazioni su cartelle multi-select (per ora cartelle solo single-select).
 *   - "Apri con app esterna" (limitazione browser cloud, gia' richiesta dal
 *     desktop SLIDE CENTER).
 *
 * RUOLI:
 *   - admin/tech: tutto (upload, move, rinomina, delete folders, delete file).
 *   - speaker / viewer: nessun accesso (la rotta `/events/:id/production` e'
 *     gia' protetta dal RequireTenantAdmin a monte? In realta' no — la guard
 *     viene fatta dalle RPC SECURITY DEFINER lato server, che rifiutano
 *     `role_forbidden`. La UI mostra l'errore raw nello stato 'error').
 *
 * ============================================================================
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ArrowUp,
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  FileImage,
  FileText,
  FileVideo,
  FileAudio,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderUp,
  Grid3x3,
  Home,
  Info,
  Loader2,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Database } from '@slidecenter/shared';
import {
  Badge,
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ScrollArea,
  cn,
} from '@slidecenter/ui';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import {
  buildFolderTree,
  createEventFolder,
  deleteEventFolder,
  ensureFolderPath,
  listEventFolders,
  movePresentationsToFolder,
  renameEventFolder,
  type EventFolderRow,
  type FolderTreeNode,
} from '@/features/folders/repository';
import {
  createVersionDownloadUrl,
  createVersionPreviewUrl,
  deletePresentationAdmin,
  renameVersionFileName,
} from '@/features/presentations/repository';
import {
  useUploadQueue,
  type UploadJob,
  type UploadJobDoneInfo,
} from '@/features/presentations/hooks/useUploadQueue';
import {
  extractFilesFromDataTransfer,
  extractFilesFromInputDirectory,
  type FolderTraversalResult,
} from '@/features/presentations/lib/folder-traversal';
import { FilePreviewDialog } from '@/features/presentations/components/FilePreviewDialog';

// ============================================================================
// TYPES
// ============================================================================

type PresentationRow = Pick<
  Database['public']['Tables']['presentations']['Row'],
  | 'id'
  | 'session_id'
  | 'speaker_id'
  | 'folder_id'
  | 'status'
  | 'current_version_id'
  | 'updated_at'
  | 'created_at'
>;

type SessionLite = {
  id: string;
  title: string;
  room_id: string | null;
};

type SpeakerLite = {
  id: string;
  full_name: string;
};

type VersionLite = {
  id: string;
  file_name: string;
  file_size_bytes: number;
  mime_type: string | null;
  status: string;
};

type EventLite = {
  id: string;
  name: string;
  tenant_id: string;
};

interface ExplorerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
  event?: EventLite;
  folders: EventFolderRow[];
  presentations: PresentationRow[];
  sessions: SessionLite[];
  sessionsById: Record<string, SessionLite>;
  speakers: Record<string, SpeakerLite>;
  versions: Record<string, VersionLite>;
}

const EMPTY_STATE: ExplorerState = {
  status: 'idle',
  folders: [],
  presentations: [],
  sessions: [],
  sessionsById: {},
  speakers: {},
  versions: {},
};

/** Vista speciale: mostra TUTTI i file dell'evento (flatten ricorsivo). */
const ALL_FILES_VIEW = '__all__' as const;
type FolderSelection = string | null | typeof ALL_FILES_VIEW;

type ViewMode = 'grid' | 'list';
type SortBy = 'name' | 'date' | 'size' | 'type';

/**
 * Converte una `FolderSelection` (UI state) in un vero `folder_id` UUID o
 * `null` per "root". La vista speciale "Tutti i file" (`ALL_FILES_VIEW =
 * '__all__'`) NON e' una folder reale e quindi va sempre tradotta in `null`
 * (= upload/create in root) prima di essere passata a qualunque RPC server,
 * che si aspetta `uuid | null`.
 *
 * BUGFIX 2026-04-19 sera: il pattern `typeof selectedFolder === 'string' ?
 * selectedFolder : null` lasciava passare `'__all__'` (e' una stringa
 * literal!), causando l'errore Postgres `invalid input syntax for type uuid:
 * "__all__"` quando l'utente caricava un file dalla vista "Tutti i file"
 * (che e' la vista di default/comune): il mismatch finiva nella coda FIFO
 * `pendingFolderQueueRef` e poi nell'RPC `move_presentations_to_folder`
 * tramite `onJobDone`. Stessa cosa per "Nuova cartella" (parent_id) e per i
 * drop PC sul pannello centrale.
 */
function folderIdFromSelection(sel: FolderSelection): string | null {
  if (sel === ALL_FILES_VIEW || sel === null) return null;
  return sel;
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}

function pickFileIcon(mime: string | null | undefined): typeof FileIcon {
  const m = (mime ?? '').toLowerCase();
  if (m === 'application/pdf') return FileText;
  if (m.startsWith('image/')) return FileImage;
  if (m.startsWith('video/')) return FileVideo;
  if (m.startsWith('audio/')) return FileAudio;
  return FileIcon;
}

/**
 * Wrapper per renderizzare l'icona corretta in base al mime senza incorrere
 * nel lint "react-hooks/static-components" (che vieta `const X = pickIcon();
 * <X />` dentro render): usa `React.createElement` su una function reference
 * gia' importata da `lucide-react`.
 */
function MimeIcon({ mime, className }: { mime: string | null | undefined; className?: string }) {
  return createElement(pickFileIcon(mime), { className });
}

function fileExt(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i >= 0 && i < fileName.length - 1 ? fileName.slice(i + 1).toLowerCase() : '';
}

/** Cache dell'ID sessione di default in localStorage, scoped per evento. */
function loadDefaultSession(eventId: string): string | null {
  try {
    return localStorage.getItem(`sc.explorer.session.${eventId}`);
  } catch {
    return null;
  }
}
function saveDefaultSession(eventId: string, sessionId: string): void {
  try {
    localStorage.setItem(`sc.explorer.session.${eventId}`, sessionId);
  } catch {
    /* noop */
  }
}

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem('sc.explorer.viewMode');
    if (v === 'list' || v === 'grid') return v;
  } catch {
    /* noop */
  }
  return 'grid';
}
function saveViewMode(v: ViewMode): void {
  try {
    localStorage.setItem('sc.explorer.viewMode', v);
  } catch {
    /* noop */
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ProductionView() {
  const { t, i18n } = useTranslation();
  const params = useParams();
  const eventId = params.eventId ?? '';
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

  // ---------- STATE ---------------------------------------------------------
  const [state, setState] = useState<ExplorerState>(EMPTY_STATE);
  const [selectedFolder, setSelectedFolder] = useState<FolderSelection>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Selection multi-item (file ID per ora; cartelle gestite separatamente)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastClickedFileId, setLastClickedFileId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Folder editing inline
  const [creatingChild, setCreatingChild] = useState<string | 'root' | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renamingFileVersionId, setRenamingFileVersionId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  // Drag&drop state
  const [draggedFileIds, setDraggedFileIds] = useState<string[] | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [pcDropZone, setPcDropZone] = useState<'tree' | 'center' | null>(null);
  const [pcDropTargetFolderId, setPcDropTargetFolderId] = useState<string | null>(null);

  // Upload session pickup (default = prima sessione attiva o cached)
  const [targetSessionId, setTargetSessionId] = useState<string>('');

  // Preview dialog state
  const [previewState, setPreviewState] = useState<{
    open: boolean;
    fileName: string;
    mime: string;
    versionId: string | null;
    sourceUrl: string | null;
    sourceLoading: boolean;
    sourceError: string | null;
  }>({
    open: false,
    fileName: '',
    mime: '',
    versionId: null,
    sourceUrl: null,
    sourceLoading: false,
    sourceError: null,
  });

  // FIFO destinazioni file: shiftata da onJobDone in ordine di completamento.
  // BUGFIX 2026-04-19: in passato esisteva una `pendingFolderByJobRef` Map
  // indicizzata per versionId che NON veniva mai popolata (versionId noto solo
  // dopo init server-side, post-enqueue): risultato → tutti i file caricati
  // restavano in root anche se l'utente li droppava in una sotto-cartella.
  // Sostituita da una coda FIFO popolata in `startUpload` PRIMA di enqueue,
  // consumata da onJobDone nello stesso ordine (concurrency=1 nell'hook
  // garantisce che onJobDone arriva nello stesso ordine di enqueue).
  const pendingFolderQueueRef = useRef<Array<string | null>>([]);

  // ---------- DATA LOADING -------------------------------------------------
  const reload = useCallback(async () => {
    if (!eventId) return;
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const eventRes = await supabase
        .from('events')
        .select('id, name, tenant_id')
        .eq('id', eventId)
        .single();
      if (eventRes.error) throw new Error(eventRes.error.message);
      const event = eventRes.data as EventLite;

      const [folders, presentationsRes, sessionsRes, speakersRes] = await Promise.all([
        listEventFolders(eventId),
        supabase
          .from('presentations')
          .select(
            'id, session_id, speaker_id, folder_id, status, current_version_id, updated_at, created_at',
          )
          .eq('event_id', eventId)
          .order('updated_at', { ascending: false })
          .limit(2000),
        supabase
          .from('sessions')
          .select('id, title, room_id, scheduled_start')
          .eq('event_id', eventId)
          .order('scheduled_start', { ascending: true, nullsFirst: false })
          .limit(1000),
        supabase
          .from('speakers')
          .select('id, full_name')
          .eq('event_id', eventId)
          .limit(2000),
      ]);
      if (presentationsRes.error) throw new Error(presentationsRes.error.message);
      if (sessionsRes.error) throw new Error(sessionsRes.error.message);
      if (speakersRes.error) throw new Error(speakersRes.error.message);

      const presentations = (presentationsRes.data ?? []) as unknown as PresentationRow[];
      const sessions = (sessionsRes.data ?? []) as unknown as SessionLite[];
      const sessionsById: Record<string, SessionLite> = {};
      sessions.forEach((s) => {
        sessionsById[s.id] = s;
      });
      const speakers: Record<string, SpeakerLite> = {};
      (speakersRes.data ?? []).forEach((row) => {
        const sp = row as SpeakerLite;
        if (sp?.id) speakers[sp.id] = sp;
      });

      // Versions (chunked parallel, riuso strategia Sprint U-5+1 H1)
      const versionIds = presentations
        .map((p) => p.current_version_id)
        .filter((v): v is string => Boolean(v));
      const versions: Record<string, VersionLite> = {};
      if (versionIds.length > 0) {
        const chunkSize = 200;
        const chunks: string[][] = [];
        for (let i = 0; i < versionIds.length; i += chunkSize) {
          chunks.push(versionIds.slice(i, i + chunkSize));
        }
        const chunkResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from('presentation_versions')
              .select('id, file_name, file_size_bytes, mime_type, status')
              .in('id', chunk),
          ),
        );
        for (const versionsRes of chunkResults) {
          if (versionsRes.error) throw new Error(versionsRes.error.message);
          (versionsRes.data ?? []).forEach((v) => {
            const row = v as VersionLite;
            versions[row.id] = row;
          });
        }
      }

      setState({
        status: 'ready',
        event,
        folders,
        presentations,
        sessions,
        sessionsById,
        speakers,
        versions,
      });

      // Pickup default session: cached -> prima per scheduled_start (gia' ordinata).
      // (Nota: `sessions.status` non esiste a schema — niente filtro 'active'/'setup'.)
      setTargetSessionId((prev) => {
        if (prev && sessionsById[prev]) return prev;
        const cached = loadDefaultSession(eventId);
        if (cached && sessionsById[cached]) return cached;
        return sessions[0]?.id ?? '';
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        message: err instanceof Error ? err.message : 'unknown_error',
      }));
    }
  }, [eventId, supabase]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // ---------- DERIVED ------------------------------------------------------
  const tree = useMemo(() => buildFolderTree(state.folders), [state.folders]);
  const folderById = useMemo(() => {
    const map = new Map<string, EventFolderRow>();
    state.folders.forEach((f) => map.set(f.id, f));
    return map;
  }, [state.folders]);

  /** Conta file per folder_id (null = root). */
  const fileCountByFolder = useMemo(() => {
    const counts = new Map<string | null, number>();
    state.presentations.forEach((p) => {
      counts.set(p.folder_id, (counts.get(p.folder_id) ?? 0) + 1);
    });
    return counts;
  }, [state.presentations]);

  const totalFileCount = state.presentations.length;

  /** Sotto-cartelle direttamente figlie della folder corrente (visibili in centro). */
  const subFoldersOfSelected = useMemo(() => {
    if (selectedFolder === ALL_FILES_VIEW) return [];
    const parentId = typeof selectedFolder === 'string' ? selectedFolder : null;
    return state.folders
      .filter((f) => (f.parent_id ?? null) === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  }, [state.folders, selectedFolder, i18n.language]);

  /** Files visibili in centro (filtrati + ordinati + ricerca). */
  const visibleFiles = useMemo(() => {
    let files: PresentationRow[] = [];
    if (selectedFolder === ALL_FILES_VIEW) {
      files = state.presentations.slice();
    } else {
      const fid = typeof selectedFolder === 'string' ? selectedFolder : null;
      files = state.presentations.filter((p) => p.folder_id === fid);
    }
    if (search.trim().length > 0) {
      const q = search.trim().toLowerCase();
      files = files.filter((p) => {
        const v = p.current_version_id ? state.versions[p.current_version_id] : null;
        const sp = p.speaker_id ? state.speakers[p.speaker_id] : null;
        return (
          (v?.file_name ?? '').toLowerCase().includes(q) ||
          (sp?.full_name ?? '').toLowerCase().includes(q)
        );
      });
    }
    files.sort((a, b) => {
      const va = a.current_version_id ? state.versions[a.current_version_id] : null;
      const vb = b.current_version_id ? state.versions[b.current_version_id] : null;
      switch (sortBy) {
        case 'name':
          return (va?.file_name ?? '').localeCompare(vb?.file_name ?? '', i18n.language);
        case 'date':
          return (Date.parse(b.updated_at) || 0) - (Date.parse(a.updated_at) || 0);
        case 'size':
          return (vb?.file_size_bytes ?? 0) - (va?.file_size_bytes ?? 0);
        case 'type':
          return fileExt(va?.file_name ?? '').localeCompare(fileExt(vb?.file_name ?? ''));
        default:
          return 0;
      }
    });
    return files;
  }, [
    state.presentations,
    state.versions,
    state.speakers,
    selectedFolder,
    search,
    sortBy,
    i18n.language,
  ]);

  /** Breadcrumb chain dalla folder corrente alla root. */
  const breadcrumb = useMemo(() => {
    if (selectedFolder === ALL_FILES_VIEW) return [];
    if (selectedFolder === null) return [] as EventFolderRow[];
    const chain: EventFolderRow[] = [];
    let cur = folderById.get(selectedFolder) ?? null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? (folderById.get(cur.parent_id) ?? null) : null;
    }
    return chain;
  }, [folderById, selectedFolder]);

  const parentOfSelected = useMemo<FolderSelection>(() => {
    if (selectedFolder === ALL_FILES_VIEW) return null;
    if (selectedFolder === null) return null;
    const f = folderById.get(selectedFolder);
    return f?.parent_id ?? null;
  }, [selectedFolder, folderById]);

  // ---------- UPLOAD QUEUE -------------------------------------------------

  const onJobDone = useCallback(
    async (info: UploadJobDoneInfo) => {
      // Shift FIFO: prendi la destinazione del prossimo job completato.
      // L'ordine e' garantito perche' useUploadQueue ha MAX_PARALLEL=1 e
      // onJobDone viene invocato dopo finalize, nello stesso ordine di enqueue.
      const dest = pendingFolderQueueRef.current.shift();
      try {
        if (dest != null) {
          await movePresentationsToFolder([info.presentationId], dest);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'move_after_upload_failed');
      }
      void reload();
    },
    [reload],
  );

  const onAllDone = useCallback(() => {
    pendingFolderQueueRef.current = [];
  }, []);

  const queue = useUploadQueue({
    sessionId: targetSessionId,
    supabaseUrl,
    anonKey: supabaseAnonKey,
    onJobDone,
    onAllDone,
  });

  // ---------- FOLDER NAV / EDIT ---------------------------------------------

  const expandFolder = useCallback((id: string) => {
    setExpanded((s) => new Set(s).add(id));
  }, []);
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectFolder = useCallback((sel: FolderSelection) => {
    setSelectedFolder(sel);
    setSelectedFileIds(new Set());
    setLastClickedFileId(null);
    setActionError(null);
  }, []);

  const handleNavigateUp = useCallback(() => {
    handleSelectFolder(parentOfSelected);
  }, [handleSelectFolder, parentOfSelected]);

  const handleCreateFolder = useCallback(
    async (parentId: string | null, name: string) => {
      if (!state.event) return;
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setCreatingChild(null);
        setDraftName('');
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await createEventFolder({
          tenantId: state.event.tenant_id,
          eventId: state.event.id,
          parentId,
          name: trimmed,
        });
        if (parentId) expandFolder(parentId);
        setCreatingChild(null);
        setDraftName('');
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'create_failed');
      } finally {
        setBusy(false);
      }
    },
    [expandFolder, reload, state.event],
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setRenamingFolderId(null);
        setDraftName('');
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await renameEventFolder(folderId, trimmed);
        setRenamingFolderId(null);
        setDraftName('');
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'rename_failed');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      if (!confirm(t('folder.confirmDelete'))) return;
      setBusy(true);
      setActionError(null);
      try {
        await deleteEventFolder(folderId);
        if (typeof selectedFolder === 'string' && selectedFolder === folderId) {
          setSelectedFolder(null);
        }
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'delete_failed');
      } finally {
        setBusy(false);
      }
    },
    [reload, selectedFolder, t],
  );

  // ---------- FILE SELECTION (single / multi / range) -----------------------

  const handleClickFile = useCallback(
    (id: string, e: React.MouseEvent) => {
      const isMulti = e.metaKey || e.ctrlKey;
      const isRange = e.shiftKey;
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (isRange && lastClickedFileId) {
          const ids = visibleFiles.map((f) => f.id);
          const i1 = ids.indexOf(lastClickedFileId);
          const i2 = ids.indexOf(id);
          if (i1 >= 0 && i2 >= 0) {
            const [a, b] = i1 < i2 ? [i1, i2] : [i2, i1];
            for (let i = a; i <= b; i += 1) next.add(ids[i]);
            return next;
          }
        }
        if (isMulti) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }
        next.clear();
        next.add(id);
        return next;
      });
      setLastClickedFileId(id);
    },
    [lastClickedFileId, visibleFiles],
  );

  const clearFileSelection = useCallback(() => {
    setSelectedFileIds(new Set());
    setLastClickedFileId(null);
  }, []);

  // ---------- FILE OPERATIONS -----------------------------------------------

  const handleMoveFiles = useCallback(
    async (presentationIds: string[], folderId: string | null) => {
      if (presentationIds.length === 0) return;
      setBusy(true);
      setActionError(null);
      try {
        await movePresentationsToFolder(presentationIds, folderId);
        clearFileSelection();
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'move_failed');
      } finally {
        setBusy(false);
      }
    },
    [clearFileSelection, reload],
  );

  const handleRenameFile = useCallback(
    async (versionId: string, newName: string) => {
      const trimmed = newName.trim();
      if (trimmed.length === 0) {
        setRenamingFileVersionId(null);
        setDraftName('');
        return;
      }
      setBusy(true);
      setActionError(null);
      try {
        await renameVersionFileName(versionId, trimmed);
        setRenamingFileVersionId(null);
        setDraftName('');
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'rename_file_failed');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  const handleDeleteFile = useCallback(
    async (presentationId: string) => {
      if (!confirm(t('explorer.confirmDeleteFile'))) return;
      setBusy(true);
      setActionError(null);
      try {
        await deletePresentationAdmin(presentationId);
        clearFileSelection();
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'delete_failed');
      } finally {
        setBusy(false);
      }
    },
    [clearFileSelection, reload, t],
  );

  const handleDeleteSelected = useCallback(async () => {
    if (selectedFileIds.size === 0) return;
    if (!confirm(t('explorer.confirmDeleteFilesBulk', { count: selectedFileIds.size }))) return;
    setBusy(true);
    setActionError(null);
    try {
      const ids = Array.from(selectedFileIds);
      // Sequenziale per evitare stress su storage_keys remove
      for (const id of ids) {
        await deletePresentationAdmin(id);
      }
      clearFileSelection();
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'delete_failed');
    } finally {
      setBusy(false);
    }
  }, [clearFileSelection, reload, selectedFileIds, t]);

  // ---------- PREVIEW -------------------------------------------------------

  const openPreview = useCallback(
    async (versionId: string) => {
      const v = state.versions[versionId];
      if (!v) return;
      // Trova storage_key (non e' nello state.versions: solo nello state.presentations
      // tramite current_version_id, ma non lo ricarichiamo per non ingrossare il payload).
      // Fetch on-demand:
      setPreviewState({
        open: true,
        fileName: v.file_name,
        mime: v.mime_type ?? 'application/octet-stream',
        versionId,
        sourceUrl: null,
        sourceLoading: true,
        sourceError: null,
      });
      try {
        const { data, error } = await supabase
          .from('presentation_versions')
          .select('storage_key')
          .eq('id', versionId)
          .single();
        if (error || !data?.storage_key) throw error ?? new Error('missing_storage_key');
        const url = await createVersionPreviewUrl(data.storage_key);
        setPreviewState((s) => ({ ...s, sourceUrl: url, sourceLoading: false }));
      } catch (err) {
        setPreviewState((s) => ({
          ...s,
          sourceLoading: false,
          sourceError: err instanceof Error ? err.message : 'preview_failed',
        }));
      }
    },
    [state.versions, supabase],
  );

  const closePreview = useCallback(() => {
    setPreviewState((s) => ({ ...s, open: false }));
  }, []);

  const downloadVersion = useCallback(
    async (versionId: string) => {
      try {
        const { data, error } = await supabase
          .from('presentation_versions')
          .select('storage_key, file_name')
          .eq('id', versionId)
          .single();
        if (error || !data?.storage_key) throw error ?? new Error('missing_storage_key');
        const url = await createVersionDownloadUrl(data.storage_key);
        // Force download via anchor + revoke. URL e' signed, no leak.
        const a = document.createElement('a');
        a.href = url;
        a.download = data.file_name ?? 'file';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'download_failed');
      }
    },
    [supabase],
  );

  // ---------- UPLOAD ORCHESTRATION ------------------------------------------

  /**
   * Avvia upload di File[] verso una specifica folder. Per ogni file calcoliamo
   * la destinazione (folder droppata + eventuale sotto-folder ricreata da
   * `webkitRelativePath`) e usiamo la coda FIFO `pendingFolderQueueRef`:
   * `useUploadQueue` non espone `init.version_id` PRIMA del done, ma essendo
   * single-job (MAX_PARALLEL=1) i job vengono processati in ordine di enqueue
   * e onJobDone arriva nello stesso ordine — quindi shift FIFO da
   * pendingFolderQueueRef coincide con la destinazione del job appena fatto.
   */
  const startUpload = useCallback(
    async (
      files: File[],
      baseFolderId: string | null,
      result?: FolderTraversalResult,
    ) => {
      if (files.length === 0) return;
      if (!targetSessionId) {
        setActionError('explorer.errors.noSessionSelected');
        return;
      }
      if (!state.event) return;

      // Per ogni file, calcola folder finale: se file.name contiene "/" =>
      // ensureFolderPath (crea sotto-folder); altrimenti baseFolderId.
      // Pre-creiamo le folder UNA volta deduplicando, poi pushiamo la
      // destinazione di ciascun file in pendingFolderQueueRef (FIFO),
      // e infine enqueue: onJobDone consumera' la coda nello stesso ordine.
      setBusy(true);
      try {
        // Pre-crea tutte le sotto-cartelle UNA volta (deduplica per directory path).
        const dirSet = new Set<string>();
        for (const f of files) {
          const last = f.name.lastIndexOf('/');
          if (last > 0) dirSet.add(f.name.slice(0, last));
        }
        const dirToFolderId = new Map<string, string | null>();
        dirToFolderId.set('', baseFolderId);
        // Ordina path corti prima per evitare race
        const sortedDirs = Array.from(dirSet).sort((a, b) => a.split('/').length - b.split('/').length);
        for (const dir of sortedDirs) {
          const id = await ensureFolderPath({
            tenantId: state.event.tenant_id,
            eventId: state.event.id,
            parentId: baseFolderId,
            segments: dir.split('/'),
          });
          dirToFolderId.set(dir, id);
        }
        await reload(); // refresh tree per mostrare le nuove folders subito

        // Push destinazione FIFO per OGNI file, nello stesso ordine di enqueue.
        // onJobDone shifta una destinazione per job completato.
        const destQueue: Array<string | null> = [];
        for (const f of files) {
          const last = f.name.lastIndexOf('/');
          const dir = last > 0 ? f.name.slice(0, last) : '';
          destQueue.push(dirToFolderId.get(dir) ?? baseFolderId);
        }
        pendingFolderQueueRef.current.push(...destQueue);

        queue.enqueue(files);

        if (result) {
          const messages: string[] = [];
          if (result.duplicates > 0)
            messages.push(t('explorer.uploadFeedback.duplicates', { count: result.duplicates }));
          if (result.emptyFiles > 0)
            messages.push(t('explorer.uploadFeedback.emptyFiles', { count: result.emptyFiles }));
          if (result.filenameTooLong > 0)
            messages.push(t('explorer.uploadFeedback.filenameTooLong', { count: result.filenameTooLong }));
          if (result.truncated)
            messages.push(t('explorer.uploadFeedback.truncated'));
          if (messages.length > 0) setActionError(messages.join(' · '));
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'upload_failed');
      } finally {
        setBusy(false);
      }
    },
    [queue, reload, state.event, t, targetSessionId],
  );

  // ---------- SESSION PICKER ------------------------------------------------

  const handlePickSession = useCallback(
    (sessionId: string) => {
      setTargetSessionId(sessionId);
      saveDefaultSession(eventId, sessionId);
    },
    [eventId],
  );

  // ---------- DRAG & DROP HANDLERS ------------------------------------------

  /** Drop dal PC su una folder dell'albero (sx) o sul centro (folder corrente). */
  const handlePcDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string | null) => {
      e.preventDefault();
      e.stopPropagation();
      setPcDropZone(null);
      setPcDropTargetFolderId(null);
      const dt = e.dataTransfer;
      if (!dt) return;
      // Ignora drop di presentation interna (gestito altrove)
      if (Array.from(dt.types).includes('application/x-slidecenter-presentation')) return;
      try {
        const result = await extractFilesFromDataTransfer(dt);
        if (result.files.length === 0) return;
        await startUpload(result.files, targetFolderId, result);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'drop_failed');
      }
    },
    [startUpload],
  );

  /** Click "Carica file" toolbar. */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const onFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const baseFolder = folderIdFromSelection(selectedFolder);
      await startUpload(Array.from(files), baseFolder);
      // Reset input per permettere stessa selezione di nuovo
      e.target.value = '';
    },
    [selectedFolder, startUpload],
  );

  const onDirInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const baseFolder = folderIdFromSelection(selectedFolder);
      const result = extractFilesFromInputDirectory(files);
      await startUpload(result.files, baseFolder, result);
      e.target.value = '';
    },
    [selectedFolder, startUpload],
  );

  // ---------- KEYBOARD SHORTCUTS --------------------------------------------

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // F2 = rinomina file selezionato (single)
      if (e.key === 'F2' && selectedFileIds.size === 1 && !renamingFileVersionId && !renamingFolderId) {
        const id = Array.from(selectedFileIds)[0];
        const pres = state.presentations.find((p) => p.id === id);
        const v = pres?.current_version_id ? state.versions[pres.current_version_id] : null;
        if (v) {
          setRenamingFileVersionId(v.id);
          setDraftName(v.file_name);
          e.preventDefault();
        }
      }
      // Delete = elimina selezione
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFileIds.size > 0 && !renamingFileVersionId && !renamingFolderId) {
        // Solo se non in input
        const tag = (document.activeElement?.tagName ?? '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        void handleDeleteSelected();
      }
      // Esc = clear selection / chiudi rename
      if (e.key === 'Escape') {
        if (renamingFileVersionId || renamingFolderId || creatingChild) {
          setRenamingFileVersionId(null);
          setRenamingFolderId(null);
          setCreatingChild(null);
          setDraftName('');
          return;
        }
        if (selectedFileIds.size > 0) {
          clearFileSelection();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    clearFileSelection,
    creatingChild,
    handleDeleteSelected,
    renamingFileVersionId,
    renamingFolderId,
    selectedFileIds,
    state.presentations,
    state.versions,
  ]);

  // Persist viewMode
  useEffect(() => {
    saveViewMode(viewMode);
  }, [viewMode]);

  // ---------- RENDER GUARDS -------------------------------------------------
  if (!eventId) {
    return (
      <div className="p-8 text-sm text-sc-text-dim">{t('production.errorMissingEvent')}</div>
    );
  }
  if (state.status === 'loading' || state.status === 'idle') {
    return (
      <div className="flex h-full items-center justify-center p-12 text-sc-text-dim">
        <Loader2 className="mr-2 size-5 animate-spin" /> {t('common.loading')}
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="p-8">
        <h1 className="text-lg font-semibold text-sc-danger">{t('common.errorTitle')}</h1>
        <p className="mt-2 text-sm text-sc-text-dim">{state.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => void reload()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (!state.event) return null;
  const event = state.event;

  // ---------- RENDER --------------------------------------------------------
  const selectedSingleFile =
    selectedFileIds.size === 1
      ? state.presentations.find((p) => p.id === Array.from(selectedFileIds)[0]) ?? null
      : null;

  return (
    <div className="flex h-full flex-col bg-sc-bg">
      {/* HEADER + TOOLBAR + BREADCRUMB */}
      <header className="border-b border-sc-border bg-sc-surface/40">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-sc-text-dim">
              {t('explorer.kicker')}
            </p>
            <h1 className="mt-0.5 truncate text-xl font-semibold text-sc-text sm:text-2xl">
              {event.name}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/events/${event.id}`}>
                <ChevronRight className="rotate-180" />
                {t('production.backToEvent')}
              </Link>
            </Button>
          </div>
        </div>

        <ExplorerToolbar
          busy={busy}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          sortBy={sortBy}
          onSortChange={setSortBy}
          search={search}
          onSearchChange={setSearch}
          canNavigateUp={selectedFolder !== null && selectedFolder !== ALL_FILES_VIEW}
          onNavigateUp={handleNavigateUp}
          onNewFolder={() => {
            const parentId = folderIdFromSelection(selectedFolder);
            setCreatingChild(parentId ?? 'root');
            setDraftName('');
          }}
          onUploadFiles={() => fileInputRef.current?.click()}
          onUploadDirectory={() => dirInputRef.current?.click()}
          sessions={state.sessions}
          targetSessionId={targetSessionId}
          onPickSession={handlePickSession}
        />

        <ExplorerBreadcrumb
          eventName={event.name}
          chain={breadcrumb}
          onSelect={handleSelectFolder}
          isAllView={selectedFolder === ALL_FILES_VIEW}
        />
      </header>

      {/* ERROR BAR */}
      {actionError ? (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-sc-danger/40 bg-sc-danger/10 px-4 py-2 text-sm text-sc-danger sm:px-6"
        >
          <Info className="size-4 shrink-0" />
          <span className="flex-1">{actionError}</span>
          <button
            type="button"
            className="text-sc-danger hover:opacity-80"
            onClick={() => setActionError(null)}
            aria-label={t('common.close')}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      {/* HIDDEN INPUTS for file/folder upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onFileInputChange}
      />
      <input
        ref={dirInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={onDirInputChange}
        // @ts-expect-error - Non-standard ma supportato da Chrome/Edge/Safari/Firefox50+
        webkitdirectory=""
      />

      {/* MAIN 3 PANES */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANE: tree */}
        <ExplorerLeftPane
          tree={tree}
          expanded={expanded}
          selectedFolder={selectedFolder}
          fileCountByFolder={fileCountByFolder}
          totalFileCount={totalFileCount}
          creatingChild={creatingChild}
          renamingFolderId={renamingFolderId}
          draftName={draftName}
          onDraftChange={setDraftName}
          busy={busy}
          onSelectFolder={handleSelectFolder}
          onToggleExpand={toggleExpanded}
          onStartCreateChild={(parentId) => {
            setCreatingChild(parentId);
            setDraftName('');
            if (parentId !== 'root' && typeof parentId === 'string') expandFolder(parentId);
          }}
          onCommitCreate={handleCreateFolder}
          onStartRename={(id, currentName) => {
            setRenamingFolderId(id);
            setDraftName(currentName);
          }}
          onCommitRename={handleRenameFolder}
          onCancelEdit={() => {
            setCreatingChild(null);
            setRenamingFolderId(null);
            setDraftName('');
          }}
          onDelete={handleDeleteFolder}
          // Drop file presentations su folder
          draggedFileIds={draggedFileIds}
          dragOverFolderId={dragOverFolderId}
          onDragEnterFolder={(id) => setDragOverFolderId(id)}
          onDragLeaveFolder={(id) =>
            setDragOverFolderId((cur) => (cur === id ? null : cur))
          }
          onDropFilesOnFolder={(folderId) => {
            setDragOverFolderId(null);
            if (draggedFileIds && draggedFileIds.length > 0) {
              void handleMoveFiles(draggedFileIds, folderId);
            }
            setDraggedFileIds(null);
          }}
          // Drop PC su folder (creazione + upload)
          pcDropTargetFolderId={pcDropTargetFolderId}
          onPcDragEnterFolder={(folderId) => {
            setPcDropZone('tree');
            setPcDropTargetFolderId(folderId);
          }}
          onPcDragLeaveFolder={(folderId) =>
            setPcDropTargetFolderId((cur) => (cur === folderId ? null : cur))
          }
          onPcDropOnFolder={(e, folderId) => {
            void handlePcDrop(e, folderId);
          }}
        />

        {/* CENTER PANE: grid/list */}
        <ExplorerCenterPane
          viewMode={viewMode}
          sortBy={sortBy}
          subFolders={subFoldersOfSelected}
          files={visibleFiles}
          versions={state.versions}
          speakers={state.speakers}
          sessionsById={state.sessionsById}
          folderById={folderById}
          isAllFilesView={selectedFolder === ALL_FILES_VIEW}
          selectedFileIds={selectedFileIds}
          renamingFileVersionId={renamingFileVersionId}
          draftName={draftName}
          onDraftChange={setDraftName}
          onCommitFileRename={handleRenameFile}
          onCancelFileRename={() => {
            setRenamingFileVersionId(null);
            setDraftName('');
          }}
          onClickFile={handleClickFile}
          onDoubleClickFile={(id) => {
            const pres = state.presentations.find((p) => p.id === id);
            if (pres?.current_version_id) void openPreview(pres.current_version_id);
          }}
          onClickFolder={handleSelectFolder}
          fileCountByFolder={fileCountByFolder}
          // Drag file -> folder/center
          onDragStartFile={(id, e) => {
            // Se selectedFileIds include id, draggiamo TUTTI i selezionati;
            // altrimenti solo l'id.
            const ids = selectedFileIds.has(id) ? Array.from(selectedFileIds) : [id];
            setDraggedFileIds(ids);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ids.join(','));
          }}
          onDragEndFile={() => setDraggedFileIds(null)}
          onDropFilesOnSubFolder={(folderId) => {
            if (draggedFileIds && draggedFileIds.length > 0) {
              void handleMoveFiles(draggedFileIds, folderId);
            }
            setDraggedFileIds(null);
          }}
          // Drop PC sul centro
          isPcDropping={pcDropZone === 'center'}
          onPcDragEnter={() => setPcDropZone('center')}
          onPcDragLeave={() => setPcDropZone((cur) => (cur === 'center' ? null : cur))}
          onPcDrop={(e) => {
            const baseFolder = folderIdFromSelection(selectedFolder);
            void handlePcDrop(e, baseFolder);
          }}
          // File context menu actions
          onContextOpen={(presentationId) => {
            const pres = state.presentations.find((p) => p.id === presentationId);
            if (pres?.current_version_id) void openPreview(pres.current_version_id);
          }}
          onContextDownload={(presentationId) => {
            const pres = state.presentations.find((p) => p.id === presentationId);
            if (pres?.current_version_id) void downloadVersion(pres.current_version_id);
          }}
          onContextRename={(presentationId) => {
            const pres = state.presentations.find((p) => p.id === presentationId);
            if (pres?.current_version_id) {
              const v = state.versions[pres.current_version_id];
              setRenamingFileVersionId(pres.current_version_id);
              setDraftName(v?.file_name ?? '');
            }
          }}
          onContextDelete={(presentationId) => {
            void handleDeleteFile(presentationId);
          }}
          onContextMove={(presentationId, folderId) => {
            void handleMoveFiles([presentationId], folderId);
          }}
          folders={state.folders}
          // Selection bar
          selectionCount={selectedFileIds.size}
          onClearSelection={clearFileSelection}
          onBulkMove={(folderId) =>
            void handleMoveFiles(Array.from(selectedFileIds), folderId)
          }
          onBulkDelete={() => void handleDeleteSelected()}
          busy={busy}
        />

        {/* RIGHT PANE: details */}
        <ExplorerRightPane
          selectedFile={selectedSingleFile}
          selectionCount={selectedFileIds.size}
          versions={state.versions}
          speakers={state.speakers}
          sessionsById={state.sessionsById}
          folderById={folderById}
          locale={i18n.language}
          onPreview={(versionId) => void openPreview(versionId)}
          onDownload={(versionId) => void downloadVersion(versionId)}
          onRename={(versionId, currentName) => {
            setRenamingFileVersionId(versionId);
            setDraftName(currentName);
          }}
          onDelete={(presentationId) => void handleDeleteFile(presentationId)}
          folders={state.folders}
          onMoveTo={(presentationId, folderId) =>
            void handleMoveFiles([presentationId], folderId)
          }
        />
      </div>

      {/* UPLOAD QUEUE DOCK */}
      {queue.jobs.length > 0 ? (
        <ExplorerUploadDock
          jobs={queue.jobs}
          onCancel={queue.cancel}
          onClearFinished={queue.clearFinished}
        />
      ) : null}

      {/* PREVIEW DIALOG */}
      <FilePreviewDialog
        open={previewState.open}
        onClose={closePreview}
        fileName={previewState.fileName}
        mime={previewState.mime}
        sourceUrl={previewState.sourceUrl}
        sourceLoading={previewState.sourceLoading}
        sourceError={previewState.sourceError}
        onDownload={
          previewState.versionId
            ? () => void downloadVersion(previewState.versionId as string)
            : undefined
        }
      />
    </div>
  );
}

export { ProductionView as Component };

// ============================================================================
// SUB COMPONENTS
// ============================================================================

interface ExplorerToolbarProps {
  busy: boolean;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  sortBy: SortBy;
  onSortChange: (s: SortBy) => void;
  search: string;
  onSearchChange: (s: string) => void;
  canNavigateUp: boolean;
  onNavigateUp: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadDirectory: () => void;
  sessions: SessionLite[];
  targetSessionId: string;
  onPickSession: (id: string) => void;
}

function ExplorerToolbar({
  busy,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  search,
  onSearchChange,
  canNavigateUp,
  onNavigateUp,
  onNewFolder,
  onUploadFiles,
  onUploadDirectory,
  sessions,
  targetSessionId,
  onPickSession,
}: ExplorerToolbarProps) {
  const { t } = useTranslation();
  const targetSession = sessions.find((s) => s.id === targetSessionId);
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-sc-border/40 px-4 py-2 sm:px-6">
      <Button
        size="sm"
        variant="ghost"
        disabled={!canNavigateUp || busy}
        onClick={onNavigateUp}
        title={t('explorer.toolbar.navigateUp')}
      >
        <ArrowUp />
        <span className="hidden sm:inline">{t('explorer.toolbar.navigateUp')}</span>
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onNewFolder}>
        <FolderPlus />
        <span className="hidden sm:inline">{t('explorer.toolbar.newFolder')}</span>
      </Button>

      <div className="mx-1 h-5 w-px bg-sc-border/60" />

      <Button
        size="sm"
        variant="accent"
        disabled={busy || sessions.length === 0}
        onClick={onUploadFiles}
        title={t('explorer.toolbar.uploadFiles')}
      >
        <Upload />
        <span className="hidden sm:inline">{t('explorer.toolbar.uploadFiles')}</span>
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={busy || sessions.length === 0}
        onClick={onUploadDirectory}
        title={t('explorer.toolbar.uploadFolder')}
      >
        <FolderUp />
        <span className="hidden sm:inline">{t('explorer.toolbar.uploadFolder')}</span>
      </Button>

      {/* SESSION PICKER */}
      {sessions.length === 0 ? (
        <span className="ml-1 text-[11px] text-sc-warning">
          {t('explorer.toolbar.noSessionsHint')}
        </span>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex h-8 items-center gap-1.5 rounded-md border border-sc-border bg-sc-surface px-2 text-xs text-sc-text hover:bg-sc-surface/70"
          >
            <span className="text-sc-text-dim">{t('explorer.toolbar.uploadInto')}</span>
            <span className="font-medium">
              {targetSession?.title ?? t('explorer.toolbar.pickSession')}
            </span>
            <ChevronRight className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-72 w-64 overflow-y-auto">
            {sessions.map((s) => (
              <DropdownMenuItem
                key={s.id}
                onSelect={() => onPickSession(s.id)}
                className={cn(s.id === targetSessionId && 'bg-sc-accent/15 text-sc-text')}
              >
                <span className="truncate">{s.title}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <div className="mx-1 h-5 w-px bg-sc-border/60" />

      {/* SEARCH */}
      <div className="relative flex flex-1 items-center sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2 size-3.5 text-sc-text-dim" />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('explorer.toolbar.searchPlaceholder')}
          className="h-8 w-full rounded-md border border-sc-border bg-sc-surface pl-7 pr-2 text-xs text-sc-text outline-none placeholder:text-sc-text-dim focus:border-sc-accent"
        />
      </div>

      {/* SORT */}
      <select
        value={sortBy}
        onChange={(e) => onSortChange(e.target.value as SortBy)}
        className="h-8 rounded-md border border-sc-border bg-sc-surface px-2 text-xs text-sc-text"
        aria-label={t('explorer.toolbar.sortAria')}
      >
        <option value="name">{t('explorer.sort.name')}</option>
        <option value="date">{t('explorer.sort.date')}</option>
        <option value="size">{t('explorer.sort.size')}</option>
        <option value="type">{t('explorer.sort.type')}</option>
      </select>

      {/* VIEW MODE */}
      <div className="flex h-8 overflow-hidden rounded-md border border-sc-border">
        <button
          type="button"
          onClick={() => onViewModeChange('grid')}
          className={cn(
            'flex items-center gap-1 px-2 text-xs',
            viewMode === 'grid'
              ? 'bg-sc-accent/20 text-sc-text'
              : 'text-sc-text-dim hover:bg-sc-surface',
          )}
          aria-pressed={viewMode === 'grid'}
          title={t('explorer.toolbar.viewGrid')}
        >
          <Grid3x3 className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange('list')}
          className={cn(
            'flex items-center gap-1 px-2 text-xs',
            viewMode === 'list'
              ? 'bg-sc-accent/20 text-sc-text'
              : 'text-sc-text-dim hover:bg-sc-surface',
          )}
          aria-pressed={viewMode === 'list'}
          title={t('explorer.toolbar.viewList')}
        >
          <MoreHorizontal className="size-3.5 rotate-90" />
        </button>
      </div>
    </div>
  );
}

interface ExplorerBreadcrumbProps {
  eventName: string;
  chain: EventFolderRow[];
  onSelect: (sel: FolderSelection) => void;
  isAllView: boolean;
}

function ExplorerBreadcrumb({ eventName, chain, onSelect, isAllView }: ExplorerBreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label="breadcrumb"
      className="flex flex-wrap items-center gap-1 border-t border-sc-border/40 px-4 py-1.5 text-xs text-sc-text-dim sm:px-6"
    >
      <button
        type="button"
        onClick={() => onSelect(null)}
        className="hover:text-sc-text"
      >
        {eventName}
      </button>
      <ChevronRight className="size-3" />
      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'rounded px-1 hover:bg-sc-surface',
          chain.length === 0 && !isAllView ? 'font-medium text-sc-text' : 'hover:text-sc-text',
        )}
      >
        {t('production.rootLabel')}
      </button>
      {isAllView ? (
        <>
          <ChevronRight className="size-3" />
          <span className="rounded bg-sc-accent/20 px-1 font-medium text-sc-text">
            {t('explorer.allFiles')}
          </span>
        </>
      ) : null}
      {chain.map((node, i) => (
        <span key={node.id} className="flex items-center gap-1">
          <ChevronRight className="size-3" />
          <button
            type="button"
            onClick={() => onSelect(node.id)}
            className={cn(
              'rounded px-1 hover:bg-sc-surface',
              i === chain.length - 1 ? 'font-medium text-sc-text' : 'hover:text-sc-text',
            )}
          >
            {node.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

// ----- LEFT PANE -----------------------------------------------------------

interface ExplorerLeftPaneProps {
  tree: FolderTreeNode[];
  expanded: Set<string>;
  selectedFolder: FolderSelection;
  fileCountByFolder: Map<string | null, number>;
  totalFileCount: number;
  creatingChild: string | 'root' | null;
  renamingFolderId: string | null;
  draftName: string;
  onDraftChange: (s: string) => void;
  busy: boolean;
  onSelectFolder: (sel: FolderSelection) => void;
  onToggleExpand: (id: string) => void;
  onStartCreateChild: (parentId: string | 'root') => void;
  onCommitCreate: (parentId: string | null, name: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  draggedFileIds: string[] | null;
  dragOverFolderId: string | null;
  onDragEnterFolder: (id: string) => void;
  onDragLeaveFolder: (id: string) => void;
  onDropFilesOnFolder: (id: string | null) => void;
  pcDropTargetFolderId: string | null;
  onPcDragEnterFolder: (id: string | null) => void;
  onPcDragLeaveFolder: (id: string | null) => void;
  onPcDropOnFolder: (e: React.DragEvent, id: string | null) => void;
}

function ExplorerLeftPane(props: ExplorerLeftPaneProps) {
  const { t } = useTranslation();
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-sc-border bg-sc-surface/30 md:flex">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-sc-text-dim">
          {t('explorer.leftPaneTitle')}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => props.onStartCreateChild('root')}
          disabled={props.busy}
          title={t('folder.newRootFolder')}
        >
          <FolderPlus />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="px-1.5 pb-3">
          {/* Vista speciale "Tutti i file" */}
          <FolderTreeRow
            label={t('explorer.allFiles')}
            icon={<Home className="size-4" />}
            count={props.totalFileCount}
            depth={0}
            selected={props.selectedFolder === ALL_FILES_VIEW}
            isPcDropTarget={false}
            onClick={() => props.onSelectFolder(ALL_FILES_VIEW)}
          />
          {/* Root */}
          <FolderTreeRow
            label={t('production.rootLabel')}
            icon={<Folder className="size-4" />}
            count={props.fileCountByFolder.get(null) ?? 0}
            depth={0}
            selected={props.selectedFolder === null}
            isDropTarget={
              props.dragOverFolderId === '__root__' && Boolean(props.draggedFileIds)
            }
            isPcDropTarget={props.pcDropTargetFolderId === '__root__'}
            onClick={() => props.onSelectFolder(null)}
            onDragOver={(e) => {
              if (props.draggedFileIds) {
                e.preventDefault();
                props.onDragEnterFolder('__root__');
              } else if (Array.from(e.dataTransfer.types).includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
                props.onPcDragEnterFolder('__root__');
              }
            }}
            onDragLeave={() => {
              props.onDragLeaveFolder('__root__');
              props.onPcDragLeaveFolder('__root__');
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (props.draggedFileIds) {
                props.onDropFilesOnFolder(null);
              } else {
                props.onPcDropOnFolder(e, null);
              }
            }}
          />
          {props.creatingChild === 'root' ? (
            <FolderEditor
              depth={1}
              draftName={props.draftName}
              onDraftChange={props.onDraftChange}
              busy={props.busy}
              onCommit={(name) => props.onCommitCreate(null, name)}
              onCancel={props.onCancelEdit}
            />
          ) : null}

          <FolderTree
            nodes={props.tree}
            expanded={props.expanded}
            selectedFolder={props.selectedFolder}
            fileCountByFolder={props.fileCountByFolder}
            creatingChild={props.creatingChild}
            renamingFolderId={props.renamingFolderId}
            draftName={props.draftName}
            onDraftChange={props.onDraftChange}
            busy={props.busy}
            onSelect={(id) => props.onSelectFolder(id)}
            onToggleExpand={props.onToggleExpand}
            onStartCreateChild={props.onStartCreateChild}
            onStartRename={props.onStartRename}
            onCommitCreate={props.onCommitCreate}
            onCommitRename={props.onCommitRename}
            onCancelEdit={props.onCancelEdit}
            onDelete={props.onDelete}
            draggedFileIds={props.draggedFileIds}
            dragOverFolderId={props.dragOverFolderId}
            onDragEnterFolder={props.onDragEnterFolder}
            onDragLeaveFolder={props.onDragLeaveFolder}
            onDropFilesOnFolder={props.onDropFilesOnFolder}
            pcDropTargetFolderId={props.pcDropTargetFolderId}
            onPcDragEnterFolder={props.onPcDragEnterFolder}
            onPcDragLeaveFolder={props.onPcDragLeaveFolder}
            onPcDropOnFolder={props.onPcDropOnFolder}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}

interface FolderTreeRowProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  depth: number;
  selected: boolean;
  isDropTarget?: boolean;
  isPcDropTarget?: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  onClick: () => void;
  onToggleExpand?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  trailing?: React.ReactNode;
}

function FolderTreeRow({
  label,
  icon,
  count,
  depth,
  selected,
  isDropTarget,
  isPcDropTarget,
  hasChildren,
  expanded,
  onClick,
  onToggleExpand,
  onDragOver,
  onDragLeave,
  onDrop,
  trailing,
}: FolderTreeRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-1 py-1 text-sm',
        selected
          ? 'bg-sc-accent/15 text-sc-text'
          : 'text-sc-text-muted hover:bg-sc-surface/60 hover:text-sc-text',
        isDropTarget && 'ring-2 ring-sc-accent/70',
        isPcDropTarget && 'ring-2 ring-sc-primary/80 bg-sc-primary/10',
      )}
      style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {hasChildren !== undefined ? (
        <button
          type="button"
          aria-label={expanded ? 'collapse' : 'expand'}
          className="flex size-5 items-center justify-center rounded text-sc-text-dim hover:bg-sc-surface"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
        >
          {hasChildren ? (
            <ChevronRight className={cn('size-3.5 transition', expanded && 'rotate-90')} />
          ) : null}
        </button>
      ) : (
        <span className="size-5" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 truncate text-left"
        onClick={onClick}
      >
        <span className="text-sc-text-dim">{icon}</span>
        <span className="truncate">{label}</span>
        {count > 0 ? (
          <Badge variant="secondary" className="ml-auto h-5 px-1.5 text-[10px]">
            {count}
          </Badge>
        ) : null}
      </button>
      {trailing}
    </div>
  );
}

interface FolderEditorProps {
  depth: number;
  draftName: string;
  onDraftChange: (s: string) => void;
  busy: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

function FolderEditor({
  depth,
  draftName,
  onDraftChange,
  busy,
  onCommit,
  onCancel,
}: FolderEditorProps) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-1 rounded-md px-1 py-1"
      style={{ paddingLeft: `${depth * 0.75 + 0.25}rem` }}
    >
      <span className="size-5" />
      <Folder className="size-4 text-sc-text-dim" />
      <input
        autoFocus
        type="text"
        value={draftName}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder={t('folder.namePlaceholder')}
        className="h-6 flex-1 rounded border border-sc-border bg-sc-bg px-1 text-sm text-sc-text outline-none focus:border-sc-accent"
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit(draftName);
          else if (e.key === 'Escape') onCancel();
        }}
        disabled={busy}
      />
    </div>
  );
}

interface FolderTreeProps {
  nodes: FolderTreeNode[];
  expanded: Set<string>;
  selectedFolder: FolderSelection;
  fileCountByFolder: Map<string | null, number>;
  creatingChild: string | 'root' | null;
  renamingFolderId: string | null;
  draftName: string;
  onDraftChange: (s: string) => void;
  busy: boolean;
  onSelect: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onStartCreateChild: (parentId: string) => void;
  onStartRename: (id: string, name: string) => void;
  onCommitCreate: (parentId: string | null, name: string) => void;
  onCommitRename: (id: string, name: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  draggedFileIds: string[] | null;
  dragOverFolderId: string | null;
  onDragEnterFolder: (id: string) => void;
  onDragLeaveFolder: (id: string) => void;
  onDropFilesOnFolder: (id: string | null) => void;
  pcDropTargetFolderId: string | null;
  onPcDragEnterFolder: (id: string | null) => void;
  onPcDragLeaveFolder: (id: string | null) => void;
  onPcDropOnFolder: (e: React.DragEvent, id: string | null) => void;
}

function FolderTree(props: FolderTreeProps) {
  return (
    <div role="tree">
      {props.nodes.map((node) => (
        <FolderTreeNodeView key={node.id} node={node} {...props} />
      ))}
    </div>
  );
}

function FolderTreeNodeView({
  node,
  ...props
}: { node: FolderTreeNode } & FolderTreeProps) {
  const { t } = useTranslation();
  const isExpanded = props.expanded.has(node.id);
  const isSelected = props.selectedFolder === node.id;
  const count = props.fileCountByFolder.get(node.id) ?? 0;
  const isRenaming = props.renamingFolderId === node.id;
  const isCreatingChildHere = props.creatingChild === node.id;

  return (
    <div role="treeitem" aria-expanded={isExpanded}>
      <ContextMenu>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => props.onStartCreateChild(node.id)} disabled={props.busy}>
            <FolderPlus />
            {t('folder.actionNewSub')}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => props.onStartRename(node.id, node.name)}
            disabled={props.busy}
          >
            <Pencil />
            {t('folder.actionRename')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-sc-danger focus:text-sc-danger"
            onSelect={() => props.onDelete(node.id)}
            disabled={props.busy}
          >
            <Trash2 />
            {t('folder.actionDelete')}
          </ContextMenuItem>
        </ContextMenuContent>
        {/* ContextMenuTrigger asChild non e' usato perche' avvolge gia' la row */}
      </ContextMenu>

      {isRenaming ? (
        <FolderEditor
          depth={node.depth}
          draftName={props.draftName}
          onDraftChange={props.onDraftChange}
          busy={props.busy}
          onCommit={(name) => props.onCommitRename(node.id, name)}
          onCancel={props.onCancelEdit}
        />
      ) : (
        <FolderTreeRow
          label={node.name}
          icon={isExpanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
          count={count}
          depth={node.depth}
          selected={isSelected}
          isDropTarget={props.dragOverFolderId === node.id && Boolean(props.draggedFileIds)}
          isPcDropTarget={props.pcDropTargetFolderId === node.id}
          hasChildren={node.children.length > 0}
          expanded={isExpanded}
          onClick={() => props.onSelect(node.id)}
          onToggleExpand={() => props.onToggleExpand(node.id)}
          onDragOver={(e) => {
            if (props.draggedFileIds) {
              e.preventDefault();
              props.onDragEnterFolder(node.id);
            } else if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              e.stopPropagation();
              props.onPcDragEnterFolder(node.id);
            }
          }}
          onDragLeave={() => {
            props.onDragLeaveFolder(node.id);
            props.onPcDragLeaveFolder(node.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (props.draggedFileIds) {
              props.onDropFilesOnFolder(node.id);
            } else {
              props.onPcDropOnFolder(e, node.id);
            }
          }}
        />
      )}

      {isCreatingChildHere ? (
        <FolderEditor
          depth={node.depth + 1}
          draftName={props.draftName}
          onDraftChange={props.onDraftChange}
          busy={props.busy}
          onCommit={(name) => props.onCommitCreate(node.id, name)}
          onCancel={props.onCancelEdit}
        />
      ) : null}

      {isExpanded && node.children.length > 0 ? (
        <div role="group">
          {node.children.map((child) => (
            <FolderTreeNodeView key={child.id} node={child} {...props} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ----- CENTER PANE ---------------------------------------------------------

interface ExplorerCenterPaneProps {
  viewMode: ViewMode;
  sortBy: SortBy;
  subFolders: EventFolderRow[];
  files: PresentationRow[];
  versions: Record<string, VersionLite>;
  speakers: Record<string, SpeakerLite>;
  sessionsById: Record<string, SessionLite>;
  folderById: Map<string, EventFolderRow>;
  isAllFilesView: boolean;
  selectedFileIds: Set<string>;
  renamingFileVersionId: string | null;
  draftName: string;
  onDraftChange: (s: string) => void;
  onCommitFileRename: (versionId: string, name: string) => void;
  onCancelFileRename: () => void;
  onClickFile: (id: string, e: React.MouseEvent) => void;
  onDoubleClickFile: (id: string) => void;
  onClickFolder: (id: string) => void;
  fileCountByFolder: Map<string | null, number>;
  onDragStartFile: (id: string, e: React.DragEvent) => void;
  onDragEndFile: () => void;
  onDropFilesOnSubFolder: (folderId: string) => void;
  isPcDropping: boolean;
  onPcDragEnter: () => void;
  onPcDragLeave: () => void;
  onPcDrop: (e: React.DragEvent) => void;
  onContextOpen: (presentationId: string) => void;
  onContextDownload: (presentationId: string) => void;
  onContextRename: (presentationId: string) => void;
  onContextDelete: (presentationId: string) => void;
  onContextMove: (presentationId: string, folderId: string | null) => void;
  folders: EventFolderRow[];
  selectionCount: number;
  onClearSelection: () => void;
  onBulkMove: (folderId: string | null) => void;
  onBulkDelete: () => void;
  busy: boolean;
}

function ExplorerCenterPane(props: ExplorerCenterPaneProps) {
  const { t } = useTranslation();
  const isEmpty = props.subFolders.length === 0 && props.files.length === 0;

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden">
      {props.selectionCount > 0 ? (
        <SelectionBar
          count={props.selectionCount}
          folders={props.folders}
          busy={props.busy}
          onClear={props.onClearSelection}
          onMoveTo={props.onBulkMove}
          onDelete={props.onBulkDelete}
        />
      ) : null}

      <ScrollArea className="flex-1">
        <div
          className="relative min-h-full"
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes('Files')) {
              e.preventDefault();
              e.stopPropagation();
              props.onPcDragEnter();
            }
          }}
          onDragLeave={(e) => {
            // Solo se davvero stiamo uscendo dal pane (event currentTarget vs related)
            const rt = e.relatedTarget as Node | null;
            if (!rt || !e.currentTarget.contains(rt)) props.onPcDragLeave();
          }}
          onDrop={props.onPcDrop}
        >
          {props.isPcDropping ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-sc-primary/10 ring-2 ring-inset ring-sc-primary">
              <div className="rounded-lg bg-sc-surface px-4 py-2 text-sm text-sc-text shadow">
                {t('explorer.dropOverlay.pcCenter')}
              </div>
            </div>
          ) : null}

          {isEmpty ? (
            <EmptyCenter isAllView={props.isAllFilesView} />
          ) : props.viewMode === 'grid' ? (
            <CenterGrid {...props} />
          ) : (
            <CenterList {...props} />
          )}
        </div>
      </ScrollArea>
    </main>
  );
}

function EmptyCenter({ isAllView }: { isAllView: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <Folder className="size-12 text-sc-text-dim" />
      <h3 className="text-base font-medium text-sc-text">
        {isAllView ? t('explorer.emptyAllTitle') : t('explorer.emptyFolderTitle')}
      </h3>
      <p className="max-w-md text-sm text-sc-text-dim">
        {isAllView ? t('explorer.emptyAllDesc') : t('explorer.emptyFolderDesc')}
      </p>
    </div>
  );
}

function CenterGrid(props: ExplorerCenterPaneProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {/* Sub-folders */}
      {props.subFolders.map((f) => (
        <FolderTile
          key={f.id}
          folder={f}
          count={props.fileCountByFolder.get(f.id) ?? 0}
          onOpen={() => props.onClickFolder(f.id)}
          onDropFiles={() => props.onDropFilesOnSubFolder(f.id)}
        />
      ))}
      {/* Files */}
      {props.files.map((p) => {
        const v = p.current_version_id ? props.versions[p.current_version_id] : null;
        const sp = p.speaker_id ? props.speakers[p.speaker_id] : null;
        const session = p.session_id ? props.sessionsById[p.session_id] : null;
        const isSelected = props.selectedFileIds.has(p.id);
        const isRenaming = v && props.renamingFileVersionId === v.id;
        const fileName = v?.file_name ?? t('production.untitledFile');
        const Icon = pickFileIcon(v?.mime_type);
        return (
          <ContextMenu key={p.id}>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => props.onContextOpen(p.id)}>
                <Eye />
                {t('explorer.context.open')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => props.onContextDownload(p.id)}>
                <Download />
                {t('explorer.context.download')}
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => props.onContextRename(p.id)}>
                <Pencil />
                {t('explorer.context.rename')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <MoveRight />
                  {t('production.moveTo')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                  <ContextMenuItem onSelect={() => props.onContextMove(p.id, null)}>
                    <Home />
                    {t('production.rootLabel')}
                  </ContextMenuItem>
                  {props.folders.length > 0 ? <ContextMenuSeparator /> : null}
                  {props.folders.map((f) => (
                    <ContextMenuItem
                      key={f.id}
                      onSelect={() => props.onContextMove(p.id, f.id)}
                    >
                      <Folder />
                      {f.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-sc-danger focus:text-sc-danger"
                onSelect={() => props.onContextDelete(p.id)}
              >
                <Trash2 />
                {t('explorer.context.delete')}
              </ContextMenuItem>
            </ContextMenuContent>
            <button
              type="button"
              draggable
              onDragStart={(e) => props.onDragStartFile(p.id, e)}
              onDragEnd={props.onDragEndFile}
              onClick={(e) => props.onClickFile(p.id, e)}
              onDoubleClick={() => props.onDoubleClickFile(p.id)}
              className={cn(
                'flex flex-col rounded-lg border bg-sc-surface/40 p-3 text-left text-sm transition focus:outline-none',
                isSelected
                  ? 'border-sc-accent ring-2 ring-sc-accent/40'
                  : 'border-sc-border hover:border-sc-text-dim hover:bg-sc-surface/70',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                  {fileExt(fileName) || 'file'}
                </Badge>
                {p.status === 'approved' ? (
                  <Badge variant="success" className="text-[10px]">
                    ok
                  </Badge>
                ) : p.status === 'rejected' ? (
                  <Badge variant="destructive" className="text-[10px]">
                    ko
                  </Badge>
                ) : null}
              </div>
              <div className="mt-2 flex aspect-video items-center justify-center rounded bg-sc-bg/60 text-sc-text-dim">
                <Icon className="size-10" />
              </div>
              {isRenaming && v ? (
                <input
                  autoFocus
                  type="text"
                  value={props.draftName}
                  onChange={(e) => props.onDraftChange(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') props.onCommitFileRename(v.id, props.draftName);
                    else if (e.key === 'Escape') props.onCancelFileRename();
                    e.stopPropagation();
                  }}
                  className="mt-2 w-full rounded border border-sc-accent bg-sc-bg px-1 py-0.5 text-xs text-sc-text outline-none"
                />
              ) : (
                <p className="mt-2 line-clamp-2 break-all text-xs font-medium text-sc-text">
                  {fileName}
                </p>
              )}
              <p className="mt-1 line-clamp-1 text-[11px] text-sc-text-dim">
                {sp?.full_name ?? t('production.unknownSpeaker')}
              </p>
              {session && props.isAllFilesView ? (
                <p className="mt-0.5 line-clamp-1 text-[11px] text-sc-text-dim">
                  {session.title}
                </p>
              ) : null}
              {v ? (
                <p className="mt-1 text-[11px] text-sc-text-dim">
                  {formatBytesShort(v.file_size_bytes)}
                </p>
              ) : null}
            </button>
          </ContextMenu>
        );
      })}
    </div>
  );
}

interface FolderTileProps {
  folder: EventFolderRow;
  count: number;
  onOpen: () => void;
  onDropFiles: () => void;
}
function FolderTile({ folder, count, onOpen, onDropFiles }: FolderTileProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <button
      type="button"
      onDoubleClick={onOpen}
      onClick={onOpen}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropFiles();
      }}
      className={cn(
        'flex flex-col rounded-lg border p-3 text-left text-sm transition focus:outline-none',
        isDragOver
          ? 'border-sc-accent bg-sc-accent/10 ring-2 ring-sc-accent/40'
          : 'border-sc-border bg-sc-surface/30 hover:border-sc-text-dim hover:bg-sc-surface/60',
      )}
    >
      <div className="flex aspect-video items-center justify-center rounded bg-sc-bg/40 text-sc-text-dim">
        <Folder className="size-10" />
      </div>
      <p className="mt-2 line-clamp-2 break-all text-xs font-medium text-sc-text">
        {folder.name}
      </p>
      <p className="mt-1 text-[11px] text-sc-text-dim">
        {count > 0 ? `${count} file` : '—'}
      </p>
    </button>
  );
}

function CenterList(props: ExplorerCenterPaneProps) {
  const { t } = useTranslation();
  return (
    <div className="px-2 py-2 sm:px-4">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-sc-text-dim">
          <tr className="border-b border-sc-border/40">
            <th className="w-1/2 px-2 py-1.5">{t('explorer.col.name')}</th>
            <th className="px-2 py-1.5">{t('explorer.col.size')}</th>
            <th className="hidden px-2 py-1.5 md:table-cell">{t('explorer.col.modified')}</th>
            <th className="hidden px-2 py-1.5 md:table-cell">{t('explorer.col.speaker')}</th>
          </tr>
        </thead>
        <tbody>
          {props.subFolders.map((f) => (
            <FolderRowTable
              key={f.id}
              folder={f}
              count={props.fileCountByFolder.get(f.id) ?? 0}
              onOpen={() => props.onClickFolder(f.id)}
              onDropFiles={() => props.onDropFilesOnSubFolder(f.id)}
            />
          ))}
          {props.files.map((p) => {
            const v = p.current_version_id ? props.versions[p.current_version_id] : null;
            const sp = p.speaker_id ? props.speakers[p.speaker_id] : null;
            const isSelected = props.selectedFileIds.has(p.id);
            const isRenaming = v && props.renamingFileVersionId === v.id;
            const fileName = v?.file_name ?? t('production.untitledFile');
            const Icon = pickFileIcon(v?.mime_type);
            return (
              <ContextMenu key={p.id}>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => props.onContextOpen(p.id)}>
                    <Eye /> {t('explorer.context.open')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => props.onContextDownload(p.id)}>
                    <Download /> {t('explorer.context.download')}
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => props.onContextRename(p.id)}>
                    <Pencil /> {t('explorer.context.rename')}
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <MoveRight /> {t('production.moveTo')}
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                      <ContextMenuItem onSelect={() => props.onContextMove(p.id, null)}>
                        <Home />
                        {t('production.rootLabel')}
                      </ContextMenuItem>
                      {props.folders.length > 0 ? <ContextMenuSeparator /> : null}
                      {props.folders.map((f) => (
                        <ContextMenuItem
                          key={f.id}
                          onSelect={() => props.onContextMove(p.id, f.id)}
                        >
                          <Folder /> {f.name}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-sc-danger focus:text-sc-danger"
                    onSelect={() => props.onContextDelete(p.id)}
                  >
                    <Trash2 /> {t('explorer.context.delete')}
                  </ContextMenuItem>
                </ContextMenuContent>
                <tr
                  draggable
                  onDragStart={(e) => props.onDragStartFile(p.id, e)}
                  onDragEnd={props.onDragEndFile}
                  onClick={(e) => props.onClickFile(p.id, e)}
                  onDoubleClick={() => props.onDoubleClickFile(p.id)}
                  className={cn(
                    'cursor-pointer border-b border-sc-border/30 hover:bg-sc-surface/40',
                    isSelected && 'bg-sc-accent/15',
                  )}
                >
                  <td className="truncate px-2 py-1.5">
                    <span className="flex items-center gap-2">
                      <Icon className="size-4 text-sc-text-dim" />
                      {isRenaming && v ? (
                        <input
                          autoFocus
                          type="text"
                          value={props.draftName}
                          onChange={(e) => props.onDraftChange(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onDoubleClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') props.onCommitFileRename(v.id, props.draftName);
                            else if (e.key === 'Escape') props.onCancelFileRename();
                            e.stopPropagation();
                          }}
                          className="w-full rounded border border-sc-accent bg-sc-bg px-1 py-0.5 text-xs text-sc-text outline-none"
                        />
                      ) : (
                        <span className="truncate text-sc-text">{fileName}</span>
                      )}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-sc-text-dim">
                    {v ? formatBytesShort(v.file_size_bytes) : '—'}
                  </td>
                  <td className="hidden px-2 py-1.5 text-sc-text-dim md:table-cell">
                    {p.updated_at ? new Date(p.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="hidden truncate px-2 py-1.5 text-sc-text-dim md:table-cell">
                    {sp?.full_name ?? '—'}
                  </td>
                </tr>
              </ContextMenu>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

interface FolderRowTableProps {
  folder: EventFolderRow;
  count: number;
  onOpen: () => void;
  onDropFiles: () => void;
}
function FolderRowTable({ folder, count, onOpen, onDropFiles }: FolderRowTableProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  return (
    <tr
      onClick={onOpen}
      onDoubleClick={onOpen}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        onDropFiles();
      }}
      className={cn(
        'cursor-pointer border-b border-sc-border/30 hover:bg-sc-surface/40',
        isDragOver && 'bg-sc-accent/15 ring-1 ring-inset ring-sc-accent',
      )}
    >
      <td className="truncate px-2 py-1.5">
        <span className="flex items-center gap-2">
          <Folder className="size-4 text-sc-accent" />
          <span className="truncate font-medium text-sc-text">{folder.name}</span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-sc-text-dim">{count > 0 ? `${count} file` : '—'}</td>
      <td className="hidden px-2 py-1.5 text-sc-text-dim md:table-cell">—</td>
      <td className="hidden px-2 py-1.5 text-sc-text-dim md:table-cell">—</td>
    </tr>
  );
}

// ----- SELECTION BAR -------------------------------------------------------

interface SelectionBarProps {
  count: number;
  busy: boolean;
  folders: EventFolderRow[];
  onClear: () => void;
  onMoveTo: (folderId: string | null) => void;
  onDelete: () => void;
}

function SelectionBar({ count, busy, folders, onClear, onMoveTo, onDelete }: SelectionBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-sc-border bg-sc-accent/10 px-4 py-2 text-sm sm:px-6">
      <span className="font-medium text-sc-text">
        {t('production.selectedCount', { count })}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex h-7 items-center gap-1 rounded-md border border-sc-border bg-sc-surface px-2 text-xs text-sc-text hover:bg-sc-surface/70">
          <MoveRight className="size-3.5" />
          {t('production.moveTo')}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuItem onSelect={() => onMoveTo(null)}>
            <Home />
            {t('production.rootLabel')}
          </DropdownMenuItem>
          {folders.length > 0 ? <DropdownMenuSeparator /> : null}
          {folders.map((f) => (
            <DropdownMenuItem key={f.id} onSelect={() => onMoveTo(f.id)}>
              <Folder />
              {f.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button size="sm" variant="ghost" onClick={onDelete} disabled={busy}>
        <Trash2 className="text-sc-danger" />
        <span className="text-sc-danger">{t('explorer.context.delete')}</span>
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
        <X />
        {t('production.clearSelection')}
      </Button>
      {busy ? <Loader2 className="size-4 animate-spin text-sc-text-dim" /> : null}
    </div>
  );
}

// ----- RIGHT PANE ----------------------------------------------------------

interface ExplorerRightPaneProps {
  selectedFile: PresentationRow | null;
  selectionCount: number;
  versions: Record<string, VersionLite>;
  speakers: Record<string, SpeakerLite>;
  sessionsById: Record<string, SessionLite>;
  folderById: Map<string, EventFolderRow>;
  locale: string;
  onPreview: (versionId: string) => void;
  onDownload: (versionId: string) => void;
  onRename: (versionId: string, currentName: string) => void;
  onDelete: (presentationId: string) => void;
  folders: EventFolderRow[];
  onMoveTo: (presentationId: string, folderId: string | null) => void;
}

function ExplorerRightPane(props: ExplorerRightPaneProps) {
  const { t } = useTranslation();
  if (props.selectionCount > 1) {
    return (
      <aside className="hidden w-72 shrink-0 border-l border-sc-border bg-sc-surface/30 lg:block">
        <div className="px-4 py-4 text-xs text-sc-text-dim">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide">
            {t('explorer.detailPaneTitle')}
          </h3>
          <p>{t('explorer.multiSelected', { count: props.selectionCount })}</p>
        </div>
      </aside>
    );
  }
  if (!props.selectedFile) {
    return (
      <aside className="hidden w-72 shrink-0 border-l border-sc-border bg-sc-surface/30 lg:block">
        <div className="px-4 py-4 text-xs text-sc-text-dim">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide">
            {t('explorer.detailPaneTitle')}
          </h3>
          <p>{t('explorer.noSelection')}</p>
        </div>
      </aside>
    );
  }
  const p = props.selectedFile;
  const v = p.current_version_id ? props.versions[p.current_version_id] : null;
  const sp = p.speaker_id ? props.speakers[p.speaker_id] : null;
  const session = p.session_id ? props.sessionsById[p.session_id] : null;
  const folder = p.folder_id ? props.folderById.get(p.folder_id) : null;
  return (
    <aside className="hidden w-72 shrink-0 flex-col border-l border-sc-border bg-sc-surface/30 lg:flex">
      <ScrollArea className="flex-1">
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <MimeIcon mime={v?.mime_type} className="size-5 text-sc-accent" />
            <h3 className="break-all text-sm font-semibold text-sc-text">
              {v?.file_name ?? t('production.untitledFile')}
            </h3>
          </div>

          {v ? (
            <div className="space-y-1.5 rounded-lg bg-sc-bg/40 p-3 text-xs">
              <DetailRow label={t('explorer.detail.size')} value={formatBytesShort(v.file_size_bytes)} />
              <DetailRow label={t('explorer.detail.type')} value={v.mime_type ?? '—'} />
              <DetailRow label={t('explorer.detail.status')} value={v.status} />
            </div>
          ) : null}

          <div className="space-y-1.5 rounded-lg bg-sc-bg/40 p-3 text-xs">
            <DetailRow label={t('explorer.detail.session')} value={session?.title ?? '—'} />
            <DetailRow label={t('explorer.detail.speaker')} value={sp?.full_name ?? '—'} />
            <DetailRow label={t('explorer.detail.folder')} value={folder?.name ?? t('production.rootLabel')} />
            <DetailRow
              label={t('explorer.detail.modified')}
              value={formatDate(p.updated_at, props.locale)}
            />
            <DetailRow
              label={t('explorer.detail.created')}
              value={formatDate(p.created_at, props.locale)}
            />
          </div>

          <div className="space-y-1.5">
            <Button
              size="sm"
              variant="accent"
              className="w-full justify-start"
              onClick={() => v && props.onPreview(v.id)}
              disabled={!v}
            >
              <Eye />
              {t('explorer.action.preview')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={() => v && props.onDownload(v.id)}
              disabled={!v}
            >
              <Download />
              {t('explorer.action.download')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={() => v && props.onRename(v.id, v.file_name)}
              disabled={!v}
            >
              <Pencil />
              {t('explorer.action.rename')}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="flex h-8 w-full items-center gap-2 rounded-md border border-sc-border bg-sc-surface px-3 text-xs text-sc-text hover:bg-sc-surface/70">
                <MoveRight className="size-3.5" />
                <span>{t('production.moveTo')}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="max-h-72 w-56 overflow-y-auto">
                <DropdownMenuItem onSelect={() => props.onMoveTo(p.id, null)}>
                  <Home />
                  {t('production.rootLabel')}
                </DropdownMenuItem>
                {props.folders.length > 0 ? <DropdownMenuSeparator /> : null}
                {props.folders.map((f) => (
                  <DropdownMenuItem
                    key={f.id}
                    onSelect={() => props.onMoveTo(p.id, f.id)}
                  >
                    <Folder />
                    {f.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start text-sc-danger"
              onClick={() => props.onDelete(p.id)}
            >
              <Trash2 />
              {t('explorer.action.delete')}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="text-sc-text-dim">{label}</span>
      <span className="truncate text-right text-sc-text">{value}</span>
    </div>
  );
}

// ----- UPLOAD QUEUE DOCK ---------------------------------------------------

interface ExplorerUploadDockProps {
  jobs: UploadJob[];
  onCancel: (jobId: string) => void;
  onClearFinished: () => void;
}

function ExplorerUploadDock({ jobs, onCancel, onClearFinished }: ExplorerUploadDockProps) {
  const { t } = useTranslation();
  const active = jobs.filter((j) => j.status !== 'done' && j.status !== 'error' && j.status !== 'cancelled');
  const done = jobs.filter((j) => j.status === 'done');
  const failed = jobs.filter((j) => j.status === 'error' || j.status === 'cancelled');
  return (
    <div className="border-t border-sc-border bg-sc-surface/60 px-4 py-2 text-xs sm:px-6">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-sc-text">
          {t('explorer.upload.dockTitle', {
            active: active.length,
            done: done.length,
            failed: failed.length,
          })}
        </span>
        {done.length + failed.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={onClearFinished}>
            {t('explorer.upload.clearFinished')}
          </Button>
        ) : null}
      </div>
      <div className="max-h-32 overflow-y-auto">
        {jobs.map((j) => (
          <div
            key={j.id}
            className="flex items-center gap-2 border-t border-sc-border/30 py-1 first:border-t-0"
          >
            <span className="flex-1 truncate text-sc-text">{j.fileName}</span>
            <span className="w-12 text-right text-sc-text-dim">
              {Math.round(j.progress * 100)}%
            </span>
            <span
              className={cn(
                'w-20 text-right text-[10px] uppercase',
                j.status === 'done' && 'text-sc-success',
                j.status === 'error' && 'text-sc-danger',
                j.status === 'cancelled' && 'text-sc-text-dim',
                j.status !== 'done' && j.status !== 'error' && j.status !== 'cancelled' && 'text-sc-accent',
              )}
            >
              {j.status}
            </span>
            {j.status !== 'done' && j.status !== 'error' && j.status !== 'cancelled' ? (
              <button
                type="button"
                onClick={() => onCancel(j.id)}
                className="text-sc-text-dim hover:text-sc-danger"
                aria-label={t('common.cancel')}
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
