import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import {
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  Loader2,
  MoveRight,
  Pencil,
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
  ContextMenuTrigger,
  ScrollArea,
  cn,
} from '@slidecenter/ui';
import { getSupabaseBrowserClient } from '@/lib/supabase';
import {
  buildFolderTree,
  createEventFolder,
  deleteEventFolder,
  listEventFolders,
  movePresentationsToFolder,
  renameEventFolder,
  type EventFolderRow,
  type FolderTreeNode,
} from '@/features/folders/repository';

/**
 * Sprint U-2 (UX redesign V2.0): vista "Production" stile OneDrive/Drive
 * che permette agli admin di organizzare le presentations dell'evento in
 * cartelle. Layout a 2 pane:
 *   - sinistra: tree cartelle ricorsivo + nodo "Tutti i file" (root)
 *   - destra : grid file della cartella correntemente selezionata
 *
 * Funzionalita' MVP coperte:
 *   1) Tree espandibile con CRUD inline (nuova / rinomina / elimina).
 *   2) Breadcrumb sopra la grid (Evento → cartella corrente con percorso).
 *   3) Multi-select su file (Ctrl/Cmd+click toggle, click semplice = select
 *      singolo, "Annulla" deseleziona tutto).
 *   4) Bulk action: "Sposta a..." in 1 click verso qualunque cartella o root,
 *      via RPC atomica `move_presentations_to_folder`.
 *   5) Drag & drop di un file su una cartella del tree → move istantaneo.
 *   6) Context menu (right-click) su file: Sposta a..., Apri sessione.
 *
 * Funzionalita' che NON sono in questo MVP (rinviate a U-2.x se necessario):
 *   - upload diretto dalla ProductionView (l'upload resta dentro la sessione,
 *     dove c'e' tutta la pipeline di validation, queue, version);
 *   - drag & drop file dal SO (idem);
 *   - shift+click range select sulla grid.
 *
 * Realtime: niente sub Realtime per ora — refetch on mount + dopo ogni
 * mutazione (l'evento ha numeri "umani", 100-300 presentations max).
 */

type PresentationRow = Pick<
  Database['public']['Tables']['presentations']['Row'],
  | 'id'
  | 'session_id'
  | 'speaker_id'
  | 'folder_id'
  | 'status'
  | 'current_version_id'
  | 'updated_at'
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
  status: string;
};

type EventLite = {
  id: string;
  name: string;
  tenant_id: string;
};

interface ProductionState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  message?: string;
  event?: EventLite;
  folders: EventFolderRow[];
  presentations: PresentationRow[];
  sessions: Record<string, SessionLite>;
  speakers: Record<string, SpeakerLite>;
  versions: Record<string, VersionLite>;
}

const EMPTY_STATE: ProductionState = {
  status: 'idle',
  folders: [],
  presentations: [],
  sessions: {},
  speakers: {},
  versions: {},
};

function formatBytesShort(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function ProductionView() {
  const { t } = useTranslation();
  const params = useParams();
  const eventId = params.eventId ?? '';
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [state, setState] = useState<ProductionState>(EMPTY_STATE);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingChild, setCreatingChild] = useState<string | 'root' | null>(null);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

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
          .select('id, session_id, speaker_id, folder_id, status, current_version_id, updated_at')
          .eq('event_id', eventId)
          .order('updated_at', { ascending: false })
          .limit(2000),
        supabase
          .from('sessions')
          .select('id, title, room_id')
          .eq('event_id', eventId)
          .limit(1000),
        supabase
          .from('event_speakers')
          .select('speaker_id, speakers(id, full_name)')
          .eq('event_id', eventId)
          .limit(2000),
      ]);

      if (presentationsRes.error) throw new Error(presentationsRes.error.message);
      if (sessionsRes.error) throw new Error(sessionsRes.error.message);
      if (speakersRes.error) throw new Error(speakersRes.error.message);

      const presentations = (presentationsRes.data ?? []) as PresentationRow[];
      const sessions: Record<string, SessionLite> = {};
      (sessionsRes.data ?? []).forEach((s) => {
        const row = s as { id: string; title: string; room_id: string | null };
        sessions[row.id] = row;
      });
      const speakers: Record<string, SpeakerLite> = {};
      (speakersRes.data ?? []).forEach((row) => {
        const sp = (row as { speakers: SpeakerLite | null }).speakers;
        if (sp) speakers[sp.id] = sp;
      });

      // versions: prendo solo le current_version_id presenti
      const versionIds = presentations
        .map((p) => p.current_version_id)
        .filter((v): v is string => Boolean(v));
      const versions: Record<string, VersionLite> = {};
      if (versionIds.length > 0) {
        // chunk a 200 per non superare i limit di IN(...)
        const chunkSize = 200;
        for (let i = 0; i < versionIds.length; i += chunkSize) {
          const chunk = versionIds.slice(i, i + chunkSize);
          const versionsRes = await supabase
            .from('presentation_versions')
            .select('id, file_name, file_size_bytes, status')
            .in('id', chunk);
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
        speakers,
        versions,
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

  const tree = useMemo(() => buildFolderTree(state.folders), [state.folders]);
  const folderById = useMemo(() => {
    const map = new Map<string, EventFolderRow>();
    state.folders.forEach((f) => map.set(f.id, f));
    return map;
  }, [state.folders]);

  // Conta i file per cartella per mostrare badge nel tree
  const fileCountByFolder = useMemo(() => {
    const counts = new Map<string | null, number>();
    state.presentations.forEach((p) => {
      const key = p.folder_id;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [state.presentations]);

  const breadcrumb = useMemo(() => {
    if (!selectedFolderId) return [] as EventFolderRow[];
    const chain: EventFolderRow[] = [];
    let cur = folderById.get(selectedFolderId) ?? null;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parent_id ? (folderById.get(cur.parent_id) ?? null) : null;
    }
    return chain;
  }, [folderById, selectedFolderId]);

  const filteredFiles = useMemo(() => {
    return state.presentations.filter((p) => p.folder_id === selectedFolderId);
  }, [state.presentations, selectedFolderId]);

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

  const handleSelectFolder = useCallback((id: string | null) => {
    setSelectedFolderId(id);
    setSelectedFileIds(new Set());
    setActionError(null);
  }, []);

  const handleToggleFile = useCallback((id: string, multi: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (multi) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      } else if (next.size === 1 && next.has(id)) {
        next.clear();
      } else {
        next.clear();
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedFileIds(new Set()), []);

  const handleCreateFolder = useCallback(
    async (parentId: string | null, name: string) => {
      if (!state.event) return;
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setCreatingChild(null);
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
        if (selectedFolderId === folderId) setSelectedFolderId(null);
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'delete_failed');
      } finally {
        setBusy(false);
      }
    },
    [reload, selectedFolderId, t],
  );

  const handleMoveFiles = useCallback(
    async (presentationIds: string[], folderId: string | null) => {
      if (presentationIds.length === 0) return;
      setBusy(true);
      setActionError(null);
      try {
        await movePresentationsToFolder(presentationIds, folderId);
        clearSelection();
        await reload();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'move_failed');
      } finally {
        setBusy(false);
      }
    },
    [clearSelection, reload],
  );

  // ====== render branches ======

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
        <h1 className="text-lg font-semibold text-sc-error">{t('common.errorTitle')}</h1>
        <p className="mt-2 text-sm text-sc-text-dim">{state.message}</p>
        <Button className="mt-4" variant="outline" onClick={() => void reload()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  }
  if (!state.event) return null;

  const event = state.event;

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-sc-border bg-sc-surface/40 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-sc-text-dim">
              {t('production.headerKicker')}
            </p>
            <h1 className="mt-1 truncate text-2xl font-semibold text-sc-text">{event.name}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={`/events/${event.id}`}>
                <ChevronRight className="mr-0 rotate-180" />
                {t('production.backToEvent')}
              </Link>
            </Button>
            <Button asChild size="sm" variant="accent">
              <Link to={`/events/${event.id}#sessions`}>
                <Upload />
                {t('production.uploadFromSession')}
              </Link>
            </Button>
          </div>
        </div>

        <Breadcrumb
          eventName={event.name}
          eventId={event.id}
          chain={breadcrumb}
          onSelectFolder={handleSelectFolder}
        />
      </header>

      {actionError ? (
        <div
          role="alert"
          className="border-b border-sc-error/40 bg-sc-error/10 px-6 py-2 text-sm text-sc-error"
        >
          {actionError}
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 shrink-0 border-r border-sc-border bg-sc-surface/30">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-sc-text-dim">
              {t('production.sidebarTitle')}
            </h2>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreatingChild('root');
                setDraftName('');
              }}
              disabled={busy}
            >
              <FolderPlus />
              <span className="sr-only">{t('folder.newRootFolder')}</span>
            </Button>
          </div>
          <ScrollArea className="h-[calc(100%-3rem)]">
            <div className="px-2 pb-4">
              <FolderRow
                label={t('production.rootLabel')}
                icon={<Home className="size-4" />}
                count={fileCountByFolder.get(null) ?? 0}
                selected={selectedFolderId === null}
                depth={0}
                isDropTarget={dragOverFolderId === '__root__'}
                onClick={() => handleSelectFolder(null)}
                onDragOver={(e) => {
                  if (!draggedFileId) return;
                  e.preventDefault();
                  setDragOverFolderId('__root__');
                }}
                onDragLeave={() => setDragOverFolderId((s) => (s === '__root__' ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverFolderId(null);
                  if (draggedFileId) void handleMoveFiles([draggedFileId], null);
                  setDraggedFileId(null);
                }}
              />

              {creatingChild === 'root' ? (
                <FolderEditor
                  depth={1}
                  initial=""
                  draftName={draftName}
                  onDraftChange={setDraftName}
                  busy={busy}
                  onCommit={(name) => handleCreateFolder(null, name)}
                  onCancel={() => {
                    setCreatingChild(null);
                    setDraftName('');
                  }}
                />
              ) : null}

              <FolderTree
                nodes={tree}
                expanded={expanded}
                onToggleExpanded={toggleExpanded}
                selectedFolderId={selectedFolderId}
                onSelect={handleSelectFolder}
                fileCountByFolder={fileCountByFolder}
                creatingChild={creatingChild}
                onStartCreateChild={(parentId) => {
                  setCreatingChild(parentId);
                  setDraftName('');
                  expandFolder(parentId);
                }}
                renamingFolderId={renamingFolderId}
                onStartRename={(id, currentName) => {
                  setRenamingFolderId(id);
                  setDraftName(currentName);
                }}
                draftName={draftName}
                onDraftChange={setDraftName}
                onCommitCreate={handleCreateFolder}
                onCommitRename={handleRenameFolder}
                onCancelEdit={() => {
                  setCreatingChild(null);
                  setRenamingFolderId(null);
                  setDraftName('');
                }}
                onDelete={handleDeleteFolder}
                busy={busy}
                draggedFileId={draggedFileId}
                dragOverFolderId={dragOverFolderId}
                onDragEnterFolder={(id) => setDragOverFolderId(id)}
                onDragLeaveFolder={(id) =>
                  setDragOverFolderId((cur) => (cur === id ? null : cur))
                }
                onDropOnFolder={(folderId) => {
                  setDragOverFolderId(null);
                  if (draggedFileId) void handleMoveFiles([draggedFileId], folderId);
                  setDraggedFileId(null);
                }}
              />
            </div>
          </ScrollArea>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          {selectedFileIds.size > 0 ? (
            <SelectionBar
              count={selectedFileIds.size}
              onClear={clearSelection}
              folders={state.folders}
              busy={busy}
              onMoveTo={(folderId) =>
                void handleMoveFiles(Array.from(selectedFileIds), folderId)
              }
            />
          ) : null}

          <ScrollArea className="flex-1">
            {filteredFiles.length === 0 ? (
              <EmptyGrid
                isRoot={selectedFolderId === null}
                folderName={
                  selectedFolderId
                    ? (folderById.get(selectedFolderId)?.name ?? '')
                    : ''
                }
              />
            ) : (
              <FilesGrid
                files={filteredFiles}
                selectedIds={selectedFileIds}
                onToggleSelect={handleToggleFile}
                sessions={state.sessions}
                speakers={state.speakers}
                versions={state.versions}
                folders={state.folders}
                onMoveTo={(presentationId, folderId) =>
                  void handleMoveFiles([presentationId], folderId)
                }
                onDragStart={(id) => setDraggedFileId(id)}
                onDragEnd={() => setDraggedFileId(null)}
                eventId={event.id}
              />
            )}
          </ScrollArea>
        </main>
      </div>
    </div>
  );
}

export { ProductionView as Component };

// ============================================================================
// SUB COMPONENTS
// ============================================================================

interface BreadcrumbProps {
  eventName: string;
  eventId: string;
  chain: EventFolderRow[];
  onSelectFolder: (id: string | null) => void;
}

function Breadcrumb({ eventName, chain, onSelectFolder }: BreadcrumbProps) {
  const { t } = useTranslation();
  return (
    <nav aria-label="breadcrumb" className="mt-3 flex flex-wrap items-center gap-1 text-sm">
      <button
        type="button"
        onClick={() => onSelectFolder(null)}
        className="text-sc-text-dim hover:text-sc-text"
      >
        {eventName}
      </button>
      <ChevronRight className="size-3.5 text-sc-text-dim" />
      <button
        type="button"
        onClick={() => onSelectFolder(null)}
        className={cn(
          'rounded px-1 hover:bg-sc-surface',
          chain.length === 0 ? 'font-medium text-sc-text' : 'text-sc-text-dim hover:text-sc-text',
        )}
      >
        {t('production.rootLabel')}
      </button>
      {chain.map((node, i) => (
        <span key={node.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 text-sc-text-dim" />
          <button
            type="button"
            onClick={() => onSelectFolder(node.id)}
            className={cn(
              'rounded px-1 hover:bg-sc-surface',
              i === chain.length - 1
                ? 'font-medium text-sc-text'
                : 'text-sc-text-dim hover:text-sc-text',
            )}
          >
            {node.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

interface FolderRowProps {
  label: string;
  icon: React.ReactNode;
  count: number;
  selected: boolean;
  depth: number;
  hasChildren?: boolean;
  expanded?: boolean;
  isDropTarget?: boolean;
  onClick: () => void;
  onToggleExpand?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: (e: React.DragEvent) => void;
  trailing?: React.ReactNode;
}

function FolderRow({
  label,
  icon,
  count,
  selected,
  depth,
  hasChildren,
  expanded,
  isDropTarget,
  onClick,
  onToggleExpand,
  onDragOver,
  onDragLeave,
  onDrop,
  trailing,
}: FolderRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-1 rounded-md px-1 py-1.5 text-sm',
        selected
          ? 'bg-sc-accent/15 text-sc-text'
          : 'text-sc-text-muted hover:bg-sc-surface/60 hover:text-sc-text',
        isDropTarget && 'ring-2 ring-sc-accent/70',
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
  initial: string;
  draftName: string;
  onDraftChange: (s: string) => void;
  busy: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}

function FolderEditor({
  depth,
  initial,
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
        placeholder={initial || t('folder.namePlaceholder')}
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
  onToggleExpanded: (id: string) => void;
  selectedFolderId: string | null;
  onSelect: (id: string) => void;
  fileCountByFolder: Map<string | null, number>;
  creatingChild: string | 'root' | null;
  onStartCreateChild: (parentId: string) => void;
  renamingFolderId: string | null;
  onStartRename: (id: string, currentName: string) => void;
  draftName: string;
  onDraftChange: (s: string) => void;
  onCommitCreate: (parentId: string | null, name: string) => void;
  onCommitRename: (folderId: string, name: string) => void;
  onCancelEdit: () => void;
  onDelete: (id: string) => void;
  busy: boolean;
  draggedFileId: string | null;
  dragOverFolderId: string | null;
  onDragEnterFolder: (id: string) => void;
  onDragLeaveFolder: (id: string) => void;
  onDropOnFolder: (folderId: string) => void;
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
  expanded,
  onToggleExpanded,
  selectedFolderId,
  onSelect,
  fileCountByFolder,
  creatingChild,
  onStartCreateChild,
  renamingFolderId,
  onStartRename,
  draftName,
  onDraftChange,
  onCommitCreate,
  onCommitRename,
  onCancelEdit,
  onDelete,
  busy,
  draggedFileId,
  dragOverFolderId,
  onDragEnterFolder,
  onDragLeaveFolder,
  onDropOnFolder,
}: { node: FolderTreeNode } & FolderTreeProps) {
  const { t } = useTranslation();
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedFolderId === node.id;
  const count = fileCountByFolder.get(node.id) ?? 0;
  const isRenaming = renamingFolderId === node.id;
  const isCreatingChildHere = creatingChild === node.id;

  return (
    <div role="treeitem" aria-expanded={isExpanded}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {isRenaming ? (
            <FolderEditor
              depth={node.depth}
              initial={node.name}
              draftName={draftName}
              onDraftChange={onDraftChange}
              busy={busy}
              onCommit={(name) => onCommitRename(node.id, name)}
              onCancel={onCancelEdit}
            />
          ) : (
            <FolderRow
              label={node.name}
              icon={isExpanded ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
              count={count}
              selected={isSelected}
              depth={node.depth}
              hasChildren={node.children.length > 0}
              expanded={isExpanded}
              isDropTarget={dragOverFolderId === node.id && Boolean(draggedFileId)}
              onClick={() => onSelect(node.id)}
              onToggleExpand={() => onToggleExpanded(node.id)}
              onDragOver={(e) => {
                if (!draggedFileId) return;
                e.preventDefault();
                onDragEnterFolder(node.id);
              }}
              onDragLeave={() => onDragLeaveFolder(node.id)}
              onDrop={(e) => {
                e.preventDefault();
                onDropOnFolder(node.id);
              }}
            />
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onStartCreateChild(node.id)} disabled={busy}>
            <FolderPlus />
            {t('folder.actionNewSub')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onStartRename(node.id, node.name)} disabled={busy}>
            <Pencil />
            {t('folder.actionRename')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-sc-error focus:text-sc-error"
            onSelect={() => onDelete(node.id)}
            disabled={busy}
          >
            <Trash2 />
            {t('folder.actionDelete')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isCreatingChildHere ? (
        <FolderEditor
          depth={node.depth + 1}
          initial=""
          draftName={draftName}
          onDraftChange={onDraftChange}
          busy={busy}
          onCommit={(name) => onCommitCreate(node.id, name)}
          onCancel={onCancelEdit}
        />
      ) : null}

      {isExpanded && node.children.length > 0 ? (
        <div role="group">
          {node.children.map((child) => (
            <FolderTreeNodeView
              key={child.id}
              node={child}
              nodes={[]}
              expanded={expanded}
              onToggleExpanded={onToggleExpanded}
              selectedFolderId={selectedFolderId}
              onSelect={onSelect}
              fileCountByFolder={fileCountByFolder}
              creatingChild={creatingChild}
              onStartCreateChild={onStartCreateChild}
              renamingFolderId={renamingFolderId}
              onStartRename={onStartRename}
              draftName={draftName}
              onDraftChange={onDraftChange}
              onCommitCreate={onCommitCreate}
              onCommitRename={onCommitRename}
              onCancelEdit={onCancelEdit}
              onDelete={onDelete}
              busy={busy}
              draggedFileId={draggedFileId}
              dragOverFolderId={dragOverFolderId}
              onDragEnterFolder={onDragEnterFolder}
              onDragLeaveFolder={onDragLeaveFolder}
              onDropOnFolder={onDropOnFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface SelectionBarProps {
  count: number;
  busy: boolean;
  folders: EventFolderRow[];
  onClear: () => void;
  onMoveTo: (folderId: string | null) => void;
}

function SelectionBar({ count, busy, folders, onClear, onMoveTo }: SelectionBarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-sc-border bg-sc-accent/10 px-6 py-2 text-sm">
      <span className="font-medium text-sc-text">
        {t('production.selectedCount', { count })}
      </span>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={busy}>
            <MoveRight />
            {t('production.moveTo')}
          </Button>
        </ContextMenuTrigger>
        <ContextMenuContent className="max-h-72 w-56 overflow-y-auto">
          <ContextMenuItem onSelect={() => onMoveTo(null)}>
            <Home />
            {t('production.rootLabel')}
          </ContextMenuItem>
          {folders.length > 0 ? <ContextMenuSeparator /> : null}
          {folders.map((f) => (
            <ContextMenuItem key={f.id} onSelect={() => onMoveTo(f.id)}>
              <Folder />
              {f.name}
            </ContextMenuItem>
          ))}
        </ContextMenuContent>
      </ContextMenu>
      <Button size="sm" variant="ghost" onClick={onClear} disabled={busy}>
        <X />
        {t('production.clearSelection')}
      </Button>
      {busy ? <Loader2 className="size-4 animate-spin text-sc-text-dim" /> : null}
    </div>
  );
}

interface FilesGridProps {
  files: PresentationRow[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string, multi: boolean) => void;
  sessions: Record<string, SessionLite>;
  speakers: Record<string, SpeakerLite>;
  versions: Record<string, VersionLite>;
  folders: EventFolderRow[];
  onMoveTo: (presentationId: string, folderId: string | null) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  eventId: string;
}

function FilesGrid({
  files,
  selectedIds,
  onToggleSelect,
  sessions,
  speakers,
  versions,
  folders,
  onMoveTo,
  onDragStart,
  onDragEnd,
  eventId,
}: FilesGridProps) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3 p-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {files.map((p) => {
        const session = p.session_id ? sessions[p.session_id] : null;
        const speaker = p.speaker_id ? speakers[p.speaker_id] : null;
        const version = p.current_version_id ? versions[p.current_version_id] : null;
        const isSelected = selectedIds.has(p.id);
        const fileName = version?.file_name ?? t('production.untitledFile');
        return (
          <ContextMenu key={p.id}>
            <ContextMenuTrigger asChild>
              <button
                type="button"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', p.id);
                  e.dataTransfer.effectAllowed = 'move';
                  onDragStart(p.id);
                }}
                onDragEnd={onDragEnd}
                onClick={(e) => onToggleSelect(p.id, e.metaKey || e.ctrlKey)}
                className={cn(
                  'flex flex-col rounded-lg border bg-sc-surface/40 p-3 text-left text-sm transition',
                  isSelected
                    ? 'border-sc-accent ring-2 ring-sc-accent/40'
                    : 'border-sc-border hover:border-sc-text-dim hover:bg-sc-surface/70',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                    {fileName.split('.').pop()?.slice(0, 5) ?? 'file'}
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
                <div className="mt-2 flex aspect-video items-center justify-center rounded bg-sc-bg/60 text-3xl text-sc-text-dim">
                  <Folder className="size-10" />
                </div>
                <p className="mt-2 line-clamp-2 break-all text-xs font-medium text-sc-text">
                  {fileName}
                </p>
                <p className="mt-1 line-clamp-1 text-[11px] text-sc-text-dim">
                  {speaker?.full_name ?? t('production.unknownSpeaker')}
                </p>
                {session ? (
                  <p className="mt-0.5 line-clamp-1 text-[11px] text-sc-text-dim">
                    {session.title}
                  </p>
                ) : null}
                {version ? (
                  <p className="mt-1 text-[11px] text-sc-text-dim">
                    {formatBytesShort(version.file_size_bytes)}
                  </p>
                ) : null}
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem asChild>
                <Link to={`/events/${eventId}#session-${p.session_id}`}>
                  <FolderOpen />
                  {t('production.openSession')}
                </Link>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <MoveRight />
                  {t('production.moveTo')}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
                  <ContextMenuItem onSelect={() => onMoveTo(p.id, null)}>
                    <Home />
                    {t('production.rootLabel')}
                  </ContextMenuItem>
                  {folders.length > 0 ? <ContextMenuSeparator /> : null}
                  {folders.map((f) => (
                    <ContextMenuItem key={f.id} onSelect={() => onMoveTo(p.id, f.id)}>
                      <Folder />
                      {f.name}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

interface EmptyGridProps {
  isRoot: boolean;
  folderName: string;
}

function EmptyGrid({ isRoot, folderName }: EmptyGridProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <Folder className="size-12 text-sc-text-dim" />
      <h3 className="text-base font-medium text-sc-text">
        {isRoot ? t('production.emptyRootTitle') : t('production.emptyFolderTitle', { folderName })}
      </h3>
      <p className="max-w-md text-sm text-sc-text-dim">
        {isRoot ? t('production.emptyRootDesc') : t('production.emptyFolderDesc')}
      </p>
    </div>
  );
}
