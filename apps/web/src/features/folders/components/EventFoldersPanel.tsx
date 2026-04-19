import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Folder, FolderPlus, Plus, Trash2 } from 'lucide-react';
import {
  Button,
  Input,
  Skeleton,
  cn,
} from '@slidecenter/ui';
import {
  buildFolderTree,
  createEventFolder,
  deleteEventFolder,
  listEventFolders,
  type EventFolderRow,
  type FolderTreeNode,
} from '@/features/folders/repository';

/**
 * Sprint U-2 (UX redesign V2.0): pannello gerarchia cartelle Production.
 *
 * Versione 1.1 (Sprint W A2): tree espandibile + CRUD inline solo per
 * "nuova cartella" e "elimina". La RINOMINA e' stata rimossa: l'unico
 * punto operativo per rinominare una cartella e' il File Explorer V2
 * (`/events/:id/production`) per evitare due punti di gestione e
 * disallineamenti UX. L'utente arriva li' tramite il banner CTA in
 * cima alla tab "Produzione" (vedi `EventDetailView.tsx`).
 *
 * NON ancora drag&drop file dentro una folder qui: la grid file +
 * pannello dettaglio + rinomina file vivono solo in `ProductionView`.
 */

interface EventFoldersPanelProps {
  eventId: string;
  tenantId: string;
}

export function EventFoldersPanel({ eventId, tenantId }: EventFoldersPanelProps) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<EventFolderRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creatingUnderId, setCreatingUnderId] = useState<string | 'root' | null>(null);
  const [createValue, setCreateValue] = useState<string>('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listEventFolders(eventId);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'load_failed');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = useMemo<FolderTreeNode[]>(() => (rows ? buildFolderTree(rows) : []), [rows]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCreate = useCallback(
    async (parentId: string | null) => {
      const name = createValue.trim();
      if (!name) return;
      setBusy('create');
      setError(null);
      try {
        await createEventFolder({ tenantId, eventId, parentId, name });
        setCreateValue('');
        setCreatingUnderId(null);
        if (parentId) setExpanded((prev) => new Set(prev).add(parentId));
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'create_failed');
      } finally {
        setBusy(null);
      }
    },
    [createValue, tenantId, eventId, load],
  );

  const handleDelete = useCallback(
    async (folder: FolderTreeNode) => {
      const childCount = folder.children.length;
      const confirmMsg =
        childCount > 0
          ? t('folder.confirmDeleteWithChildren', { count: childCount })
          : t('folder.confirmDelete');
      if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;
      setBusy(folder.id);
      setError(null);
      try {
        await deleteEventFolder(folder.id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'delete_failed');
      } finally {
        setBusy(null);
      }
    },
    [load, t],
  );

  return (
    <div className="rounded-xl border border-sc-primary/12 bg-sc-surface/50 p-5">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-sc-text">{t('folder.panelTitle')}</h3>
          <p className="mt-0.5 text-xs text-sc-text-dim">{t('folder.panelIntro')}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            setCreatingUnderId('root');
            setCreateValue('');
          }}
          disabled={loading || busy !== null}
        >
          <FolderPlus />
          {t('folder.newRootFolder')}
        </Button>
      </header>

      <p className="mb-3 rounded-md border border-sc-primary/15 bg-sc-primary/5 px-3 py-2 text-xs text-sc-text-dim">
        {t('folder.renameMovedToExplorer')}
      </p>

      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-md border border-sc-danger/30 bg-sc-danger/10 px-3 py-2 text-xs text-sc-danger"
        >
          {error}
        </p>
      ) : null}

      {loading && rows === null ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-3/4" />
          <Skeleton className="h-9 w-2/3" />
        </div>
      ) : rows && rows.length === 0 && creatingUnderId !== 'root' ? (
        <div className="rounded-lg border border-dashed border-sc-primary/20 px-4 py-8 text-center text-sm text-sc-text-dim">
          {t('folder.empty')}
        </div>
      ) : (
        <ul className="space-y-1">
          {creatingUnderId === 'root' ? (
            <li>
              <FolderCreateInput
                value={createValue}
                onChange={setCreateValue}
                onSubmit={() => handleCreate(null)}
                onCancel={() => {
                  setCreatingUnderId(null);
                  setCreateValue('');
                }}
                disabled={busy !== null}
                indent={0}
              />
            </li>
          ) : null}
          {tree.map((node) => (
            <FolderNodeRow
              key={node.id}
              node={node}
              expanded={expanded}
              creatingUnderId={creatingUnderId}
              createValue={createValue}
              busy={busy}
              onToggle={toggleExpand}
              onStartCreate={(id) => {
                setCreatingUnderId(id);
                setCreateValue('');
                setExpanded((prev) => new Set(prev).add(id));
              }}
              onChangeCreate={setCreateValue}
              onSubmitCreate={handleCreate}
              onCancelCreate={() => {
                setCreatingUnderId(null);
                setCreateValue('');
              }}
              onDelete={handleDelete}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface FolderNodeRowProps {
  node: FolderTreeNode;
  expanded: Set<string>;
  creatingUnderId: string | 'root' | null;
  createValue: string;
  busy: string | null;
  onToggle: (id: string) => void;
  onStartCreate: (id: string) => void;
  onChangeCreate: (val: string) => void;
  onSubmitCreate: (parentId: string | null) => void;
  onCancelCreate: () => void;
  onDelete: (node: FolderTreeNode) => void;
}

function FolderNodeRow(props: FolderNodeRowProps) {
  const {
    node,
    expanded,
    creatingUnderId,
    createValue,
    busy,
    onToggle,
    onStartCreate,
    onChangeCreate,
    onSubmitCreate,
    onCancelCreate,
    onDelete,
  } = props;
  const { t } = useTranslation();
  const isExpanded = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isCreatingHere = creatingUnderId === node.id;

  return (
    <li>
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors hover:bg-sc-primary/8',
        )}
        style={{ paddingLeft: `${node.depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={() => (hasChildren ? onToggle(node.id) : undefined)}
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center text-sc-text-dim transition-transform',
            isExpanded && hasChildren && 'rotate-90',
            !hasChildren && 'invisible',
          )}
          aria-label={isExpanded ? t('folder.collapse') : t('folder.expand')}
          aria-expanded={hasChildren ? isExpanded : undefined}
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <Folder className="h-4 w-4 shrink-0 text-sc-accent" />

        <span
          className="flex-1 truncate text-sm text-sc-text"
          title={t('folder.renameMovedToExplorer')}
        >
          {node.name}
        </span>
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label={t('folder.actionNewSub')}
            onClick={() => onStartCreate(node.id)}
            disabled={busy !== null}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-sc-danger hover:text-sc-danger/80"
            aria-label={t('folder.actionDelete')}
            onClick={() => onDelete(node)}
            disabled={busy !== null}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {(isExpanded || isCreatingHere) && (
        <ul className="space-y-1">
          {isCreatingHere ? (
            <li>
              <FolderCreateInput
                value={createValue}
                onChange={onChangeCreate}
                onSubmit={() => onSubmitCreate(node.id)}
                onCancel={onCancelCreate}
                disabled={busy !== null}
                indent={(node.depth + 1) * 16 + 8}
              />
            </li>
          ) : null}
          {isExpanded
            ? node.children.map((child) => (
                <FolderNodeRow
                  key={child.id}
                  {...props}
                  node={child}
                />
              ))
            : null}
        </ul>
      )}
    </li>
  );
}

function FolderCreateInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled,
  indent,
}: {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  disabled?: boolean;
  indent: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-1.5 rounded-md bg-sc-primary/8 px-2 py-1.5"
      style={{ paddingLeft: `${indent}px` }}
    >
      <Folder className="h-4 w-4 shrink-0 text-sc-accent" />
      <FolderInlineForm
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        onCancel={onCancel}
        disabled={disabled}
        placeholder={t('folder.namePlaceholder')}
      />
    </div>
  );
}

function FolderInlineForm({
  value,
  onChange,
  onSubmit,
  onCancel,
  disabled,
  placeholder,
}: {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  disabled?: boolean;
  placeholder: string;
}) {
  return (
    <form
      className="flex flex-1 items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="h-7 max-w-[260px] py-0 text-sm"
      />
      <Button type="submit" size="sm" variant="default" disabled={disabled || value.trim().length === 0}>
        OK
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
        Esc
      </Button>
    </form>
  );
}
